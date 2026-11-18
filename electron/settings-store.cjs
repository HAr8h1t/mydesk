const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')

const themes = new Set(['warm', 'dark', 'ocean', 'forest'])
const settingKeys = new Set(['theme', 'calendar-events', 'auto-backup-enabled', 'backup-directory', 'last-auto-backup-at'])

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

class SettingsStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  load() {
    const settings = Object.fromEntries(this.database.prepare('SELECT key, value FROM app_settings')
      .all().map(row => [row.key, JSON.parse(row.value)]))
    return {
      theme: themes.has(settings.theme) ? settings.theme : 'warm',
      events: Array.isArray(settings['calendar-events']) ? settings['calendar-events'] : [],
      hasCalendarEvents: Object.prototype.hasOwnProperty.call(settings, 'calendar-events'),
      autoBackupEnabled: settings['auto-backup-enabled'] === true,
      backupDirectory: typeof settings['backup-directory'] === 'string' ? settings['backup-directory'] : '',
      lastAutoBackupAt: typeof settings['last-auto-backup-at'] === 'string' ? settings['last-auto-backup-at'] : '',
    }
  }

  save(key, value) {
    if (!settingKeys.has(key)) throw new TypeError('This application setting cannot be changed.')
    if (key === 'theme' && !themes.has(value)) throw new TypeError('Choose a supported color theme.')
    if (key === 'calendar-events' && (!Array.isArray(value) || value.length > 10_000)) {
      throw new TypeError('Calendar events must be a list of no more than 10,000 entries.')
    }
    if (key === 'calendar-events' && value.some(event => (
      !event || typeof event.id !== 'string' || !event.id || event.id.length > 120
      || typeof event.title !== 'string' || event.title.length > 240
      || !isCalendarDate(event.date)
    ))) {
      throw new TypeError('Each calendar event must have an id, title, and valid date.')
    }
    if (key === 'auto-backup-enabled' && typeof value !== 'boolean') {
      throw new TypeError('Automatic backup must be enabled or disabled.')
    }
    if (key === 'backup-directory' && (
      typeof value !== 'string' || value.length > 2048 || (value && !path.isAbsolute(value))
    )) {
      throw new TypeError('Choose a valid backup folder.')
    }
    if (key === 'last-auto-backup-at' && (typeof value !== 'string' || (value && !Number.isFinite(Date.parse(value))))) {
      throw new TypeError('The last automatic backup date is invalid.')
    }
    this.database.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, JSON.stringify(value))
    return value
  }

  close() {
    this.database.close()
  }
}

module.exports = { SettingsStore, isCalendarDate }
