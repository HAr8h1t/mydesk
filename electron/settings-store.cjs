const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')
const audioContract = require('../shared/audio-contract.json')

const themes = new Set(['warm', 'dark', 'ocean', 'forest'])
const alarmToneIds = new Set(audioContract.alarmTones.map(tone => tone.id))
const settingKeys = new Set([
  'theme',
  'calendar-events',
  'auto-backup-enabled',
  'backup-directory',
  'last-auto-backup-at',
  'sound-effects-enabled',
  'ui-sound-volume',
  'alarm-tone',
])

function isAlarmTone(value) {
  if (!value || typeof value !== 'object') return false
  if (value.type === 'built-in') {
    return alarmToneIds.has(value.id)
      && Object.keys(value).every(key => ['type', 'id'].includes(key))
  }
  return value.type === 'custom'
    && typeof value.id === 'string'
    && /^[0-9a-f-]{36}$/i.test(value.id)
    && typeof value.name === 'string'
    && value.name.length > 0
    && value.name.length <= 120
    && audioContract.allowedExtensions.includes(value.extension)
    && Object.keys(value).every(key => ['type', 'id', 'name', 'extension'].includes(key))
}

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
      soundEffectsEnabled: settings['sound-effects-enabled'] === true,
      uiSoundVolume: Number.isFinite(settings['ui-sound-volume'])
        ? Math.min(1, Math.max(0, settings['ui-sound-volume']))
        : 0.25,
      alarmTone: isAlarmTone(settings['alarm-tone'])
        ? settings['alarm-tone']
        : { type: 'built-in', id: 'alarm-default' },
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
    if (key === 'sound-effects-enabled' && typeof value !== 'boolean') {
      throw new TypeError('Sound effects must be enabled or disabled.')
    }
    if (key === 'ui-sound-volume' && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError('Sound volume must be between 0 and 1.')
    }
    if (key === 'alarm-tone' && !isAlarmTone(value)) {
      throw new TypeError('Choose a supported built-in or personal alarm tone.')
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

module.exports = { SettingsStore, isAlarmTone, isCalendarDate }
