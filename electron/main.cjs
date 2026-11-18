const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { TaskStore } = require('./task-store.cjs')
const { ReminderStore } = require('./reminder-store.cjs')
const { ReminderScheduler } = require('./reminder-scheduler.cjs')

let taskStore
let reminderStore
let reminderScheduler

ipcMain.handle('tasks:list', () => ({
  tasks: taskStore.list(),
  hasImportedLegacyTasks: taskStore.hasImportedLegacyTasks(),
}))
ipcMain.handle('tasks:save', (_event, tasks) => {
  taskStore.save(tasks)
  reminderStore.importLegacyTaskReminders(tasks)
  reminderScheduler.refresh()
  return reminderStore.list()
})
ipcMain.handle('tasks:history-for-date', (_event, date) => {
  const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null
  if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new TypeError('A calendar date is required to search task history.')
  }
  return taskStore.historyForDate(date)
})
ipcMain.handle('reminders:list', () => {
  reminderStore.importLegacyTaskReminders(taskStore.list())
  reminderScheduler.refresh()
  return reminderStore.list()
})
ipcMain.handle('reminders:save', (_event, reminders) => {
  reminderStore.save(reminders)
  reminderScheduler.refresh()
  return reminderStore.list()
})
ipcMain.handle('reminders:complete', (_event, id) => {
  const reminder = reminderStore.complete(id)
  reminderScheduler.refresh()
  return reminder
})
ipcMain.handle('reminders:snooze', (_event, id, minutes) => {
  const reminder = reminderStore.snooze(id, minutes)
  reminderScheduler.refresh()
  return reminder
})
ipcMain.handle('reminders:delete', (_event, id) => {
  const deleted = reminderStore.delete(id)
  reminderScheduler.refresh()
  return deleted
})

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
  const databasePath = path.join(app.getPath('userData'), 'mydesk.sqlite')
  taskStore = new TaskStore(databasePath)
  reminderStore = new ReminderStore(databasePath)
  reminderScheduler = new ReminderScheduler(reminderStore, () => BrowserWindow.getAllWindows())
  reminderScheduler.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    reminderScheduler?.stop()
    reminderStore?.close()
    taskStore?.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})