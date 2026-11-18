const { Notification } = require('electron')

const maxTimerDelay = 2_147_000_000

class AlarmScheduler {
  constructor(store, getWindows) {
    this.store = store
    this.getWindows = getWindows
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
    const now = Date.now()
    const upcoming = this.store.list().alarms
      .filter(alarm => alarm.enabled && alarm.nextAt && !alarm.ringingAt)
      .map(alarm => ({ alarm, at: Date.parse(alarm.nextAt) }))
      .filter(entry => {
        if (Number.isFinite(entry.at)) return true
        this.reportError(`Alarm ${entry.alarm.id} has an invalid next occurrence.`)
        return false
      })
      .sort((left, right) => left.at - right.at)
    if (!upcoming.length) {
      this.timer = null
      return
    }

    const delay = Math.max(0, Math.min(maxTimerDelay, upcoming[0].at - now))
    this.timer = setTimeout(() => this.deliverDue(), delay)
  }

  deliverDue() {
    this.timer = null
    const now = new Date()
    const due = this.store.list().alarms.filter(alarm => (
      alarm.enabled
      && alarm.nextAt
      && !alarm.ringingAt
      && Date.parse(alarm.nextAt) <= now.getTime()
    ))
    due.forEach(alarm => {
      const updated = this.store.markDue(alarm.id, alarm.nextAt, now)
      if (!updated) return
      this.notify(updated)
      this.getWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.webContents.send('alarms:triggered', updated)
        }
      })
    })
    this.refresh()
  }

  notify(alarm) {
    if (!Notification.isSupported()) {
      this.reportError(`System notifications are not supported; alarm "${alarm.label}" is ringing.`)
      return
    }
    try {
      const notification = new Notification({
        title: alarm.label,
        body: alarm.profile ? `${alarm.profile} alarm` : 'Your alarm is ringing.',
        silent: alarm.sound !== 'system',
      })
      notification.on('click', () => {
        const window = this.getWindows()[0]
        if (window && !window.isDestroyed()) {
          window.show()
          window.focus()
        }
      })
      notification.show()
    } catch (error) {
      this.reportError(`Could not show alarm "${alarm.label}": ${error.message}`)
    }
  }

  reportError(message) {
    console.error(message)
    this.getWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('alarms:error', message)
    })
  }
}

module.exports = { AlarmScheduler }
