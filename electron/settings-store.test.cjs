const assert = require('node:assert/strict')
const test = require('node:test')
const { SettingsStore } = require('./settings-store.cjs')

test('persists themes and calendar events with validation', t => {
  const store = new SettingsStore(':memory:')
  t.after(() => store.close())
  const events = [{ id: 'event-1', title: 'Lecture', date: '2025-04-03' }]

  store.save('theme', 'ocean')
  store.save('calendar-events', events)
  assert.equal(store.load().theme, 'ocean')
  assert.deepEqual(store.load().events, events)
  assert.throws(() => store.save('theme', 'unknown'), /supported color theme/)
  assert.throws(() => store.save('calendar-events', [{ id: 'broken' }]), /valid date/)
  assert.throws(() => store.save('calendar-events', [{
    id: 'invalid-date',
    title: 'Impossible event',
    date: '2025-02-31',
  }]), /valid date/)
  assert.throws(() => store.save('backup-directory', 'relative/backups'), /valid backup folder/)
})
