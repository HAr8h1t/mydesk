const { randomUUID } = require('node:crypto')
const { createServer } = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Pool } = require('pg')
const {
  createRefreshToken,
  createTokenService,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} = require('./security.cjs')

const syncEntityTypes = new Set([
  'task',
  'reminder',
  'note',
  'alarm',
  'calendar-event',
  'focus-session',
  'scheduled-focus-block',
])
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const bodyLimitBytes = 2 * 1024 * 1024
const refreshLifetimeDays = 30

function jsonResponse(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > bodyLimitBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })
  }
}

function validateDeviceId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    throw Object.assign(new TypeError('A valid device id is required.'), { status: 400 })
  }
  return value
}

function validateSyncOperation(operation) {
  if (!operation || !idPattern.test(operation.operationId || '')
    || !syncEntityTypes.has(operation.entityType)
    || typeof operation.recordId !== 'string' || !operation.recordId || operation.recordId.length > 200
    || !['upsert', 'delete'].includes(operation.operation)
    || !Number.isSafeInteger(operation.baseServerVersion) || operation.baseServerVersion < 0
    || (operation.operation === 'upsert' && (
      !operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)
      || operation.payload.id !== operation.recordId
      || operation.entityType === 'focus-session' && operation.payload.status === 'active'
      || Buffer.byteLength(JSON.stringify(operation.payload)) > 256 * 1024
    ))) {
    throw Object.assign(new TypeError('A sync operation is invalid.'), { status: 400 })
  }
}

function presentSyncRecord(record, accountId) {
  return {
    accountId,
    entityType: record.entity_type,
    recordId: record.record_id,
    payload: record.payload,
    createdAt: new Date(record.created_at).toISOString(),
    updatedAt: new Date(record.updated_at).toISOString(),
    deletedAt: record.deleted_at ? new Date(record.deleted_at).toISOString() : '',
    serverVersion: Number(record.server_version),
    deviceId: record.device_id,
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function migrate(pool) {
  const sql = await fs.readFile(path.join(__dirname, 'migrations', '001_initial.sql'), 'utf8')
  await pool.query(sql)
}

function createRequestHandler({ pool, tokens, allowedOrigins, logger = console, now = () => new Date() }) {
  const loginAttempts = new Map()
  const dummyHashPromise = hashPassword('mydesk-dummy-password-to-equalize-login-work')

  function setCors(request, response) {
    const origin = request.headers.origin
    if (!origin) return true
    if (!allowedOrigins.has(origin)) return false
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('vary', 'Origin')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    response.setHeader('access-control-allow-headers', 'authorization, content-type')
    response.setHeader('access-control-max-age', '600')
    return true
  }

  function authorize(request) {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '')
    if (!match) throw Object.assign(new Error('Authentication is required.'), { status: 401 })
    try {
      return tokens.verify(match[1])
    } catch {
      throw Object.assign(new Error('The access token is invalid or expired.'), { status: 401 })
    }
  }

  function limitLoginAttempts(request) {
    const key = request.socket.remoteAddress || 'unknown'
    const current = loginAttempts.get(key) || { count: 0, resetAt: 0 }
    const time = Date.now()
    const state = current.resetAt <= time ? { count: 0, resetAt: time + 60_000 } : current
    state.count += 1
    loginAttempts.set(key, state)
    if (state.count > 20) throw Object.assign(new Error('Too many login attempts. Try again shortly.'), { status: 429 })
  }

  async function createAuthSession(client, user, deviceId) {
    const refreshToken = createRefreshToken()
    const expiresAt = new Date(now().getTime() + refreshLifetimeDays * 86_400_000)
    await client.query(`
      INSERT INTO refresh_sessions (id, user_id, token_hash, device_id, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [randomUUID(), user.id, hashOpaqueToken(refreshToken), deviceId, expiresAt])
    return {
      ...tokens.sign(user, deviceId),
      refreshToken,
      refreshExpiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email },
      deviceId,
    }
  }

  async function handle(request, response) {
    if (!setCors(request, response)) {
      jsonResponse(response, 403, { error: 'Origin is not allowed.' })
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const url = new URL(request.url, 'http://localhost')
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        await pool.query('SELECT 1')
        jsonResponse(response, 200, { status: 'ok' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/register') {
        const body = await readJson(request)
        const email = normalizeEmail(body.email)
        const passwordHash = await hashPassword(body.password)
        const deviceId = validateDeviceId(body.deviceId)
        const result = await withTransaction(pool, async client => {
          const user = { id: randomUUID(), email }
          await client.query(
            'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
            [user.id, email, passwordHash],
          )
          return createAuthSession(client, user, deviceId)
        })
        jsonResponse(response, 201, result)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/login') {
        limitLoginAttempts(request)
        const body = await readJson(request)
        const email = normalizeEmail(body.email)
        const deviceId = validateDeviceId(body.deviceId)
        const result = await pool.query(
          'SELECT id, email, password_hash FROM users WHERE LOWER(email) = $1',
          [email],
        )
        const user = result.rows[0]
        const valid = await verifyPassword(body.password, user?.password_hash || await dummyHashPromise)
        if (!user || !valid) {
          throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 })
        }
        loginAttempts.delete(request.socket.remoteAddress || 'unknown')
        const session = await withTransaction(pool, client => createAuthSession(client, user, deviceId))
        jsonResponse(response, 200, session)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/refresh') {
        const body = await readJson(request)
        if (typeof body.refreshToken !== 'string' || body.refreshToken.length < 32) {
          throw Object.assign(new Error('A valid refresh token is required.'), { status: 401 })
        }
        const session = await withTransaction(pool, async client => {
          const selected = await client.query(`
            SELECT sessions.id, sessions.user_id, sessions.device_id, users.email
            FROM refresh_sessions AS sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL
              AND sessions.expires_at > $2
            FOR UPDATE OF sessions
          `, [hashOpaqueToken(body.refreshToken), now()])
          const current = selected.rows[0]
          if (!current) throw Object.assign(new Error('The refresh session is invalid or expired.'), { status: 401 })
          const refreshToken = createRefreshToken()
          const expiresAt = new Date(now().getTime() + refreshLifetimeDays * 86_400_000)
          await client.query(`
            UPDATE refresh_sessions SET token_hash = $1, expires_at = $2
            WHERE id = $3
          `, [hashOpaqueToken(refreshToken), expiresAt, current.id])
          return {
            ...tokens.sign({ id: current.user_id, email: current.email }, current.device_id),
            refreshToken,
            refreshExpiresAt: expiresAt.toISOString(),
            user: { id: current.user_id, email: current.email },
            deviceId: current.device_id,
          }
        })
        jsonResponse(response, 200, session)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
        const user = authorize(request)
        const body = await readJson(request)
        if (typeof body.refreshToken !== 'string') {
          throw Object.assign(new Error('A refresh token is required.'), { status: 400 })
        }
        await pool.query(`
          UPDATE refresh_sessions SET revoked_at = NOW()
          WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL
        `, [user.userId, hashOpaqueToken(body.refreshToken)])
        jsonResponse(response, 200, { loggedOut: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices') {
        const user = authorize(request)
        const body = await readJson(request)
        const deviceId = validateDeviceId(body.deviceId)
        if (!['windows', 'android'].includes(body.platform)) {
          throw Object.assign(new TypeError('Choose a supported device platform.'), { status: 400 })
        }
        const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 100) : ''
        await pool.query(`
          INSERT INTO devices (user_id, device_id, platform, display_name)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, device_id) DO UPDATE SET
            platform = excluded.platform, display_name = excluded.display_name, last_seen_at = NOW()
        `, [user.userId, deviceId, body.platform, displayName])
        jsonResponse(response, 200, { registered: true, deviceId })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sync/push') {
        const user = authorize(request)
        const body = await readJson(request)
        if (!Array.isArray(body.operations) || body.operations.length > 100) {
          throw Object.assign(new TypeError('Provide no more than 100 sync operations.'), { status: 400 })
        }
        body.operations.forEach(validateSyncOperation)
        const results = await withTransaction(pool, async client => {
          const output = []
          for (const operation of body.operations) {
            await client.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
              [`${user.userId}:${operation.entityType}:${operation.recordId}`],
            )
            const previous = await client.query(`
              SELECT result FROM sync_operations WHERE user_id = $1 AND operation_id = $2
            `, [user.userId, operation.operationId])
            if (previous.rows[0]) {
              output.push(previous.rows[0].result)
              continue
            }
            const selected = await client.query(`
              SELECT entity_type, record_id, payload, created_at, updated_at, deleted_at,
                server_version, device_id
              FROM sync_records
              WHERE user_id = $1 AND entity_type = $2 AND record_id = $3
              FOR UPDATE
            `, [user.userId, operation.entityType, operation.recordId])
            const existing = selected.rows[0]
            const currentVersion = existing ? Number(existing.server_version) : 0
            let result
            if (currentVersion !== operation.baseServerVersion) {
              result = {
                operationId: operation.operationId,
                status: 'conflict',
                record: existing ? presentSyncRecord(existing, user.userId) : null,
              }
            } else {
              const time = now()
              const version = currentVersion + 1
              const payload = operation.operation === 'delete'
                ? existing?.payload || { id: operation.recordId }
                : operation.payload
              const createdAt = existing?.created_at || operation.payload?.createdAt || time
              const deletedAt = operation.operation === 'delete' ? time : null
              const values = {
                user_id: user.userId,
                entity_type: operation.entityType,
                record_id: operation.recordId,
                payload,
                created_at: createdAt,
                updated_at: time,
                deleted_at: deletedAt,
                server_version: version,
                device_id: user.deviceId || '',
              }
              const saved = await client.query(`
                INSERT INTO sync_records (
                  user_id, entity_type, record_id, payload, created_at, updated_at,
                  deleted_at, server_version, device_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (user_id, entity_type, record_id) DO UPDATE SET
                  payload = excluded.payload, updated_at = excluded.updated_at,
                  deleted_at = excluded.deleted_at, server_version = excluded.server_version,
                  device_id = excluded.device_id
                RETURNING entity_type, record_id, payload, created_at, updated_at,
                  deleted_at, server_version, device_id
              `, [
                values.user_id, values.entity_type, values.record_id, values.payload,
                values.created_at, values.updated_at, values.deleted_at,
                values.server_version, values.device_id,
              ])
              const remote = presentSyncRecord(saved.rows[0], user.userId)
              await client.query(`
                INSERT INTO sync_changes (
                  user_id, entity_type, record_id, payload, created_at, updated_at,
                  deleted_at, server_version, device_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `, [
                values.user_id, values.entity_type, values.record_id, values.payload,
                values.created_at, values.updated_at, values.deleted_at,
                values.server_version, values.device_id,
              ])
              result = {
                operationId: operation.operationId,
                status: 'applied',
                serverVersion: version,
                record: remote,
              }
            }
            await client.query(`
              INSERT INTO sync_operations (user_id, operation_id, result)
              VALUES ($1, $2, $3)
            `, [user.userId, operation.operationId, result])
            output.push(result)
          }
          return output
        })
        jsonResponse(response, 200, { results })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/sync/pull') {
        const user = authorize(request)
        const cursor = url.searchParams.get('cursor') || '0'
        const limit = Number(url.searchParams.get('limit') || 200)
        if (!/^\d{1,20}$/.test(cursor) || !Number.isInteger(limit) || limit < 1 || limit > 500) {
          throw Object.assign(new TypeError('The sync cursor or page size is invalid.'), { status: 400 })
        }
        const changes = await pool.query(`
          SELECT sequence, entity_type, record_id, payload, created_at, updated_at,
            deleted_at, server_version, device_id
          FROM sync_changes WHERE user_id = $1 AND sequence > $2::bigint
          ORDER BY sequence LIMIT $3
        `, [user.userId, cursor, limit])
        const records = changes.rows.map(record => ({
          ...presentSyncRecord(record, user.userId),
          cursor: String(record.sequence),
        }))
        jsonResponse(response, 200, {
          records,
          nextCursor: records.at(-1)?.cursor || cursor,
          hasMore: records.length === limit,
        })
        return
      }
      jsonResponse(response, 404, { error: 'Route not found.' })
    } catch (error) {
      const status = Number.isInteger(error.status)
        ? error.status
        : error.code === '23505' ? 409 : error instanceof TypeError || error instanceof RangeError ? 400 : 500
      if (status >= 500) logger.error('API request failed:', error)
      jsonResponse(response, status, {
        error: status >= 500 ? 'The server could not complete the request.' : error.message,
      })
    }
  }
  return handle
}

async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.')
  const tokenSecret = process.env.JWT_SECRET
  const tokens = createTokenService(tokenSecret)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
    max: Number(process.env.PG_POOL_SIZE) || 10,
  })
  await migrate(pool)
  const allowedOrigins = new Set((process.env.CORS_ORIGINS
    || 'https://localhost,http://localhost,http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(origin => origin.trim()).filter(Boolean))
  const server = createServer(createRequestHandler({ pool, tokens, allowedOrigins }))
  const port = Number(process.env.PORT) || 3001
  const host = process.env.HOST || '0.0.0.0'
  server.listen(port, host, () => console.log(`MyDesk sync API listening on ${host}:${port}`))
  const shutdown = () => server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (require.main === module) {
  start().catch(error => {
    console.error('Unable to start MyDesk sync API:', error)
    process.exitCode = 1
  })
}

module.exports = { createRequestHandler, migrate, presentSyncRecord, validateSyncOperation }
