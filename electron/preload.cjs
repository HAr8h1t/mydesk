const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('mydesk', {
  platform: process.platform,

  versions: {
    electron: process.versions.electron
  }
})