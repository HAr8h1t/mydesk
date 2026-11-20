const { app, BrowserWindow, dialog, globalShortcut, ipcMain, safeStorage, shell } = require('electron')
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
const { AlarmToneService } = require('./alarm-tone-service.cjs')
const { registerAlarmToneIpc } = require('./ipc/alarm-tone-ipc.cjs')
const { SyncStore } = require('./sync-store.cjs')
const { AuthService, EncryptedCredentialStore } = require('./auth-service.cjs')
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
let alarmToneService
let syncStore
let authService
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

async function openStores() {
  syncStore = new SyncStore(databasePath)
  taskStore = new TaskStore(databasePath)
  reminderStore = new ReminderStore(databasePath)
  alarmStore = new AlarmStore(databasePath)
  noteStore = new NoteStore(databasePath)
  focusStore = new FocusStore(databasePath)
  settingsStore = new SettingsStore(databasePath)
  alarmToneService = new AlarmToneService(path.join(app.getPath('userData'), 'alarm-tones'))
  authService = new AuthService({
    syncStore,
    credentialStore: new EncryptedCredentialStore(
      path.join(app.getPath('userData'), 'auth-session.bin'),
      safeStorage,
    ),
    initialApiUrl: process.env.MYDESK_API_URL || 'http://localhost:3001',
  })
  await authService.initialize()
  reminderScheduler = new ReminderScheduler(
    reminderStore,
    () => BrowserWindow.getAllWindows(),
    () => syncStore.reconcileSnapshot('reminder', reminderStore.list()),
  )
  alarmScheduler = new AlarmScheduler(alarmStore, () => BrowserWindow.getAllWindows())
  focusScheduler = new FocusScheduler(
    focusStore,
    () => BrowserWindow.getAllWindows(),
    () => {
      reconcileSyncType('focus-session')
      reconcileSyncType('task')
    },
  )
  backupScheduler = new BackupScheduler(
    settingsStore,
    destination => withDatabaseMaintenance(() => createBackupFile(destination)),
    () => BrowserWindow.getAllWindows(),
    path.join(app.getPath('userData'), 'backups'),
  )
  reconcileLocalData()
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
  const stores = [reminderStore, alarmStore, noteStore, focusStore, settingsStore, taskStore, syncStore]
  reminderStore = undefined
  alarmStore = undefined
  noteStore = undefined
  focusStore = undefined
  settingsStore = undefined
  taskStore = undefined
  syncStore = undefined
  authService = undefined
  reminderScheduler = undefined
  alarmScheduler = undefined
  focusScheduler = undefined
  backupScheduler = undefined
  stores.forEach(store => store?.close())
}

function reconcileLocalData() {
  for (const entityType of [
    'task',
    'reminder',
    'note',
    'alarm',
    'calendar-event',
    'focus-session',
    'scheduled-focus-block',
  ]) reconcileSyncType(entityType)
}

function reconcileSyncType(entityType) {
  const records = {
    task: () => taskStore.list(),
    reminder: () => reminderStore.list(),
    note: () => noteStore.list().map(note => ({
      ...note,
      history: noteStore.history(note.id),
    })),
    alarm: () => alarmStore.list().alarms,
    'calendar-event': () => settingsStore.load().events,
    'focus-session': () => focusStore.exportAll().filter(session => session.status !== 'active'),
    'scheduled-focus-block': () => focusStore.exportScheduled(),
  }[entityType]
  if (!records) throw new TypeError(`Unsupported sync entity type: ${entityType}`)
  return syncStore.reconcileSnapshot(entityType, records())
}

async function applyRemoteToLocal(remote) {
  const { entityType, recordId, payload, deletedAt } = remote
  const deleting = Boolean(deletedAt)
  if (entityType === 'task') {
    const tasks = taskStore.list().filter(task => task.id !== recordId)
    if (!deleting) {
      const local = taskStore.list().find(task => task.id === recordId)
      tasks.push({ ...payload, attachments: local?.attachments || [] })
    }
    const ids = new Set(tasks.map(task => task.id))
    taskStore.save(tasks.map(task => ({
      ...task,
      dependencies: (task.dependencies || []).filter(id => ids.has(id)),
    })))
  } else if (entityType === 'reminder') {
    const reminders = reminderStore.list().filter(item => item.id !== recordId)
    if (!deleting) reminders.push(payload)
    reminderStore.save(reminders)
    reminderScheduler.refresh()
  } else if (entityType === 'note') {
    if (deleting) await removeStoredAttachments(noteStore.delete(recordId))
    else noteStore.save(payload)
  } else if (entityType === 'alarm') {
    const current = alarmStore.list()
    const alarms = current.alarms.filter(item => item.id !== recordId)
    if (!deleting) alarms.push(payload)
    alarmStore.save(alarms, current.profiles)
    alarmScheduler.refresh()
  } else if (entityType === 'calendar-event') {
    const events = settingsStore.load().events.filter(item => item.id !== recordId)
    if (!deleting) events.push(payload)
    settingsStore.save('calendar-events', events)
  } else if (['focus-session', 'scheduled-focus-block'].includes(entityType)) {
    focusStore.applySyncRecord(entityType, recordId, payload, deletedAt)
    if (entityType === 'focus-session') focusScheduler.refresh()
  } else {
    throw new TypeError(`Unsupported remote sync entity type: ${entityType}`)
  }
}

async function applyRemote(remote) {
  const previous = syncStore.record(remote.entityType, remote.recordId)
  const result = syncStore.applyRemote(remote)
  if (!result.applied) {
    if (result.conflict) {
      syncStore.recordConflict({
        accountId: remote.accountId,
        entityType: remote.entityType,
        recordId: remote.recordId,
        localPayload: result.conflict.local,
        remotePayload: result.conflict.remote,
      })
    }
    return result
  }
  try {
    await applyRemoteToLocal(remote)
  } catch (error) {
    syncStore.restoreRecord(remote.entityType, remote.recordId, previous)
    throw error
  }
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('sync:updated', { entityTypes: [remote.entityType], recordId: remote.recordId })
    }
  })
  return result
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
        await openStores()
      } catch (error) {
        closeStores()
        if (newDatabaseInstalled) await fs.rm(databasePath, { force: true })
        if (newAttachmentsInstalled) await fs.rm(attachmentDirectory, { recursive: true, force: true })
        if (oldDatabaseMoved) await fs.rename(displacedDatabase, databasePath)
        if (oldAttachmentsMoved) await fs.rename(displacedAttachments, attachmentDirectory)
        await openStores()
        throw error
      }
      if (oldDatabaseMoved) await fs.rm(displacedDatabase, { force: true }).catch(error => console.error('Unable to remove the replaced database after restore.', error))
      if (oldAttachmentsMoved) await fs.rm(displacedAttachments, { recursive: true, force: true }).catch(error => console.error('Unable to remove replaced attachments after restore.', error))
      startSchedulers()
      return { restored: true, safetyBackup: path.basename(safetyPath) }
    } catch (error) {
      if (!taskStore) {
        await openStores()
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
  reconcileSyncType('task')
  reconcileSyncType('reminder')
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
  reconcileSyncType('reminder')
  reminderScheduler.refresh()
  return reminderStore.list()
})
registerIpcHandler('reminders:save', (_event, reminders) => {
  reminderStore.save(reminders)
  reconcileSyncType('reminder')
  reminderScheduler.refresh()
  return reminderStore.list()
})
registerIpcHandler('reminders:complete', (_event, id) => {
  const reminder = reminderStore.complete(id)
  reconcileSyncType('reminder')
  reminderScheduler.refresh()
  return reminder
})
registerIpcHandler('reminders:snooze', (_event, id, minutes) => {
  const reminder = reminderStore.snooze(id, minutes)
  reconcileSyncType('reminder')
  reminderScheduler.refresh()
  return reminder
})
registerIpcHandler('reminders:delete', (_event, id) => {
  const deleted = reminderStore.delete(id)
  reconcileSyncType('reminder')
  reminderScheduler.refresh()
  return deleted
})
registerIpcHandler('alarms:list', () => alarmStore.list())
registerIpcHandler('alarms:save', (_event, alarms, profiles) => {
  const saved = alarmStore.save(alarms, profiles)
  reconcileSyncType('alarm')
  alarmScheduler.refresh()
  return saved
})
registerIpcHandler('alarms:snooze', (_event, id, minutes) => {
  const alarm = alarmStore.snooze(id, minutes)
  reconcileSyncType('alarm')
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:dismiss', (_event, id) => {
  const alarm = alarmStore.dismiss(id)
  reconcileSyncType('alarm')
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:set-enabled', (_event, id, enabled) => {
  const alarm = alarmStore.setEnabled(id, enabled)
  reconcileSyncType('alarm')
  alarmScheduler.refresh()
  return alarm
})
registerIpcHandler('alarms:delete', (_event, id) => {
  const deleted = alarmStore.delete(id)
  reconcileSyncType('alarm')
  alarmScheduler.refresh()
  return deleted
})
registerIpcHandler('notes:list', () => ({
  notes: noteStore.list(),
  hasImportedLegacyNotes: noteStore.hasImportedLegacyNotes(),
}))
registerIpcHandler('notes:save-all', (_event, notes) => {
  const saved = noteStore.saveAll(notes)
  reconcileSyncType('note')
  return saved
})
registerIpcHandler('notes:save', (_event, note) => {
  const saved = noteStore.save(note)
  reconcileSyncType('note')
  return saved
})
registerIpcHandler('notes:search', (_event, query, includeArchived) => noteStore.search(query, Boolean(includeArchived)))
registerIpcHandler('notes:history', (_event, noteId) => noteStore.history(noteId))
registerIpcHandler('notes:delete', async (_event, noteId) => {
  await removeStoredAttachments(noteStore.delete(noteId))
  reconcileSyncType('note')
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
    const saved = noteStore.addAttachments(noteId, attachments)
    reconcileSyncType('note')
    return saved
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
  reconcileSyncType('note')
  return noteStore.list().find(note => note.id === noteId)?.attachments || []
})
registerIpcHandler('notes:open-attachment', async (_event, noteId, attachmentId) => {
  const filePath = noteStore.attachmentPath(noteId, attachmentId)
  if (!filePath) throw new TypeError('The requested note attachment does not exist.')
  const error = await shell.openPath(getManagedAttachmentPath(filePath))
  if (error) throw new Error(`Unable to open attachment: ${error}`)
})
registerIpcHandler('settings:load', () => settingsStore.load())
registerIpcHandler('settings:save', async (_event, key, value) => {
  const previousTone = key === 'alarm-tone' ? settingsStore.load().alarmTone : null
  const saved = settingsStore.save(key, value)
  if (key === 'calendar-events') reconcileSyncType('calendar-event')
  if (['auto-backup-enabled', 'backup-directory'].includes(key)) backupScheduler.refresh()
  if (previousTone?.type === 'custom' && value?.type === 'built-in') {
    alarmToneService.remove(previousTone.id, previousTone.extension).catch(error => {
      console.error('Unable to remove the replaced alarm ringtone.', error)
    })
  }
  return saved
})
registerAlarmToneIpc({
  registerIpcHandler,
  dialog,
  BrowserWindow,
  getSettingsStore: () => settingsStore,
  getAlarmToneService: () => alarmToneService,
})
registerIpcHandler('focus:active', () => focusStore.active())
registerIpcHandler('focus:scheduled', () => focusStore.scheduled())
registerIpcHandler('focus:save-scheduled', (_event, block) => {
  const saved = focusStore.saveScheduled(block)
  reconcileSyncType('scheduled-focus-block')
  return saved
})
registerIpcHandler('focus:delete-scheduled', (_event, id) => {
  const deleted = focusStore.deleteScheduled(id)
  reconcileSyncType('scheduled-focus-block')
  return deleted
})
registerIpcHandler('focus:start', (_event, session) => {
  const started = focusStore.start(session)
  reconcileSyncType('focus-session')
  focusScheduler.refresh()
  return started
})
registerIpcHandler('focus:finish', (_event, id, discard) => {
  const finished = focusStore.finish(id, new Date(), Boolean(discard))
  reconcileSyncType('focus-session')
  reconcileSyncType('task')
  focusScheduler.refresh()
  return finished
})
registerIpcHandler('focus:record-manual', (_event, session) => {
  const saved = focusStore.recordManual(session)
  reconcileSyncType('focus-session')
  reconcileSyncType('task')
  return saved
})
registerIpcHandler('focus:history', (_event, startAt, endAt) => focusStore.historyForRange(startAt, endAt))
registerIpcHandler('focus:summary', (_event, startAt, endAt) => focusStore.summaryForRange(startAt, endAt))
registerIpcHandler('sync:state', () => syncStore.state())
registerIpcHandler('sync:activate-account', (_event, accountId) => syncStore.setActiveAccount(accountId))
registerIpcHandler('sync:logout', () => syncStore.clearActiveAccount())
registerIpcHandler('sync:pending', () => syncStore.pending())
registerIpcHandler('sync:mark-in-flight', (_event, operationIds) => {
  if (!Array.isArray(operationIds) || operationIds.length > 500
    || operationIds.some(id => typeof id !== 'string' || !id)) {
    throw new TypeError('A valid sync operation list is required.')
  }
  syncStore.markInFlight(operationIds)
  return syncStore.state()
})
registerIpcHandler('sync:retry', (_event, operationId, error, retryAt) => {
  if (typeof operationId !== 'string' || !operationId || typeof error !== 'string'
    || !Number.isFinite(Date.parse(retryAt))) {
    throw new TypeError('Valid sync retry details are required.')
  }
  syncStore.markRetry(operationId, error, retryAt)
  return syncStore.state()
})
registerIpcHandler('sync:mark-synced', (_event, operationId, serverVersion) => {
  if (typeof operationId !== 'string' || !operationId || !Number.isInteger(serverVersion) || serverVersion < 1) {
    throw new TypeError('Valid sync acknowledgement details are required.')
  }
  return syncStore.markSynced(operationId, serverVersion)
})
registerIpcHandler('sync:conflicts', () => syncStore.conflicts())
registerIpcHandler('sync:cursor', () => syncStore.cursor())
registerIpcHandler('sync:set-cursor', (_event, value) => syncStore.setCursor(value))
registerIpcHandler('sync:push', (_event, operations) => {
  if (!Array.isArray(operations) || operations.length > 100) {
    throw new TypeError('Provide no more than 100 sync operations.')
  }
  return authService.push(operations)
})
registerIpcHandler('sync:pull', (_event, cursor) => authService.pull(cursor))
registerIpcHandler('sync:register-device', (_event, device) => authService.registerDevice(device))
registerIpcHandler('sync:apply-remote', (_event, remote) => applyRemote(remote))
registerIpcHandler('sync:resolve-conflict', async (_event, id, resolution) => {
  if (resolution === 'keep-remote') {
    const conflict = syncStore.conflicts().find(item => item.id === id)
    if (!conflict) return false
    await applyRemoteToLocal(conflict.remotePayload)
  }
  const resolved = syncStore.resolveConflict(id, resolution)
  if (resolved) {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('sync:updated', { conflictsChanged: true })
    })
  }
  return resolved
})
registerIpcHandler('auth:status', () => authService.status())
registerIpcHandler('auth:configure', (_event, apiUrl) => authService.configure(apiUrl))
registerIpcHandler('auth:register', (_event, email, password) => authService.register(email, password))
registerIpcHandler('auth:login', (_event, email, password) => authService.login(email, password))
registerIpcHandler('auth:logout', () => authService.logout())
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

app.whenReady().then(async () => {
  databasePath = path.join(app.getPath('userData'), 'mydesk.sqlite')
  await openStores()
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