const assert = require('node:assert/strict')
const { test } = require('node:test')
const { SyncStore } = require('./sync-store.cjs')

function createTime() {
  let time = Date.parse('2026-11-19T12:00:00.000Z')
  return {
    now: () => new Date(time),
    advance: milliseconds => { time += milliseconds },
  }
}

test('migrates additively and queues existing local records when an account is linked', () => {
  const clock = createTime()
  const store = new SyncStore(':memory:', clock.now)
  try {
    const deviceId = store.deviceId
    store.reconcileSnapshot('task', [{ id: 'legacy-id', title: 'Keep me', createdAt: '2026-01-01T00:00:00.000Z' }])
    assert.equal(store.pending().length, 0)
    assert.match(deviceId, /^[0-9a-f-]{36}$/)

    store.setActiveAccount('account-1')
    const [queued] = store.pending()
    assert.equal(queued.entityType, 'task')
    assert.equal(queued.recordId, 'legacy-id')
    assert.equal(queued.operation, 'upsert')
    assert.equal(queued.payload.title, 'Keep me')
  } finally {
    store.close()
  }
})

test('coalesces unsent edits, retries durably, and emits deletion tombstones', () => {
  const clock = createTime()
  const store = new SyncStore(':memory:', clock.now)
  try {
    store.reconcileSnapshot('task', [{ id: 'task-1', title: 'First' }])
    store.setActiveAccount('account-1')
    const first = store.pending()[0]
    store.reconcileSnapshot('task', [{ id: 'task-1', title: 'Latest' }])
    assert.equal(store.pending().length, 1)
    assert.equal(store.pending()[0].payload.title, 'Latest')
    assert.notEqual(store.pending()[0].operationId, first.operationId)

    const operationId = store.pending()[0].operationId
    store.markInFlight([operationId])
    store.markRetry(operationId, 'Connection failed', '2026-11-19T12:00:10.000Z')
    assert.equal(store.pending().length, 0)
    clock.advance(10_000)
    assert.equal(store.pending()[0].attempts, 1)
    assert.equal(store.pending()[0].lastError, 'Connection failed')
    assert.equal(store.markSynced(operationId, 4), true)
    assert.equal(store.pending().length, 0)

    store.reconcileSnapshot('task', [])
    const [deletion] = store.pending()
    assert.equal(deletion.operation, 'delete')
    assert.equal(deletion.payload, null)
    assert.ok(store.database.prepare(`
      SELECT deleted_at FROM sync_records WHERE entity_type = 'task' AND record_id = 'task-1'
    `).get().deleted_at)
  } finally {
    store.close()
  }
})

test('excludes device-local attachment files from synchronized snapshots', () => {
  const store = new SyncStore(':memory:')
  try {
    store.reconcileSnapshot('task', [{
      id: 'task-with-file',
      title: 'Local file',
      attachments: [{ id: 'file-1', dataUrl: 'data:application/pdf;base64,private' }],
    }])
    store.setActiveAccount('account-1')
    const [queued] = store.pending()
    assert.equal(queued.payload.title, 'Local file')
    assert.equal('attachments' in queued.payload, false)
    store.markSynced(queued.operationId, 1)

    store.reconcileSnapshot('task', [{
      id: 'task-with-file',
      title: 'Local file',
      attachments: [{ id: 'file-2', dataUrl: 'data:application/pdf;base64,other' }],
    }])
    assert.equal(store.pending().length, 0)
  } finally {
    store.close()
  }
})

test('rejects account switching and does not apply stale or conflicting remote values', () => {
  const store = new SyncStore(':memory:')
  try {
    store.reconcileSnapshot('note', [{ id: 'note-1', title: 'Local' }])
    store.setActiveAccount('account-1')
    const creation = store.pending()[0]
    store.markSynced(creation.operationId, 1)
    assert.throws(() => store.setActiveAccount('account-2'), /linked to a different account/)
    assert.deepEqual(store.applyRemote({
      accountId: 'account-1',
      entityType: 'note',
      recordId: 'note-1',
      payload: { id: 'note-1', title: 'Stale' },
      serverVersion: 1,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }), { applied: false, stale: true })

    store.reconcileSnapshot('note', [{ id: 'note-1', title: 'New local edit' }])
    const remote = store.applyRemote({
      accountId: 'account-1',
      entityType: 'note',
      recordId: 'note-1',
      payload: { id: 'note-1', title: 'New server edit' },
      serverVersion: 2,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    assert.equal(remote.applied, false)
    assert.equal(remote.conflict.local.title, 'New local edit')
    assert.equal(remote.conflict.remote.payload.title, 'New server edit')
  } finally {
    store.close()
  }
})

test('persists conflict choices and queues local edits against the remote revision', () => {
  const store = new SyncStore(':memory:')
  try {
    store.reconcileSnapshot('note', [{ id: 'note-1', title: 'Initial' }])
    store.setActiveAccount('account-1')
    const creation = store.pending()[0]
    store.markSynced(creation.operationId, 1)
    store.reconcileSnapshot('note', [{ id: 'note-1', title: 'Local edit' }])
    const remote = {
      accountId: 'account-1',
      entityType: 'note',
      recordId: 'note-1',
      payload: { id: 'note-1', title: 'Remote edit' },
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T11:00:00.000Z',
      serverVersion: 2,
    }
    const result = store.applyRemote(remote)
    const conflictId = store.recordConflict({
      accountId: 'account-1',
      entityType: 'note',
      recordId: 'note-1',
      localPayload: result.conflict.local,
      remotePayload: result.conflict.remote,
    })
    assert.equal(store.pending().length, 0)
    assert.equal(store.resolveConflict(conflictId, 'keep-local'), true)
    const [queued] = store.pending()
    assert.equal(queued.payload.title, 'Local edit')
    assert.equal(queued.baseServerVersion, 2)

    const nextRemote = {
      ...remote,
      payload: { id: 'note-1', title: 'Newest remote' },
      serverVersion: 3,
    }
    const nextResult = store.applyRemote(nextRemote)
    const nextConflictId = store.recordConflict({
      accountId: 'account-1',
      entityType: 'note',
      recordId: 'note-1',
      localPayload: nextResult.conflict.local,
      remotePayload: nextResult.conflict.remote,
    })
    assert.equal(store.resolveConflict(nextConflictId, 'keep-remote'), true)
    assert.equal(store.pending().length, 0)
    assert.equal(JSON.parse(store.record('note', 'note-1').payload).title, 'Newest remote')
    assert.equal(store.record('note', 'note-1').serverVersion, 3)
  } finally {
    store.close()
  }
})
