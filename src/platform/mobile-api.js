const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS mobile_records (
    entity_type TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'local',
    device_id TEXT NOT NULL DEFAULT '',
    server_version INTEGER NOT NULL DEFAULT 0,
    account_id TEXT,
    PRIMARY KEY (entity_type, id)
  );
  CREATE INDEX IF NOT EXISTS idx_mobile_records_type_updated
    ON mobile_records (entity_type, updated_at);
  CREATE TABLE IF NOT EXISTS mobile_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mobile_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mobile_sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mobile_sync_queue (
    operation_id TEXT PRIMARY KEY,
    account_id TEXT,
    entity_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
    payload TEXT,
    base_server_version INTEGER NOT NULL DEFAULT 0,
    enqueued_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    queue_status TEXT NOT NULL CHECK (queue_status IN ('pending', 'in_flight'))
  );
  CREATE INDEX IF NOT EXISTS idx_mobile_sync_queue_due
    ON mobile_sync_queue (account_id, queue_status, next_retry_at, enqueued_at);
  CREATE TABLE IF NOT EXISTS mobile_sync_conflicts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    local_payload TEXT NOT NULL,
    remote_payload TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS mobile_notification_ids (
    entity_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    notification_id INTEGER NOT NULL UNIQUE,
    PRIMARY KEY (entity_type, record_id)
  );
`

const snoozeOptions = new Set([5, 10, 15, 30, 60, 120])
const weekdays = new Set([0, 1, 2, 3, 4, 5, 6])
const syncableTypes = new Set([
  'task',
  'reminder',
  'note',
  'alarm',
  'event',
  'focus_session',
  'scheduled_focus',
])
const syncEntityTypes = {
  event: 'calendar-event',
  focus_session: 'focus-session',
  scheduled_focus: 'scheduled-focus-block',
}
const localEntityTypes = Object.fromEntries(
  Object.entries(syncEntityTypes).map(([local, remote]) => [remote, local]),
)

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function syncPayload(type, record) {
  const payload = { ...record }
  if (type === 'task' || type === 'note') delete payload.attachments
  if (type === 'note') delete payload.historyCount
  return payload
}

function createId() {
  return crypto.randomUUID()
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function nextReminderOccurrence(value, repeat, now = Date.now()) {
  const date = new Date(value)
  do {
    if (repeat === 'daily') date.setDate(date.getDate() + 1)
    else if (repeat === 'weekly') date.setDate(date.getDate() + 7)
    else if (repeat === 'monthly') {
      const originalDay = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + 1)
      date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
    }
  } while (date.getTime() <= now)
  return date.toISOString()
}

function nextAlarmOccurrence(alarm, now = new Date()) {
  const [hours, minutes] = alarm.time.split(':').map(Number)
  if (alarm.repeat === 'once') {
    if (!isValidDateKey(alarm.onceDate)) return ''
    const date = new Date(`${alarm.onceDate}T${alarm.time}:00`)
    return date > now ? date.toISOString() : ''
  }
  const days = alarm.repeat === 'daily' ? [...weekdays] : alarm.days
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + offset)
    if (!days.includes(date.getDay())) continue
    date.setHours(hours, minutes, 0, 0)
    if (date > now) return date.toISOString()
  }
  return ''
}

function validateIdAndTitle(item, label) {
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string') {
    throw new TypeError(`${label} must have a string id and title.`)
  }
}

function normalizeSession(input, now = new Date()) {
  if (!input || !['focus', 'break'].includes(input.mode)) {
    throw new TypeError('Choose a focus or break session.')
  }
  const maximumMinutes = input.source === 'manual' ? 1440 : 240
  if (!Number.isInteger(input.targetMinutes) || input.targetMinutes < 1 || input.targetMinutes > maximumMinutes) {
    throw new RangeError(`Session duration must be between 1 and ${maximumMinutes} minutes.`)
  }
  if (input.mode === 'break' && input.taskId) throw new TypeError('Break sessions cannot be linked to a task.')
  if (typeof input.id !== 'string' || !input.id) throw new TypeError('A session id is required.')
  return {
    id: input.id,
    mode: input.mode,
    taskId: input.taskId || '',
    taskTitle: input.taskTitle || '',
    project: input.project || '',
    category: input.category || 'Other',
    startedAt: input.startedAt || now.toISOString(),
    plannedEndAt: input.plannedEndAt || new Date(now.getTime() + input.targetMinutes * 60_000).toISOString(),
    endedAt: input.endedAt || '',
    targetMinutes: input.targetMinutes,
    durationSeconds: Number(input.durationSeconds) || 0,
    status: input.status || 'active',
    source: input.source || 'timer',
  }
}

function normalizeNote(note, now = new Date()) {
  if (!note || typeof note.id !== 'string' || !note.id
    || typeof note.title !== 'string' || typeof note.body !== 'string') {
    throw new TypeError('Each note must have a string id, title, and body.')
  }
  const updatedAt = note.updatedAt || now.toISOString()
  return {
    ...note,
    title: note.title.slice(0, 240),
    category: typeof note.category === 'string' ? note.category.slice(0, 80) : '',
    tags: [...new Set((Array.isArray(note.tags) ? note.tags : [])
      .filter(tag => typeof tag === 'string')
      .map(tag => tag.trim().slice(0, 50))
      .filter(Boolean))],
    links: Array.isArray(note.links) ? note.links : [],
    createdAt: note.createdAt || updatedAt,
    updatedAt,
    pinned: Boolean(note.pinned),
    archived: Boolean(note.archived),
    dailyDate: typeof note.dailyDate === 'string' ? note.dailyDate : '',
  }
}

function createMobileApi({ database, files, share, notifications, idFactory = createId }) {
  if (!database?.execute || !database?.query || !database?.run) {
    throw new TypeError('An open Capacitor SQLite connection is required.')
  }

  const listeners = new Map()
  let activeFocusTimer
  let deviceId = ''
  let applyingRemote = false
  let authClient

  async function rows(statement, values = []) {
    const result = await database.query(statement, values)
    return Array.isArray(result) ? result : result?.values || []
  }

  async function run(statement, values = []) {
    return database.run(statement, values, false)
  }

  async function transaction(operation) {
    await database.beginTransaction()
    try {
      const result = await operation()
      await database.commitTransaction()
      return result
    } catch (error) {
      await database.rollbackTransaction()
      throw error
    }
  }

  async function getRecords(type) {
    return (await rows(
      'SELECT payload FROM mobile_records WHERE entity_type = ? AND deleted_at IS NULL ORDER BY created_at, id',
      [type],
    )).map(row => JSON.parse(row.payload))
  }

  async function getRecord(type, id) {
    const [row] = await rows(
      'SELECT payload FROM mobile_records WHERE entity_type = ? AND id = ? AND deleted_at IS NULL',
      [type, id],
    )
    return row ? JSON.parse(row.payload) : null
  }

  async function getSyncState(key, fallback = '') {
    const [row] = await rows('SELECT value FROM mobile_sync_state WHERE key = ?', [key])
    return row ? row.value : fallback
  }

  async function setSyncState(key, value) {
    await run(`
      INSERT INTO mobile_sync_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, String(value)])
  }

  async function queueOperation(accountId, type, id, operation, payload, version = 0) {
    if (!accountId) return
    const entityType = syncEntityTypes[type] || type
    const now = new Date().toISOString()
    await run(`
      DELETE FROM mobile_sync_queue
      WHERE account_id = ? AND entity_type = ? AND record_id = ? AND queue_status = 'pending'
    `, [accountId, entityType, id])
    await run(`
      INSERT INTO mobile_sync_queue (
        operation_id, account_id, entity_type, record_id, operation, payload,
        base_server_version, enqueued_at, next_retry_at, queue_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      idFactory(), accountId, entityType, id, operation,
      payload ? stableJson(syncPayload(type, payload)) : null, version, now, now,
    ])
  }

  async function putRecord(type, record) {
    const now = new Date().toISOString()
    const [existing] = await rows(
      `SELECT payload, created_at, updated_at, deleted_at, account_id, device_id,
        server_version, sync_status FROM mobile_records WHERE entity_type = ? AND id = ?`,
      [type, record.id],
    )
    if (existing?.deleted_at && !applyingRemote) {
      throw new Error(`Cannot overwrite deleted ${type} ${record.id} before resolving its tombstone.`)
    }
    const domainRecord = { ...record }
    delete domainRecord.accountId
    delete domainRecord.deviceId
    delete domainRecord.serverVersion
    delete domainRecord.syncStatus
    const createdAt = domainRecord.createdAt || existing?.created_at || now
    let updatedAt = domainRecord.updatedAt || existing?.updated_at || now
    let stored = { ...domainRecord, createdAt, updatedAt }
    if (existing && stableJson(JSON.parse(existing.payload)) !== stableJson(stored)
      && updatedAt === existing.updated_at && !applyingRemote) {
      updatedAt = now
      stored = { ...stored, updatedAt }
    }
    const payload = stableJson(stored)
    if (existing && existing.payload === payload && !existing.deleted_at
      && (!record.serverVersion || record.serverVersion === existing.server_version)) return stored
    const shouldSync = syncableTypes.has(type) && !(type === 'focus_session' && stored.status === 'active')
    const accountId = shouldSync
      ? record.accountId || existing?.account_id || await getSyncState('active-account-id', '')
      : null
    const syncStatus = applyingRemote ? 'synced' : accountId ? 'pending' : 'local'
    const serverVersion = Number(record.serverVersion) || existing?.server_version || 0
    await run(`
      INSERT INTO mobile_records (
        entity_type, id, payload, created_at, updated_at, deleted_at,
        sync_status, device_id, server_version, account_id
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(entity_type, id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = NULL,
        sync_status = excluded.sync_status,
        device_id = excluded.device_id,
        server_version = excluded.server_version,
        account_id = excluded.account_id
    `, [
      type,
      record.id,
      payload,
      createdAt,
      updatedAt,
      syncStatus,
      deviceId,
      serverVersion,
      accountId || null,
    ])
    if (!applyingRemote && accountId) {
      await queueOperation(accountId, type, record.id, 'upsert', stored, serverVersion)
    }
    return stored
  }

  async function markDeleted(type, id) {
    const [existing] = await rows(
      `SELECT payload, account_id, server_version, deleted_at
       FROM mobile_records WHERE entity_type = ? AND id = ?`,
      [type, id],
    )
    if (!existing || existing.deleted_at) return false
    const now = new Date().toISOString()
    const accountId = syncableTypes.has(type)
      ? existing.account_id || await getSyncState('active-account-id', '')
      : null
    await run(`
      UPDATE mobile_records SET deleted_at = ?, updated_at = ?, sync_status = ?, account_id = ?
      WHERE entity_type = ? AND id = ?
    `, [now, now, accountId ? 'pending' : 'local', accountId || null, type, id])
    if (accountId) await queueOperation(accountId, type, id, 'delete', null, existing.server_version)
    return true
  }

  async function allocateNotificationId(type, recordId) {
    const [existing] = await rows(`
      SELECT notification_id FROM mobile_notification_ids
      WHERE entity_type = ? AND record_id = ?
    `, [type, recordId])
    if (existing) return existing.notification_id
    let notificationId = Math.floor(Math.random() * 2_147_483_646) + 1
    while ((await rows('SELECT notification_id FROM mobile_notification_ids WHERE notification_id = ?', [notificationId])).length) {
      notificationId = notificationId === 2_147_483_646 ? 1 : notificationId + 1
    }
    await run(`
      INSERT INTO mobile_notification_ids (entity_type, record_id, notification_id)
      VALUES (?, ?, ?)
    `, [type, recordId, notificationId])
    return notificationId
  }

  async function refreshLocalNotifications() {
    if (!notifications) return
    try {
      const desired = [
        ...(await getRecords('reminder'))
          .filter(item => item.status === 'active' && item.nextAt)
          .map(item => ({
            type: 'reminder',
            id: item.id,
            at: item.nextAt,
            title: item.title,
            body: item.description || item.sourceTitle || 'It is time.',
          })),
        ...(await getRecords('alarm'))
          .filter(item => item.enabled && item.nextAt && !item.ringingAt)
          .map(item => ({
            type: 'alarm',
            id: item.id,
            at: item.nextAt,
            title: item.label,
            body: item.profile ? `${item.profile} alarm` : 'Your alarm is ringing.',
          })),
      ]
      if (desired.length) {
          let permission = await notifications.checkPermissions()
          if (permission.display !== 'granted') permission = await notifications.requestPermissions()
          if (permission.display !== 'granted') {
            const message = 'Enable MyDesk notifications in Android settings to receive local reminders and alarms.'
            console.error(message)
            emit('error', message)
            return
          }
      }
      const desiredKeys = new Set(desired.map(item => `${item.type}:${item.id}`))
      const saved = await rows('SELECT entity_type, record_id, notification_id FROM mobile_notification_ids')
      const stale = saved.filter(item => !desiredKeys.has(`${item.entity_type}:${item.record_id}`))
      if (stale.length) {
        await notifications.cancel({
          notifications: stale.map(item => ({ id: item.notification_id })),
        })
        for (const item of stale) {
          await run('DELETE FROM mobile_notification_ids WHERE entity_type = ? AND record_id = ?', [
            item.entity_type,
            item.record_id,
          ])
        }
      }
      const items = []
      for (const item of desired) {
        const at = new Date(item.at)
        if (!Number.isFinite(at.getTime())) throw new TypeError(`The ${item.type} ${item.id} has an invalid notification date.`)
        items.push({
          id: await allocateNotificationId(item.type, item.id),
          title: item.title,
          body: item.body,
          schedule: { at },
        })
      }
      if (items.length) await notifications.schedule({ notifications: items })
    } catch (error) {
      const message = `Android notifications could not be updated: ${error.message}`
      console.error(message, error)
      emit('error', message)
    }
  }

  async function handleLocalNotification(notificationId) {
    const [mapping] = await rows(`
      SELECT entity_type, record_id FROM mobile_notification_ids WHERE notification_id = ?
    `, [notificationId])
    if (!mapping) return false
    const now = new Date()
    if (mapping.entity_type === 'reminder') {
      const reminder = await getRecord('reminder', mapping.record_id)
      if (!reminder || reminder.status !== 'active') return false
      const dueAt = Date.parse(reminder.nextAt || '')
      if (!Number.isFinite(dueAt) || dueAt > now.getTime()) return false
      const updated = {
        ...reminder,
        lastNotifiedAt: now.toISOString(),
        lastDeliveryKind: reminder.nextKind === 'escalation' ? 'escalation' : 'reminder',
        snoozedUntil: '',
      }
      if (updated.lastDeliveryKind === 'escalation') {
        updated.escalationCount = (reminder.escalationCount || 0) + 1
      } else if (reminder.repeat !== 'none') {
        updated.scheduledAt = nextReminderOccurrence(reminder.scheduledAt, reminder.repeat, now.getTime())
        updated.nextAt = updated.scheduledAt
        updated.nextKind = 'schedule'
        updated.escalationCount = 0
      } else if (reminder.escalationMinutes > 0) {
        updated.nextAt = new Date(now.getTime() + reminder.escalationMinutes * 60_000).toISOString()
        updated.nextKind = 'escalation'
        updated.escalationCount = 0
      } else {
        updated.nextAt = ''
        updated.nextKind = ''
      }
      if (updated.lastDeliveryKind === 'escalation'
        && updated.escalationCount < (reminder.maxEscalations || 3)) {
        updated.nextAt = new Date(now.getTime() + reminder.escalationMinutes * 60_000).toISOString()
        updated.nextKind = 'escalation'
      } else if (updated.lastDeliveryKind === 'escalation') {
        updated.nextAt = ''
        updated.nextKind = ''
      }
      await putRecord('reminder', updated)
      emit('reminderTriggered', { reminder: updated, deliveryKind: updated.lastDeliveryKind })
    } else if (mapping.entity_type === 'alarm') {
      const alarm = await getRecord('alarm', mapping.record_id)
      if (!alarm || !alarm.enabled || alarm.ringingAt) return false
      const updated = {
        ...alarm,
        ringingAt: now.toISOString(),
        lastTriggeredAt: now.toISOString(),
        snoozedUntil: '',
        nextAt: '',
        nextKind: '',
      }
      await putRecord('alarm', updated)
      await putRecord('alarm_history', {
        id: idFactory(),
        alarmId: alarm.id,
        label: alarm.label,
        action: 'triggered',
        occurredAt: now.toISOString(),
      })
      emit('alarmTriggered', updated)
    } else return false
    await refreshLocalNotifications()
    return true
  }

  async function replaceRecords(type, records) {
    if (!Array.isArray(records)) throw new TypeError(`${type} must be provided as an array.`)
    const ids = new Set()
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id) {
        throw new TypeError(`Each ${type} record must have a string id.`)
      }
      if (ids.has(record.id)) throw new TypeError(`Duplicate ${type} id: ${record.id}`)
      ids.add(record.id)
    }
    return transaction(async () => {
      const existing = await rows(
        'SELECT id FROM mobile_records WHERE entity_type = ? AND deleted_at IS NULL',
        [type],
      )
      for (const record of records) await putRecord(type, record)
      for (const row of existing) {
        if (!ids.has(row.id)) await markDeleted(type, row.id)
      }
    })
  }

  async function getSetting(key, fallback) {
    const [row] = await rows('SELECT value FROM mobile_settings WHERE key = ?', [key])
    return row ? JSON.parse(row.value) : fallback
  }

  async function setSetting(key, value) {
    await run(`
      INSERT INTO mobile_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, JSON.stringify(value)])
    return value
  }

  function emit(name, value) {
    for (const callback of listeners.get(name) || []) callback(value)
  }

  function subscribe(name, callback) {
    const callbacks = listeners.get(name) || new Set()
    callbacks.add(callback)
    listeners.set(name, callbacks)
    return () => callbacks.delete(callback)
  }

  async function updateNote(note) {
    const normalized = normalizeNote(note)
    delete normalized.attachments
    delete normalized.historyCount
    const current = await getRecord('note', normalized.id)
    const history = current?.history || (Array.isArray(normalized.history) ? normalized.history : [])
    const currentContent = current ? { ...current } : null
    if (currentContent) {
      delete currentContent.history
      delete currentContent.historyCount
    }
    if (current && JSON.stringify(currentContent) !== JSON.stringify(normalized)) {
      const previous = { ...current }
      delete previous.history
      history.unshift({ id: idFactory(), action: 'edited', createdAt: normalized.updatedAt, ...previous })
    } else if (!current && !history.length) {
      history.unshift({ id: idFactory(), action: 'created', createdAt: normalized.createdAt, ...normalized })
    }
    const stored = { ...normalized, history }
    await putRecord('note', stored)
    return stored
  }

  async function saveNotes(notes) {
    if (!Array.isArray(notes)) throw new TypeError('Notes must be provided as an array.')
    const normalized = notes.map(normalizeNote)
    const ids = new Set(normalized.map(note => note.id))
    if (ids.size !== normalized.length) throw new TypeError('Notes must have unique ids.')
    return transaction(async () => {
      for (const note of normalized) await updateNote(note)
      for (const current of await getRecords('note')) {
        if (!ids.has(current.id)) await markDeleted('note', current.id)
      }
    })
  }

  async function markReminder(id, update) {
    const reminder = await getRecord('reminder', id)
    if (!reminder) return null
    const next = update(reminder)
    await putRecord('reminder', next)
    emit('reminderChanged', next)
    await refreshLocalNotifications()
    return next
  }

  async function saveAlarms(alarms, profiles = []) {
    if (!Array.isArray(alarms) || !Array.isArray(profiles)) {
      throw new TypeError('Alarm and profile lists must be arrays.')
    }
    const old = new Map((await getRecords('alarm')).map(alarm => [alarm.id, alarm]))
    const now = new Date()
    const prepared = alarms.map(alarm => {
      validateIdAndTitle({ id: alarm?.id, title: alarm?.label }, 'Alarm')
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(alarm.time)) throw new TypeError(`Alarm ${alarm.id} has an invalid time.`)
      if (!['once', 'daily', 'weekly', 'custom'].includes(alarm.repeat)) throw new TypeError(`Alarm ${alarm.id} has an invalid repeat schedule.`)
      const days = [...new Set((alarm.days || []).map(Number))]
      if (days.some(day => !weekdays.has(day))) throw new TypeError(`Alarm ${alarm.id} has an invalid weekday.`)
      if (alarm.repeat === 'once' && !isValidDateKey(alarm.onceDate)) throw new TypeError(`Alarm ${alarm.id} needs a valid date.`)
      if (['weekly', 'custom'].includes(alarm.repeat) && !days.length) throw new TypeError(`Alarm ${alarm.id} needs at least one weekday.`)
      const current = old.get(alarm.id)
      const next = {
        ...alarm,
        days,
        enabled: Boolean(alarm.enabled),
        createdAt: current?.createdAt || alarm.createdAt || now.toISOString(),
        ringingAt: current?.ringingAt || alarm.ringingAt || '',
        snoozedUntil: current?.snoozedUntil || alarm.snoozedUntil || '',
      }
      next.nextAt = next.ringingAt ? '' : next.snoozedUntil || (next.enabled ? nextAlarmOccurrence(next, now) : '')
      next.nextKind = next.ringingAt ? '' : next.snoozedUntil ? 'snooze' : next.nextAt ? 'schedule' : ''
      if (next.enabled && !next.nextAt && !next.ringingAt) throw new RangeError(`Alarm "${next.label}" has no future occurrence.`)
      return next
    })
    const profileNames = [...new Set([...profiles, ...prepared.map(alarm => alarm.profile || 'General')])]
    await replaceRecords('alarm', prepared)
    await replaceRecords('alarm_profile', profileNames.filter(Boolean).map(name => ({ id: name, name })))
    await refreshLocalNotifications()
    return { alarms: prepared, profiles: profileNames, history: await getRecords('alarm_history') }
  }

  async function updateAlarm(id, action, value) {
    const alarm = await getRecord('alarm', id)
    if (!alarm) return null
    const now = new Date()
    let updated = { ...alarm }
    if (action === 'setEnabled') {
      updated.enabled = Boolean(value)
      updated.ringingAt = ''
      updated.snoozedUntil = ''
      updated.nextAt = updated.enabled ? nextAlarmOccurrence(updated, now) : ''
    } else if (action === 'snooze') {
      if (!snoozeOptions.has(value)) throw new RangeError('Choose a supported alarm snooze duration.')
      updated.ringingAt = ''
      updated.snoozedUntil = new Date(now.getTime() + value * 60_000).toISOString()
      updated.nextAt = updated.snoozedUntil
      updated.nextKind = 'snooze'
    } else if (action === 'dismiss') {
      updated.ringingAt = ''
      updated.snoozedUntil = ''
      if (updated.repeat === 'once') {
        updated.enabled = false
        updated.nextAt = ''
      } else {
        updated.nextAt = nextAlarmOccurrence(updated, now)
      }
    }
    if (updated.enabled && !updated.nextAt) throw new RangeError('This alarm has no future occurrence.')
    updated.nextKind = updated.nextAt ? updated.nextKind || 'schedule' : ''
    await putRecord('alarm', updated)
    await putRecord('alarm_history', {
      id: idFactory(),
      alarmId: id,
      label: alarm.label,
      action: action === 'setEnabled' ? (updated.enabled ? 'enabled' : 'disabled') : action,
      occurredAt: now.toISOString(),
    })
    await refreshLocalNotifications()
    return updated
  }

  async function saveReminderList(reminders) {
    if (!Array.isArray(reminders)) throw new TypeError('Reminders must be provided as an array.')
    const ids = new Set()
    reminders.forEach(reminder => {
      validateIdAndTitle(reminder, 'Reminder')
      if (!['active', 'completed', 'paused'].includes(reminder.status)) throw new TypeError(`Reminder ${reminder.id} has an invalid status.`)
      if (!['none', 'daily', 'weekly', 'monthly'].includes(reminder.repeat)) throw new TypeError(`Reminder ${reminder.id} has an invalid repeat schedule.`)
      if (!Number.isFinite(Date.parse(reminder.scheduledAt))) throw new TypeError(`Reminder ${reminder.id} has an invalid scheduled date.`)
      if (reminder.nextAt && !Number.isFinite(Date.parse(reminder.nextAt))) throw new TypeError(`Reminder ${reminder.id} has an invalid next delivery date.`)
      if (ids.has(reminder.id)) throw new TypeError(`Duplicate reminder id: ${reminder.id}`)
      ids.add(reminder.id)
    })
    await replaceRecords('reminder', reminders)
    emit('remindersChanged', reminders)
    await refreshLocalNotifications()
    return reminders
  }

  async function saveTaskList(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError('Tasks must be provided as an array.')
    const ids = new Set()
    for (const task of tasks) {
      validateIdAndTitle(task, 'Task')
      if (ids.has(task.id)) throw new TypeError(`Duplicate task id: ${task.id}`)
      ids.add(task.id)
    }
    for (const task of tasks) {
      for (const dependencyId of task.dependencies || []) {
        if (!ids.has(dependencyId)) throw new TypeError(`Task ${task.id} references missing dependency ${dependencyId}.`)
      }
    }
    await replaceRecords('task', tasks)
    if (tasks.length) await setSetting('legacy-tasks-imported', true)
    await recordTaskReminderImports()
    await refreshLocalNotifications()
    return getRecords('reminder')
  }

  async function deleteRecord(type, id) {
    const deleted = await markDeleted(type, id)
    if (['reminder', 'alarm'].includes(type)) await refreshLocalNotifications()
    return deleted
  }

  async function listNotes() {
    const [notes, attachments] = await Promise.all([
      getRecords('note'),
      getRecords('note_attachment'),
    ])
    return notes.map(note => ({
      ...note,
      attachments: attachments.filter(file => file.noteId === note.id)
        .map(({ id, name, size, type }) => ({ id, name, size, type })),
      historyCount: note.history?.length || 0,
    }))
  }

  async function recordTaskReminderImports() {
    const imported = new Set(await getSetting('legacy-reminder-imports', []))
    const reminders = await getRecords('reminder')
    const known = new Set(reminders.map(reminder => reminder.legacyKey).filter(Boolean))
    const tasks = await getRecords('task')
    const additions = tasks.filter(task => task.reminderAt
      && Number.isFinite(Date.parse(task.reminderAt))
      && !known.has(`task:${task.id}`)
      && !imported.has(`task:${task.id}`))
      .map(task => {
        const scheduledAt = new Date(task.reminderAt).toISOString()
        return {
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
          legacyKey: `task:${task.id}`,
        }
      })
    if (additions.length) await replaceRecords('reminder', [...reminders, ...additions])
  }

  async function focusSummary(startAt, endAt) {
    if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))
      || Date.parse(startAt) >= Date.parse(endAt)) {
      throw new TypeError('A valid focus summary date range is required.')
    }
    const rowsInRange = (await getRecords('focus_session')).filter(session => (
      Date.parse(session.startedAt) >= Date.parse(startAt)
      && Date.parse(session.startedAt) < Date.parse(endAt)
      && session.mode === 'focus'
      && session.status === 'completed'
    ))
    const categories = new Map()
    for (const session of rowsInRange) {
      categories.set(session.category, (categories.get(session.category) || 0) + session.durationSeconds)
    }
    return {
      totalSeconds: [...categories.values()].reduce((sum, seconds) => sum + seconds, 0),
      byCategory: [...categories].map(([category, seconds]) => ({ category, seconds }))
        .sort((left, right) => right.seconds - left.seconds),
    }
  }

  async function updateTaskActualMinutes(taskId, durationSeconds) {
    if (!taskId || durationSeconds < 1) return null
    const task = await getRecord('task', taskId)
    if (!task) return null
    task.actualMinutes = Math.round(((Number(task.actualMinutes) || 0) + durationSeconds / 60) * 10) / 10
    await putRecord('task', task)
    return { id: taskId, actualMinutes: task.actualMinutes }
  }

  async function finishFocus(id, discard = false) {
    const session = await getRecord('focus_session', id)
    if (!session || session.status !== 'active') return null
    const endedAt = new Date().toISOString()
    const durationSeconds = discard ? 0 : Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000))
    const updated = {
      ...session,
      endedAt,
      durationSeconds,
      status: discard ? 'discarded' : 'completed',
    }
    await putRecord('focus_session', updated)
    const task = updated.mode === 'focus' && !discard
      ? await updateTaskActualMinutes(updated.taskId, durationSeconds)
      : null
    const result = { ...updated, task }
    if (activeFocusTimer) clearTimeout(activeFocusTimer)
    activeFocusTimer = undefined
    emit('focusCompleted', result)
    return result
  }

  async function filePicker(multiple = false) {
    if (typeof document === 'undefined') throw new Error('File selection is unavailable on this device.')
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = multiple
      input.onchange = () => resolve([...input.files])
      input.onerror = () => reject(new Error('The selected files could not be read.'))
      input.click()
    })
  }

  function toBase64(bytes) {
    let binary = ''
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  async function addAttachments(noteId) {
    if (!files) throw new Error('Android file storage is unavailable.')
    const note = await getRecord('note', noteId)
    if (!note) throw new TypeError('The note for these attachments does not exist.')
    const selected = await filePicker(true)
    if (selected.length > 10) throw new RangeError('Choose no more than 10 files at a time.')
    for (const file of selected) {
      if (file.size > 25 * 1024 * 1024) throw new RangeError(`${file.name} is larger than the 25 MB per-file limit.`)
      const id = idFactory()
      const path = `note-attachments/${id}`
      const content = toBase64(await file.arrayBuffer())
      await files.writeFile({ path, data: content, directory: 'DATA', recursive: true })
      await putRecord('note_attachment', {
        id,
        noteId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        path,
      })
    }
    return (await getRecords('note_attachment')).filter(item => item.noteId === noteId)
      .map(({ id, name, size, type }) => ({ id, name, size, type }))
  }

  async function exportData(kind) {
    const tasks = await getRecords('task')
    const reminders = await getRecords('reminder')
    const alarms = await getRecords('alarm')
    const notes = await listNotes()
    const events = await getRecords('event')
    const focusSessions = await getRecords('focus_session')
    const scheduledFocusBlocks = await getRecords('scheduled_focus')
    const data = kind === 'tasks' ? { format: 'mydesk-tasks', version: 1, tasks }
      : kind === 'notes' ? { format: 'mydesk-notes', version: 1, notes }
        : kind === 'calendar' ? { format: 'mydesk-calendar', version: 1, events }
          : {
            format: 'mydesk-data-export',
            version: 1,
            exportedAt: new Date().toISOString(),
            tasks,
            reminders,
            alarms: {
              alarms,
              profiles: (await getRecords('alarm_profile')).map(item => item.name),
              history: await getRecords('alarm_history'),
            },
            notes,
            events,
            focusSessions,
            scheduledFocusBlocks,
            settings: await getSetting('settings', {}),
          }
    if (kind === 'all' || kind === 'notes') {
      if (notes.some(note => note.attachments.length) && !files) {
        throw new Error('Note attachments cannot be exported without local file access.')
      }
      data.notes = await Promise.all(notes.map(async note => ({
        ...note,
        attachments: await Promise.all(note.attachments.map(async attachment => {
          const stored = await getRecord('note_attachment', attachment.id)
          if (!stored) throw new Error(`Attachment ${attachment.name} is missing from local storage.`)
          const content = await files.readFile({ path: stored.path, directory: 'DATA' })
          return { ...attachment, contentBase64: content.data }
        })),
      })))
    }
    return data
  }

  async function saveExport(kind) {
    if (!files) throw new Error('File export is unavailable on this device.')
    const data = await exportData(kind)
    const name = `mydesk-${kind}-${dateKey(new Date())}.json`
    const result = await files.writeFile({
      path: name,
      data: toBase64(new TextEncoder().encode(JSON.stringify(data, null, 2))),
      directory: 'DOCUMENTS',
      recursive: true,
    })
    if (share?.share) await share.share({ title: 'MyDesk data export', url: result.uri, dialogTitle: 'Save MyDesk export' })
    return { canceled: false, filePath: result.uri || name }
  }

  async function restoreData() {
    const [file] = await filePicker()
    if (!file) return { canceled: true }
    const parsed = JSON.parse(await file.text())
    const safety = await exportData('all')
    await files.writeFile({
      path: `mydesk-pre-restore-${Date.now()}.json`,
      data: toBase64(new TextEncoder().encode(JSON.stringify(safety))),
      directory: 'DOCUMENTS',
      recursive: true,
    })
    const data = parsed.format === 'mydesk-data-export' ? parsed : parsed
    if (!data || (!Array.isArray(data.tasks) && !Array.isArray(data.notes) && !Array.isArray(data.events))) {
      throw new TypeError('The selected file is not a supported MyDesk export.')
    }
    if (Array.isArray(data.tasks)) await replaceRecords('task', data.tasks)
    if (Array.isArray(data.reminders)) await replaceRecords('reminder', data.reminders)
    if (Array.isArray(data.alarms?.alarms)) await replaceRecords('alarm', data.alarms.alarms)
    if (Array.isArray(data.alarms?.profiles)) await replaceRecords(
      'alarm_profile',
      data.alarms.profiles.map(name => ({ id: name, name })),
    )
    if (Array.isArray(data.alarms?.history)) await replaceRecords('alarm_history', data.alarms.history)
    if (Array.isArray(data.notes)) {
      const existingAttachments = await getRecords('note_attachment')
      await replaceRecords('note_attachment', [])
      for (const attachment of existingAttachments) {
        if (files) await files.deleteFile({ path: attachment.path, directory: 'DATA' })
      }
      for (const note of data.notes) {
        const { attachments = [], ...noteContent } = note
        await updateNote(noteContent)
        for (const attachment of attachments) {
          if (!attachment.contentBase64 || !files) continue
          const id = attachment.id || idFactory()
          const path = `note-attachments/${id}`
          await files.writeFile({ path, data: attachment.contentBase64, directory: 'DATA', recursive: true })
          await putRecord('note_attachment', {
            id,
            noteId: note.id,
            name: attachment.name,
            size: attachment.size,
            type: attachment.type,
            path,
          })
        }
      }
    }
    if (Array.isArray(data.events)) await replaceRecords('event', data.events)
    if (Array.isArray(data.focusSessions)) await replaceRecords('focus_session', data.focusSessions)
    if (Array.isArray(data.scheduledFocusBlocks)) await replaceRecords('scheduled_focus', data.scheduledFocusBlocks)
    return { canceled: false, safetyBackup: 'Saved in Documents' }
  }

  async function getSyncSummary() {
    const accountId = await getSyncState('active-account-id', '')
    const [queue] = await rows(
    "SELECT COUNT(*) AS count FROM mobile_sync_queue WHERE account_id = ?",
      [accountId],
    )
    const [conflicts] = await rows(
      "SELECT COUNT(*) AS count FROM mobile_sync_conflicts WHERE account_id = ? AND resolved_at = ''",
      [accountId],
    )
    return {
      deviceId,
      accountId,
      pending: Number(queue?.count) || 0,
      conflicts: Number(conflicts?.count) || 0,
    }
  }

  function getAuthClient() {
    if (!authClient) throw new Error('Authentication has not been initialized on this device.')
    return authClient
  }

  async function activateSyncAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) {
      throw new TypeError('An authenticated account id is required.')
    }
    const knownAccountId = await getSyncState('known-account-id', '')
    if (knownAccountId && knownAccountId !== accountId) {
      throw new Error('This local database is linked to a different account. Export its data before using another account on this device.')
    }
    await transaction(async () => {
      await setSyncState('known-account-id', accountId)
      await setSyncState('active-account-id', accountId)
      const placeholders = [...syncableTypes].map(() => '?').join(', ')
      const localRecords = await rows(`
        SELECT entity_type, id, payload, server_version, deleted_at
        FROM mobile_records WHERE account_id IS NULL
          AND entity_type IN (${placeholders})
      `, [...syncableTypes])
      for (const record of localRecords) {
        if (record.entity_type === 'focus_session'
          && !record.deleted_at && JSON.parse(record.payload).status === 'active') continue
        await run(`
          UPDATE mobile_records SET account_id = ?, sync_status = 'pending', device_id = ?
          WHERE entity_type = ? AND id = ? AND account_id IS NULL
        `, [accountId, deviceId, record.entity_type, record.id])
        await queueOperation(
          accountId,
          record.entity_type,
          record.id,
          record.deleted_at ? 'delete' : 'upsert',
          record.deleted_at ? null : JSON.parse(record.payload),
          record.server_version,
        )
      }
    })
    return getSyncSummary()
  }

  async function listPendingOperations(limit = 100) {
    const accountId = await getSyncState('active-account-id', '')
    if (!accountId) return []
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 100
    return (await rows(`
      SELECT operation_id AS operationId, account_id AS accountId,
        entity_type AS entityType, record_id AS recordId, operation, payload,
        base_server_version AS baseServerVersion, enqueued_at AS enqueuedAt,
        attempts, next_retry_at AS nextRetryAt, last_error AS lastError
      FROM mobile_sync_queue
      WHERE account_id = ? AND queue_status = 'pending' AND next_retry_at <= ?
      ORDER BY enqueued_at LIMIT ?
    `, [accountId, new Date().toISOString(), safeLimit]))
      .map(operation => ({ ...operation, payload: operation.payload ? JSON.parse(operation.payload) : null }))
  }

  async function markOperationsInFlight(operationIds) {
    if (!Array.isArray(operationIds) || operationIds.length > 500
      || operationIds.some(id => typeof id !== 'string' || !id)) {
      throw new TypeError('Sync operation ids must be provided as an array of strings.')
    }
    const accountId = await getSyncState('active-account-id', '')
    if (!accountId || !operationIds.length) return
    await transaction(async () => {
      for (const operationId of operationIds) {
        await run(`
          UPDATE mobile_sync_queue SET queue_status = 'in_flight'
          WHERE operation_id = ? AND account_id = ? AND queue_status = 'pending'
        `, [operationId, accountId])
      }
    })
  }

  async function retryOperation(operationId, error, retryAt) {
    if (typeof retryAt !== 'string' || !Number.isFinite(Date.parse(retryAt))) {
      throw new TypeError('A valid sync retry time is required.')
    }
    const accountId = await getSyncState('active-account-id', '')
    if (!accountId) return false
    await run(`
      UPDATE mobile_sync_queue SET queue_status = 'pending', attempts = attempts + 1,
        next_retry_at = ?, last_error = ?
      WHERE operation_id = ? AND account_id = ?
    `, [new Date(retryAt).toISOString(), String(error || 'Sync failed').slice(0, 1000), operationId, accountId])
    return true
  }

  async function markOperationSynced(operationId, serverVersion) {
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
      throw new TypeError('A positive server revision is required.')
    }
    const accountId = await getSyncState('active-account-id', '')
    if (!accountId) return false
    return transaction(async () => {
      const [operation] = await rows(`
        SELECT entity_type, record_id FROM mobile_sync_queue
        WHERE operation_id = ? AND account_id = ?
      `, [operationId, accountId])
      if (!operation) return false
      const localType = localEntityTypes[operation.entity_type] || operation.entity_type
      await run(`
        UPDATE mobile_records SET server_version = MAX(server_version, ?),
          sync_status = CASE WHEN EXISTS (
            SELECT 1 FROM mobile_sync_queue
            WHERE entity_type = ? AND record_id = ? AND account_id = ? AND operation_id != ?
          ) THEN 'pending' ELSE 'synced' END
        WHERE entity_type = ? AND id = ? AND account_id = ?
      `, [
        serverVersion,
        operation.entity_type,
        operation.record_id,
        accountId,
        operationId,
        localType,
        operation.record_id,
        accountId,
      ])
      await run('DELETE FROM mobile_sync_queue WHERE operation_id = ?', [operationId])
      return true
    })
  }

  async function applyRemoteRecord(remote, force = false) {
    const type = localEntityTypes[remote?.entityType] || remote?.entityType
    if (!syncableTypes.has(type) || typeof remote.recordId !== 'string'
      || !Number.isSafeInteger(remote.serverVersion) || remote.serverVersion < 1) {
      throw new TypeError('The remote sync record is invalid.')
    }
    const accountId = await getSyncState('active-account-id', '')
    if (!accountId || remote.accountId !== accountId) {
      throw new Error('A remote record cannot be applied outside the active account.')
    }
    const [existing] = await rows(`
      SELECT payload, server_version, sync_status FROM mobile_records
      WHERE entity_type = ? AND id = ?
    `, [type, remote.recordId])
    if (existing && existing.server_version >= remote.serverVersion) return { applied: false, stale: true }
    const remoteEnvelope = {
      entityType: remote.entityType,
      recordId: remote.recordId,
      accountId,
      payload: remote.payload,
      deletedAt: remote.deletedAt || '',
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      serverVersion: remote.serverVersion,
    }
    if (!force && existing && ['pending', 'conflict'].includes(existing.sync_status)) {
      const conflictId = idFactory()
      await transaction(async () => {
        await run(`
          INSERT INTO mobile_sync_conflicts (
            id, account_id, entity_type, record_id, local_payload, remote_payload, detected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          conflictId,
          accountId,
          remote.entityType,
          remote.recordId,
          existing.payload,
          stableJson(remoteEnvelope),
          new Date().toISOString(),
        ])
        await run(`
          UPDATE mobile_records SET sync_status = 'conflict'
          WHERE entity_type = ? AND id = ?
        `, [type, remote.recordId])
        await run(`
          DELETE FROM mobile_sync_queue
          WHERE account_id = ? AND entity_type = ? AND record_id = ?
        `, [accountId, remote.entityType, remote.recordId])
      })
      return { applied: false, conflictId }
    }

    await transaction(async () => {
      applyingRemote = true
      try {
        if (remote.deletedAt) {
          const payload = existing?.payload || stableJson(remote.payload || { id: remote.recordId })
          await run(`
            INSERT INTO mobile_records (
              entity_type, id, payload, created_at, updated_at, deleted_at,
              sync_status, device_id, server_version, account_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)
            ON CONFLICT(entity_type, id) DO UPDATE SET
              updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
              sync_status = 'synced', server_version = excluded.server_version,
              account_id = excluded.account_id
          `, [
            type,
            remote.recordId,
            payload,
            remote.createdAt || new Date().toISOString(),
            remote.updatedAt || remote.deletedAt,
            remote.deletedAt,
            deviceId,
            remote.serverVersion,
            accountId,
          ])
        } else {
          if (!remote.payload || remote.payload.id !== remote.recordId) {
            throw new TypeError('The remote sync payload does not match its record id.')
          }
          if (type === 'focus_session' && remote.payload.status === 'active') {
            throw new TypeError('Active focus sessions are device-local and cannot be synchronized.')
          }
          const domainRecord = { ...remote.payload }
          delete domainRecord.accountId
          delete domainRecord.deviceId
          delete domainRecord.serverVersion
          delete domainRecord.syncStatus
          if (type === 'task' && existing) {
            const localRecord = JSON.parse(existing.payload)
            if (Array.isArray(localRecord.attachments)) domainRecord.attachments = localRecord.attachments
          }
          await putRecord(type, {
            ...domainRecord,
            accountId,
            serverVersion: remote.serverVersion,
            createdAt: remote.createdAt || domainRecord.createdAt,
            updatedAt: remote.updatedAt || domainRecord.updatedAt,
          })
        }
      } finally {
        applyingRemote = false
      }
    })
    emit('syncUpdated', { entityTypes: [type], recordId: remote.recordId })
    if (['reminder', 'alarm'].includes(type)) await refreshLocalNotifications()
    return { applied: true, stale: false }
  }

  async function listConflicts() {
    const accountId = await getSyncState('active-account-id', '')
    return (await rows(`
      SELECT id, entity_type AS entityType, record_id AS recordId,
        local_payload AS localPayload, remote_payload AS remotePayload,
        detected_at AS detectedAt
      FROM mobile_sync_conflicts WHERE account_id = ? AND resolved_at = ''
      ORDER BY detected_at DESC
    `, [accountId])).map(conflict => ({
      ...conflict,
      localPayload: JSON.parse(conflict.localPayload),
      remotePayload: JSON.parse(conflict.remotePayload),
    }))
  }

  async function resolveSyncConflict(id, resolution) {
    if (!['keep-local', 'keep-remote'].includes(resolution)) {
      throw new TypeError('Choose a valid sync conflict resolution.')
    }
    const accountId = await getSyncState('active-account-id', '')
    const [conflict] = await rows(`
      SELECT entity_type, record_id, local_payload, remote_payload
      FROM mobile_sync_conflicts WHERE id = ? AND account_id = ? AND resolved_at = ''
    `, [id, accountId])
    if (!conflict) return false
    const remote = JSON.parse(conflict.remote_payload)
    if (resolution === 'keep-remote') {
      await applyRemoteRecord(remote, true)
    } else {
      const localType = localEntityTypes[conflict.entity_type] || conflict.entity_type
      const local = JSON.parse(conflict.local_payload)
      const [record] = await rows(`
        SELECT account_id, deleted_at FROM mobile_records WHERE entity_type = ? AND id = ?
      `, [localType, conflict.record_id])
      if (record?.deleted_at) {
        await run(`
          UPDATE mobile_records SET deleted_at = NULL, sync_status = 'pending',
            server_version = ?, updated_at = ? WHERE entity_type = ? AND id = ?
        `, [remote.serverVersion, new Date().toISOString(), localType, conflict.record_id])
      } else {
        await run(`
          UPDATE mobile_records SET sync_status = 'pending', server_version = ?
          WHERE entity_type = ? AND id = ?
        `, [remote.serverVersion, localType, conflict.record_id])
      }
      await queueOperation(accountId, localType, conflict.record_id, 'upsert', local, remote.serverVersion)
    }
    await run(`
      UPDATE mobile_sync_conflicts SET resolved_at = ?, resolution = ?
      WHERE id = ? AND account_id = ?
    `, [new Date().toISOString(), resolution, id, accountId])
    if (resolution === 'keep-remote') {
      const localType = localEntityTypes[conflict.entity_type] || conflict.entity_type
      await run(`
        DELETE FROM mobile_sync_queue
        WHERE account_id = ? AND entity_type = ? AND record_id = ?
      `, [accountId, conflict.entity_type, conflict.record_id])
      await run(`
        UPDATE mobile_records SET sync_status = 'synced'
        WHERE entity_type = ? AND id = ?
      `, [localType, conflict.record_id])
    }
    return true
  }

  return {
    platform: 'android',
    initialize: async () => {
      await database.execute(schema)
      const columns = await rows('PRAGMA table_info(mobile_records)')
      if (!columns.some(column => column.name === 'account_id')) {
        await database.execute('ALTER TABLE mobile_records ADD COLUMN account_id TEXT')
      }
      await database.run(
        'INSERT OR IGNORE INTO mobile_migrations (version, applied_at) VALUES (1, ?)',
        [new Date().toISOString()],
        false,
      )
      await database.run(
        'INSERT OR IGNORE INTO mobile_migrations (version, applied_at) VALUES (2, ?)',
        [new Date().toISOString()],
        false,
      )
      deviceId = await getSyncState('device-id', '')
      if (!deviceId) {
        deviceId = idFactory()
        await setSyncState('device-id', deviceId)
      }
      await run(`
        UPDATE mobile_sync_queue SET queue_status = 'pending', next_retry_at = ?
        WHERE queue_status = 'in_flight'
      `, [new Date().toISOString()])
      await recordTaskReminderImports()
      await refreshLocalNotifications()
    },
    tasks: {
      load: async () => ({
        tasks: await getRecords('task'),
        hasImportedLegacyTasks: await getSetting('legacy-tasks-imported', false),
      }),
      save: saveTaskList,
      historyForDate: async date => (await getRecords('task')).flatMap(task => (
        (task.history || [])
          .filter(entry => dateKey(new Date(entry.at)) === date)
          .map(entry => ({ taskId: task.id, title: task.title, ...entry }))
      )),
    },
    reminders: {
      load: async () => {
        await recordTaskReminderImports()
        return getRecords('reminder')
      },
      save: saveReminderList,
      complete: id => markReminder(id, reminder => {
        const now = new Date()
        if (reminder.repeat === 'none') return {
          ...reminder,
          status: 'completed',
          completedAt: now.toISOString(),
          lastCompletedAt: now.toISOString(),
          nextAt: '',
          nextKind: '',
          snoozedUntil: '',
          escalationCount: 0,
        }
        const scheduledAt = nextReminderOccurrence(reminder.scheduledAt, reminder.repeat)
        return {
          ...reminder,
          scheduledAt,
          nextAt: scheduledAt,
          nextKind: 'schedule',
          lastCompletedAt: now.toISOString(),
          snoozedUntil: '',
          escalationCount: 0,
        }
      }),
      snooze: (id, minutes) => {
        if (!snoozeOptions.has(minutes)) throw new RangeError('Choose a supported snooze duration.')
        const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString()
        return markReminder(id, reminder => ({ ...reminder, snoozedUntil, nextAt: snoozedUntil, nextKind: 'snooze' }))
      },
      delete: async id => {
        const reminder = await getRecord('reminder', id)
        if (reminder?.legacyKey) {
          const imports = await getSetting('legacy-reminder-imports', [])
          await setSetting('legacy-reminder-imports', [...new Set([...imports, reminder.legacyKey])])
        }
        return deleteRecord('reminder', id)
      },
      onTriggered: callback => subscribe('reminderTriggered', callback),
      onError: callback => subscribe('error', callback),
    },
    alarms: {
      load: async () => ({
        alarms: await getRecords('alarm'),
        profiles: (await getRecords('alarm_profile')).map(item => item.name),
        history: (await getRecords('alarm_history')).slice(-50).reverse(),
      }),
      save: saveAlarms,
      snooze: (id, minutes) => updateAlarm(id, 'snooze', minutes),
      dismiss: id => updateAlarm(id, 'dismiss'),
      setEnabled: (id, enabled) => updateAlarm(id, 'setEnabled', enabled),
      delete: async id => {
        return deleteRecord('alarm', id)
      },
      onTriggered: callback => subscribe('alarmTriggered', callback),
      onError: callback => subscribe('error', callback),
    },
    notes: {
      load: async () => ({
        notes: await listNotes(),
        hasImportedLegacyNotes: await getSetting('legacy-notes-imported', false),
      }),
      saveAll: async notes => {
        await saveNotes(notes)
        await setSetting('legacy-notes-imported', true)
        return listNotes()
      },
      save: updateNote,
      search: async (query, includeArchived = false) => {
        const normalized = String(query || '').trim().toLowerCase()
        return (await listNotes()).filter(note => (
          (includeArchived || !note.archived)
          && (!normalized || `${note.title} ${note.body} ${note.category} ${(note.tags || []).join(' ')}`
            .toLowerCase().includes(normalized))
        ))
      },
      history: async noteId => ((await getRecord('note', noteId))?.history || []),
      delete: async noteId => {
        const attachments = (await getRecords('note_attachment')).filter(item => item.noteId === noteId)
        await transaction(async () => {
          await markDeleted('note', noteId)
          for (const attachment of attachments) {
            await markDeleted('note_attachment', attachment.id)
            if (files) await files.deleteFile({ path: attachment.path, directory: 'DATA' })
          }
        })
        return listNotes()
      },
      addAttachments,
      removeAttachment: async (noteId, attachmentId) => {
        const attachment = await getRecord('note_attachment', attachmentId)
        if (attachment?.noteId === noteId) {
          await markDeleted('note_attachment', attachmentId)
          if (files) await files.deleteFile({ path: attachment.path, directory: 'DATA' })
        }
        return (await getRecords('note_attachment')).filter(item => item.noteId === noteId)
          .map(({ id, name, size, type }) => ({ id, name, size, type }))
      },
      openAttachment: async (noteId, attachmentId) => {
        const attachment = await getRecord('note_attachment', attachmentId)
        if (!attachment || attachment.noteId !== noteId || !files) throw new TypeError('The requested note attachment does not exist.')
        const result = await files.readFile({ path: attachment.path, directory: 'DATA' })
        const link = document.createElement('a')
        link.href = `data:${attachment.type};base64,${result.data}`
        link.download = attachment.name
        link.click()
      },
      onQuickCapture: callback => subscribe('quickCapture', callback),
    },
    focus: {
      active: async () => {
        const active = (await getRecords('focus_session')).find(session => session.status === 'active')
        if (active && Date.parse(active.plannedEndAt) <= Date.now()) await finishFocus(active.id)
        return (await getRecords('focus_session')).find(session => session.status === 'active') || null
      },
      scheduled: () => getRecords('scheduled_focus'),
      saveScheduled: async block => {
        normalizeSession({ ...block, id: block.id, startedAt: undefined, plannedEndAt: undefined })
        if (!Number.isFinite(Date.parse(block.scheduledAt)) || Date.parse(block.scheduledAt) <= Date.now()) {
          throw new TypeError('Scheduled focus needs a valid future date and time.')
        }
        const saved = { ...block, createdAt: (await getRecord('scheduled_focus', block.id))?.createdAt || new Date().toISOString() }
        await putRecord('scheduled_focus', saved)
        return saved
      },
      deleteScheduled: async id => {
        return deleteRecord('scheduled_focus', id)
      },
      start: async input => {
        const session = normalizeSession(input)
        const current = (await getRecords('focus_session')).find(item => item.status === 'active')
        if (current) throw new Error('A focus session is already running.')
        if (session.taskId && !(await getRecord('task', session.taskId))) {
          throw new TypeError('The selected task no longer exists.')
        }
        await putRecord('focus_session', session)
        activeFocusTimer = setTimeout(() => {
          void finishFocus(session.id).catch(error => emit('error', error.message))
        }, Math.max(0, Date.parse(session.plannedEndAt) - Date.now()))
        return session
      },
      finish: finishFocus,
      recordManual: async input => {
        const startedAt = Date.parse(input.startedAt)
        const endedAt = Date.parse(input.endedAt)
        if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)
          || endedAt <= startedAt || endedAt > Date.now() || endedAt - startedAt > 24 * 60 * 60_000) {
          throw new TypeError('Manual tracking needs a valid past start and end time no more than 24 hours apart.')
        }
        const session = normalizeSession({
          ...input,
          mode: 'focus',
          startedAt: new Date(startedAt).toISOString(),
          plannedEndAt: '',
          endedAt: new Date(endedAt).toISOString(),
          targetMinutes: Math.min(240, Math.max(1, Math.ceil((endedAt - startedAt) / 60_000))),
          durationSeconds: Math.floor((endedAt - startedAt) / 1000),
          status: 'completed',
          source: 'manual',
        })
        if (session.taskId && !(await getRecord('task', session.taskId))) {
          throw new TypeError('The selected task no longer exists.')
        }
        session.status = 'completed'
        session.source = 'manual'
        await putRecord('focus_session', session)
        session.task = await updateTaskActualMinutes(session.taskId, session.durationSeconds)
        return session
      },
      history: async (startAt, endAt) => (await getRecords('focus_session'))
        .filter(session => Date.parse(session.startedAt) >= Date.parse(startAt)
          && Date.parse(session.startedAt) < Date.parse(endAt))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, 2000),
      summary: focusSummary,
      onCompleted: callback => subscribe('focusCompleted', callback),
      onError: callback => subscribe('error', callback),
    },
    settings: {
      load: async () => {
        const settings = await getSetting('settings', {})
        return {
          theme: settings.theme || 'warm',
          events: await getRecords('event'),
          hasCalendarEvents: Boolean(await getSetting('calendar-events-initialized', false)),
          autoBackupEnabled: false,
          backupDirectory: '',
          lastAutoBackupAt: '',
        }
      },
      save: async (key, value) => {
        if (key === 'calendar-events') {
          if (!Array.isArray(value) || value.some(event => (
            !event || typeof event.id !== 'string' || typeof event.title !== 'string' || !isValidDateKey(event.date)
          ))) {
            throw new TypeError('Each calendar event must have an id, title, and valid date.')
          }
          await replaceRecords('event', value)
          await setSetting('calendar-events-initialized', true)
          return value
        }
        const settings = await getSetting('settings', {})
        settings[key] = value
        await setSetting('settings', settings)
        return value
      },
    },
    backups: {
      create: async () => saveExport('all'),
      restore: restoreData,
      export: saveExport,
      chooseDirectory: async () => 'Documents/MyDesk',
      onError: callback => subscribe('backupError', callback),
    },
    sync: {
      state: getSyncSummary,
      activateAccount: activateSyncAccount,
      logout: async () => {
        await run("DELETE FROM mobile_sync_state WHERE key = 'active-account-id'")
        return getSyncSummary()
      },
      pending: listPendingOperations,
      markInFlight: markOperationsInFlight,
      retry: retryOperation,
      markSynced: markOperationSynced,
      applyRemote: applyRemoteRecord,
      conflicts: listConflicts,
      resolveConflict: resolveSyncConflict,
      cursor: () => getSyncState('pull-cursor', ''),
      setCursor: async value => {
        if ((typeof value !== 'string' && !Number.isSafeInteger(value))
          || String(value).length > 1000) {
          throw new TypeError('A valid sync cursor is required.')
        }
        await setSyncState('pull-cursor', value)
      },
      apiBaseUrl: () => getSyncState('api-base-url', ''),
      setApiBaseUrl: value => setSyncState('api-base-url', value),
      push: operations => getAuthClient().request('/v1/sync/push', { method: 'POST', body: { operations } }),
      pull: cursor => getAuthClient().request(
        `/v1/sync/pull?cursor=${encodeURIComponent(String(cursor || '0'))}&limit=200`,
      ),
      registerDevice: device => getAuthClient().request('/v1/devices', {
        method: 'POST',
        body: { ...device, displayName: 'MyDesk Android' },
      }),
      onUpdated: callback => subscribe('syncUpdated', callback),
    },
    notifications: {
      handleReceived: async id => {
        try {
          return await handleLocalNotification(id)
        } catch (error) {
          emit('error', `Android notification handling failed: ${error.message}`)
          throw error
        }
      },
      refresh: refreshLocalNotifications,
    },
    auth: {
      attach: client => {
        if (!client || typeof client.initialize !== 'function') {
          throw new TypeError('An initialized authentication client is required.')
        }
        authClient = client
      },
      status: () => getAuthClient().status(),
      configure: value => getAuthClient().configure(value),
      register: (email, password) => getAuthClient().register(email, password),
      login: (email, password) => getAuthClient().login(email, password),
      logout: () => getAuthClient().logout(),
      onChanged: callback => getAuthClient().onChanged(callback),
    },
  }
}

export { createMobileApi, schema as mobileSchema }
