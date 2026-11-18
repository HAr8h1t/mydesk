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
