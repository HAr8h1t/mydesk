import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createMobileApi } from './mobile-api.js'

const databases = []

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  return {
    execute: async statements => sqlite.exec(statements),
    query: async (statement, values = []) => ({ values: sqlite.prepare(statement).all(...values) }),
    run: async (statement, values = []) => ({
      changes: { changes: sqlite.prepare(statement).run(...values).changes },
    }),
    beginTransaction: async () => sqlite.exec('BEGIN IMMEDIATE'),
    commitTransaction: async () => sqlite.exec('COMMIT'),
    rollbackTransaction: async () => sqlite.exec('ROLLBACK'),
  }
}

afterEach(() => {
  databases.splice(0).forEach(database => database.close())
})

test('stores tasks, relationships, and calendar events in local SQLite', async () => {
  const api = createMobileApi({ database: createDatabase() })
  await api.initialize()
  await api.tasks.save([{
    id: 'task-uuid',
    title: 'Plan offline',
    dependencies: [],
    subtasks: [{ id: 'subtask-uuid', title: 'Check locally', done: false }],
    history: [],
  }])
  await api.settings.save('calendar-events', [{
    id: 'event-uuid',
    title: 'Local event',
    date: '2026-11-20',
    startTime: '10:00',
    endTime: '11:00',
  }])

  assert.equal((await api.tasks.load()).tasks[0].subtasks[0].title, 'Check locally')
  assert.equal((await api.settings.load()).events[0].title, 'Local event')
  assert.equal((await api.settings.load()).hasCalendarEvents, true)
})

test('persists and validates sound preferences and a personal ringtone locally', async () => {
  const api = createMobileApi({ database: createDatabase() })
  await api.initialize()
  await api.settings.save('sound-effects-enabled', true)
  await api.settings.save('ui-sound-volume', 0.6)
  await api.settings.save('alarm-tone', {
    type: 'custom',
    name: 'soft.wav',
    extension: '.wav',
    dataUrl: 'data:audio/wav;base64,UklGRg==',
  })

  const saved = await api.settings.load()
  assert.equal(saved.soundEffectsEnabled, true)
  assert.equal(saved.uiSoundVolume, 0.6)
  assert.equal(saved.alarmTone.name, 'soft.wav')
  await assert.rejects(api.settings.save('ui-sound-volume', 1.2), /between 0 and 1/)
  await assert.rejects(api.settings.save('alarm-tone', { type: 'built-in', id: 'unknown' }), /supported built-in/)
})

test('persists notes, revisions, and deletion without a network service', async () => {
  const api = createMobileApi({ database: createDatabase(), idFactory: () => 'history-uuid' })
  await api.initialize()
  await api.notes.saveAll([{
    id: 'note-uuid',
    title: 'First',
    body: 'Local data',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
  }])
  await api.notes.save({
    id: 'note-uuid',
    title: 'Updated',
    body: 'Still local',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T11:00:00.000Z',
  })

  assert.equal((await api.notes.history('note-uuid')).length, 2)
  assert.equal((await api.notes.search('still local'))[0].title, 'Updated')
  await api.notes.delete('note-uuid')
  assert.deepEqual((await api.notes.load()).notes, [])
})

test('claims local data on account link and preserves deletions as durable sync tombstones', async () => {
  const database = createDatabase()
  const api = createMobileApi({ database, idFactory: (() => {
    let id = 0
    return () => `generated-${++id}`
  })() })
  await api.initialize()
  await api.tasks.save([{ id: 'task-uuid', title: 'Offline task', dependencies: [] }])
  assert.equal((await api.sync.pending()).length, 0)

  await api.sync.activateAccount('account-1')
  const [creation] = await api.sync.pending()
  assert.equal(creation.operation, 'upsert')
  assert.equal(creation.entityType, 'task')
  assert.equal(creation.payload.title, 'Offline task')

  await api.tasks.save([])
  const [deletion] = await api.sync.pending()
  assert.equal(deletion.operation, 'delete')
  assert.equal(deletion.recordId, 'task-uuid')
  assert.equal((await api.tasks.load()).tasks.length, 0)

  const { values: [tombstone] } = await database.query(`
    SELECT deleted_at, account_id, sync_status FROM mobile_records
    WHERE entity_type = 'task' AND id = 'task-uuid'
  `)
  assert.ok(tombstone.deleted_at)
  assert.equal(tombstone.account_id, 'account-1')
  assert.equal(tombstone.sync_status, 'pending')
})

test('keeps task attachment data local instead of placing it in the sync queue', async () => {
  const api = createMobileApi({ database: createDatabase() })
  await api.initialize()
  await api.tasks.save([{
    id: 'task-with-file',
    title: 'Offline attachment',
    dependencies: [],
    attachments: [{ id: 'file-1', name: 'local.pdf', dataUrl: 'data:application/pdf;base64,private' }],
  }])
  await api.sync.activateAccount('account-1')

  const [queued] = await api.sync.pending()
  assert.equal(queued.payload.title, 'Offline attachment')
  assert.equal('attachments' in queued.payload, false)
  assert.equal((await api.tasks.load()).tasks[0].attachments[0].dataUrl, 'data:application/pdf;base64,private')
})

test('applies remote records locally and records concurrent edits as resolvable conflicts', async () => {
  const api = createMobileApi({ database: createDatabase() })
  await api.initialize()
  await api.sync.activateAccount('account-1')

  const remote = {
    accountId: 'account-1',
    entityType: 'calendar-event',
    recordId: 'event-uuid',
    payload: { id: 'event-uuid', title: 'Remote event', date: '2026-11-20' },
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    serverVersion: 1,
  }
  assert.equal((await api.sync.applyRemote(remote)).applied, true)
  assert.equal((await api.settings.load()).events[0].title, 'Remote event')

  await api.settings.save('calendar-events', [{
    ...remote.payload,
    title: 'Local edit',
    updatedAt: '2026-11-19T11:00:00.000Z',
  }])
  const conflict = await api.sync.applyRemote({
    ...remote,
    payload: { ...remote.payload, title: 'Server edit' },
    updatedAt: '2026-11-19T12:00:00.000Z',
    serverVersion: 2,
  })
  assert.equal(conflict.applied, false)
  assert.ok(conflict.conflictId)
  assert.equal((await api.sync.conflicts()).length, 1)

  assert.equal(await api.sync.resolveConflict(conflict.conflictId, 'keep-remote'), true)
  assert.equal((await api.settings.load()).events[0].title, 'Server edit')
  assert.equal((await api.sync.conflicts()).length, 0)
})

test('migrates existing local records without replacing them', async () => {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  sqlite.exec(`
    CREATE TABLE mobile_records (
      entity_type TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'local', device_id TEXT NOT NULL DEFAULT '',
      server_version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (entity_type, id)
    );
    CREATE TABLE mobile_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mobile_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO mobile_records (entity_type, id, payload, created_at, updated_at)
    VALUES ('task', 'existing-task', '{"id":"existing-task","title":"Keep"}', '2026-01-01', '2026-01-01');
  `)
  const database = {
    execute: async statements => sqlite.exec(statements),
    query: async (statement, values = []) => ({ values: sqlite.prepare(statement).all(...values) }),
    run: async (statement, values = []) => ({
      changes: { changes: sqlite.prepare(statement).run(...values).changes },
    }),
    beginTransaction: async () => sqlite.exec('BEGIN IMMEDIATE'),
    commitTransaction: async () => sqlite.exec('COMMIT'),
    rollbackTransaction: async () => sqlite.exec('ROLLBACK'),
  }
  const api = createMobileApi({ database })
  await api.initialize()
  assert.equal((await api.tasks.load()).tasks[0].title, 'Keep')
  assert.ok((await database.query('PRAGMA table_info(mobile_records)')).values.some(column => column.name === 'account_id'))
})

test('schedules and cancels Android local notifications from local reminder changes', async () => {
  const scheduled = []
  const cancelled = []
  const notifications = {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    schedule: async value => scheduled.push(...value.notifications),
    cancel: async value => cancelled.push(...value.notifications),
  }
  const api = createMobileApi({ database: createDatabase(), notifications })
  await api.initialize()
  const nextAt = new Date(Date.now() + 60_000).toISOString()
  await api.reminders.save([{
    id: 'reminder-local',
    title: 'Local reminder',
    scheduledAt: nextAt,
    nextAt,
    status: 'active',
    repeat: 'none',
  }])
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].title, 'Local reminder')
  await api.reminders.delete('reminder-local')
  assert.equal(cancelled.length, 1)
  assert.equal(cancelled[0].id, scheduled[0].id)
})

test('validates reminder, alarm, and focus operations against local records', async () => {
  const api = createMobileApi({ database: createDatabase() })
  await api.initialize()
  const reminder = {
    id: 'reminder-uuid',
    title: 'Review',
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    nextAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'active',
    repeat: 'none',
  }
  await api.reminders.save([reminder])
  assert.equal((await api.reminders.complete(reminder.id)).status, 'completed')

  const alarmDate = new Date(Date.now() + 24 * 60 * 60_000)
  const alarm = {
    id: 'alarm-uuid',
    label: 'Wake up',
    time: `${String(alarmDate.getHours()).padStart(2, '0')}:${String(alarmDate.getMinutes()).padStart(2, '0')}`,
    onceDate: [
      alarmDate.getFullYear(),
      String(alarmDate.getMonth() + 1).padStart(2, '0'),
      String(alarmDate.getDate()).padStart(2, '0'),
    ].join('-'),
    repeat: 'once',
    days: [],
    enabled: true,
  }
  await api.alarms.save([alarm], ['General'])
  assert.equal((await api.alarms.load()).alarms[0].label, 'Wake up')
  assert.equal((await api.alarms.setEnabled(alarm.id, false)).enabled, false)

  const focus = await api.focus.start({
    id: 'focus-uuid',
    mode: 'focus',
    targetMinutes: 1,
  })
  assert.equal((await api.focus.active()).id, focus.id)
  assert.equal((await api.focus.finish(focus.id, true)).status, 'discarded')
})
