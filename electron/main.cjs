const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const fsConstants = require('node:fs').constants
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { TaskStore } = require('./task-store.cjs')
const { ReminderStore } = require('./reminder-store.cjs')
const { ReminderScheduler } = require('./reminder-scheduler.cjs')
const { AlarmStore } = require('./alarm-store.cjs')
const { AlarmScheduler } = require('./alarm-scheduler.cjs')
const { NoteStore } = require('./note-store.cjs')

let taskStore
let reminderStore
let reminderScheduler
let alarmStore
let alarmScheduler
let noteStore

const attachmentTypes = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
}

function getManagedAttachmentPath(filePath) {
  const directory = path.resolve(app.getPath('userData'), 'note-attachments')
  const resolved = path.resolve(filePath)
  if (path.dirname(resolved) !== directory) {
    throw new TypeError('The requested file is outside MyDesk note storage.')
  }
  return resolved
}

async function removeStoredAttachments(paths) {
  for (const filePath of paths) {
    try {
      await fs.unlink(getManagedAttachmentPath(filePath))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

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
ipcMain.handle('alarms:list', () => alarmStore.list())
ipcMain.handle('alarms:save', (_event, alarms, profiles) => {
  const saved = alarmStore.save(alarms, profiles)
  alarmScheduler.refresh()
  return saved
})
ipcMain.handle('alarms:snooze', (_event, id, minutes) => {
  const alarm = alarmStore.snooze(id, minutes)
  alarmScheduler.refresh()
  return alarm
})
ipcMain.handle('alarms:dismiss', (_event, id) => {
  const alarm = alarmStore.dismiss(id)
  alarmScheduler.refresh()
  return alarm
})
ipcMain.handle('alarms:set-enabled', (_event, id, enabled) => {
  const alarm = alarmStore.setEnabled(id, enabled)
  alarmScheduler.refresh()
  return alarm
})
ipcMain.handle('alarms:delete', (_event, id) => {
  const deleted = alarmStore.delete(id)
  alarmScheduler.refresh()
  return deleted
})
ipcMain.handle('notes:list', () => ({
  notes: noteStore.list(),
  hasImportedLegacyNotes: noteStore.hasImportedLegacyNotes(),
}))
ipcMain.handle('notes:save-all', (_event, notes) => noteStore.saveAll(notes))
ipcMain.handle('notes:save', (_event, note) => noteStore.save(note))
ipcMain.handle('notes:search', (_event, query, includeArchived) => noteStore.search(query, Boolean(includeArchived)))
ipcMain.handle('notes:history', (_event, noteId) => noteStore.history(noteId))
ipcMain.handle('notes:delete', async (_event, noteId) => {
  await removeStoredAttachments(noteStore.delete(noteId))
  return noteStore.list()
})
ipcMain.handle('notes:add-attachments', async (_event, noteId) => {
  if (!noteStore.list().some(note => note.id === noteId)) {
    throw new TypeError('The note for these attachments does not exist.')
  }
  const options = {
    properties: ['openFile', 'multiSelections'],
  }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled) return noteStore.attachments(noteId)
  if (selection.filePaths.length > 10) throw new RangeError('Choose no more than 10 files at a time.')

  const directory = path.join(app.getPath('userData'), 'note-attachments')
  await fs.mkdir(directory, { recursive: true })
  const copiedPaths = []
  const attachments = []
  try {
    for (const sourcePath of selection.filePaths) {
      const source = await fs.stat(sourcePath)
      if (source.size > 25 * 1024 * 1024) {
        throw new RangeError(`${path.basename(sourcePath)} is larger than the 25 MB per-file limit.`)
      }
      const id = randomUUID()
      const extension = path.extname(sourcePath).toLowerCase()
      const filePath = path.join(directory, `${id}${extension}`)
      await fs.copyFile(sourcePath, filePath, fsConstants.COPYFILE_EXCL)
      copiedPaths.push(filePath)
      attachments.push({
        id,
        name: path.basename(sourcePath),
        size: source.size,
        type: attachmentTypes[extension] || 'application/octet-stream',
        filePath,
      })
    }
    return noteStore.addAttachments(noteId, attachments)
  } catch (error) {
    await Promise.all(copiedPaths.map(async filePath => {
      try {
        await fs.unlink(filePath)
      } catch (cleanupError) {
        console.error(`Unable to remove incomplete note attachment ${filePath}.`, cleanupError)
      }
    }))
    throw error
  }
})
ipcMain.handle('notes:remove-attachment', async (_event, noteId, attachmentId) => {
  const filePath = noteStore.removeAttachment(noteId, attachmentId)
  if (filePath) await removeStoredAttachments([filePath])
  return noteStore.list().find(note => note.id === noteId)?.attachments || []
})
ipcMain.handle('notes:open-attachment', async (_event, noteId, attachmentId) => {
  const filePath = noteStore.attachmentPath(noteId, attachmentId)
  if (!filePath) throw new TypeError('The requested note attachment does not exist.')
  const error = await shell.openPath(getManagedAttachmentPath(filePath))
  if (error) throw new Error(`Unable to open attachment: ${error}`)
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
  alarmStore = new AlarmStore(databasePath)
  noteStore = new NoteStore(databasePath)
  reminderScheduler = new ReminderScheduler(reminderStore, () => BrowserWindow.getAllWindows())
  alarmScheduler = new AlarmScheduler(alarmStore, () => BrowserWindow.getAllWindows())
  reminderScheduler.start()
  alarmScheduler.start()
  createWindow()

  if (!globalShortcut.register('CommandOrControl+Shift+N', () => {
    let window = BrowserWindow.getAllWindows()[0]
    if (!window) {
      createWindow()
      window = BrowserWindow.getAllWindows()[0]
      if (window) window.webContents.once('did-finish-load', () => window.webContents.send('notes:quick-capture'))
      return
    }
    window.show()
    window.focus()
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => window.webContents.send('notes:quick-capture'))
    } else {
      window.webContents.send('notes:quick-capture')
    }
  })) {
    console.error('The Ctrl+Shift+N quick-capture shortcut could not be registered.')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    globalShortcut.unregisterAll()
    reminderScheduler?.stop()
    alarmScheduler?.stop()
    reminderStore?.close()
    alarmStore?.close()
    noteStore?.close()
    taskStore?.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})