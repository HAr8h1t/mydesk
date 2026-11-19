const { Notification } = require('electron')

const maxTimerDelay = 2_147_000_000

class FocusScheduler {
  constructor(store, getWindows, onCompleted = () => {}) {
    this.store = store
    this.getWindows = getWindows
    this.onCompleted = onCompleted
    this.timer = null
    this.stopped = false
  }

  start() {
    this.stopped = false
    this.refresh()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  refresh() {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const active = this.store.active()
    if (!active) return
    const endAt = Date.parse(active.plannedEndAt)
    if (!Number.isFinite(endAt)) {
      this.reportError('The active focus session has an invalid end time.')
      return
    }
    this.timer = setTimeout(() => this.completeDue(), Math.max(0, Math.min(maxTimerDelay, endAt - Date.now())))
  }

  completeDue() {
    this.timer = null
    const active = this.store.active()
    if (!active || Date.parse(active.plannedEndAt) > Date.now()) {
      this.refresh()
      return
    }
    let session
    try {
      session = this.store.finish(active.id)
    } catch (error) {
      this.reportError(`The focus session could not be saved: ${error.message}`)
      this.timer = setTimeout(() => this.completeDue(), 30_000)
      return
    }
    if (!session) {
      this.refresh()
      return
    }
    try {
      this.onCompleted(session)
    } catch (error) {
      this.reportError(`The completed focus session could not be added to the sync queue: ${error.message}`)
    }
    const title = session.mode === 'break' ? 'Break complete' : 'Focus session complete'
    const body = session.taskTitle ? `You focused on ${session.taskTitle}.` : 'Your focus session is complete.'
    this.notify(title, body)
    this.getWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('focus:completed', session)
    })
    this.refresh()
  }

  notify(title, body) {
    if (!Notification.isSupported()) {
      this.reportError('Desktop notifications are not supported; your focus session was still saved.')
      return
    }
    try {
      new Notification({ title, body }).show()
    } catch (error) {
      this.reportError(`Could not show the focus notification: ${error.message}`)
    }
  }

  reportError(message) {
    console.error(message)
    this.getWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('focus:error', message)
    })
  }
}

module.exports = { FocusScheduler }
