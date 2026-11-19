import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthClient } from './auth-client.js'

function createHarness(fetchImpl = async () => ({ ok: true, json: async () => ({}) })) {
  const values = new Map()
  const calls = []
  const account = { value: '' }
  const store = {
    sync: {
      state: async () => ({ deviceId: 'device-1' }),
      activateAccount: async id => { account.value = id },
      logout: async () => { account.value = '' },
      apiBaseUrl: async () => '',
      setApiBaseUrl: async value => calls.push(['api-url', value]),
      pending: async () => [],
    },
  }
  const secureStorage = {
    get: async key => values.get(key) || null,
    set: async (key, value) => values.set(key, value),
    remove: async key => values.delete(key),
  }
  const client = new AuthClient({ store, secureStorage, fetchImpl })
  return { account, calls, client, secureStorage, values }
}

test('validates API URLs and persists a login session only in secure storage', async () => {
  const harness = createHarness(async (url, options) => {
    assert.match(url, /\/v1\/auth\/login$/)
    assert.equal(JSON.parse(options.body).deviceId, 'device-1')
    return {
      ok: true,
      json: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'account-1', email: 'user@example.com' },
        deviceId: 'device-1',
      }),
    }
  })
  await harness.client.initialize()
  await assert.rejects(harness.client.configure('http://example.com'), /HTTPS/)
  const status = await harness.client.login('user@example.com', 'correct horse battery staple')
  assert.equal(status.authenticated, true)
  assert.equal(harness.account.value, 'account-1')
  assert.equal(harness.values.get('session').refreshToken, 'refresh')
  assert.equal('refreshToken' in status, false)
})

test('refreshes expired access tokens and clears only account linkage on logout', async () => {
  const calls = []
  const harness = createHarness(async (url, options) => {
    calls.push([url, options.headers.authorization || '', options.body])
    if (url.endsWith('/v1/auth/refresh')) {
      return {
        ok: true,
        json: async () => ({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          user: { id: 'account-1', email: 'user@example.com' },
          deviceId: 'device-1',
        }),
      }
    }
    if (url.endsWith('/v1/data') && options.headers.authorization === 'Bearer old-access') {
      return { ok: false, status: 401, json: async () => ({ error: 'expired' }) }
    }
    return { ok: true, json: async () => ({ ok: true }) }
  })
  harness.values.set('session', {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    user: { id: 'account-1', email: 'user@example.com' },
    deviceId: 'device-1',
  })
  await harness.client.initialize()
  await harness.client.request('/v1/data')
  assert.equal(calls.some(call => call[1] === 'Bearer new-access'), true)
  assert.equal(harness.values.get('session').refreshToken, 'new-refresh')
  const result = await harness.client.logout()
  assert.equal(result.loggedOut, true)
  assert.equal(harness.values.has('session'), false)
  assert.equal(harness.account.value, '')
})
