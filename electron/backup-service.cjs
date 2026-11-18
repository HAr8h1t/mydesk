const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')

const requiredTables = [
  'alarms',
  'app_settings',
  'focus_sessions',
  'note_attachments',
  'notes',
  'reminders',
  'tasks',
]

function quoteSqliteString(value) {
  return `'${value.replace(/'/g, "''")}'`
}

function createDatabaseSnapshot(databasePath, destinationPath) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`VACUUM INTO ${quoteSqliteString(destinationPath)}`)
  } finally {
    database.close()
  }
}

function inspectDatabaseBackup(databasePath) {
  const database = new DatabaseSync(databasePath)
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get()
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('The selected database backup failed its integrity check.')
    }
    const tables = new Set(database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map(row => row.name))
    const missing = requiredTables.filter(table => !tables.has(table))
    if (missing.length) {
      throw new TypeError(`The selected file is not a supported MyDesk backup (missing ${missing.join(', ')}).`)
    }
    return database.prepare(`
      SELECT id, file_path AS filePath FROM note_attachments ORDER BY id
    `).all()
  } finally {
    database.close()
  }
}

function updateAttachmentPaths(databasePath, attachmentDirectory) {
  const database = new DatabaseSync(databasePath)
  try {
    const update = database.prepare('UPDATE note_attachments SET file_path = ? WHERE id = ?')
    database.exec('BEGIN IMMEDIATE')
    try {
      const attachments = database.prepare('SELECT id, file_path AS filePath FROM note_attachments').all()
      for (const attachment of attachments) {
        const name = path.win32.basename(attachment.filePath)
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
          throw new TypeError('The backup contains an invalid attachment path.')
        }
        update.run(path.join(attachmentDirectory, name), attachment.id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
}

module.exports = { createDatabaseSnapshot, inspectDatabaseBackup, updateAttachmentPaths }
