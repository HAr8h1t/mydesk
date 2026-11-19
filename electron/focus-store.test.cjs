const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { FocusStore } = require('./focus-store.cjs')
const { TaskStore } = require('./task-store.cjs')

test('records timed focus sessions and applies actual time to the linked task', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-focus-'))
  const databasePath = path.join(directory, 'focus.sqlite')
  const tasks = new TaskStore(databasePath)
  const focus = new FocusStore(databasePath)
  t.after(() => {
    focus.close()
    tasks.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  tasks.save([{ id: 'task-1', title: 'Study', actualMinutes: 5 }])
  const startedAt = new Date('2025-01-01T10:00:00.000Z')
  const started = focus.start({
    id: 'session-1',
    mode: 'focus',
    targetMinutes: 25,
    taskId: 'task-1',
    category: 'Study',
  }, startedAt)
  assert.equal(focus.active().id, started.id)
  assert.throws(() => focus.start({
    id: 'session-2',
    mode: 'break',
    targetMinutes: 5,
  }, startedAt), /already running/)

  const finished = focus.finish(started.id, new Date('2025-01-01T10:20:30.000Z'))
  assert.equal(finished.durationSeconds, 1230)
  assert.equal(finished.task.actualMinutes, 25.5)
  assert.equal(tasks.list()[0].actualMinutes, 25.5)
  assert.equal(focus.summaryForRange('2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z').totalSeconds, 1230)
})

test('validates manual tracking ranges and records valid historical time', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-focus-manual-'))
  const databasePath = path.join(directory, 'focus.sqlite')
  const focus = new FocusStore(databasePath)
  t.after(() => {
    focus.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  assert.throws(() => focus.recordManual({
    id: 'invalid',
    startedAt: '2025-01-01T12:00:00.000Z',
    endedAt: '2025-01-01T11:00:00.000Z',
    targetMinutes: 60,
  }), /valid past start and end time/)

  const session = focus.recordManual({
    id: 'manual-1',
    startedAt: '2025-01-01T10:00:00.000Z',
    endedAt: '2025-01-01T10:45:00.000Z',
    targetMinutes: 45,
    category: 'Study',
  })
  assert.equal(session.durationSeconds, 2700)
  assert.equal(session.source, 'manual')
  assert.equal(focus.historyForRange('2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z').length, 1)
})

test('stores, updates, orders, and deletes future focus blocks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-focus-scheduled-'))
  const databasePath = path.join(directory, 'focus.sqlite')
  const tasks = new TaskStore(databasePath)
  const focus = new FocusStore(databasePath)
  t.after(() => {
    focus.close()
    tasks.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  tasks.save([{ id: 'task-1', title: 'Study', project: 'Exam prep' }])
  const now = new Date('2025-01-01T10:00:00.000Z')
  const saved = focus.saveScheduled({
    id: 'block-1',
    mode: 'focus',
    targetMinutes: 45,
    taskId: 'task-1',
    scheduledAt: '2025-01-02T19:00:00.000Z',
  }, now)
  assert.equal(saved.taskTitle, 'Study')
  assert.equal(saved.project, 'Exam prep')
  focus.saveScheduled({
    id: 'block-2',
    mode: 'focus',
    targetMinutes: 25,
    scheduledAt: '2025-01-02T18:00:00.000Z',
  }, now)
  assert.deepEqual(focus.scheduled().map(block => block.id), ['block-2', 'block-1'])

  const restartedFocus = new FocusStore(databasePath)
  assert.deepEqual(restartedFocus.scheduled().map(block => block.id), ['block-2', 'block-1'])
  restartedFocus.close()

  const updated = focus.saveScheduled({
    ...saved,
    targetMinutes: 60,
    scheduledAt: '2025-01-03T19:00:00.000Z',
  }, now)
  assert.equal(updated.targetMinutes, 60)
  assert.deepEqual(focus.scheduled().map(block => block.scheduledAt), [
    '2025-01-02T18:00:00.000Z',
    '2025-01-03T19:00:00.000Z',
  ])
  assert.equal(focus.deleteScheduled('block-1'), true)
  assert.equal(focus.deleteScheduled('block-1'), false)
  assert.deepEqual(focus.scheduled().map(block => block.id), ['block-2'])
  assert.throws(() => focus.deleteScheduled(''), /id is required/)
})

test('rejects invalid or past scheduled focus blocks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-focus-invalid-scheduled-'))
  const focus = new FocusStore(path.join(directory, 'focus.sqlite'))
  t.after(() => {
    focus.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const now = new Date('2025-01-01T10:00:00.000Z')
  const base = { id: 'block-1', mode: 'focus', targetMinutes: 25, scheduledAt: '2025-01-02T19:00:00.000Z' }
  assert.throws(() => focus.saveScheduled({ ...base, scheduledAt: '2025-01-01T09:00:00.000Z' }, now), /future date and time/)
  assert.throws(() => focus.saveScheduled({ ...base, mode: 'break', taskId: 'task-1' }, now), /cannot be linked/)
})
