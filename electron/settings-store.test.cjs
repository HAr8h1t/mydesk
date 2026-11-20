const assert = require('node:assert/strict')
const test = require('node:test')
const { SettingsStore } = require('./settings-store.cjs')

test('persists themes and calendar events with validation', t => {
  const store = new SettingsStore(':memory:')
  t.after(() => store.close())
  const events = [{ id: 'event-1', title: 'Lecture', date: '2025-04-03' }]

  assert.equal(store.load().soundEffectsEnabled, false)
  assert.equal(store.load().uiSoundVolume, 0.25)
  assert.deepEqual(store.load().alarmTone, { type: 'built-in', id: 'alarm-default' })
  store.save('theme', 'ocean')
  store.save('calendar-events', events)
  store.save('sound-effects-enabled', true)
  store.save('ui-sound-volume', 0.4)
  store.save('alarm-tone', { type: 'built-in', id: 'alarm-soft' })
  assert.equal(store.load().theme, 'ocean')
  assert.deepEqual(store.load().events, events)
  assert.equal(store.load().soundEffectsEnabled, true)
  assert.equal(store.load().uiSoundVolume, 0.4)
  assert.deepEqual(store.load().alarmTone, { type: 'built-in', id: 'alarm-soft' })
  assert.throws(() => store.save('theme', 'unknown'), /supported color theme/)
  assert.throws(() => store.save('calendar-events', [{ id: 'broken' }]), /valid date/)
  assert.throws(() => store.save('calendar-events', [{
    id: 'invalid-date',
    title: 'Impossible event',
    date: '2025-02-31',
  }]), /valid date/)
  assert.throws(() => store.save('backup-directory', 'relative/backups'), /valid backup folder/)
  assert.throws(() => store.save('ui-sound-volume', 1.1), /between 0 and 1/)
  assert.throws(() => store.save('alarm-tone', { type: 'built-in', id: 'unknown' }), /supported built-in/)
})
