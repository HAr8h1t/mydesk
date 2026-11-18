const { DatabaseSync } = require('node:sqlite')

const snoozeOptions = new Set([5, 10, 15, 30, 60, 120])

function nextOccurrence(value, repeat, now = Date.now()) {
  const date = new Date(value)
  do {
    if (repeat === 'daily') {
      date.setDate(date.getDate() + 1)
    } else if (repeat === 'weekly') {
      date.setDate(date.getDate() + 7)
    } else if (repeat === 'monthly') {
      const originalDay = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + 1)
      date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
    }
  } while (date.getTime() <= now)
  return date.toISOString()
}

class ReminderStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        next_at TEXT NOT NULL DEFAULT '',
        legacy_key TEXT UNIQUE,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due
        ON reminders (status, next_at);
      CREATE TABLE IF NOT EXISTS reminder_legacy_imports (
        legacy_key TEXT PRIMARY KEY
      );
    `)
  }

  list() {
    return this.database.prepare('SELECT payload FROM reminders ORDER BY rowid DESC')
      .all().map(row => JSON.parse(row.payload))
  }

  save(reminders) {
    if (!Array.isArray(reminders)) throw new TypeError('Reminders must be provided as an array.')
    const ids = new Set()
    for (const reminder of reminders) {
      if (!reminder || typeof reminder.id !== 'string' || !reminder.id || typeof reminder.title !== 'string') {
        throw new TypeError('Each reminder must have a string id and title.')
      }
      if (ids.has(reminder.id)) throw new TypeError(`Duplicate reminder id: ${reminder.id}`)
      if (!['active', 'completed', 'paused'].includes(reminder.status)) {
        throw new TypeError(`Reminder ${reminder.id} has an invalid status.`)
      }
      if (!Number.isFinite(Date.parse(reminder.scheduledAt))) {
        throw new TypeError(`Reminder ${reminder.id} has an invalid scheduled date.`)
      }
      if (reminder.nextAt && !Number.isFinite(Date.parse(reminder.nextAt))) {
        throw new TypeError(`Reminder ${reminder.id} has an invalid next delivery date.`)
      }
      ids.add(reminder.id)
    }

    const storedReminders = new Map(this.list().map(reminder => [reminder.id, reminder]))
    const mergedReminders = reminders.map(reminder => {
      const current = storedReminders.get(reminder.id)
      const incomingRevision = Date.parse(reminder.scheduleRevisionAt || '') || 0
      const storedRevision = Date.parse(current?.scheduleRevisionAt || '') || 0
      const incomingNotification = Date.parse(reminder.lastNotifiedAt || '') || 0
      const storedNotification = Date.parse(current?.lastNotifiedAt || '') || 0
      if (!current || storedNotification <= incomingNotification || incomingRevision > storedRevision) return reminder
      return {
        ...current,
        ...reminder,
        scheduledAt: current.scheduledAt,
        nextAt: current.nextAt,
        nextKind: current.nextKind,
        status: current.status,
        lastNotifiedAt: current.lastNotifiedAt,
        lastDeliveryKind: current.lastDeliveryKind,
        escalationCount: current.escalationCount,
        snoozedUntil: current.snoozedUntil,
        completedAt: current.completedAt,
        lastCompletedAt: current.lastCompletedAt,
      }
    })

    const insert = this.database.prepare(`
      INSERT INTO reminders (id, status, next_at, legacy_key, payload)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec('DELETE FROM reminders')
      mergedReminders.forEach(reminder => insert.run(
        reminder.id,
        reminder.status,
        reminder.nextAt || '',
        reminder.legacyKey || null,
        JSON.stringify(reminder),
      ))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  importLegacyTaskReminders(tasks) {
    const markImported = this.database.prepare(`
      INSERT OR IGNORE INTO reminder_legacy_imports (legacy_key) VALUES (?)
    `)
    const insert = this.database.prepare(`
      INSERT INTO reminders (id, status, next_at, legacy_key, payload)
      VALUES (?, 'active', ?, ?, ?)
    `)
    let imported = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const task of tasks) {
        if (!task.reminderAt || !Number.isFinite(new Date(task.reminderAt).getTime())) continue
        const legacyKey = `task:${task.id}`
        if (!markImported.run(legacyKey).changes) continue
        const scheduledAt = new Date(task.reminderAt).toISOString()
        const reminder = {
          id: `legacy-${task.id}`,
          title: task.title,
          description: '',
          sourceType: 'task',
          sourceId: task.id,
          sourceTitle: task.title,
          scheduledAt,
          nextAt: scheduledAt,
          nextKind: 'schedule',
          repeat: 'none',
          priority: task.priority || 'Medium',
          sound: 'system',
          escalationMinutes: 0,
          escalationCount: 0,
          maxEscalations: 3,
          status: 'active',
          createdAt: task.createdAt || new Date().toISOString(),
          scheduleRevisionAt: '',
          legacyKey,
        }
        insert.run(reminder.id, reminder.nextAt, legacyKey, JSON.stringify(reminder))
        imported += 1
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return imported
  }

  markDue(id, expectedNextAt, now = new Date()) {
    const reminder = this.database.prepare('SELECT payload FROM reminders WHERE id = ?').get(id)
    if (!reminder) return null
    const current = JSON.parse(reminder.payload)
    if (current.status !== 'active' || current.nextAt !== expectedNextAt || Date.parse(current.nextAt) > now.getTime()) {
      return null
    }

    const isEscalation = current.nextKind === 'escalation'
    const wasSnoozed = current.nextKind === 'snooze'
    const updated = {
      ...current,
      lastNotifiedAt: now.toISOString(),
      lastDeliveryKind: isEscalation ? 'escalation' : 'reminder',
      snoozedUntil: '',
    }

    if (isEscalation) {
      updated.escalationCount = (current.escalationCount || 0) + 1
      if (updated.escalationCount < (current.maxEscalations || 3)) {
        updated.nextAt = new Date(now.getTime() + current.escalationMinutes * 60_000).toISOString()
        updated.nextKind = 'escalation'
      } else {
        updated.nextAt = ''
        updated.nextKind = ''
      }
    } else if (current.repeat !== 'none') {
      updated.scheduledAt = nextOccurrence(current.scheduledAt, current.repeat, now.getTime())
      updated.nextAt = updated.scheduledAt
      updated.nextKind = 'schedule'
      updated.escalationCount = 0
    } else if (current.escalationMinutes > 0) {
      if (!wasSnoozed) updated.escalationCount = 0
      updated.nextAt = new Date(now.getTime() + current.escalationMinutes * 60_000).toISOString()
      updated.nextKind = 'escalation'
    } else {
      updated.nextAt = ''
      updated.nextKind = ''
    }

    this.update(updated)
    return updated
  }

  complete(id, now = new Date()) {
    const reminder = this.get(id)
    if (!reminder || reminder.status !== 'active') return reminder
    const updated = {
      ...reminder,
      lastCompletedAt: now.toISOString(),
      snoozedUntil: '',
      escalationCount: 0,
    }
    if (reminder.repeat === 'none') {
      updated.status = 'completed'
      updated.completedAt = now.toISOString()
      updated.nextAt = ''
      updated.nextKind = ''
    } else {
      const alreadyScheduledNextOccurrence = reminder.lastNotifiedAt
        && Date.parse(reminder.scheduledAt) > now.getTime()
      if (!alreadyScheduledNextOccurrence) {
        updated.scheduledAt = nextOccurrence(reminder.scheduledAt, reminder.repeat, now.getTime())
      }
      updated.nextAt = updated.scheduledAt
      updated.nextKind = 'schedule'
      updated.status = 'active'
    }
    this.update(updated)
    return updated
  }

  snooze(id, minutes, now = new Date()) {
    if (!snoozeOptions.has(minutes)) throw new RangeError('Choose a supported snooze duration.')
    const reminder = this.get(id)
    if (!reminder || reminder.status !== 'active') return reminder
    const snoozedUntil = new Date(now.getTime() + minutes * 60_000).toISOString()
    const updated = {
      ...reminder,
      snoozedUntil,
      nextAt: snoozedUntil,
      nextKind: 'snooze',
      escalationCount: 0,
    }
    this.update(updated)
    return updated
  }

  delete(id) {
    return this.database.prepare('DELETE FROM reminders WHERE id = ?').run(id).changes > 0
  }

  get(id) {
    const row = this.database.prepare('SELECT payload FROM reminders WHERE id = ?').get(id)
    return row ? JSON.parse(row.payload) : null
  }

  update(reminder) {
    this.database.prepare(`
      UPDATE reminders
      SET status = ?, next_at = ?, payload = ?
      WHERE id = ?
    `).run(reminder.status, reminder.nextAt || '', JSON.stringify(reminder), reminder.id)
  }

  close() {
    this.database.close()
  }
}

module.exports = { ReminderStore, nextOccurrence }
