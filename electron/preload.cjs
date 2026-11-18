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
})