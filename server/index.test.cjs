const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validateSyncOperation } = require('./index.cjs')

test('accepts supported, idempotent sync operations and rejects invalid records', () => {
  const operation = {
    operationId: 'b98bda09-6776-4f37-9c70-a18022a9a8f3',
    entityType: 'calendar-event',
    recordId: 'event-legacy-1',
    operation: 'upsert',
    payload: { id: 'event-legacy-1', title: 'Planning' },
    baseServerVersion: 0,
  }
  assert.doesNotThrow(() => validateSyncOperation(operation))
  assert.throws(() => validateSyncOperation({ ...operation, payload: { id: 'other' } }), /invalid/)
  assert.throws(() => validateSyncOperation({ ...operation, entityType: 'user' }), /invalid/)
  assert.throws(() => validateSyncOperation({ ...operation, baseServerVersion: -1 }), /invalid/)
  assert.doesNotThrow(() => validateSyncOperation({
    ...operation,
    operation: 'delete',
    payload: null,
  }))
})
