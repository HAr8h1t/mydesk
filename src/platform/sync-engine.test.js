import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SyncEngine } from './sync-engine.js'

function createHarness({ pending = [], push, pull, online = true } = {}) {
  const calls = []
  let remaining = [...pending]
  let cursor = '0'
  const store = {
    platform: 'android',
    sync: {
      state: async () => ({ deviceId: 'device-1', accountId: 'account-1', pending: remaining.length, conflicts: 0 }),
      pending: async () => remaining,
      markInFlight: async ids => calls.push(['in-flight', ids]),
      markSynced: async (id, version) => {
        calls.push(['synced', id, version])
        remaining = remaining.filter(operation => operation.operationId !== id)
      },
      retry: async (id, error, retryAt) => calls.push(['retry', id, error, retryAt]),
      applyRemote: async record => calls.push(['remote', record.recordId]),
      cursor: async () => cursor,
      setCursor: async value => { cursor = String(value); calls.push(['cursor', cursor]) },
    },
  }
  const transport = {
    registerDevice: async device => calls.push(['device', device]),
    push: push || (async operations => ({
      results: operations.map(operation => ({
        operationId: operation.operationId,
        status: 'applied',
        serverVersion: 1,
      })),
    })),
    pull: pull || (async () => ({ records: [], nextCursor: cursor, hasMore: false })),
  }
  const engine = new SyncEngine({
    store,
    transport,
    connectivity: {
      isOnline: () => online,
      onChange: () => () => {},
    },
  })
  return { calls, engine, store, transport }
}

test('registers a device, acknowledges pushed operations, and commits pull cursors', async () => {
  const operation = { operationId: 'operation-1', attempts: 0 }
  const harness = createHarness({
    pending: [operation],
    pull: async cursor => {
      assert.equal(cursor, '0')
      return { records: [{ recordId: 'remote-1' }], nextCursor: '12', hasMore: false }
    },
  })

  const result = await harness.engine.syncNow()
  assert.equal(result.status, 'idle')
  assert.equal(harness.calls[0][0], 'device')
  assert.deepEqual(harness.calls.find(call => call[0] === 'synced'), ['synced', 'operation-1', 1])
  assert.deepEqual(harness.calls.find(call => call[0] === 'remote'), ['remote', 'remote-1'])
  assert.deepEqual(harness.calls.find(call => call[0] === 'cursor'), ['cursor', '12'])
})

test('keeps offline changes queued and persists retries after transport failure', async () => {
  const pending = [{ operationId: 'operation-2', attempts: 2 }]
  const offline = createHarness({ pending, online: false })
  assert.equal((await offline.engine.syncNow()).status, 'offline')
  assert.equal(offline.calls.some(call => call[0] === 'in-flight'), false)

  const failed = createHarness({
    pending,
    push: async () => { throw new Error('network unavailable') },
  })
  const result = await failed.engine.syncNow()
  assert.equal(result.status, 'error')
  assert.equal(result.error, 'network unavailable')
  assert.equal(failed.calls.some(call => call[0] === 'retry'), true)
  assert.equal(failed.calls.some(call => call[0] === 'cursor'), true)
})
