const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { TaskStore } = require('./task-store.cjs')

let taskStore

ipcMain.handle('tasks:list', () => ({
  tasks: taskStore.list(),
  hasImportedLegacyTasks: taskStore.hasImportedLegacyTasks(),
}))
ipcMain.handle('tasks:save', (_event, tasks) => taskStore.save(tasks))

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (app.isPackaged) {
    mainWindow.loadFile(
      path.join(app.getAppPath(), 'dist', 'index.html')
    )
  } else {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  }
}

app.whenReady().then(() => {
  taskStore = new TaskStore(path.join(app.getPath('userData'), 'mydesk.sqlite'))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    taskStore?.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})