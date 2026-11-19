const {
  createHmac,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(scryptCallback)
const tokenIssuer = 'mydesk-sync'
const accessTokenLifetimeSeconds = 15 * 60

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function createTokenService(secret, now = () => Date.now()) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new TypeError('JWT_SECRET must contain at least 32 bytes.')
  }
  const key = Buffer.from(secret)
  function sign(user, deviceId) {
    const issuedAt = Math.floor(now() / 1000)
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' })
    const payload = encodeJson({
      iss: tokenIssuer,
      sub: user.id,
      email: user.email,
      deviceId,
      typ: 'access',
      iat: issuedAt,
      exp: issuedAt + accessTokenLifetimeSeconds,
    })
    const content = `${header}.${payload}`
    const signature = createHmac('sha256', key).update(content).digest('base64url')
    return { accessToken: `${content}.${signature}`, expiresIn: accessTokenLifetimeSeconds }
  }
  function verify(token) {
    if (typeof token !== 'string') throw new TypeError('A bearer access token is required.')
    const parts = token.split('.')
    if (parts.length !== 3) throw new TypeError('The access token is invalid.')
    const content = `${parts[0]}.${parts[1]}`
    const expected = createHmac('sha256', key).update(content).digest()
    let actual
    try {
      actual = Buffer.from(parts[2], 'base64url')
    } catch {
      throw new TypeError('The access token is invalid.')
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new TypeError('The access token is invalid.')
    }
    let header
    let payload
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    } catch {
      throw new TypeError('The access token is invalid.')
    }
    if (header.alg !== 'HS256' || payload.iss !== tokenIssuer || payload.typ !== 'access'
      || typeof payload.sub !== 'string' || !Number.isInteger(payload.exp)
      || payload.exp <= Math.floor(now() / 1000)) {
      throw new TypeError('The access token is invalid or expired.')
    }
    return { userId: payload.sub, email: payload.email, deviceId: payload.deviceId }
  }
  return { sign, verify }
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new TypeError('Password must be between 12 and 128 characters.')
  }
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 128
    || typeof encoded !== 'string') return false
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split('$')
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !saltValue || !hashValue) {
    return false
  }
  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function hashOpaqueToken(token) {
  return createHmac('sha256', 'mydesk-refresh-token-v1').update(token).digest('hex')
}

function createRefreshToken() {
  return randomBytes(32).toString('base64url')
}

function normalizeEmail(email) {
  if (typeof email !== 'string') throw new TypeError('Enter a valid email address.')
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new TypeError('Enter a valid email address.')
  }
  return normalized
}

module.exports = {
  accessTokenLifetimeSeconds,
  createRefreshToken,
  createTokenService,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
}
