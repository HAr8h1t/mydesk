const { DatabaseSync } = require('node:sqlite')

class TaskStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        done INTEGER NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, depends_on_id)
      );
      CREATE TABLE IF NOT EXISTS task_history (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_activity_index (
        history_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        activity_date TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_activity_date
        ON task_activity_index (activity_date, occurred_at);
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        data_url TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  hasImportedLegacyTasks() {
    const row = this.database.prepare("SELECT value FROM task_metadata WHERE key = 'legacy-imported'").get()
    return row?.value === 'true'
  }

  historyForDate(date) {
    return this.database.prepare(`
      SELECT activity.task_id AS taskId, tasks.title, activity.payload
      FROM task_activity_index AS activity
      JOIN tasks ON tasks.id = activity.task_id
      WHERE activity.activity_date = ?
      ORDER BY activity.occurred_at
    `).all(date).map(row => ({
      taskId: row.taskId,
      title: row.title,
      ...JSON.parse(row.payload),
    }))
  }

  list() {
    const tasks = this.database.prepare('SELECT id, payload FROM tasks ORDER BY rowid ASC').all()
    const taskMap = new Map(tasks.map(row => [row.id, {
      ...JSON.parse(row.payload),
      subtasks: [],
      dependencies: [],
      history: [],
      attachments: [],
    }]))

    for (const row of this.database.prepare('SELECT id, task_id, title, done FROM task_subtasks ORDER BY task_id, position').all()) {
      taskMap.get(row.task_id).subtasks.push({ id: row.id, title: row.title, done: Boolean(row.done) })
    }
    for (const row of this.database.prepare('SELECT task_id, depends_on_id FROM task_dependencies').all()) {
      taskMap.get(row.task_id).dependencies.push(row.depends_on_id)
    }
    for (const row of this.database.prepare('SELECT id, task_id, payload FROM task_history ORDER BY task_id, position').all()) {
      taskMap.get(row.task_id).history.push(JSON.parse(row.payload))
    }
    for (const row of this.database.prepare('SELECT id, task_id, name, size, type, data_url FROM task_attachments ORDER BY rowid').all()) {
      taskMap.get(row.task_id).attachments.push({
        id: row.id,
        name: row.name,
        size: row.size,
        type: row.type,
        dataUrl: row.data_url,
      })
    }
    return [...taskMap.values()]
  }

  save(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError('Tasks must be provided as an array.')
    const taskIds = new Set()
    for (const task of tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || typeof task.title !== 'string') {
        throw new TypeError('Each task must have a string id and title.')
      }
      if (taskIds.has(task.id)) throw new TypeError(`Duplicate task id: ${task.id}`)
      taskIds.add(task.id)
    }
    for (const task of tasks) {
      for (const dependencyId of task.dependencies || []) {
        if (!taskIds.has(dependencyId)) {
          throw new TypeError(`Task ${task.id} references missing dependency ${dependencyId}.`)
        }
      }
    }

    const insertTask = this.database.prepare('INSERT INTO tasks (id, title, payload) VALUES (?, ?, ?)')
    const insertSubtask = this.database.prepare('INSERT INTO task_subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, ?, ?)')
    const insertDependency = this.database.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)')
    const insertHistory = this.database.prepare('INSERT INTO task_history (id, task_id, payload, position) VALUES (?, ?, ?, ?)')
    const insertActivity = this.database.prepare('INSERT INTO task_activity_index (history_id, task_id, activity_date, occurred_at, payload) VALUES (?, ?, ?, ?, ?)')
    const insertAttachment = this.database.prepare('INSERT INTO task_attachments (id, task_id, name, size, type, data_url) VALUES (?, ?, ?, ?, ?, ?)')

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.exec('DELETE FROM tasks')
      for (const task of tasks) {
        const payload = { ...task }
        delete payload.subtasks
        delete payload.dependencies
        delete payload.history
        delete payload.attachments
        insertTask.run(task.id, task.title, JSON.stringify(payload))
      }
      for (const task of tasks) {
        const { subtasks = [], dependencies = [], history = [], attachments = [] } = task
        subtasks.forEach((subtask, position) => {
          insertSubtask.run(subtask.id, task.id, subtask.title, subtask.done ? 1 : 0, position)
        })
        dependencies.forEach(dependencyId => {
          insertDependency.run(task.id, dependencyId)
        })
        history.forEach((entry, position) => {
          const payload = JSON.stringify(entry)
          insertHistory.run(entry.id, task.id, payload, position)
          const occurredAt = new Date(entry.at)
          const activityDate = [
            occurredAt.getFullYear(),
            String(occurredAt.getMonth() + 1).padStart(2, '0'),
            String(occurredAt.getDate()).padStart(2, '0'),
          ].join('-')
          insertActivity.run(entry.id, task.id, activityDate, entry.at, payload)
        })
        attachments.forEach(attachment => {
          insertAttachment.run(
            attachment.id,
            task.id,
            attachment.name,
            attachment.size,
            attachment.type,
            attachment.dataUrl || '',
          )
        })
      }
      this.database.prepare(`
        INSERT INTO task_metadata (key, value) VALUES ('legacy-imported', 'true')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    this.database.close()
  }
}

module.exports = { TaskStore }
