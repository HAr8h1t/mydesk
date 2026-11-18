const { Notification } = require('electron')

const maxTimerDelay = 2_147_000_000

class ReminderScheduler {
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
    const upcoming = this.store.list()
      .filter(reminder => reminder.status === 'active' && reminder.nextAt)
      .map(reminder => ({ reminder, at: Date.parse(reminder.nextAt) }))
      .filter(entry => {
        if (Number.isFinite(entry.at)) return true
        console.error(`Reminder ${entry.reminder.id} has an invalid next delivery time.`)
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
    const due = this.store.list().filter(reminder => (
      reminder.status === 'active'
      && reminder.nextAt
      && Date.parse(reminder.nextAt) <= now.getTime()
    ))
    due.forEach(reminder => {
      const updated = this.store.markDue(reminder.id, reminder.nextAt, now)
      if (!updated) return
      this.notify(updated)
      this.getWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.webContents.send('reminders:triggered', {
            reminder: updated,
            deliveryKind: updated.lastDeliveryKind,
          })
        }
      })
    })
    this.refresh()
  }

  notify(reminder) {
    if (!Notification.isSupported()) {
      this.reportError(`System notifications are not supported; reminder "${reminder.title}" was due.`)
      return
    }
    const body = reminder.lastDeliveryKind === 'escalation'
      ? 'This reminder is still incomplete.'
      : reminder.description || (reminder.sourceTitle ? `For ${reminder.sourceTitle}` : 'It is time.')
    try {
      const notification = new Notification({
        title: reminder.title,
        body,
        silent: reminder.sound !== 'system',
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
      this.reportError(`Could not show reminder "${reminder.title}": ${error.message}`)
    }
  }

  reportError(message) {
    console.error(message)
    this.getWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('reminders:error', message)
    })
  }
}

module.exports = { ReminderScheduler }
