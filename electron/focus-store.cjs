const { DatabaseSync } = require('node:sqlite')

const maxSessionMinutes = 240

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validateSessionDetails(session) {
  if (!session || !['focus', 'break'].includes(session.mode)) {
    throw new TypeError('Choose a focus or break session.')
  }
  if (!Number.isInteger(session.targetMinutes) || session.targetMinutes < 1 || session.targetMinutes > maxSessionMinutes) {
    throw new RangeError(`Session duration must be between 1 and ${maxSessionMinutes} minutes.`)
  }
  for (const field of ['taskId', 'taskTitle', 'project', 'category']) {
    if (session[field] !== undefined && (typeof session[field] !== 'string' || session[field].length > 180)) {
      throw new TypeError(`Session ${field} must be a string of at most 180 characters.`)
    }
  }
}

class FocusStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('focus', 'break')),
        task_id TEXT NOT NULL DEFAULT '',
        task_title TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Other',
        started_at TEXT NOT NULL,
        planned_end_at TEXT NOT NULL DEFAULT '',
        ended_at TEXT NOT NULL DEFAULT '',
        target_minutes INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'discarded')),
        source TEXT NOT NULL CHECK (source IN ('timer', 'manual'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_single_active
        ON focus_sessions (status) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_focus_started_at
        ON focus_sessions (started_at, status);
      CREATE INDEX IF NOT EXISTS idx_focus_task_started
        ON focus_sessions (task_id, started_at);
      CREATE TABLE IF NOT EXISTS scheduled_focus_blocks (
        id TEXT PRIMARY KEY,
        scheduled_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_focus_time
        ON scheduled_focus_blocks (scheduled_at);
    `)
  }

  active() {
    return this.database.prepare(`
      SELECT id, mode, task_id AS taskId, task_title AS taskTitle, project, category,
        started_at AS startedAt, planned_end_at AS plannedEndAt, target_minutes AS targetMinutes,
        status, source
      FROM focus_sessions WHERE status = 'active' LIMIT 1
    `).get() || null
  }

  scheduled() {
    return this.database.prepare(`
      SELECT payload FROM scheduled_focus_blocks ORDER BY scheduled_at, rowid
    `).all().map(row => JSON.parse(row.payload))
  }

  saveScheduled(input, now = new Date()) {
    if (!input || typeof input !== 'object') throw new TypeError('Scheduled focus details are required.')
    validateSessionDetails(input)
    if (typeof input.id !== 'string' || !input.id || input.id.length > 120) {
      throw new TypeError('A scheduled focus id is required.')
    }
    if (!isValidTimestamp(input.scheduledAt) || Date.parse(input.scheduledAt) <= now.getTime()) {
      throw new TypeError('Scheduled focus needs a valid future date and time.')
    }
    if (input.mode === 'break' && input.taskId) throw new TypeError('Break sessions cannot be linked to a task.')
    if (input.taskId && !this.database.prepare('SELECT id FROM tasks WHERE id = ?').get(input.taskId)) {
      throw new TypeError('The selected task no longer exists.')
    }
    const task = input.taskId
      ? this.database.prepare('SELECT title, payload FROM tasks WHERE id = ?').get(input.taskId)
      : null
    const taskPayload = task ? JSON.parse(task.payload) : null
    const existing = this.database.prepare('SELECT payload FROM scheduled_focus_blocks WHERE id = ?').get(input.id)
    const block = {
      id: input.id,
      mode: input.mode,
      targetMinutes: input.targetMinutes,
      taskId: input.taskId || '',
      taskTitle: task?.title || input.taskTitle || '',
      project: taskPayload?.project || input.project || '',
      category: input.category || taskPayload?.category || 'Other',
      scheduledAt: new Date(input.scheduledAt).toISOString(),
      createdAt: existing ? JSON.parse(existing.payload).createdAt : now.toISOString(),
    }
    this.database.prepare(`
      INSERT INTO scheduled_focus_blocks (id, scheduled_at, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET scheduled_at = excluded.scheduled_at, payload = excluded.payload
    `).run(block.id, block.scheduledAt, JSON.stringify(block))
    return block
  }

  deleteScheduled(id) {
    if (typeof id !== 'string' || !id || id.length > 120) {
      throw new TypeError('A scheduled focus id is required.')
    }
    return this.database.prepare('DELETE FROM scheduled_focus_blocks WHERE id = ?').run(id).changes > 0
  }

  start(input, now = new Date()) {
    validateSessionDetails(input)
    if (input.mode === 'break' && input.taskId) throw new TypeError('Break sessions cannot be linked to a task.')
    if (input.taskId && !this.database.prepare('SELECT id FROM tasks WHERE id = ?').get(input.taskId)) {
      throw new TypeError('The selected task no longer exists.')
    }
    if (this.active()) throw new Error('A focus session is already running.')
    const task = input.taskId
      ? this.database.prepare('SELECT title, payload FROM tasks WHERE id = ?').get(input.taskId)
      : null
    const taskPayload = task ? JSON.parse(task.payload) : null
    const startedAt = now.toISOString()
    const session = {
      id: typeof input.id === 'string' && input.id.length <= 120 ? input.id : '',
      mode: input.mode,
      taskId: input.taskId || '',
      taskTitle: task?.title || input.taskTitle || '',
      project: taskPayload?.project || input.project || '',
      category: input.category || taskPayload?.category || 'Other',
      startedAt,
      plannedEndAt: new Date(now.getTime() + input.targetMinutes * 60_000).toISOString(),
      targetMinutes: input.targetMinutes,
      durationSeconds: 0,
      status: 'active',
      source: 'timer',
    }
    if (!session.id) throw new TypeError('A session id is required.')
    this.database.prepare(`
      INSERT INTO focus_sessions (
        id, mode, task_id, task_title, project, category, started_at, planned_end_at,
        target_minutes, status, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'timer')
    `).run(
      session.id,
      session.mode,
      session.taskId,
      session.taskTitle,
      session.project,
      session.category,
      session.startedAt,
      session.plannedEndAt,
      session.targetMinutes,
    )
    return session
  }

  finish(id, now = new Date(), discard = false) {
    const row = this.database.prepare(`
      SELECT id, mode, task_id AS taskId, task_title AS taskTitle, project, category,
        started_at AS startedAt, planned_end_at AS plannedEndAt, target_minutes AS targetMinutes
      FROM focus_sessions WHERE id = ? AND status = 'active'
    `).get(id)
    if (!row) return null
    const endedAt = now.toISOString()
    const durationSeconds = discard
      ? 0
      : Math.max(0, Math.floor((now.getTime() - Date.parse(row.startedAt)) / 1000))
    const status = discard ? 'discarded' : 'completed'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE focus_sessions SET ended_at = ?, duration_seconds = ?, status = ? WHERE id = ?
      `).run(endedAt, durationSeconds, status, id)
      const task = status === 'completed' && row.mode === 'focus'
        ? this.addTaskActualMinutes(row.taskId, durationSeconds)
        : null
      this.database.exec('COMMIT')
      return { ...row, endedAt, durationSeconds, status, source: 'timer', task }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  recordManual(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Manual tracking details are required.')
    validateSessionDetails({ ...input, mode: 'focus', targetMinutes: Math.min(input?.targetMinutes, maxSessionMinutes) })
    if (!Number.isInteger(input.targetMinutes) || input.targetMinutes < 1 || input.targetMinutes > 1440) {
      throw new RangeError('Manual tracking duration must be between 1 minute and 24 hours.')
    }
    if (!isValidTimestamp(input.startedAt) || !isValidTimestamp(input.endedAt)
      || Date.parse(input.endedAt) <= Date.parse(input.startedAt)
      || Date.parse(input.endedAt) > Date.now()
      || Date.parse(input.endedAt) - Date.parse(input.startedAt) > 24 * 60 * 60_000) {
      throw new TypeError('Manual tracking needs a valid past start and end time no more than 24 hours apart.')
    }
    if (input.taskId && !this.database.prepare('SELECT id FROM tasks WHERE id = ?').get(input.taskId)) {
      throw new TypeError('The selected task no longer exists.')
    }
    const task = input.taskId
      ? this.database.prepare('SELECT title, payload FROM tasks WHERE id = ?').get(input.taskId)
      : null
    const taskPayload = task ? JSON.parse(task.payload) : null
    const durationSeconds = Math.floor((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000)
    const session = {
      id: input.id,
      mode: 'focus',
      taskId: input.taskId || '',
      taskTitle: task?.title || input.taskTitle || '',
      project: taskPayload?.project || input.project || '',
      category: input.category || taskPayload?.category || 'Other',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      plannedEndAt: '',
      targetMinutes: input.targetMinutes,
      durationSeconds,
      status: 'completed',
      source: 'manual',
    }
    if (typeof session.id !== 'string' || !session.id || session.id.length > 120) {
      throw new TypeError('A session id is required.')
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO focus_sessions (
          id, mode, task_id, task_title, project, category, started_at, ended_at,
          target_minutes, duration_seconds, status, source
        ) VALUES (?, 'focus', ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'manual')
      `).run(
        session.id,
        session.taskId,
        session.taskTitle,
        session.project,
        session.category,
        session.startedAt,
        session.endedAt,
        session.targetMinutes,
        session.durationSeconds,
      )
      const task = this.addTaskActualMinutes(session.taskId, durationSeconds)
      this.database.exec('COMMIT')
      return { ...session, task }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  addTaskActualMinutes(taskId, durationSeconds) {
    if (!taskId || durationSeconds < 1) return null
    const row = this.database.prepare('SELECT payload FROM tasks WHERE id = ?').get(taskId)
    if (!row) return null
    const payload = JSON.parse(row.payload)
    payload.actualMinutes = Math.round(((Number(payload.actualMinutes) || 0) + durationSeconds / 60) * 10) / 10
    this.database.prepare('UPDATE tasks SET payload = ? WHERE id = ?')
      .run(JSON.stringify(payload), taskId)
    return { id: taskId, actualMinutes: payload.actualMinutes }
  }

  historyForRange(startAt, endAt) {
    if (!isValidTimestamp(startAt) || !isValidTimestamp(endAt) || Date.parse(startAt) >= Date.parse(endAt)) {
      throw new TypeError('A valid focus history date range is required.')
    }
    return this.database.prepare(`
      SELECT id, mode, task_id AS taskId, task_title AS taskTitle, project, category,
        started_at AS startedAt, ended_at AS endedAt, target_minutes AS targetMinutes,
        duration_seconds AS durationSeconds, status, source
      FROM focus_sessions
      WHERE started_at >= ? AND started_at < ?
      ORDER BY started_at DESC LIMIT 2000
    `).all(startAt, endAt)
  }

  exportAll() {
    return this.database.prepare(`
      SELECT id, mode, task_id AS taskId, task_title AS taskTitle, project, category,
        started_at AS startedAt, ended_at AS endedAt, target_minutes AS targetMinutes,
        duration_seconds AS durationSeconds, status, source
      FROM focus_sessions ORDER BY started_at DESC
    `).all()
  }

  exportScheduled() {
    return this.scheduled()
  }

  applySyncRecord(entityType, recordId, payload, deletedAt) {
    if (!['focus-session', 'scheduled-focus-block'].includes(entityType)) {
      throw new TypeError(`Unsupported focus sync entity type: ${entityType}`)
    }
    if (typeof recordId !== 'string' || !recordId) throw new TypeError('A focus record id is required.')
    if (deletedAt) {
      const table = entityType === 'focus-session' ? 'focus_sessions' : 'scheduled_focus_blocks'
      this.database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(recordId)
      return
    }
    if (!payload || payload.id !== recordId) throw new TypeError('The remote focus record is invalid.')
    if (entityType === 'focus-session') {
      validateSessionDetails(payload)
      if (!isValidTimestamp(payload.startedAt)
        || !['completed', 'discarded'].includes(payload.status)
        || !['timer', 'manual'].includes(payload.source)
        || (payload.endedAt && !isValidTimestamp(payload.endedAt))
        || !Number.isInteger(payload.durationSeconds) || payload.durationSeconds < 0) {
        throw new TypeError('The remote focus session is invalid.')
      }
      this.database.prepare(`
        INSERT INTO focus_sessions (
          id, mode, task_id, task_title, project, category, started_at, planned_end_at,
          ended_at, target_minutes, duration_seconds, status, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode, task_id = excluded.task_id, task_title = excluded.task_title,
          project = excluded.project, category = excluded.category, started_at = excluded.started_at,
          planned_end_at = excluded.planned_end_at, ended_at = excluded.ended_at,
          target_minutes = excluded.target_minutes, duration_seconds = excluded.duration_seconds,
          status = excluded.status, source = excluded.source
      `).run(
        payload.id,
        payload.mode,
        payload.taskId || '',
        payload.taskTitle || '',
        payload.project || '',
        payload.category || 'Other',
        payload.startedAt,
        payload.plannedEndAt || '',
        payload.endedAt || '',
        payload.targetMinutes,
        payload.durationSeconds,
        payload.status,
        payload.source,
      )
      return
    }

    validateSessionDetails(payload)
    if (!isValidTimestamp(payload.scheduledAt)
      || payload.mode === 'break' && payload.taskId) {
      throw new TypeError('The remote scheduled focus block is invalid.')
    }
    this.database.prepare(`
      INSERT INTO scheduled_focus_blocks (id, scheduled_at, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET scheduled_at = excluded.scheduled_at, payload = excluded.payload
    `).run(recordId, payload.scheduledAt, JSON.stringify(payload))
  }

  summaryForRange(startAt, endAt) {
    if (!isValidTimestamp(startAt) || !isValidTimestamp(endAt) || Date.parse(startAt) >= Date.parse(endAt)) {
      throw new TypeError('A valid focus summary date range is required.')
    }
    const rows = this.database.prepare(`
      SELECT category, SUM(duration_seconds) AS seconds
      FROM focus_sessions
      WHERE mode = 'focus' AND status = 'completed' AND started_at >= ? AND started_at < ?
      GROUP BY category ORDER BY seconds DESC
    `).all(startAt, endAt)
    return {
      totalSeconds: rows.reduce((total, row) => total + row.seconds, 0),
      byCategory: rows.map(row => ({ category: row.category, seconds: row.seconds })),
    }
  }

  close() {
    this.database.close()
  }
}

module.exports = { FocusStore, maxSessionMinutes }
