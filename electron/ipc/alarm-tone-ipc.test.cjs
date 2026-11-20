const assert = require('node:assert/strict')
const test = require('node:test')
const { registerAlarmToneIpc } = require('./alarm-tone-ipc.cjs')

test('picks, validates, and persists ringtones through the allowlisted IPC handler', async () => {
  const handlers = new Map()
  const calls = []
  const tone = { type: 'custom', id: '01234567-89ab-cdef-0123-456789abcdef', name: 'tone.wav', extension: '.wav' }
  let selectedTone = { type: 'built-in', id: 'alarm-default' }
  const settingsStore = {
    load: () => ({ alarmTone: selectedTone }),
    save: (key, value) => {
      calls.push(['save', key, value])
      selectedTone = value
    },
  }
  const alarmToneService = {
    store: async source => {
      calls.push(['store', source])
      return tone
    },
    dataUrl: async id => `data:${id}`,
    remove: async (...args) => calls.push(['remove', ...args]),
  }
  const window = { id: 1 }
  const dialog = {
    showOpenDialog: async (target, options) => {
      calls.push(['dialog', target, options])
      return { canceled: false, filePaths: ['selected-tone.wav'] }
    },
  }
  registerAlarmToneIpc({
    registerIpcHandler: (channel, handler) => handlers.set(channel, handler),
    dialog,
    BrowserWindow: { getFocusedWindow: () => window },
    getSettingsStore: () => settingsStore,
    getAlarmToneService: () => alarmToneService,
  })

  assert.deepEqual(await handlers.get('settings:choose-alarm-tone')(), { canceled: false, tone })
  const options = calls.find(([kind]) => kind === 'dialog')[2]
  assert.deepEqual(options.properties, ['openFile'])
  assert.deepEqual(options.filters[0].extensions, ['mp3', 'wav', 'ogg', 'm4a'])
  assert.deepEqual(await handlers.get('settings:get-alarm-tone-data')(null, tone.id, tone.extension), { dataUrl: `data:${tone.id}` })
  await assert.rejects(handlers.get('settings:get-alarm-tone-data')(null, 'unselected', '.wav'), /not the selected/)
})
