const { DatabaseSync } = require('node:sqlite')

const snoozeOptions = new Set([5, 10, 15, 30])
const weekdays = new Set([0, 1, 2, 3, 4, 5, 6])

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function nextAlarmAt(alarm, now = new Date()) {
  const [hours, minutes] = alarm.time.split(':').map(Number)
  if (alarm.repeat === 'once') {
    if (!isDateKey(alarm.onceDate)) return ''
    const date = new Date(`${alarm.onceDate}T${alarm.time}:00`)
    return date > now ? date.toISOString() : ''
  }

  const days = alarm.repeat === 'daily' ? [...weekdays] : alarm.days
  if (!days.length) return ''
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    if (!days.includes(date.getDay())) continue
    date.setHours(hours, minutes, 0, 0)
    if (date > now) return date.toISOString()
  }
  return ''
}

class AlarmStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS alarms (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        next_at TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alarms_due ON alarms (enabled, next_at);
      CREATE TABLE IF NOT EXISTS alarm_profiles (
        name TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS alarm_history (
        id TEXT PRIMARY KEY,
        alarm_id TEXT NOT NULL,
        label TEXT NOT NULL,
        action TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alarm_history_date
        ON alarm_history (occurred_at DESC);
    `)
  }

  list() {
    return {
      alarms: this.database.prepare('SELECT payload FROM alarms ORDER BY rowid DESC')
        .all().map(row => JSON.parse(row.payload)),
      profiles: this.database.prepare('SELECT name FROM alarm_profiles ORDER BY name')
        .all().map(row => row.name),
      history: this.database.prepare(`
        SELECT id, alarm_id AS alarmId, label, action, occurred_at AS occurredAt
        FROM alarm_history ORDER BY occurred_at DESC LIMIT 50
      `).all(),
    }
  }

  exportHistory() {
    return this.database.prepare(`
      SELECT id, alarm_id AS alarmId, label, action, occurred_at AS occurredAt
      FROM alarm_history ORDER BY occurred_at DESC
    `).all()
  }

  save(alarms, profiles) {
    if (!Array.isArray(alarms) || !Array.isArray(profiles)) {
      throw new TypeError('Alarm and profile lists must be arrays.')
    }
    const ids = new Set()
    const normalized = alarms.map(alarm => {
      if (!alarm || typeof alarm.id !== 'string' || !alarm.id || typeof alarm.label !== 'string') {
        throw new TypeError('Each alarm must have a string id and label.')
      }
      if (ids.has(alarm.id)) throw new TypeError(`Duplicate alarm id: ${alarm.id}`)
      ids.add(alarm.id)
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(alarm.time)) {
        throw new TypeError(`Alarm ${alarm.id} has an invalid time.`)
      }
      if (!['once', 'daily', 'weekly', 'custom'].includes(alarm.repeat)) {
        throw new TypeError(`Alarm ${alarm.id} has an invalid repeat schedule.`)
      }
      const days = [...new Set((alarm.days || []).map(Number))]
      if (days.some(day => !weekdays.has(day))) throw new TypeError(`Alarm ${alarm.id} has an invalid weekday.`)
      if (alarm.repeat === 'once' && !isDateKey(alarm.onceDate)) {
        throw new TypeError(`Alarm ${alarm.id} needs a valid date.`)
      }
      if (['weekly', 'custom'].includes(alarm.repeat) && !days.length) {
        throw new TypeError(`Alarm ${alarm.id} needs at least one weekday.`)
      }
      return {
        ...alarm,
        label: alarm.label.trim() || 'Alarm',
        days,
        profile: typeof alarm.profile === 'string' && alarm.profile.trim() ? alarm.profile.trim() : 'General',
        enabled: Boolean(alarm.enabled),
      }
    })
    const profileNames = [...new Set(profiles
      .filter(profile => typeof profile === 'string')
      .map(profile => profile.trim())
      .filter(Boolean))]
    normalized.forEach(alarm => {
      if (!profileNames.includes(alarm.profile)) profileNames.push(alarm.profile)
    })

    const existing = new Map(this.list().alarms.map(alarm => [alarm.id, alarm]))
    const prepared = normalized.map(alarm => {
      const current = existing.get(alarm.id)
      const isRinging = Boolean(current?.ringingAt)
      const next = {
        ...alarm,
        createdAt: current?.createdAt || alarm.createdAt || new Date().toISOString(),
        ringingAt: isRinging ? current.ringingAt : alarm.ringingAt || '',
        snoozedUntil: isRinging ? current.snoozedUntil : alarm.snoozedUntil || '',
      }
      if (next.ringingAt) {
        next.nextAt = ''
        next.nextKind = ''
      } else if (next.snoozedUntil) {
        next.nextAt = next.snoozedUntil
        next.nextKind = 'snooze'
      } else {
        next.nextAt = next.enabled ? nextAlarmAt(next) : ''
        next.nextKind = next.nextAt ? 'schedule' : ''
      }
      if (next.enabled && !next.nextAt && !next.ringingAt) {
        throw new RangeError(`Alarm "${next.label}" has no future occurrence.`)
      }
      return next
    })

    const insertAlarm = this.database.prepare(`
      INSERT INTO alarms (id, enabled, next_at, payload) VALUES (?, ?, ?, ?)
    `)
    const insertProfile = this.database.prepare('INSERT INTO alarm_profiles (name) VALUES (?)')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec('DELETE FROM alarms')
      this.database.exec('DELETE FROM alarm_profiles')
      prepared.forEach(alarm => insertAlarm.run(
        alarm.id,
        alarm.enabled ? 1 : 0,
        alarm.nextAt || '',
        JSON.stringify(alarm),
      ))
      profileNames.forEach(profile => insertProfile.run(profile))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.list()
  }

  markDue(id, expectedNextAt, now = new Date()) {
    const alarm = this.get(id)
    if (!alarm || !alarm.enabled || alarm.nextAt !== expectedNextAt || Date.parse(alarm.nextAt) > now.getTime()) {
      return null
    }
    const updated = {
      ...alarm,
      ringingAt: now.toISOString(),
      lastTriggeredAt: now.toISOString(),
      snoozedUntil: '',
      nextAt: '',
      nextKind: '',
    }
    this.update(updated)
    this.record(updated, 'triggered', now)
    return updated
  }

  snooze(id, minutes, now = new Date()) {
    if (!snoozeOptions.has(minutes)) throw new RangeError('Choose a supported alarm snooze duration.')
    const alarm = this.get(id)
    if (!alarm || !alarm.ringingAt) return alarm
    const snoozedUntil = new Date(now.getTime() + minutes * 60_000).toISOString()
    const updated = {
      ...alarm,
      ringingAt: '',
      snoozedUntil,
      nextAt: snoozedUntil,
      nextKind: 'snooze',
    }
    this.update(updated)
    this.record(updated, `snoozed ${minutes} minutes`, now)
    return updated
  }

  dismiss(id, now = new Date()) {
    const alarm = this.get(id)
    if (!alarm || !alarm.ringingAt) return alarm
    const updated = { ...alarm, ringingAt: '', snoozedUntil: '' }
    if (alarm.repeat === 'once') {
      updated.enabled = false
      updated.nextAt = ''
      updated.nextKind = ''
    } else {
      updated.nextAt = nextAlarmAt(updated, now)
      updated.nextKind = updated.nextAt ? 'schedule' : ''
    }
    this.update(updated)
    this.record(updated, 'dismissed', now)
    return updated
  }

  setEnabled(id, enabled, now = new Date()) {
    const alarm = this.get(id)
    if (!alarm) return null
    const updated = { ...alarm, enabled: Boolean(enabled), ringingAt: '', snoozedUntil: '' }
    updated.nextAt = updated.enabled ? nextAlarmAt(updated, now) : ''
    updated.nextKind = updated.nextAt ? 'schedule' : ''
    if (updated.enabled && !updated.nextAt) {
      throw new RangeError('This alarm has no future occurrence. Update its date or repeat schedule.')
    }
    this.update(updated)
    this.record(updated, updated.enabled ? 'enabled' : 'disabled', now)
    return updated
  }

  delete(id) {
    return this.database.prepare('DELETE FROM alarms WHERE id = ?').run(id).changes > 0
  }

  get(id) {
    const row = this.database.prepare('SELECT payload FROM alarms WHERE id = ?').get(id)
    return row ? JSON.parse(row.payload) : null
  }

  update(alarm) {
    this.database.prepare(`
      UPDATE alarms SET enabled = ?, next_at = ?, payload = ? WHERE id = ?
    `).run(alarm.enabled ? 1 : 0, alarm.nextAt || '', JSON.stringify(alarm), alarm.id)
  }

  record(alarm, action, now) {
    this.database.prepare(`
      INSERT INTO alarm_history (id, alarm_id, label, action, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, alarm.id, alarm.label, action, now.toISOString())
  }

  close() {
    this.database.close()
  }
}

module.exports = { AlarmStore, nextAlarmAt, isDateKey }
