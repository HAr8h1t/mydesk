const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mydesk', {
  platform: process.platform,

  versions: {
    electron: process.versions.electron
  },

  tasks: {
    load: () => ipcRenderer.invoke('tasks:list'),
    save: tasks => ipcRenderer.invoke('tasks:save', tasks),
    historyForDate: date => ipcRenderer.invoke('tasks:history-for-date', date),
  },
  reminders: {
    load: () => ipcRenderer.invoke('reminders:list'),
    save: reminders => ipcRenderer.invoke('reminders:save', reminders),
    complete: id => ipcRenderer.invoke('reminders:complete', id),
    snooze: (id, minutes) => ipcRenderer.invoke('reminders:snooze', id, minutes),
    delete: id => ipcRenderer.invoke('reminders:delete', id),
    onTriggered: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('reminders:triggered', listener)
      return () => ipcRenderer.removeListener('reminders:triggered', listener)
    },
    onError: callback => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('reminders:error', listener)
      return () => ipcRenderer.removeListener('reminders:error', listener)
    },
  },
})