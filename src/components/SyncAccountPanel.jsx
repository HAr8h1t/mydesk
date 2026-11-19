import { useEffect, useState } from 'react'

function SyncAccountPanel() {
  const [auth, setAuth] = useState(null)
  const [sync, setSync] = useState(null)
  const [conflicts, setConflicts] = useState([])
  const [status, setStatus] = useState('idle')
  const [apiUrl, setApiUrl] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [registering, setRegistering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    const database = window.mydesk
    const [authState, syncState, openConflicts] = await Promise.all([
      database.auth.status(),
      database.sync.state(),
      database.sync.conflicts(),
    ])
    setAuth(authState)
    setApiUrl(current => current || authState.apiBaseUrl)
    setSync(syncState)
    setConflicts(openConflicts)
  }

  useEffect(() => {
    let active = true
    const refreshSafely = () => refresh().catch(error => {
      if (active) setError(`Account status could not be loaded: ${error.message}`)
    })
    refreshSafely()
    const unsubscribe = window.mydesk.sync.onUpdated?.(refreshSafely)
    const statusListener = event => {
      if (!active) return
      setStatus(event.detail.status || 'idle')
      setSync(current => current ? { ...current, ...event.detail } : current)
    }
    const errorListener = event => {
      if (active) setError(event.detail)
    }
    window.addEventListener('mydesk:sync-status', statusListener)
    window.addEventListener('mydesk:sync-error', errorListener)
    const interval = window.setInterval(refreshSafely, 15_000)
    return () => {
      active = false
      unsubscribe?.()
      window.removeEventListener('mydesk:sync-status', statusListener)
      window.removeEventListener('mydesk:sync-error', errorListener)
      window.clearInterval(interval)
    }
  }, [])

  async function saveApiUrl() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const state = await window.mydesk.auth.configure(apiUrl)
      setAuth(state)
      setApiUrl(state.apiBaseUrl)
      setMessage('Sync server saved. Local data remains available without an account.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function authenticate(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const state = registering
        ? await window.mydesk.auth.register(email, password)
        : await window.mydesk.auth.login(email, password)
      setAuth(state)
      setPassword('')
      setMessage(registering ? 'Account created. MyDesk is syncing your local data.' : 'Signed in. MyDesk is syncing your local data.')
      await window.mydeskSyncEngine?.syncNow()
      await refresh()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.mydesk.auth.logout()
      setPassword('')
      setMessage(result.warning || 'Signed out. Your local data has not been deleted.')
      await refresh()
    } catch (failure) {
      setError(`Sign out could not be completed: ${failure.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function resolveConflict(conflict, resolution) {
    setBusy(true)
    setError('')
    try {
      await window.mydesk.sync.resolveConflict(conflict.id, resolution)
      await refresh()
      await window.mydeskSyncEngine?.syncNow()
    } catch (failure) {
      setError(`The sync conflict could not be resolved: ${failure.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    setError('')
    try {
      await window.mydeskSyncEngine?.syncNow()
      await refresh()
    } catch (failure) {
      setError(`Synchronization failed: ${failure.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card surface-card sync-account-card">
      <div className="section-heading">
        <div><p className="eyebrow">OPTIONAL CLOUD SYNC</p><h2>Devices and account</h2></div>
        <span className={`sync-status sync-status-${status}`} role="status">{status}</span>
      </div>
      <p className="settings-description">
        MyDesk always reads and saves on this device. Sign in only when you want to synchronize through your own MyDesk server.
      </p>
      {auth?.error && <p className="task-form-error" role="alert">{auth.error}</p>}
      {error && <p className="task-form-error" role="alert">{error}</p>}
      {message && <p className="sync-success" role="status">{message}</p>}

      <div className="sync-server-row">
        <label className="sync-field-group">
          <span>Sync server URL</span>
          <input
            className="sync-field"
            type="url"
            value={apiUrl}
            onChange={event => setApiUrl(event.target.value)}
            placeholder="https://mydesk.example.com"
            autoComplete="url"
          />
        </label>
        <button type="button" className="calendar-today" onClick={saveApiUrl} disabled={busy || !apiUrl.trim()}>
          Save server
        </button>
      </div>

      {auth?.authenticated ? (
        <div className="sync-account-row">
          <div>
            <strong>{auth.user.email}</strong>
            <p className="settings-description">
              {sync?.pending || 0} pending changes · {sync?.conflicts || conflicts.length} conflicts
            </p>
          </div>
          <div className="settings-actions">
            <button type="button" className="primary-button" onClick={syncNow} disabled={busy}>
              {busy ? 'Working…' : 'Sync now'}
            </button>
            <button type="button" className="calendar-today" onClick={logout} disabled={busy}>Sign out</button>
          </div>
        </div>
      ) : (
        <form className="sync-auth-form" onSubmit={authenticate}>
          <label className="sync-field-group">
            <span>Email address</span>
            <input
              className="sync-field"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="sync-field-group">
            <span>Password</span>
            <input
              className="sync-field"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <div className="settings-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Working…' : registering ? 'Create account' : 'Sign in'}
            </button>
            <button
              type="button"
              className="calendar-today"
              onClick={() => setRegistering(value => !value)}
              disabled={busy}
            >
              {registering ? 'I already have an account' : 'Create an account'}
            </button>
          </div>
        </form>
      )}

      {conflicts.length > 0 && (
        <div className="sync-conflict-list">
          <h3>Resolve changes that conflict</h3>
          {conflicts.map(conflict => (
            <article key={conflict.id} className="sync-conflict-row">
              <span>{conflict.entityType} · {conflict.recordId}</span>
              <div className="settings-actions">
                <button type="button" className="calendar-today" onClick={() => resolveConflict(conflict, 'keep-local')} disabled={busy}>
                  Keep this device
                </button>
                <button type="button" className="calendar-today" onClick={() => resolveConflict(conflict, 'keep-remote')} disabled={busy}>
                  Use synced version
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default SyncAccountPanel
