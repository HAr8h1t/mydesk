const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AlarmStore } = require('./alarm-store.cjs')
const { createDatabaseSnapshot, inspectDatabaseBackup, updateAttachmentPaths } = require('./backup-service.cjs')
const { FocusStore } = require('./focus-store.cjs')
const { NoteStore } = require('./note-store.cjs')
const { ReminderStore } = require('./reminder-store.cjs')
const { SettingsStore } = require('./settings-store.cjs')
const { TaskStore } = require('./task-store.cjs')

test('validates database snapshots and remaps note attachment paths', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-backup-test-'))
  const databasePath = path.join(directory, 'mydesk.sqlite')
  const backupPath = path.join(directory, 'backup.sqlite')
  const stores = [
    new TaskStore(databasePath),
    new ReminderStore(databasePath),
    new AlarmStore(databasePath),
    new NoteStore(databasePath),
    new FocusStore(databasePath),
    new SettingsStore(databasePath),
  ]
  t.after(() => {
    stores.forEach(store => store.close())
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const notes = stores[3]
  notes.save({
    id: 'note-1',
    title: 'Reference',
    body: '',
    createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2025-01-01T10:00:00.000Z',
  })
  notes.addAttachments('note-1', [{
    id: 'file-1',
    name: 'outline.pdf',
    size: 12,
    type: 'application/pdf',
    filePath: 'C:\\mydesk\\old\\file-1.pdf',
  }])

  createDatabaseSnapshot(databasePath, backupPath)
  assert.equal(inspectDatabaseBackup(backupPath)[0].filePath, 'C:\\mydesk\\old\\file-1.pdf')
  updateAttachmentPaths(backupPath, 'C:\\mydesk\\note-attachments')
  assert.equal(inspectDatabaseBackup(backupPath)[0].filePath, path.join('C:\\mydesk\\note-attachments', 'file-1.pdf'))
})
