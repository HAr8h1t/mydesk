const fs = require('node:fs/promises')
const path = require('node:path')

const maxTimerDelay = 2_147_000_000
const retentionDays = 30

function dateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

class BackupScheduler {
  constructor(settingsStore, createBackup, getWindows, defaultDirectory) {
    this.settingsStore = settingsStore
    this.createBackup = createBackup
    this.getWindows = getWindows
    this.defaultDirectory = defaultDirectory
    this.timer = null
    this.running = false
    this.stopped = true
    this.retryAt = 0
  }

  start() {
    this.stopped = false
    this.refresh()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  refresh() {
    if (this.stopped || this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const settings = this.settingsStore.load()
    if (!settings.autoBackupEnabled) return

    const now = new Date()
    const today = dateStamp(now)
    const lastDate = settings.lastAutoBackupAt ? dateStamp(new Date(settings.lastAutoBackupAt)) : ''
    let nextAt
    if (this.retryAt > now.getTime()) {
      nextAt = new Date(this.retryAt)
    } else if (lastDate !== today && (now.getHours() > 2 || (now.getHours() === 2 && now.getMinutes() > 0))) {
      nextAt = new Date(now.getTime() + 30_000)
    } else {
      nextAt = new Date(now)
      nextAt.setHours(2, 0, 0, 0)
      if (nextAt <= now || lastDate === today) nextAt.setDate(nextAt.getDate() + 1)
    }
    this.timer = setTimeout(() => this.run(), Math.min(maxTimerDelay, Math.max(0, nextAt.getTime() - now.getTime())))
  }

  async run() {
    this.timer = null
    if (this.stopped || this.running) return
    this.running = true
    try {
      const settings = this.settingsStore.load()
      if (!settings.autoBackupEnabled) return
      const directory = settings.backupDirectory || this.defaultDirectory
      const destination = path.join(directory, `mydesk-auto-${dateStamp()}.sqlite`)
      await this.createBackup(destination)
      this.settingsStore.save('last-auto-backup-at', new Date().toISOString())
      await this.prune(directory)
      this.retryAt = 0
    } catch (error) {
      this.retryAt = Date.now() + 15 * 60_000
      console.error('Automatic backup failed.', error)
      this.getWindows().forEach(window => {
        if (!window.isDestroyed()) window.webContents.send('backups:error', error.message)
      })
    } finally {
      this.running = false
      this.refresh()
    }
  }

  async prune(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      const match = /^mydesk-auto-(\d{4}-\d{2}-\d{2})\.sqlite$/.exec(entry.name)
      if (!entry.isFile() || !match) continue
      const date = new Date(`${match[1]}T00:00:00`)
      if (!Number.isFinite(date.getTime()) || date.getTime() >= cutoff) continue
      const backupPath = path.join(directory, entry.name)
      await fs.rm(backupPath, { force: true })
      const base = path.join(directory, `mydesk-auto-${match[1]}-attachments`)
      await fs.rm(base, { recursive: true, force: true })
    }
  }
}

module.exports = { BackupScheduler, retentionDays }
