const { contextBridge, ipcRenderer } = require('electron')

let quickCaptureCallback
let quickCapturePending = false
ipcRenderer.on('notes:quick-capture', () => {
  if (quickCaptureCallback) quickCaptureCallback()
  else quickCapturePending = true
})

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
  alarms: {
    load: () => ipcRenderer.invoke('alarms:list'),
    save: (alarms, profiles) => ipcRenderer.invoke('alarms:save', alarms, profiles),
    snooze: (id, minutes) => ipcRenderer.invoke('alarms:snooze', id, minutes),
    dismiss: id => ipcRenderer.invoke('alarms:dismiss', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('alarms:set-enabled', id, enabled),
    delete: id => ipcRenderer.invoke('alarms:delete', id),
    onTriggered: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('alarms:triggered', listener)
      return () => ipcRenderer.removeListener('alarms:triggered', listener)
    },
    onError: callback => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('alarms:error', listener)
      return () => ipcRenderer.removeListener('alarms:error', listener)
    },
  },
  notes: {
    load: () => ipcRenderer.invoke('notes:list'),
    saveAll: notes => ipcRenderer.invoke('notes:save-all', notes),
    search: (query, includeArchived = false) => ipcRenderer.invoke('notes:search', query, includeArchived),
    history: noteId => ipcRenderer.invoke('notes:history', noteId),
    delete: noteId => ipcRenderer.invoke('notes:delete', noteId),
    addAttachments: noteId => ipcRenderer.invoke('notes:add-attachments', noteId),
    removeAttachment: (noteId, attachmentId) => ipcRenderer.invoke('notes:remove-attachment', noteId, attachmentId),
    openAttachment: (noteId, attachmentId) => ipcRenderer.invoke('notes:open-attachment', noteId, attachmentId),
    onQuickCapture: callback => {
      quickCaptureCallback = callback
      if (quickCapturePending) {
        quickCapturePending = false
        callback()
      }
      return () => {
        if (quickCaptureCallback === callback) quickCaptureCallback = undefined
      }
    },
  },
  focus: {
    active: () => ipcRenderer.invoke('focus:active'),
    scheduled: () => ipcRenderer.invoke('focus:scheduled'),
    saveScheduled: block => ipcRenderer.invoke('focus:save-scheduled', block),
    deleteScheduled: id => ipcRenderer.invoke('focus:delete-scheduled', id),
    start: session => ipcRenderer.invoke('focus:start', session),
    finish: (id, discard = false) => ipcRenderer.invoke('focus:finish', id, discard),
    recordManual: session => ipcRenderer.invoke('focus:record-manual', session),
    history: (startAt, endAt) => ipcRenderer.invoke('focus:history', startAt, endAt),
    summary: (startAt, endAt) => ipcRenderer.invoke('focus:summary', startAt, endAt),
    onCompleted: callback => {
      const listener = (_event, session) => callback(session)
      ipcRenderer.on('focus:completed', listener)
      return () => ipcRenderer.removeListener('focus:completed', listener)
    },
    onError: callback => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('focus:error', listener)
      return () => ipcRenderer.removeListener('focus:error', listener)
    },
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (key, value) => ipcRenderer.invoke('settings:save', key, value),
    chooseAlarmTone: () => ipcRenderer.invoke('settings:choose-alarm-tone'),
    getAlarmToneData: (id, extension) => ipcRenderer.invoke('settings:get-alarm-tone-data', id, extension),
  },
  sync: {
    state: () => ipcRenderer.invoke('sync:state'),
    activateAccount: accountId => ipcRenderer.invoke('sync:activate-account', accountId),
    logout: () => ipcRenderer.invoke('sync:logout'),
    pending: () => ipcRenderer.invoke('sync:pending'),
    markInFlight: operationIds => ipcRenderer.invoke('sync:mark-in-flight', operationIds),
    retry: (operationId, error, retryAt) => ipcRenderer.invoke('sync:retry', operationId, error, retryAt),
    markSynced: (operationId, serverVersion) => ipcRenderer.invoke('sync:mark-synced', operationId, serverVersion),
    conflicts: () => ipcRenderer.invoke('sync:conflicts'),
    resolveConflict: (id, resolution) => ipcRenderer.invoke('sync:resolve-conflict', id, resolution),
    cursor: () => ipcRenderer.invoke('sync:cursor'),
    setCursor: value => ipcRenderer.invoke('sync:set-cursor', value),
    push: operations => ipcRenderer.invoke('sync:push', operations),
    pull: cursor => ipcRenderer.invoke('sync:pull', cursor),
    registerDevice: device => ipcRenderer.invoke('sync:register-device', device),
    applyRemote: record => ipcRenderer.invoke('sync:apply-remote', record),
    onUpdated: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('sync:updated', listener)
      return () => ipcRenderer.removeListener('sync:updated', listener)
    },
  },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    configure: apiUrl => ipcRenderer.invoke('auth:configure', apiUrl),
    register: (email, password) => ipcRenderer.invoke('auth:register', email, password),
    login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  backups: {
    create: () => ipcRenderer.invoke('backups:create'),
    restore: () => ipcRenderer.invoke('backups:restore'),
    export: kind => ipcRenderer.invoke('backups:export', kind),
    chooseDirectory: () => ipcRenderer.invoke('backups:choose-directory'),
    onError: callback => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('backups:error', listener)
      return () => ipcRenderer.removeListener('backups:error', listener)
    },
  },
})