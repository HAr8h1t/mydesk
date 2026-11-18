const assert = require('node:assert/strict')
const test = require('node:test')
const { NoteStore } = require('./note-store.cjs')

test('creates searchable notes, preserves versions, and rolls back invalid edits', t => {
  const store = new NoteStore(':memory:')
  t.after(() => store.close())
  const note = {
    id: 'note-1',
    title: 'Study plan',
    body: 'Review algebra',
    category: 'School',
    tags: ['math'],
    links: [],
    createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2025-01-01T10:00:00.000Z',
  }

  store.save(note)
  assert.equal(store.history(note.id).length, 1)
  assert.equal(store.search('algebra').length, 1)

  store.save({ ...note, body: 'Review algebra tomorrow', updatedAt: '2025-01-02T10:00:00.000Z' })
  assert.equal(store.history(note.id).length, 2)
  assert.throws(() => store.save({
    ...note,
    body: 'Invalid edit',
    updatedAt: '2025-01-03T10:00:00.000Z',
    links: [{ id: 'broken' }],
  }), /invalid link/)
  assert.equal(store.list()[0].body, 'Review algebra tomorrow')
  assert.equal(store.history(note.id).length, 2)
})

test('manages attachment metadata and hides archived notes from default search', t => {
  const store = new NoteStore(':memory:')
  t.after(() => store.close())
  const note = {
    id: 'note-2',
    title: 'Reference',
    body: 'Project draft',
    links: [],
    createdAt: '2025-02-01T10:00:00.000Z',
    updatedAt: '2025-02-01T10:00:00.000Z',
  }

  store.save(note)
  store.addAttachments(note.id, [{
    id: 'file-1',
    name: 'outline.pdf',
    size: 42,
    type: 'application/pdf',
    filePath: 'C:\\mydesk\\outline.pdf',
  }])
  assert.equal(store.attachmentPath(note.id, 'file-1'), 'C:\\mydesk\\outline.pdf')
  assert.equal(store.removeAttachment(note.id, 'file-1'), 'C:\\mydesk\\outline.pdf')

  store.save({ ...note, archived: true })
  assert.equal(store.search('draft').length, 0)
  assert.equal(store.search('draft', true).length, 1)
})
