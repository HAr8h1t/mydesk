const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { BackupScheduler } = require('./backup-scheduler.cjs')

test('retains recent automatic backups and removes only expired automatic pairs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mydesk-auto-backup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const expiredDate = new Date(Date.now() - 60 * 24 * 60 * 60_000)
  const date = [
    expiredDate.getFullYear(),
    String(expiredDate.getMonth() + 1).padStart(2, '0'),
    String(expiredDate.getDate()).padStart(2, '0'),
  ].join('-')
  const expiredBackup = path.join(directory, `mydesk-auto-${date}.sqlite`)
  const expiredFiles = path.join(directory, `mydesk-auto-${date}-attachments`)
  const manualBackup = path.join(directory, 'manual.sqlite')
  await fs.writeFile(expiredBackup, '')
  await fs.mkdir(expiredFiles)
  await fs.writeFile(manualBackup, '')

  const scheduler = new BackupScheduler({ load: () => ({ autoBackupEnabled: false }) }, async () => {}, () => [], directory)
  await scheduler.prune(directory)
  assert.equal(await fs.access(expiredBackup).then(() => true, () => false), false)
  assert.equal(await fs.access(expiredFiles).then(() => true, () => false), false)
  assert.equal(await fs.access(manualBackup).then(() => true, () => false), true)
})
