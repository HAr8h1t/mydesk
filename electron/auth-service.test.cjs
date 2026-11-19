const assert = require('node:assert/strict')
const { test } = require('node:test')
const { AuthService } = require('./auth-service.cjs')

function createHarness(fetchImpl) {
  const calls = []
  const saved = { value: null }
  const account = { value: '' }
  const syncStore = {
    deviceId: 'device-1',
    apiBaseUrl: fallback => fallback,
    setApiBaseUrl: value => calls.push(['configure', value]),
    setActiveAccount: value => { account.value = value },
    clearActiveAccount: () => { account.value = '' },
  }
  const credentialStore = {
    assertAvailable: () => {},
    load: async () => saved.value,
    save: async value => { saved.value = value },
    clear: async () => { saved.value = null },
  }
  return {
    account,
    calls,
    credentialStore,
    saved,
    service: new AuthService({ syncStore, credentialStore, fetchImpl }),
  }
}

test('keeps desktop credentials out of renderer results and preserves data on logout', async () => {
  const harness = createHarness(async (url, options) => {
    harness.calls.push([url, options.headers.authorization || ''])
    if (url.endsWith('/v1/auth/login')) {
      return {
        ok: true,
        json: async () => ({
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
          user: { id: 'account-1', email: 'user@example.com' },
        }),
      }
    }
    return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }
  })
  const status = await harness.service.login('user@example.com', 'correct horse battery staple')
  assert.equal(status.authenticated, true)
  assert.equal('refreshToken' in status, false)
  assert.equal(harness.account.value, 'account-1')
  const result = await harness.service.logout()
  assert.equal(result.loggedOut, true)
  assert.match(result.warning, /could not revoke/)
  assert.equal(harness.saved.value, null)
  assert.equal(harness.account.value, '')
})
