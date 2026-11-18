const assert = require('node:assert/strict')
const test = require('node:test')
const { AlarmStore } = require('./alarm-store.cjs')

test('triggers, snoozes, dismisses, and records a repeating alarm', t => {
  const store = new AlarmStore(':memory:')
  t.after(() => store.close())

  const { alarms } = store.save([{
    id: 'alarm-1',
    label: 'Wake up',
    time: '23:59',
    repeat: 'daily',
    days: [],
    profile: 'Personal',
    sound: 'chime',
    enabled: true,
  }], ['Personal'])
  const firstAt = alarms[0].nextAt
  const triggered = store.markDue('alarm-1', firstAt, new Date(Date.parse(firstAt) + 1))
  assert.ok(triggered.ringingAt)

  const snoozed = store.snooze('alarm-1', 5, new Date(Date.parse(triggered.ringingAt) + 1_000))
  assert.equal(snoozed.nextKind, 'snooze')
  const snoozeTriggered = store.markDue('alarm-1', snoozed.nextAt, new Date(Date.parse(snoozed.nextAt) + 1))
  assert.ok(snoozeTriggered.ringingAt)

  const dismissed = store.dismiss('alarm-1', new Date(Date.parse(snoozeTriggered.ringingAt) + 1_000))
  assert.equal(dismissed.enabled, true)
  assert.notEqual(dismissed.nextAt, '')
  assert.deepEqual(store.list().history.map(entry => entry.action), [
    'dismissed',
    'triggered',
    'snoozed 5 minutes',
    'triggered',
  ])
})

test('rejects invalid weekday schedules and unsupported snooze durations', t => {
  const store = new AlarmStore(':memory:')
  t.after(() => store.close())
  assert.throws(() => store.save([{
    id: 'alarm-2',
    label: 'No days',
    time: '08:00',
    repeat: 'weekly',
    days: [],
    enabled: true,
  }], []), /at least one weekday/)
  assert.throws(() => store.snooze('missing', 7), /supported alarm snooze/)
})
