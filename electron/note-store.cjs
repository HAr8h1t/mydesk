const { DatabaseSync } = require('node:sqlite')

function normalizeNote(note) {
  if (!note || typeof note.id !== 'string' || !note.id || typeof note.title !== 'string' || typeof note.body !== 'string') {
    throw new TypeError('Each note must have a string id, title, and body.')
  }
  const updatedAt = note.updatedAt || new Date().toISOString()
  return {
    ...note,
    title: note.title.slice(0, 240),
    category: typeof note.category === 'string' ? note.category.slice(0, 80) : '',
    tags: [...new Set((Array.isArray(note.tags) ? note.tags : [])
      .filter(tag => typeof tag === 'string')
      .map(tag => tag.trim().slice(0, 50))
      .filter(Boolean))],
    links: Array.isArray(note.links) ? note.links : [],
    createdAt: note.createdAt || updatedAt,
    updatedAt,
    pinned: Boolean(note.pinned),
    archived: Boolean(note.archived),
    dailyDate: typeof note.dailyDate === 'string' ? note.dailyDate : '',
  }
}

class NoteStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        daily_date TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_links (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        label TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_links_target
        ON note_links (link_type, target_id);
      CREATE TABLE IF NOT EXISTS note_history (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_history_note_date
        ON note_history (note_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS note_attachments (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_attachments_note
        ON note_attachments (note_id);
      CREATE TABLE IF NOT EXISTS note_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        note_id UNINDEXED,
        title,
        body,
        category,
        tags,
        tokenize = 'unicode61'
      );
    `)
  }

  hasImportedLegacyNotes() {
    const row = this.database.prepare("SELECT value FROM note_metadata WHERE key = 'legacy-imported'").get()
    return row?.value === 'true'
  }

  list() {
    const notes = this.database.prepare(`
      SELECT id, payload, pinned, archived, daily_date AS dailyDate, updated_at AS updatedAt
      FROM notes ORDER BY pinned DESC, updated_at DESC
    `).all()
    const links = this.database.prepare(`
      SELECT id, note_id AS noteId, link_type AS type, target_id AS targetId, label
      FROM note_links ORDER BY rowid
    `).all()
    const attachments = this.database.prepare(`
      SELECT id, note_id AS noteId, name, size, type
      FROM note_attachments ORDER BY rowid
    `).all()
    const historyCounts = new Map(this.database.prepare(`
      SELECT note_id, COUNT(*) AS count FROM note_history GROUP BY note_id
    `).all().map(row => [row.note_id, row.count]))
    return notes.map(row => {
      const payload = JSON.parse(row.payload)
      return {
        ...payload,
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
        dailyDate: row.dailyDate,
        updatedAt: row.updatedAt,
        links: links.filter(link => link.noteId === row.id).map(({ noteId: _noteId, ...link }) => link),
        attachments: attachments.filter(file => file.noteId === row.id).map(({ noteId: _noteId, ...file }) => file),
        historyCount: historyCounts.get(row.id) || 0,
      }
    })
  }

  save(note) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const saved = this.saveWithinTransaction(note)
      this.database.exec('COMMIT')
      return saved
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveAll(notes) {
    if (!Array.isArray(notes)) throw new TypeError('Notes must be provided as an array.')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      notes.forEach(note => this.saveWithinTransaction(note))
      this.database.prepare(`
        INSERT INTO note_metadata (key, value) VALUES ('legacy-imported', 'true')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run()
      this.database.exec('COMMIT')
      return this.list()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveWithinTransaction(note) {
    const normalized = normalizeNote(note)
    const payload = { ...normalized }
    delete payload.attachments
    delete payload.history
    delete payload.historyCount
    const serialized = JSON.stringify(payload)
    const currentRow = this.database.prepare('SELECT payload FROM notes WHERE id = ?').get(normalized.id)
    if (currentRow && currentRow.payload !== serialized) {
      this.addHistory(normalized.id, 'edited', JSON.parse(currentRow.payload), normalized.updatedAt)
    }

    this.database.prepare(`
      INSERT INTO notes (
        id, title, body, category, tags, created_at, updated_at, pinned, archived, daily_date, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        category = excluded.category,
        tags = excluded.tags,
        updated_at = excluded.updated_at,
        pinned = excluded.pinned,
        archived = excluded.archived,
        daily_date = excluded.daily_date,
        payload = excluded.payload
    `).run(
      normalized.id,
      normalized.title,
      normalized.body,
      normalized.category,
      JSON.stringify(normalized.tags),
      normalized.createdAt,
      normalized.updatedAt,
      normalized.pinned ? 1 : 0,
      normalized.archived ? 1 : 0,
      normalized.dailyDate,
      serialized,
    )
    if (!currentRow) this.addHistory(normalized.id, 'created', payload, normalized.createdAt)

    const deleteLinks = this.database.prepare('DELETE FROM note_links WHERE note_id = ?')
    const insertLink = this.database.prepare(`
      INSERT INTO note_links (id, note_id, link_type, target_id, label) VALUES (?, ?, ?, ?, ?)
    `)
    deleteLinks.run(normalized.id)
    normalized.links.forEach(link => {
      if (!link || typeof link.id !== 'string' || typeof link.type !== 'string'
        || typeof link.targetId !== 'string' || typeof link.label !== 'string') {
        throw new TypeError(`Note ${normalized.id} contains an invalid link.`)
      }
      insertLink.run(link.id, normalized.id, link.type, link.targetId, link.label.slice(0, 180))
    })

    this.database.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(normalized.id)
    this.database.prepare(`
      INSERT INTO notes_fts (note_id, title, body, category, tags) VALUES (?, ?, ?, ?, ?)
    `).run(normalized.id, normalized.title, normalized.body, normalized.category, normalized.tags.join(' '))
    return normalized
  }

  search(query, includeArchived = false) {
    const trimmed = typeof query === 'string' ? query.trim() : ''
    let rows
    if (!trimmed) {
      rows = this.database.prepare(`
        SELECT id FROM notes WHERE (? = 1 OR archived = 0)
        ORDER BY pinned DESC, updated_at DESC
      `).all(includeArchived ? 1 : 0)
    } else {
      const expression = trimmed.split(/\s+/).filter(Boolean)
        .map(term => `"${term.replace(/"/g, '""')}"`).join(' AND ')
      rows = this.database.prepare(`
        SELECT notes.id
        FROM notes_fts
        JOIN notes ON notes.id = notes_fts.note_id
        WHERE notes_fts MATCH ? AND (? = 1 OR notes.archived = 0)
        ORDER BY notes.pinned DESC, notes.updated_at DESC
      `).all(expression, includeArchived ? 1 : 0)
    }
    const ids = new Set(rows.map(row => row.id))
    return this.list().filter(note => ids.has(note.id))
  }

  history(noteId) {
    return this.database.prepare(`
      SELECT id, action, created_at AS createdAt, payload
      FROM note_history WHERE note_id = ? ORDER BY created_at DESC
    `).all(noteId).map(row => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      ...JSON.parse(row.payload),
    }))
  }

  addAttachments(noteId, attachments) {
    if (!Array.isArray(attachments)) throw new TypeError('Attachments must be provided as an array.')
    if (!this.database.prepare('SELECT id FROM notes WHERE id = ?').get(noteId)) {
      throw new TypeError('The note for these attachments does not exist.')
    }
    const insert = this.database.prepare(`
      INSERT INTO note_attachments (id, note_id, name, size, type, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      attachments.forEach(file => insert.run(file.id, noteId, file.name, file.size, file.type, file.filePath))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.attachments(noteId)
  }

  attachments(noteId) {
    return this.database.prepare(`
      SELECT id, name, size, type FROM note_attachments WHERE note_id = ? ORDER BY rowid
    `).all(noteId)
  }

  attachmentPath(noteId, attachmentId) {
    const file = this.database.prepare(`
      SELECT file_path AS filePath FROM note_attachments WHERE note_id = ? AND id = ?
    `).get(noteId, attachmentId)
    return file?.filePath || ''
  }

  removeAttachment(noteId, attachmentId) {
    const filePath = this.attachmentPath(noteId, attachmentId)
    if (!filePath) return ''
    this.database.prepare('DELETE FROM note_attachments WHERE note_id = ? AND id = ?')
      .run(noteId, attachmentId)
    return filePath
  }

  delete(noteId) {
    const attachments = this.database.prepare(`
      SELECT file_path AS filePath FROM note_attachments WHERE note_id = ?
    `).all(noteId).map(row => row.filePath)
    const deleted = this.database.prepare('DELETE FROM notes WHERE id = ?').run(noteId).changes > 0
    this.database.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId)
    return deleted ? attachments : []
  }

  addHistory(noteId, action, payload, createdAt) {
    this.database.prepare(`
      INSERT INTO note_history (id, note_id, action, created_at, payload) VALUES (?, ?, ?, ?, ?)
    `).run(`${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, noteId, action, createdAt, JSON.stringify(payload))
  }

  close() {
    this.database.close()
  }
}

module.exports = { NoteStore, normalizeNote }
