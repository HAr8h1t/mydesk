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

class AuthClient {
  constructor({ store, secureStorage, fetchImpl = globalThis.fetch, initialApiUrl = 'http://localhost:3001' }) {
    if (!store?.sync || typeof secureStorage?.get !== 'function'
      || typeof secureStorage?.set !== 'function' || typeof secureStorage?.remove !== 'function'
      || typeof fetchImpl !== 'function') {
      throw new TypeError('Local sync storage, encrypted credential storage, and fetch are required.')
    }
    this.store = store
    this.secureStorage = secureStorage
    this.fetchImpl = fetchImpl
    this.initialApiUrl = validateApiBaseUrl(initialApiUrl)
    this.session = null
    this.listeners = new Set()
    this.refreshing = null
    this.initializationError = ''
  }

  async initialize() {
    try {
      const session = await this.secureStorage.get('session')
      if (session?.refreshToken && session?.user?.id) {
        await this.store.sync.activateAccount(session.user.id)
        this.session = session
      } else {
        await this.store.sync.logout()
      }
    } catch (error) {
      this.initializationError = error.message
      this.session = null
      await this.store.sync.logout()
    }
    return this.status()
  }

  async apiBaseUrl() {
    const stored = await this.store.sync.apiBaseUrl?.()
    return stored || this.initialApiUrl
  }

  async configure(value) {
    const apiBaseUrl = validateApiBaseUrl(value)
    if (typeof this.store.sync.setApiBaseUrl !== 'function') {
      throw new Error('This platform cannot save the API URL.')
    }
    await this.store.sync.setApiBaseUrl(apiBaseUrl)
    this.emit()
    return this.status()
  }

  async status() {
    const apiBaseUrl = await this.apiBaseUrl()
    return {
      authenticated: Boolean(this.session),
      user: this.session?.user || null,
      apiBaseUrl,
      deviceId: this.session?.deviceId || (await this.store.sync.state()).deviceId,
      error: this.initializationError,
    }
  }

  async register(email, password) {
    return this.authenticate('/v1/auth/register', email, password)
  }

  async login(email, password) {
    return this.authenticate('/v1/auth/login', email, password)
  }

  async authenticate(path, email, password) {
    const { deviceId } = await this.store.sync.state()
    const session = await this.requestUnauthenticated(path, {
      method: 'POST',
      body: { email, password, deviceId },
    })
    await this.store.sync.activateAccount(session.user.id)
    try {
      await this.secureStorage.set('session', session)
    } catch (error) {
      await this.store.sync.logout()
      throw new Error(`The encrypted login session could not be saved: ${error.message}`)
    }
    this.session = session
    this.initializationError = ''
    this.emit()
    return this.status()
  }

  async requestUnauthenticated(path, { method = 'GET', body } = {}) {
    return this.fetchJson(await this.apiBaseUrl(), path, method, body)
  }

  async request(path, { method = 'GET', body } = {}) {
    if (!this.session) throw new Error('Sign in before synchronizing data.')
    let response
    try {
      response = await this.fetchJson(await this.apiBaseUrl(), path, method, body, this.session.accessToken)
    } catch (error) {
      if (error.status !== 401 || path === '/v1/auth/refresh') throw error
      await this.refreshSession()
      response = await this.fetchJson(await this.apiBaseUrl(), path, method, body, this.session.accessToken)
    }
    return response
  }

  async refreshSession() {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const current = this.session
      if (!current?.refreshToken) throw new Error('The saved login session is unavailable.')
      let updated
      try {
        updated = await this.fetchJson(await this.apiBaseUrl(), '/v1/auth/refresh', 'POST', {
          refreshToken: current.refreshToken,
        })
      } catch (error) {
        if (error.status === 401) await this.clearSession()
        throw error
      }
      this.session = updated
      await this.secureStorage.set('session', updated)
      this.emit()
      return updated
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  async logout() {
    const current = this.session
    this.session = null
    let warning = ''
    try {
      await this.secureStorage.remove('session')
    } catch (error) {
      warning = `The encrypted login session could not be deleted: ${error.message}`
    } finally {
      await this.store.sync.logout()
    }
    this.emit()
    if (!current) return { loggedOut: true, warning }
    try {
      await this.fetchJson(await this.apiBaseUrl(), '/v1/auth/logout', 'POST', {
        refreshToken: current.refreshToken,
      }, current.accessToken)
      return { loggedOut: true, warning }
    } catch (error) {
      return {
        loggedOut: true,
        warning: warning || `Local data is signed out; the server could not revoke this session: ${error.message}`,
      }
    }
  }

  async clearSession() {
    this.session = null
    try {
      await this.secureStorage.remove('session')
    } finally {
      await this.store.sync.logout()
    }
    this.emit()
  }

  async fetchJson(baseUrl, path, method, body, accessToken) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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

  onChanged(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  emit() {
    const update = this.status()
    for (const listener of this.listeners) {
      Promise.resolve(update).then(listener).catch(error => console.error('Unable to notify auth state listener.', error))
    }
  }
}

export { AuthClient, validateApiBaseUrl }
