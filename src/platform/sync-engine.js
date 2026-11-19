const batchSize = 100
const maxPullPages = 20
const maximumRetryMilliseconds = 60 * 60 * 1000

function retryDelay(attempts, random = Math.random) {
  const exponent = Math.max(0, Math.min(20, Number(attempts) || 0))
  const backoff = Math.min(maximumRetryMilliseconds, 1000 * (2 ** exponent))
  return Math.floor(backoff * (0.8 + random() * 0.4))
}

class SyncEngine {
  constructor({ store, transport, connectivity, onStatus = () => {}, onError = () => {}, intervalMs = 60_000 }) {
    if (!store?.sync || typeof transport?.push !== 'function' || typeof transport?.pull !== 'function') {
      throw new TypeError('A persistent sync store and REST transport are required.')
    }
    this.store = store
    this.transport = transport
    this.connectivity = connectivity || {
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      onChange: callback => {
        if (typeof window === 'undefined') return () => {}
        const handle = () => callback()
        window.addEventListener('online', handle)
        window.addEventListener('offline', handle)
        return () => {
          window.removeEventListener('online', handle)
          window.removeEventListener('offline', handle)
        }
      },
    }
    this.onStatus = onStatus
    this.onError = onError
    this.intervalMs = intervalMs
    this.running = false
    this.syncing = null
    this.timer = null
    this.unsubscribeConnectivity = null
    this.registeredDeviceId = ''
    this.lastError = ''
  }

  start() {
    if (this.running) return this.syncNow()
    this.running = true
    this.unsubscribeConnectivity = this.connectivity.onChange(() => {
      if (this.running) this.syncNow().catch(error => this.onError(error))
    })
    this.timer = setInterval(() => {
      if (this.running) this.syncNow().catch(error => this.onError(error))
    }, this.intervalMs)
    return this.syncNow()
  }

  stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unsubscribeConnectivity?.()
    this.unsubscribeConnectivity = null
  }

  syncNow() {
    if (this.syncing) return this.syncing
    this.syncing = this.syncOnce().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  async syncOnce() {
    const state = await this.store.sync.state()
    if (!state.accountId) {
      this.onStatus({ status: 'signed-out', pending: state.pending, conflicts: state.conflicts })
      return { status: 'signed-out' }
    }
    if (!await this.connectivity.isOnline()) {
      this.onStatus({ status: 'offline', pending: state.pending, conflicts: state.conflicts })
      return { status: 'offline' }
    }
    this.onStatus({ status: 'syncing', pending: state.pending, conflicts: state.conflicts })
    try {
      this.lastError = ''
      const registrationKey = `${state.accountId}:${state.deviceId}`
      if (this.transport.registerDevice && this.registeredDeviceId !== registrationKey) {
        await this.transport.registerDevice({
          deviceId: state.deviceId,
          platform: this.store.platform === 'android' ? 'android' : 'windows',
        })
        this.registeredDeviceId = registrationKey
      }
      await this.pushPending()
      await this.pullRemote()
      const current = await this.store.sync.state()
      const result = {
        status: current.conflicts ? 'conflict' : this.lastError ? 'error' : current.pending ? 'pending' : 'idle',
        pending: current.pending,
        conflicts: current.conflicts,
        error: this.lastError,
      }
      this.onStatus(result)
      if (this.lastError) this.onError(new Error(this.lastError))
      return result
    } catch (error) {
      this.onStatus({ status: 'error', message: error.message })
      this.onError(error)
      throw error
    }
  }

  async pushPending() {
    for (let batch = 0; batch < 20; batch += 1) {
      const operations = await this.store.sync.pending(batchSize)
      if (!operations.length) return
      await this.store.sync.markInFlight(operations.map(operation => operation.operationId))
      let response
      try {
        response = await this.transport.push(operations)
      } catch (error) {
        this.lastError = error.message
        await this.retryOperations(operations, error)
        return
      }
      if (!Array.isArray(response?.results)) throw new TypeError('The sync push response is invalid.')
      const byId = new Map(response.results.map(result => [result.operationId, result]))
      for (const operation of operations) {
        const result = byId.get(operation.operationId)
        if (!result) {
          const error = new Error('The server omitted a sync operation result.')
          this.lastError = error.message
          await this.retryOperations([operation], error)
          continue
        }
        if (result.status === 'applied') {
          await this.store.sync.markSynced(operation.operationId, result.serverVersion)
        } else if (result.status === 'conflict' && result.record) {
          await this.store.sync.applyRemote(result.record)
        } else {
          const error = new Error('The server returned an invalid sync operation result.')
          this.lastError = error.message
          await this.retryOperations([operation], error)
        }
      }
      if (response.results.some(result => result.status === 'conflict')) return
    }
  }

  async retryOperations(operations, error) {
    for (const operation of operations) {
      const retryAt = new Date(Date.now() + retryDelay(operation.attempts)).toISOString()
      await this.store.sync.retry(operation.operationId, error.message, retryAt)
    }
  }

  async pullRemote() {
    let cursor = await this.store.sync.cursor()
    for (let page = 0; page < maxPullPages; page += 1) {
      const response = await this.transport.pull(cursor)
      if (!Array.isArray(response?.records) || (typeof response.nextCursor !== 'string'
        && !Number.isSafeInteger(response.nextCursor))) {
        throw new TypeError('The sync pull response is invalid.')
      }
      for (const record of response.records) await this.store.sync.applyRemote(record)
      cursor = response.nextCursor
      await this.store.sync.setCursor(cursor)
      if (!response.hasMore) return
    }
  }
}

export { SyncEngine, retryDelay }
