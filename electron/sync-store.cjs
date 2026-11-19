const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')

const syncableTypes = new Set([
  'task',
  'reminder',
  'note',
  'alarm',
  'calendar-event',
  'focus-session',
  'scheduled-focus-block',
])

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function syncPayload(entityType, record) {
  const payload = { ...record }
  if (entityType === 'task' || entityType === 'note') delete payload.attachments
  if (entityType === 'note') delete payload.historyCount
  return canonicalJson(payload)
}

class SyncStore {
  constructor(databasePath, now = () => new Date()) {
    this.database = new DatabaseSync(databasePath)
    this.now = now
    this.database.exec('PRAGMA foreign_keys = ON')
    this.migrate()
    this.deviceId = this.getOrCreateDeviceId()
    this.database.prepare(`
      UPDATE sync_queue SET queue_status = 'pending', next_retry_at = ?
      WHERE queue_status = 'in_flight'
    `).run(this.now().toISOString())
  }

  migrate() {
    const currentVersion = this.database.prepare('PRAGMA user_version').get().user_version
    if (currentVersion >= 1) return

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_records (
          entity_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          account_id TEXT,
          payload TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          sync_status TEXT NOT NULL CHECK (sync_status IN ('local', 'pending', 'synced', 'conflict')),
          device_id TEXT NOT NULL,
          server_version INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entity_type, record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_records_account_updated
          ON sync_records (account_id, updated_at);
        CREATE TABLE IF NOT EXISTS sync_queue (
          operation_id TEXT PRIMARY KEY,
          account_id TEXT,
          entity_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
          payload TEXT,
          base_server_version INTEGER NOT NULL DEFAULT 0,
          enqueued_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT NOT NULL,
          last_error TEXT NOT NULL DEFAULT '',
          queue_status TEXT NOT NULL CHECK (queue_status IN ('pending', 'in_flight'))
        );
        CREATE INDEX IF NOT EXISTS idx_sync_queue_due
          ON sync_queue (account_id, queue_status, next_retry_at, enqueued_at);
        CREATE TABLE IF NOT EXISTS sync_conflicts (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          local_payload TEXT NOT NULL,
          remote_payload TEXT NOT NULL,
          detected_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          resolution TEXT NOT NULL DEFAULT ''
        );
        PRAGMA user_version = 1;
      `)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  getOrCreateDeviceId() {
    const existing = this.database.prepare("SELECT value FROM sync_state WHERE key = 'device-id'").get()
    if (existing?.value) return existing.value
    const deviceId = randomUUID()
    this.database.prepare(`
      INSERT INTO sync_state (key, value) VALUES ('device-id', ?)
    `).run(deviceId)
    return deviceId
  }

  activeAccountId() {
    return this.database.prepare("SELECT value FROM sync_state WHERE key = 'active-account-id'").get()?.value || ''
  }

  apiBaseUrl(defaultValue = '') {
    return this.database.prepare("SELECT value FROM sync_state WHERE key = 'api-base-url'").get()?.value || defaultValue
  }

  cursor() {
    return this.database.prepare("SELECT value FROM sync_state WHERE key = 'pull-cursor'").get()?.value || '0'
  }

  setCursor(value) {
    if ((typeof value !== 'string' && !Number.isSafeInteger(value)) || String(value).length > 1000) {
      throw new TypeError('A valid sync cursor is required.')
    }
    this.database.prepare(`
      INSERT INTO sync_state (key, value) VALUES ('pull-cursor', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(value))
  }

  setApiBaseUrl(value) {
    this.database.prepare(`
      INSERT INTO sync_state (key, value) VALUES ('api-base-url', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(value)
    return value
  }

  knownAccountId() {
    return this.database.prepare("SELECT value FROM sync_state WHERE key = 'known-account-id'").get()?.value || ''
  }

  state() {
    const queue = this.database.prepare(`
      SELECT COUNT(*) AS pending FROM sync_queue
    `).get()
    const conflict = this.database.prepare(`
      SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at = ''
    `).get()
    return {
      deviceId: this.deviceId,
      accountId: this.activeAccountId(),
      pending: queue.pending,
      conflicts: conflict.count,
    }
  }

  setActiveAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) throw new TypeError('An authenticated account id is required.')
    const knownAccountId = this.knownAccountId()
    if (knownAccountId && knownAccountId !== accountId) {
      throw new Error('This local database is linked to a different account. Export its data before using another account on this device.')
    }
    const now = this.now().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO sync_state (key, value) VALUES ('known-account-id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(accountId)
      this.database.prepare(`
        INSERT INTO sync_state (key, value) VALUES ('active-account-id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(accountId)
      const localRecords = this.database.prepare(`
        SELECT entity_type, record_id, payload, server_version, deleted_at
        FROM sync_records WHERE account_id IS NULL
      `).all()
      const claim = this.database.prepare(`
        UPDATE sync_records SET account_id = ?, sync_status = 'pending', updated_at = ?
        WHERE entity_type = ? AND record_id = ? AND account_id IS NULL
      `)
      for (const record of localRecords) {
        if (record.entity_type === 'focus-session'
          && !record.deleted_at && JSON.parse(record.payload).status === 'active') continue
        claim.run(accountId, now, record.entity_type, record.record_id)
        this.enqueue(
          accountId,
          record.entity_type,
          record.record_id,
          record.deleted_at ? 'delete' : 'upsert',
          record.deleted_at ? null : record.payload,
          record.server_version,
        )
      }
      this.database.exec('COMMIT')
      return this.state()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  clearActiveAccount() {
    this.database.prepare("DELETE FROM sync_state WHERE key = 'active-account-id'").run()
    return this.state()
  }

  enqueue(accountId, entityType, recordId, operation, payload, baseServerVersion = 0) {
    const now = this.now().toISOString()
    this.database.prepare(`
      DELETE FROM sync_queue
      WHERE account_id IS ? AND entity_type = ? AND record_id = ? AND queue_status = 'pending'
    `).run(accountId || null, entityType, recordId)
    this.database.prepare(`
      INSERT INTO sync_queue (
        operation_id, account_id, entity_type, record_id, operation, payload,
        base_server_version, enqueued_at, next_retry_at, queue_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      randomUUID(),
      accountId || null,
      entityType,
      recordId,
      operation,
      payload,
      baseServerVersion,
      now,
      now,
    )
  }

  reconcileSnapshot(entityType, records) {
    if (!syncableTypes.has(entityType)) throw new TypeError(`Unsupported sync entity type: ${entityType}`)
    if (!Array.isArray(records)) throw new TypeError('A record snapshot must be an array.')
    const current = new Map()
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id) {
        throw new TypeError(`Each ${entityType} must have a string id.`)
      }
      if (current.has(record.id)) throw new TypeError(`Duplicate ${entityType} id: ${record.id}`)
      if (entityType === 'focus-session' && record.status === 'active') continue
      current.set(record.id, record)
    }

    const now = this.now().toISOString()
    const accountId = this.activeAccountId()
    const existing = new Map(this.database.prepare(`
      SELECT record_id, account_id, payload, created_at, updated_at, deleted_at, sync_status, server_version
      FROM sync_records WHERE entity_type = ?
    `).all(entityType).map(record => [record.record_id, record]))
    const write = this.database.prepare(`
      INSERT INTO sync_records (
        entity_type, record_id, account_id, payload, created_at, updated_at,
        deleted_at, sync_status, device_id, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(entity_type, record_id) DO UPDATE SET
        account_id = excluded.account_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = NULL,
        sync_status = excluded.sync_status,
        device_id = excluded.device_id
    `)

    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const [id, record] of current) {
        const previous = existing.get(id)
        const payload = syncPayload(entityType, record)
        if (previous && previous.deleted_at) {
          throw new Error(`Cannot recreate deleted ${entityType} ${id} without resolving its tombstone.`)
        }
        if (previous && previous.payload === payload) continue
        const owner = previous?.account_id || accountId || null
        const updatedAt = record.updatedAt || now
        const createdAt = record.createdAt || previous?.created_at || updatedAt
        write.run(
          entityType,
          id,
          owner,
          payload,
          createdAt,
          updatedAt,
          owner ? 'pending' : 'local',
          this.deviceId,
          previous?.server_version || 0,
        )
        if (owner) this.enqueue(owner, entityType, id, 'upsert', payload, previous?.server_version || 0)
      }
      for (const [id, previous] of existing) {
        if (current.has(id) || previous.deleted_at) continue
        const deletedAt = now
        this.database.prepare(`
          UPDATE sync_records SET deleted_at = ?, updated_at = ?, sync_status = ?
          WHERE entity_type = ? AND record_id = ?
        `).run(deletedAt, deletedAt, previous.account_id ? 'pending' : 'local', entityType, id)
        if (previous.account_id) this.enqueue(
          previous.account_id,
          entityType,
          id,
          'delete',
          null,
          previous.server_version,
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.state()
  }

  pending(limit = 100) {
    const accountId = this.activeAccountId()
    if (!accountId) return []
    return this.database.prepare(`
      SELECT operation_id AS operationId, account_id AS accountId,
        entity_type AS entityType, record_id AS recordId, operation, payload,
        base_server_version AS baseServerVersion, enqueued_at AS enqueuedAt,
        attempts, next_retry_at AS nextRetryAt, last_error AS lastError
      FROM sync_queue
      WHERE account_id = ? AND queue_status = 'pending' AND next_retry_at <= ?
      ORDER BY enqueued_at LIMIT ?
    `).all(accountId, this.now().toISOString(), Math.max(1, Math.min(500, limit)))
      .map(row => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : null }))
  }

  markInFlight(operationIds) {
    if (!Array.isArray(operationIds) || !operationIds.length) return
    const update = this.database.prepare(`
      UPDATE sync_queue SET queue_status = 'in_flight'
      WHERE operation_id = ? AND account_id = ?
    `)
    const accountId = this.activeAccountId()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const operationId of operationIds) update.run(operationId, accountId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  markRetry(operationId, error, retryAt) {
    this.database.prepare(`
      UPDATE sync_queue
      SET queue_status = 'pending', attempts = attempts + 1,
        next_retry_at = ?, last_error = ?
      WHERE operation_id = ? AND account_id = ?
    `).run(retryAt, String(error).slice(0, 1000), operationId, this.activeAccountId())
  }

  markSynced(operationId, serverVersion) {
    const operation = this.database.prepare(`
      SELECT entity_type, record_id, account_id
      FROM sync_queue WHERE operation_id = ? AND account_id = ?
    `).get(operationId, this.activeAccountId())
    if (!operation) return false
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE sync_records SET
          server_version = MAX(server_version, ?),
          sync_status = CASE WHEN EXISTS (
            SELECT 1 FROM sync_queue
            WHERE entity_type = ? AND record_id = ? AND account_id = ? AND operation_id != ?
          ) THEN 'pending' ELSE 'synced' END
        WHERE entity_type = ? AND record_id = ? AND account_id = ?
      `).run(
        serverVersion,
        operation.entity_type,
        operation.record_id,
        operation.account_id,
        operationId,
        operation.entity_type,
        operation.record_id,
        operation.account_id,
      )
      this.database.prepare('DELETE FROM sync_queue WHERE operation_id = ?').run(operationId)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  record(entityType, recordId) {
    return this.database.prepare(`
      SELECT entity_type AS entityType, record_id AS recordId, account_id AS accountId,
        payload, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt,
        sync_status AS syncStatus, device_id AS deviceId, server_version AS serverVersion
      FROM sync_records WHERE entity_type = ? AND record_id = ?
    `).get(entityType, recordId) || null
  }

  restoreRecord(entityType, recordId, previous) {
    if (!previous) {
      this.database.prepare(`
        DELETE FROM sync_records WHERE entity_type = ? AND record_id = ?
      `).run(entityType, recordId)
      return
    }
    this.database.prepare(`
      INSERT INTO sync_records (
        entity_type, record_id, account_id, payload, created_at, updated_at,
        deleted_at, sync_status, device_id, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, record_id) DO UPDATE SET
        account_id = excluded.account_id, payload = excluded.payload,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at, sync_status = excluded.sync_status,
        device_id = excluded.device_id, server_version = excluded.server_version
    `).run(
      previous.entityType,
      previous.recordId,
      previous.accountId,
      previous.payload,
      previous.createdAt,
      previous.updatedAt,
      previous.deletedAt,
      previous.syncStatus,
      previous.deviceId,
      previous.serverVersion,
    )
  }

  applyRemote({ accountId, entityType, recordId, payload, deletedAt, serverVersion, updatedAt, createdAt }) {
    if (!syncableTypes.has(entityType)) throw new TypeError(`Unsupported sync entity type: ${entityType}`)
    if (!accountId || accountId !== this.activeAccountId()) {
      throw new Error('A remote record cannot be applied outside the active account.')
    }
    if (typeof recordId !== 'string' || !recordId
      || !Number.isSafeInteger(serverVersion) || serverVersion < 1
      || (payload && payload.id !== recordId)
      || entityType === 'focus-session' && payload?.status === 'active') {
      throw new TypeError('The remote sync record is invalid.')
    }
    const existing = this.database.prepare(`
      SELECT payload, server_version, sync_status FROM sync_records
      WHERE entity_type = ? AND record_id = ?
    `).get(entityType, recordId)
    if (existing && existing.server_version >= serverVersion) return { applied: false, stale: true }
    if (existing && existing.sync_status === 'pending') {
      return {
        applied: false,
        conflict: {
          local: JSON.parse(existing.payload),
          remote: { accountId, entityType, recordId, payload, deletedAt, serverVersion, updatedAt, createdAt },
        },
      }
    }
    this.database.prepare(`
      INSERT INTO sync_records (
        entity_type, record_id, account_id, payload, created_at, updated_at,
        deleted_at, sync_status, device_id, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
      ON CONFLICT(entity_type, record_id) DO UPDATE SET
        account_id = excluded.account_id,
        payload = excluded.payload,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        sync_status = 'synced',
        device_id = excluded.device_id,
        server_version = excluded.server_version
    `).run(
      entityType,
      recordId,
      accountId,
      payload ? canonicalJson(payload) : existing?.payload || '',
      createdAt,
      updatedAt,
      deletedAt || null,
      this.deviceId,
      serverVersion,
    )
    return { applied: true, stale: false }
  }

  recordConflict({ accountId, entityType, recordId, localPayload, remotePayload }) {
    const id = randomUUID()
    this.database.prepare(`
      INSERT INTO sync_conflicts (
        id, account_id, entity_type, record_id, local_payload, remote_payload, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      accountId,
      entityType,
      recordId,
      canonicalJson(localPayload),
      canonicalJson(remotePayload),
      this.now().toISOString(),
    )
    this.database.prepare(`
      UPDATE sync_records SET sync_status = 'conflict'
      WHERE entity_type = ? AND record_id = ?
    `).run(entityType, recordId)
    this.database.prepare(`
      DELETE FROM sync_queue WHERE account_id = ? AND entity_type = ? AND record_id = ?
    `).run(accountId, entityType, recordId)
    return id
  }

  conflicts() {
    return this.database.prepare(`
      SELECT id, entity_type AS entityType, record_id AS recordId,
        local_payload AS localPayload, remote_payload AS remotePayload,
        detected_at AS detectedAt
      FROM sync_conflicts WHERE account_id = ? AND resolved_at = ''
      ORDER BY detected_at DESC
    `).all(this.activeAccountId()).map(conflict => ({
      ...conflict,
      localPayload: JSON.parse(conflict.localPayload),
      remotePayload: JSON.parse(conflict.remotePayload),
    }))
  }

  resolveConflict(id, resolution) {
    if (typeof id !== 'string' || !id || !['keep-local', 'keep-remote'].includes(resolution)) {
      throw new TypeError('Choose a valid sync conflict resolution.')
    }
    const accountId = this.activeAccountId()
    const conflict = this.database.prepare(`
      SELECT entity_type, record_id, remote_payload
      FROM sync_conflicts WHERE id = ? AND account_id = ? AND resolved_at = ''
    `).get(id, accountId)
    if (!conflict) return false
    const remote = JSON.parse(conflict.remote_payload)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (resolution === 'keep-remote') {
        this.database.prepare(`
          INSERT INTO sync_records (
            entity_type, record_id, account_id, payload, created_at, updated_at,
            deleted_at, sync_status, device_id, server_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
          ON CONFLICT(entity_type, record_id) DO UPDATE SET
            account_id = excluded.account_id, payload = excluded.payload,
            created_at = excluded.created_at, updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at, sync_status = 'synced',
            device_id = excluded.device_id, server_version = excluded.server_version
        `).run(
          remote.entityType,
          remote.recordId,
          remote.accountId,
          remote.payload ? canonicalJson(remote.payload) : '',
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt || null,
          this.deviceId,
          remote.serverVersion,
        )
        this.database.prepare(`
          DELETE FROM sync_queue
          WHERE account_id = ? AND entity_type = ? AND record_id = ?
        `).run(accountId, conflict.entity_type, conflict.record_id)
      } else {
        const current = this.database.prepare(`
          SELECT payload, deleted_at FROM sync_records
          WHERE entity_type = ? AND record_id = ? AND account_id = ?
        `).get(conflict.entity_type, conflict.record_id, accountId)
        this.database.prepare(`
          UPDATE sync_records SET server_version = ?, sync_status = 'pending'
          WHERE entity_type = ? AND record_id = ? AND account_id = ?
        `).run(remote.serverVersion, conflict.entity_type, conflict.record_id, accountId)
        this.enqueue(
          accountId,
          conflict.entity_type,
          conflict.record_id,
          current?.deleted_at ? 'delete' : 'upsert',
          current?.deleted_at ? null : current?.payload || '',
          remote.serverVersion,
        )
      }
      this.database.prepare(`
        UPDATE sync_conflicts SET resolved_at = ?, resolution = ?
        WHERE id = ? AND account_id = ? AND resolved_at = ''
      `).run(this.now().toISOString(), resolution, id, accountId)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    this.database.close()
  }
}

module.exports = { SyncStore, syncableTypes, canonicalJson, syncPayload }
