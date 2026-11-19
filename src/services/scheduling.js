const WORKDAY_START = 9 * 60
const WORKDAY_END = 17 * 60
const OVERLOADED_MINUTES = 6 * 60
const DEFAULT_TASK_MINUTES = 60
const SLOT_INCREMENT = 15
const PRIORITY_RANK = { Urgent: 4, High: 3, Medium: 2, Low: 1 }

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateOffset(date, offset) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + offset))
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function occursOnDate(event, date) {
  if (!isDateKey(event.date) || date < event.date) return false
  if (event.repeat === 'daily') return true
  const [year, month, day] = event.date.split('-').map(Number)
  const [targetYear, targetMonth, targetDay] = date.split('-').map(Number)
  const initial = new Date(Date.UTC(year, month - 1, day))
  const target = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay))
  if (event.repeat === 'weekly') return initial.getUTCDay() === target.getUTCDay()
  if (event.repeat === 'monthly') return initial.getUTCDate() === target.getUTCDate()
  return date === event.date
}

function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function durationForTask(task) {
  const duration = Number(task.estimatedMinutes || DEFAULT_TASK_MINUTES)
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_TASK_MINUTES
}

function taskIsPending(task) {
  return (task.status || (task.done ? 'completed' : 'pending')) !== 'completed'
}

function taskDependenciesComplete(task, tasksById) {
  return (task.dependencies || []).every(id => {
    const dependency = tasksById.get(id)
    return dependency && !taskIsPending(dependency)
  })
}

function getActivities(date, tasks, events) {
  const activities = []
  for (const event of events) {
    if (!occursOnDate(event, date)) continue
    const start = timeToMinutes(event.startTime || '09:00')
    const end = timeToMinutes(event.endTime || '10:00')
    if (start === null || end === null || start >= end) continue
    activities.push({ id: event.id, type: 'event', title: event.title, start, end })
  }
  for (const task of tasks) {
    if (!taskIsPending(task) || task.startDate !== date) continue
    const start = timeToMinutes(task.startTime || '09:00')
    if (start === null) continue
    activities.push({
      id: task.id,
      type: 'task',
      title: task.title,
      start,
      end: start + durationForTask(task),
      task,
    })
  }
  return activities.sort((a, b) => a.start - b.start || a.end - b.end)
}

function getFreeSlots(activities) {
  const busy = activities
    .map(activity => ({
      start: Math.max(WORKDAY_START, activity.start),
      end: Math.min(WORKDAY_END, activity.end),
    }))
    .filter(slot => slot.start < slot.end)
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const slot of busy) {
    const previous = merged.at(-1)
    if (previous && slot.start <= previous.end) previous.end = Math.max(previous.end, slot.end)
    else merged.push({ ...slot })
  }
  const free = []
  let cursor = WORKDAY_START
  for (const slot of merged) {
    if (slot.start - cursor >= SLOT_INCREMENT) free.push({ start: cursor, end: slot.start })
    cursor = Math.max(cursor, slot.end)
  }
  if (WORKDAY_END - cursor >= SLOT_INCREMENT) free.push({ start: cursor, end: WORKDAY_END })
  return free
}

function findSlot(task, days, reservations, tasks, earliestDate) {
  const duration = durationForTask(task)
  const tasksById = new Map(tasks.map(item => [item.id, item]))
  if (!taskDependenciesComplete(task, tasksById)) return null
  for (const day of days) {
    if (day.date < earliestDate || (task.dueDate && day.date > task.dueDate)) continue
    const existing = day.activities.filter(activity => !(activity.type === 'task' && activity.id === task.id))
    const busy = [...existing, ...reservations.filter(item => item.date === day.date)]
      .map(activity => ({ start: activity.start, end: activity.end }))
      .sort((a, b) => a.start - b.start)
    let start = day.earliestStart
    while (start + duration <= WORKDAY_END) {
      const conflict = busy.find(slot => start < slot.end && slot.start < start + duration)
      if (!conflict) return { date: day.date, start, end: start + duration }
      start = Math.ceil(conflict.end / SLOT_INCREMENT) * SLOT_INCREMENT
    }
  }
  return null
}

function priorityRank(task) {
  return PRIORITY_RANK[task.priority] || PRIORITY_RANK.Medium
}

function compareTasks(a, b) {
  return priorityRank(b) - priorityRank(a)
    || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')
    || a.title.localeCompare(b.title)
}

function getScheduleOverview(tasks, events, options = {}) {
  const daysCount = Math.max(1, Math.min(31, Number(options.days) || 7))
  const startDate = isDateKey(options.startDate)
    ? options.startDate
    : localDateKey(new Date())
  const now = options.now || new Date()
  const today = localDateKey(now)
  const currentMinute = now.getHours() * 60 + now.getMinutes()
  const days = Array.from({ length: daysCount }, (_, index) => {
    const date = dateOffset(startDate, index)
    const activities = getActivities(date, tasks, events)
    const conflicts = []
    activities.forEach((activity, indexInDay) => {
      for (const other of activities.slice(indexInDay + 1)) {
        if (activity.start < other.end && other.start < activity.end) {
          conflicts.push({ first: activity, second: other })
        }
      }
    })
    const earliestStart = date === today
      ? Math.max(WORKDAY_START, Math.ceil((currentMinute + 15) / SLOT_INCREMENT) * SLOT_INCREMENT)
      : WORKDAY_START
    return {
      date,
      activities,
      conflicts,
      workloadMinutes: activities.reduce((total, activity) => total + activity.end - activity.start, 0),
      overloaded: activities.reduce((total, activity) => total + activity.end - activity.start, 0) >= OVERLOADED_MINUTES,
      freeSlots: getFreeSlots(activities).flatMap(slot => {
        const start = Math.max(slot.start, earliestStart)
        return slot.end - start >= SLOT_INCREMENT ? [{ start, end: slot.end }] : []
      }),
      earliestStart,
    }
  })
  const reservations = []
  const recommendations = []
  const scheduleTask = (task, reason, earliestDate) => {
    const slot = findSlot(task, days, reservations, tasks, earliestDate)
    if (!slot) return false
    recommendations.push({ task, ...slot, reason })
    reservations.push({ ...slot, type: 'task', id: task.id })
    return true
  }

  const conflictedTasks = new Map()
  for (const day of days) {
    for (const conflict of day.conflicts) {
      const taskActivities = [conflict.first, conflict.second].filter(activity => activity.type === 'task')
      if (!taskActivities.length) continue
      const move = taskActivities.sort((a, b) => (
        priorityRank(a.task) - priorityRank(b.task)
        || (b.task.dueDate || '0000-00-00').localeCompare(a.task.dueDate || '0000-00-00')
      ))[0]
      conflictedTasks.set(move.id, { task: move.task, date: day.date, other: move === conflict.first ? conflict.second : conflict.first })
    }
  }
  for (const { task, date, other } of conflictedTasks.values()) {
    scheduleTask(task, `Reschedule to avoid overlap with ${other.title}.`, date)
  }

  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const unscheduled = tasks.filter(task => (
    taskIsPending(task)
    && !task.startDate
    && taskDependenciesComplete(task, tasksById)
    && (!task.dueDate || task.dueDate >= startDate)
  )).sort(compareTasks)
  for (const task of unscheduled) {
    if (recommendations.length >= 5) break
    const deadline = task.dueDate ? ` Due ${task.dueDate}.` : ''
    scheduleTask(task, `${task.priority || 'Medium'} priority.${deadline}`, startDate)
  }

  return { days, recommendations }
}

export { getScheduleOverview }
