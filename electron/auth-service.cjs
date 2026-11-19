const fs = require('node:fs/promises')
const path = require('node:path')

function validateApiBaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Enter a valid MyDesk API URL.')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname)
  if (!['https:', 'http:'].includes(url.protocol)
    || url.protocol === 'http:' && !loopback
    || url.username || url.password || url.search || url.hash
    || url.pathname !== '/') {
    throw new TypeError('Use an HTTPS API URL. HTTP is allowed only for local development.')
  }
  return url.origin
}

class EncryptedCredentialStore {
  constructor(filePath, encryption) {
    this.filePath = filePath
    this.encryption = encryption
  }

  assertAvailable() {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Operating-system encrypted credential storage is unavailable.')
    }
  }

  async load() {
    this.assertAvailable()
    try {
      const encrypted = await fs.readFile(this.filePath)
      return JSON.parse(this.encryption.decryptString(encrypted))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error(`The encrypted login session could not be read: ${error.message}`)
    }
  }

  async save(value) {
    this.assertAvailable()
    const directory = path.dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporaryPath, this.encryption.encryptString(JSON.stringify(value)), { flag: 'wx' })
      await fs.rename(temporaryPath, this.filePath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(cleanupError => {
        console.error('Unable to remove a partial encrypted credential file.', cleanupError)
      })
      throw error
    }
  }

  async clear() {
    await fs.rm(this.filePath, { force: true })
  }
}

class AuthService {
  constructor({ syncStore, credentialStore, fetchImpl = globalThis.fetch, initialApiUrl = 'http://localhost:3001' }) {
    this.syncStore = syncStore
    this.credentialStore = credentialStore
    this.fetchImpl = fetchImpl
    this.initialApiUrl = validateApiBaseUrl(initialApiUrl)
    this.session = null
    this.refreshing = null
    this.initializationError = ''
  }

  async initialize() {
    try {
      const session = await this.credentialStore.load()
      if (session?.refreshToken && session?.user?.id) {
        this.syncStore.setActiveAccount(session.user.id)
        this.session = session
      } else {
        this.syncStore.clearActiveAccount()
      }
    } catch (error) {
      this.initializationError = error.message
      this.session = null
      this.syncStore.clearActiveAccount()
      console.error('MyDesk encrypted authentication state could not be restored:', error)
    }
    return this.status()
  }

  apiBaseUrl() {
    return this.syncStore.apiBaseUrl(this.initialApiUrl)
  }

  async configure(value) {
    const url = validateApiBaseUrl(value)
    this.syncStore.setApiBaseUrl(url)
    return this.status()
  }

  status() {
    return {
      authenticated: Boolean(this.session),
      user: this.session?.user || null,
      apiBaseUrl: this.apiBaseUrl(),
      deviceId: this.syncStore.deviceId,
      error: this.initializationError,
    }
  }

  async register(email, password) {
    return this.authenticate('/v1/auth/register', email, password)
  }

  async login(email, password) {
    return this.authenticate('/v1/auth/login', email, password)
  }

  async authenticate(route, email, password) {
    this.credentialStore.assertAvailable()
    const response = await this.fetchJson(route, 'POST', {
      email,
      password,
      deviceId: this.syncStore.deviceId,
    }, null)
    this.syncStore.setActiveAccount(response.user.id)
    try {
      await this.credentialStore.save(response)
    } catch (error) {
      this.syncStore.clearActiveAccount()
      throw new Error(`The encrypted login session could not be saved: ${error.message}`)
    }
    this.session = response
    this.initializationError = ''
    return this.status()
  }

  async request(route, { method = 'GET', body } = {}) {
    if (!this.session) throw new Error('Sign in before synchronizing data.')
    try {
      return await this.fetchJson(route, method, body, this.session.accessToken)
    } catch (error) {
      if (error.status !== 401 || route === '/v1/auth/refresh') throw error
      await this.refreshSession()
      return this.fetchJson(route, method, body, this.session.accessToken)
    }
  }

  async refreshSession() {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      if (!this.session?.refreshToken) throw new Error('The saved login session is unavailable.')
      let updated
      try {
        updated = await this.fetchJson('/v1/auth/refresh', 'POST', {
          refreshToken: this.session.refreshToken,
        }, null)
      } catch (error) {
        if (error.status === 401) await this.clearSession()
        throw error
      }
      this.session = updated
      await this.credentialStore.save(updated)
      return updated
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  async logout() {
    const current = this.session
    this.session = null
    let credentialError
    try {
      await this.credentialStore.clear()
    } catch (error) {
      credentialError = error
    } finally {
      this.syncStore.clearActiveAccount()
    }
    if (credentialError) throw credentialError
    if (!current) return { loggedOut: true }
    try {
      await this.fetchJson('/v1/auth/logout', 'POST', {
        refreshToken: current.refreshToken,
      }, current.accessToken)
      return { loggedOut: true }
    } catch (error) {
      return {
        loggedOut: true,
        warning: `Local data is signed out; the server could not revoke this session: ${error.message}`,
      }
    }
  }

  async clearSession() {
    this.session = null
    try {
      await this.credentialStore.clear()
    } finally {
      this.syncStore.clearActiveAccount()
    }
  }

  async registerDevice(device) {
    return this.request('/v1/devices', { method: 'POST', body: device })
  }

  push(operations) {
    return this.request('/v1/sync/push', { method: 'POST', body: { operations } })
  }

  pull(cursor) {
    const query = new URLSearchParams({ cursor: String(cursor || '0'), limit: '200' })
    return this.request(`/v1/sync/pull?${query}`)
  }

  async fetchJson(route, method, body, accessToken) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    const response = await this.fetchImpl(`${this.apiBaseUrl()}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    let result
    try {
      result = await response.json()
    } catch {
      throw new Error('The sync server returned an invalid response.')
    }
    if (!response.ok) {
      const error = new Error(result?.error || `The sync server returned HTTP ${response.status}.`)
      error.status = response.status
      throw error
    }
    return result
  }
}

module.exports = { AuthService, EncryptedCredentialStore, validateApiBaseUrl }
