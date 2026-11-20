function registerAlarmToneIpc({
  registerIpcHandler,
  dialog,
  BrowserWindow,
  getSettingsStore,
  getAlarmToneService,
}) {
  registerIpcHandler('settings:choose-alarm-tone', async () => {
    const options = {
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    }
    const window = BrowserWindow.getFocusedWindow()
    const selection = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled) return { canceled: true }

    const settingsStore = getSettingsStore()
    const alarmToneService = getAlarmToneService()
    const previous = settingsStore.load().alarmTone
    const tone = await alarmToneService.store(selection.filePaths[0])
    try {
      settingsStore.save('alarm-tone', tone)
    } catch (error) {
      await alarmToneService.remove(tone.id, tone.extension)
      throw error
    }
    if (previous.type === 'custom') {
      alarmToneService.remove(previous.id, previous.extension).catch(error => {
        console.error('Unable to remove the replaced alarm ringtone.', error)
      })
    }
    return { canceled: false, tone }
  })

  registerIpcHandler('settings:get-alarm-tone-data', async (_event, id, extension) => {
    const selected = getSettingsStore().load().alarmTone
    if (selected.type !== 'custom' || selected.id !== id || selected.extension !== extension) {
      throw new TypeError('The requested ringtone is not the selected personal alarm tone.')
    }
    return { dataUrl: await getAlarmToneService().dataUrl(id, extension) }
  })
}

module.exports = { registerAlarmToneIpc }
