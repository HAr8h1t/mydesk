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
const { FocusStore } = require('./focus-store.cjs')
const { FocusScheduler } = require('./focus-scheduler.cjs')
const { SettingsStore } = require('./settings-store.cjs')
const { BackupScheduler } = require('./backup-scheduler.cjs')
const { isTrustedIpcSender, isTrustedRendererUrl } = require('./ipc-security.cjs')
const { createDatabaseSnapshot, inspectDatabaseBackup, updateAttachmentPaths } = require('./backup-service.cjs')

let taskStore
let reminderStore
let reminderScheduler
let alarmStore
let alarmScheduler
let noteStore
let focusStore
let focusScheduler
let settingsStore
let backupScheduler
let mainWindow
let databasePath
let databaseMaintenance = false
let pendingDatabaseOperations = 0
const pendingOperationWaiters = []

function waitForPendingDatabaseOperations() {
  if (!pendingDatabaseOperations) return Promise.resolve()
  return new Promise(resolve => pendingOperationWaiters.push(resolve))
}

function openStores() {
  taskStore = new TaskStore(databasePath)
  reminderStore = new ReminderStore(databasePath)
  alarmStore = new AlarmStore(databasePath)
  noteStore = new NoteStore(databasePath)
  focusStore = new FocusStore(databasePath)
  settingsStore = new SettingsStore(databasePath)
  reminderScheduler = new ReminderScheduler(reminderStore, () => BrowserWindow.getAllWindows())
  alarmScheduler = new AlarmScheduler(alarmStore, () => BrowserWindow.getAllWindows())
  focusScheduler = new FocusScheduler(focusStore, () => BrowserWindow.getAllWindows())
  backupScheduler = new BackupScheduler(
    settingsStore,
    destination => withDatabaseMaintenance(() => createBackupFile(destination)),
    () => BrowserWindow.getAllWindows(),
    path.join(app.getPath('userData'), 'backups'),
  )
}

function startSchedulers() {
  reminderScheduler?.start()
  alarmScheduler?.start()
  focusScheduler?.start()
  backupScheduler?.start()
}

function closeStores() {
  reminderScheduler?.stop()
  alarmScheduler?.stop()
  focusScheduler?.stop()
  backupScheduler?.stop()
  const stores = [reminderStore, alarmStore, noteStore, focusStore, settingsStore, taskStore]
  reminderStore = undefined
  alarmStore = undefined
  noteStore = undefined
  focusStore = undefined
  settingsStore = undefined
  taskStore = undefined
  reminderScheduler = undefined
  alarmScheduler = undefined
  focusScheduler = undefined
  backupScheduler = undefined
  stores.forEach(store => store?.close())
}

async function withDatabaseMaintenance(operation) {
  if (databaseMaintenance) throw new Error('Another backup or restore operation is already in progress.')
  databaseMaintenance = true
  reminderScheduler?.stop()
  alarmScheduler?.stop()
  focusScheduler?.stop()
  backupScheduler?.stop()
  try {
    await waitForPendingDatabaseOperations()
    return await operation()
  } finally {
    databaseMaintenance = false
    reminderScheduler?.start()
    alarmScheduler?.start()
    focusScheduler?.start()
    backupScheduler?.start()
  }
}

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    const trusted = isTrustedIpcSender(event, mainWindow, {
      isPackaged: app.isPackaged,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      appPath: app.getAppPath(),
    })
    if (!trusted) {
      console.warn(`Rejected ${channel} IPC from an untrusted renderer frame.`)
      throw new Error('IPC request rejected: untrusted renderer frame.')
    }
    if (databaseMaintenance) {
      throw new Error('This operation is temporarily unavailable during a backup or restore.')
    }
    const tracksDatabaseOperation = !channel.startsWith('backups:')
    if (tracksDatabaseOperation) pendingDatabaseOperations += 1
    try {
      return await handler(event, ...args)
    } finally {
      if (tracksDatabaseOperation) {
        pendingDatabaseOperations -= 1
        if (!pendingDatabaseOperations) {
          pendingOperationWaiters.splice(0).forEach(resolve => resolve())
        }
      }
    }
  })
}

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

function getBackupAttachmentDirectory(backupPath) {
  const name = path.basename(backupPath, path.extname(backupPath))
  return path.join(path.dirname(backupPath), `${name}-attachments`)
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function copyNoteAttachments(destinationDirectory) {
  await fs.mkdir(destinationDirectory, { recursive: true })
  const notes = noteStore.list()
  const hasAttachments = notes.some(note => note.attachments.length)
  if (hasAttachments) {
    const managedDirectory = path.join(app.getPath('userData'), 'note-attachments')
    const stats = await fs.lstat(managedDirectory)
    if (!stats.isDirectory()) throw new TypeError('MyDesk note attachments must be stored in a regular directory.')
  }
  for (const note of notes) {
    for (const attachment of note.attachments) {
      const sourcePath = getManagedAttachmentPath(noteStore.attachmentPath(note.id, attachment.id))
      const name = path.win32.basename(sourcePath)
      if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
        throw new TypeError('A note attachment has an invalid stored path.')
      }
      const source = await fs.lstat(sourcePath)
      if (!source.isFile()) throw new TypeError(`Note attachment ${attachment.name} is not a regular file.`)
      await fs.copyFile(sourcePath, path.join(destinationDirectory, name), fsConstants.COPYFILE_EXCL)
    }
  }
}

async function createBackupFile(destinationPath) {
  if (path.resolve(destinationPath) === path.resolve(databasePath)) {
    throw new TypeError('A backup cannot overwrite the active application database.')
  }
  const token = randomUUID()
  const temporaryDatabase = `${destinationPath}.${token}.tmp`
  const attachmentDirectory = getBackupAttachmentDirectory(destinationPath)
  const temporaryAttachments = `${attachmentDirectory}.${token}.tmp`
  const previousDatabase = `${destinationPath}.${token}.previous`
  const previousAttachments = `${attachmentDirectory}.${token}.previous`
  let databaseMoved = false
  let attachmentsMoved = false
  let newDatabaseInstalled = false
  let newAttachmentsInstalled = false

  try {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    createDatabaseSnapshot(databasePath, temporaryDatabase)
    await copyNoteAttachments(temporaryAttachments)
    if (await pathExists(destinationPath)) {
      await fs.rename(destinationPath, previousDatabase)
      databaseMoved = true
    }
    if (await pathExists(attachmentDirectory)) {
      await fs.rename(attachmentDirectory, previousAttachments)
      attachmentsMoved = true
    }
    await fs.rename(temporaryDatabase, destinationPath)
    newDatabaseInstalled = true
    await fs.rename(temporaryAttachments, attachmentDirectory)
    newAttachmentsInstalled = true
  } catch (error) {
    const cleanup = []
    if (newDatabaseInstalled) cleanup.push(() => fs.rm(destinationPath, { force: true }))
    if (newAttachmentsInstalled) cleanup.push(() => fs.rm(attachmentDirectory, { recursive: true, force: true }))
    if (databaseMoved) cleanup.push(() => fs.rename(previousDatabase, destinationPath))
    if (attachmentsMoved) cleanup.push(() => fs.rename(previousAttachments, attachmentDirectory))
    for (const action of cleanup) {
      try {
        await action()
      } catch (cleanupError) {
        console.error('Unable to roll back an incomplete backup replacement.', cleanupError)
      }
    }
    throw error
  } finally {
    await Promise.all([
      fs.rm(temporaryDatabase, { force: true }).catch(error => console.error('Unable to remove a temporary backup database.', error)),
      fs.rm(temporaryAttachments, { recursive: true, force: true }).catch(error => console.error('Unable to remove temporary backup attachments.', error)),
    ])
  }

  if (databaseMoved) await fs.rm(previousDatabase, { force: true }).catch(error => console.error('Unable to remove a superseded backup database.', error))
  if (attachmentsMoved) await fs.rm(previousAttachments, { recursive: true, force: true }).catch(error => console.error('Unable to remove superseded backup attachments.', error))
  return destinationPath
}

async function prepareRestoreFiles(backupPath, token) {
  const attachments = inspectDatabaseBackup(backupPath)
  const sourceAttachments = getBackupAttachmentDirectory(backupPath)
  const temporaryDatabase = path.join(app.getPath('userData'), `mydesk-restore-${token}.sqlite`)
  const temporaryAttachments = path.join(app.getPath('userData'), `mydesk-restore-${token}-attachments`)
  await fs.copyFile(backupPath, temporaryDatabase, fsConstants.COPYFILE_EXCL)
  await fs.mkdir(temporaryAttachments, { recursive: true })
  try {
    if (attachments.length) {
      const directoryStats = await fs.lstat(sourceAttachments)
      if (!directoryStats.isDirectory()) throw new TypeError('The backup attachment folder must be a regular directory.')
    }
    for (const attachment of attachments) {
      const name = path.win32.basename(attachment.filePath)
      if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
        throw new TypeError('The selected backup contains an invalid attachment path.')
      }
      const source = path.join(sourceAttachments, name)
      const stats = await fs.lstat(source)
      if (!stats.isFile()) throw new TypeError(`The backup attachment ${name} is not a regular file.`)
      await fs.copyFile(source, path.join(temporaryAttachments, name), fsConstants.COPYFILE_EXCL)
    }
    updateAttachmentPaths(temporaryDatabase, path.join(app.getPath('userData'), 'note-attachments'))
    inspectDatabaseBackup(temporaryDatabase)
    return { temporaryDatabase, temporaryAttachments }
  } catch (error) {
    await fs.rm(temporaryDatabase, { force: true })
    await fs.rm(temporaryAttachments, { recursive: true, force: true })
    throw error
  }
}

async function restoreBackupFile(backupPath) {
  if (path.resolve(backupPath) === path.resolve(databasePath)) {
    throw new TypeError('The active application database cannot be restored as a backup.')
  }
  return withDatabaseMaintenance(async () => {
    const token = randomUUID()
    const safetyPath = path.join(app.getPath('userData'), 'backups', `mydesk-before-restore-${Date.now()}.sqlite`)
    const staged = await prepareRestoreFiles(backupPath, token)
    let safetyCreated = false
    try {
      await createBackupFile(safetyPath)
      safetyCreated = true
      closeStores()

      const displacedDatabase = `${databasePath}.${token}.previous`
      const attachmentDirectory = path.join(app.getPath('userData'), 'note-attachments')
      const displacedAttachments = `${attachmentDirectory}.${token}.previous`
      let oldDatabaseMoved = false
      let oldAttachmentsMoved = false
      let newDatabaseInstalled = false
      let newAttachmentsInstalled = false
      try {
        await fs.rename(databasePath, displacedDatabase)
        oldDatabaseMoved = true
        if (await pathExists(attachmentDirectory)) {
          await fs.rename(attachmentDirectory, displacedAttachments)
          oldAttachmentsMoved = true
        }
        await fs.rename(staged.temporaryAttachments, attachmentDirectory)
        newAttachmentsInstalled = true
        await fs.rename(staged.temporaryDatabase, databasePath)
        newDatabaseInstalled = true
        openStores()
      } catch (error) {
        closeStores()
        if (newDatabaseInstalled) await fs.rm(databasePath, { force: true })
        if (newAttachmentsInstalled) await fs.rm(attachmentDirectory, { recursive: true, force: true })
        if (oldDatabaseMoved) await fs.rename(displacedDatabase, databasePath)
        if (oldAttachmentsMoved) await fs.rename(displacedAttachments, attachmentDirectory)
        openStores()
        throw error
      }
      if (oldDatabaseMoved) await fs.rm(displacedDatabase, { force: true }).catch(error => console.error('Unable to remove the replaced database after restore.', error))
      if (oldAttachmentsMoved) await fs.rm(displacedAttachments, { recursive: true, force: true }).catch(error => console.error('Unable to remove replaced attachments after restore.', error))
      startSchedulers()
      return { restored: true, safetyBackup: path.basename(safetyPath) }
    } catch (error) {
      if (!taskStore) {
        openStores()
        startSchedulers()
      }
      if (!safetyCreated) {
        console.error('Restore failed before the pre-restore safety backup was completed.')
      }
      throw error
    } finally {
      await fs.rm(staged.temporaryDatabase, { force: true })
      await fs.rm(staged.temporaryAttachments, { recursive: true, force: true })
    }
  })
}

async function exportNotesWithFiles(notes) {
  return Promise.all(notes.map(async note => ({
    ...note,
    history: noteStore.history(note.id),
    attachments: await Promise.all(note.attachments.map(async attachment => {
      const filePath = getManagedAttachmentPath(noteStore.attachmentPath(note.id, attachment.id))
      const stats = await fs.lstat(filePath)
      if (!stats.isFile()) throw new TypeError(`Note attachment ${attachment.name} is not a regular file.`)
      const data = await fs.readFile(filePath)
      return { ...attachment, contentBase64: data.toString('base64') }
    })),
  })))
}

async function getExportData(kind) {
  if (!['all', 'notes', 'tasks', 'calendar'].includes(kind)) {
    throw new TypeError('Choose a supported export type.')
  }
  const events = settingsStore.load().events
  if (kind === 'notes') return { format: 'mydesk-notes', version: 1, notes: await exportNotesWithFiles(noteStore.list()) }
  if (kind === 'tasks') return { format: 'mydesk-tasks', version: 1, tasks: taskStore.list() }
  if (kind === 'calendar') return { format: 'mydesk-calendar', version: 1, events }
  const settings = settingsStore.load()
  delete settings.backupDirectory
  delete settings.events
  delete settings.hasCalendarEvents
  return {
    format: 'mydesk-data-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: taskStore.list(),
    reminders: reminderStore.list(),
    alarms: { ...alarmStore.list(), history: alarmStore.exportHistory() },
    notes: await exportNotesWithFiles(noteStore.list()),
    events,
    focusSessions: focusStore.exportAll(),
    scheduledFocusBlocks: focusStore.exportScheduled(),
    settings,
  }
}

registerIpcHandler('tasks:list', () => ({
  tasks: taskStore.list(),
  hasImportedLegacyTasks: taskStore.hasImportedLegacyTasks(),
}))
registerIpcHandler('tasks:save', (_event, tasks) => {
  taskStore.save(tasks)
  reminderStore.importLegacyTaskReminders(tasks)
  reminderScheduler.refresh()
  return reminderStore.list()
})
registerIpcHandler('tasks:history-for-date', (_event, date) => {
  const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null
  if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new TypeError('A calendar date is required to search task history.')
  }
  return taskStore.historyForDate(date)
})
registerIpcHandler('reminders:list', () => {
  reminderStore.importLegacyTaskReminders(taskStore.list())
  reminderScheduler.refresh()
  return reminderStore.list()
})
registerIpcHandler('reminders:save', (_event, reminders) => {
  reminderStore.save(reminders)
  reminderScheduler.refresh()
  return reminderStore.list()
})
registerIpcHandler('reminders:complete', (_event, id) => {
  const reminder = reminderStore.complete(id)
  reminderScheduler.refresh()
  return reminder
})
registerIpcHandler('reminders:snooze', (_event, id, minutes) => {
  const reminder = reminderStore.snooze(id, minutes)
  reminderScheduler.refresh()
  return reminder
})
registerIpcHandler('reminders:delete', (_event, id) => {
  const deleted = reminderStore.delete(id)
  reminderScheduler.refresh()
  return deleted
})
registerIpcHandler('alarms:list', () => alarmStore.list())
registerIpcHandler('alarms:save', (_event, alarms, profiles) => {
  const saved = alarmStore.save(alarms, profiles)
  alarmScheduler.refresh()
  return saved
})
registerIpcHandler('alarms:snooze', (_event, id, minutes) => {
  const alarm = alarmStore.snooze(id, minutes)
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:dismiss', (_event, id) => {
  const alarm = alarmStore.dismiss(id)
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:set-enabled', (_event, id, enabled) => {
  const alarm = alarmStore.setEnabled(id, enabled)
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:delete', (_event, id) => {
  const deleted = alarmStore.delete(id)
  alarmScheduler.refresh()
  return deleted
})
registerIpcHandler('notes:list', () => ({
  notes: noteStore.list(),
  hasImportedLegacyNotes: noteStore.hasImportedLegacyNotes(),
}))
registerIpcHandler('notes:save-all', (_event, notes) => noteStore.saveAll(notes))
registerIpcHandler('notes:save', (_event, note) => noteStore.save(note))
registerIpcHandler('notes:search', (_event, query, includeArchived) => noteStore.search(query, Boolean(includeArchived)))
registerIpcHandler('notes:history', (_event, noteId) => noteStore.history(noteId))
registerIpcHandler('notes:delete', async (_event, noteId) => {
  await removeStoredAttachments(noteStore.delete(noteId))
  return noteStore.list()
})
registerIpcHandler('notes:add-attachments', async (_event, noteId) => {
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
registerIpcHandler('notes:remove-attachment', async (_event, noteId, attachmentId) => {
  const filePath = noteStore.removeAttachment(noteId, attachmentId)
  if (filePath) await removeStoredAttachments([filePath])
  return noteStore.list().find(note => note.id === noteId)?.attachments || []
})
registerIpcHandler('notes:open-attachment', async (_event, noteId, attachmentId) => {
  const filePath = noteStore.attachmentPath(noteId, attachmentId)
  if (!filePath) throw new TypeError('The requested note attachment does not exist.')
  const error = await shell.openPath(getManagedAttachmentPath(filePath))
  if (error) throw new Error(`Unable to open attachment: ${error}`)
})
registerIpcHandler('settings:load', () => settingsStore.load())
registerIpcHandler('settings:save', (_event, key, value) => {
  const saved = settingsStore.save(key, value)
  if (['auto-backup-enabled', 'backup-directory'].includes(key)) backupScheduler.refresh()
  return saved
})
registerIpcHandler('focus:active', () => focusStore.active())
registerIpcHandler('focus:scheduled', () => focusStore.scheduled())
registerIpcHandler('focus:save-scheduled', (_event, block) => focusStore.saveScheduled(block))
registerIpcHandler('focus:delete-scheduled', (_event, id) => focusStore.deleteScheduled(id))
registerIpcHandler('focus:start', (_event, session) => {
  const started = focusStore.start(session)
  focusScheduler.refresh()
  return started
})
registerIpcHandler('focus:finish', (_event, id, discard) => {
  const finished = focusStore.finish(id, new Date(), Boolean(discard))
  focusScheduler.refresh()
  return finished
})
registerIpcHandler('focus:record-manual', (_event, session) => focusStore.recordManual(session))
registerIpcHandler('focus:history', (_event, startAt, endAt) => focusStore.historyForRange(startAt, endAt))
registerIpcHandler('focus:summary', (_event, startAt, endAt) => focusStore.summaryForRange(startAt, endAt))
registerIpcHandler('backups:create', async () => {
  const suggested = `mydesk-backup-${dateStamp()}.sqlite`
  const options = {
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }],
  }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  await withDatabaseMaintenance(() => createBackupFile(selection.filePath))
  return { canceled: false, filePath: selection.filePath }
})
registerIpcHandler('backups:restore', async () => {
  const options = {
    properties: ['openFile'],
    filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }],
  }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
  return restoreBackupFile(selection.filePaths[0])
})
registerIpcHandler('backups:export', async (_event, kind) => {
  const data = await withDatabaseMaintenance(() => getExportData(kind))
  const names = {
    all: 'mydesk-data-export',
    notes: 'mydesk-notes',
    tasks: 'mydesk-tasks',
    calendar: 'mydesk-calendar',
  }
  const options = {
    defaultPath: path.join(app.getPath('documents'), `${names[kind] || 'mydesk-export'}.json`),
    filters: [{ name: 'JSON export', extensions: ['json'] }],
  }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selection.canceled || !selection.filePath) return { canceled: true }
  if (path.resolve(selection.filePath) === path.resolve(databasePath)) {
    throw new TypeError('An export cannot overwrite the active application database.')
  }
  const temporaryPath = `${selection.filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryPath, selection.filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(cleanupError => {
      console.error('Unable to remove a partial JSON export.', cleanupError)
    })
    throw error
  }
  return { canceled: false, filePath: selection.filePath }
})
registerIpcHandler('backups:choose-directory', async () => {
  const options = { properties: ['openDirectory', 'createDirectory'] }
  const window = BrowserWindow.getFocusedWindow()
  const selection = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return selection.canceled ? '' : selection.filePaths[0]
})
function dateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, {
      isPackaged: app.isPackaged,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      appPath: app.getAppPath(),
    })) {
      event.preventDefault()
    }
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, {
      isPackaged: app.isPackaged,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      appPath: app.getAppPath(),
    })) {
      event.preventDefault()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
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
  databasePath = path.join(app.getPath('userData'), 'mydesk.sqlite')
  openStores()
  startSchedulers()
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
    closeStores()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})