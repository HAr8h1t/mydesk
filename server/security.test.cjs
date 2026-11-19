const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createTokenService,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} = require('./security.cjs')

test('hashes passwords with scrypt and rejects mismatched credentials', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.match(hash, /^scrypt\$32768\$8\$1\$/)
  assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  assert.equal(await verifyPassword('incorrect password', hash), false)
  assert.equal(await verifyPassword('x'.repeat(100_000), hash), false)
  await assert.rejects(hashPassword('short'), /between 12 and 128/)
})

test('issues short-lived signed access tokens and normalizes account emails', () => {
  let time = Date.parse('2026-11-19T12:00:00.000Z')
  const tokens = createTokenService('a'.repeat(48), () => time)
  const token = tokens.sign({ id: 'user-id', email: 'user@example.com' }, 'device-id')
  assert.deepEqual(tokens.verify(token.accessToken), {
    userId: 'user-id',
    email: 'user@example.com',
    deviceId: 'device-id',
  })
  const [header, payload, signature] = token.accessToken.split('.')
  const tampered = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`
  assert.throws(() => tokens.verify(tampered), /invalid/)
  time += (token.expiresIn + 1) * 1000
  assert.throws(() => tokens.verify(token.accessToken), /expired/)
  assert.equal(normalizeEmail('  User@Example.com '), 'user@example.com')
  assert.throws(() => normalizeEmail('not an email'), /valid email/)
})
