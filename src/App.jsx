import { useEffect, useMemo, useState } from 'react'
import './App.css'

const initialTasks = [
  { id: 'task-1', title: 'Review weekly priorities', done: false },
  { id: 'task-2', title: 'Send the project proposal', done: false },
  { id: 'task-3', title: 'Set up your MyDesk workspace', done: true },
]

const eventCategories = [
  { name: 'Personal', color: '#d98262' },
  { name: 'Work', color: '#6f8fc2' },
  { name: 'Health', color: '#70a486' },
  { name: 'Other', color: '#9a82b8' },
]

const taskPriorities = ['Low', 'Medium', 'High', 'Urgent']
const taskStatuses = ['pending', 'postponed', 'completed']
const reminderRepeats = ['none', 'daily', 'weekly', 'monthly']

const initialNotes = [
  {
    id: 'note-1',
    title: 'A little more focus',
    body: 'Make room for the work that matters. One thoughtful step at a time.',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'note-2',
    title: 'Ideas for later',
    body: 'A calmer morning routine\nA short walk after lunch\nMore time away from screens',
    updatedAt: new Date().toISOString(),
  },
]

const navigation = [
  { label: 'Dashboard', icon: 'home' },
  { label: 'Timeline', icon: 'clock' },
  { label: 'Calendar', icon: 'calendar' },
  { label: 'Tasks', icon: 'check' },
  { label: 'Reminders', icon: 'bell' },
  { label: 'Alarms', icon: 'clock' },
  { label: 'Notes', icon: 'note' },
  { label: 'Password Vault', icon: 'lock' },
]

const iconContent = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  check: <><path d="m5 12 4 4L19 6" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></>,
  spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
}

function Icon({ name, size = 20 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconContent[name]}
    </svg>
  )
}

function readStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : fallback
  } catch (error) {
    console.error(`Unable to load ${key} from local storage.`, error)
    return fallback
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function startOfWeek(date) {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  start.setHours(0, 0, 0, 0)
  return start
}

function formatTime(value) {
  if (!value) return ''
  const [hours, minutes] = value.split(':').map(Number)
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, hours, minutes))
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeTask(task) {
  const createdAt = task.createdAt || new Date().toISOString()
  const status = task.status || (task.done ? 'completed' : 'pending')
  return {
    ...task,
    status,
    done: status === 'completed',
    startDate: task.startDate || '',
    startTime: task.startTime || '',
    dueDate: task.dueDate || '',
    originalDueDate: task.originalDueDate ?? task.dueDate ?? '',
    priority: task.priority || 'Medium',
    category: task.category || 'Personal',
    tags: Array.isArray(task.tags) ? task.tags : [],
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    repeat: task.repeat || 'none',
    estimatedMinutes: task.estimatedMinutes ?? '',
    actualMinutes: task.actualMinutes ?? 0,
    project: task.project || '',
    goal: task.goal || '',
    eventId: task.eventId || '',
    reminderAt: task.reminderAt || '',
    notes: task.notes || '',
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    history: Array.isArray(task.history) ? task.history : [{
      id: createId(),
      at: createdAt,
      action: 'Task created',
      fromDate: '',
      toDate: task.dueDate || '',
    }],
    createdAt,
    completedAt: task.completedAt || '',
  }
}

function normalizeNote(note) {
  const updatedAt = note.updatedAt || new Date().toISOString()
  return {
    ...note,
    createdAt: note.createdAt || updatedAt,
    updatedAt,
  }
}

function localDateKey(value) {
  return dateKey(new Date(value))
}

function formatClock(value) {
  return value
    ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
    : ''
}

function localTimeKey(value) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function localDateTimeValue(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function legacyTaskReminder(task) {
  const scheduledAt = new Date(task.reminderAt).toISOString()
  return {
    id: `legacy-${task.id}`,
    title: task.title,
    description: '',
    sourceType: 'task',
    sourceId: task.id,
    sourceTitle: task.title,
    scheduledAt,
    nextAt: scheduledAt,
    nextKind: 'schedule',
    repeat: 'none',
    priority: task.priority || 'Medium',
    sound: 'system',
    escalationMinutes: 0,
    escalationCount: 0,
    maxEscalations: 3,
    status: 'active',
    createdAt: task.createdAt || new Date().toISOString(),
    scheduleRevisionAt: '',
    legacyKey: `task:${task.id}`,
  }
}

function eventStartAt(event) {
  const date = parseDateKey(event.date)
  const [hours, minutes] = (event.startTime || '09:00').split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date
}

function nextEventStartAt(event, now = new Date()) {
  let eventDate = event.date
  let date = eventStartAt(event)
  while (date <= now && event.repeat !== 'none') {
    eventDate = nextRecurringDate(eventDate, event.repeat)
    date = eventStartAt({ ...event, date: eventDate })
  }
  return date > now ? date : null
}

function eventContextReminderAt(event, rule) {
  const startsAt = nextEventStartAt(event)
  if (!startsAt) return ''
  if (rule === 'previous-evening') {
    const previousEvening = new Date(startsAt)
    previousEvening.setDate(previousEvening.getDate() - 1)
    previousEvening.setHours(19, 0, 0, 0)
    return previousEvening.toISOString()
  }
  const minutesBefore = rule === 'one-hour' ? 60 : 15
  return new Date(startsAt.getTime() - minutesBefore * 60_000).toISOString()
}

function playReminderSound(sound) {
  if (sound === 'system' || sound === 'silent') return
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return
  try {
    const context = new AudioContext()
    const notes = sound === 'chime' ? [784, 988, 1175] : [587, 698]
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const startAt = context.currentTime + index * 0.16
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.45)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.46)
    })
    window.setTimeout(() => { void context.close() }, 1000)
  } catch (error) {
    console.error('Unable to play the selected reminder sound.', error)
  }
}

function timelineActivities(date, tasks, events, notes, history, reminders) {
  const activities = []
  const completedByDate = task => task.completedAt && localDateKey(task.completedAt) <= date

  tasks.forEach(task => {
    const status = completedByDate(task) ? 'completed' : displayTaskStatus(task, date)
    const dateDetails = task.originalDueDate && task.dueDate && task.originalDueDate !== task.dueDate
      ? `Originally due ${formatDate(parseDateKey(task.originalDueDate))}; now due ${formatDate(parseDateKey(task.dueDate))}`
      : ''
    if (task.startDate === date) {
      activities.push({
        id: `${task.id}-start-${date}`,
        kind: 'task',
        title: task.title,
        time: task.startTime || '',
        sortTime: task.startTime || '09:00',
        status,
        detail: [task.category, task.priority, dateDetails].filter(Boolean).join(' · '),
        taskId: task.id,
      })
    }
    if (task.dueDate === date && task.startDate !== date) {
      activities.push({
        id: `${task.id}-due-${date}`,
        kind: 'task',
        title: task.title,
        time: '',
        sortTime: '23:59',
        status,
        detail: [`Due today`, task.category, task.priority, dateDetails].filter(Boolean).join(' · '),
        taskId: task.id,
      })
    }
    if (task.completedAt && localDateKey(task.completedAt) === date) {
      activities.push({
        id: `${task.id}-completed-${date}`,
        kind: 'task',
        title: task.title,
        time: formatClock(task.completedAt),
        sortTime: localTimeKey(task.completedAt),
        status: 'completed',
        detail: 'Task completed',
        taskId: task.id,
      })
    }
    if (task.originalDueDate === date && task.dueDate && task.dueDate !== date) {
      activities.push({
        id: `${task.id}-original-due-${date}`,
        kind: 'activity',
        title: task.title,
        time: '',
        sortTime: '23:58',
        status: 'changed',
        detail: `Originally due today · moved to ${formatDate(parseDateKey(task.dueDate))}`,
        taskId: task.id,
      })
    }
  })

  events.filter(event => eventOccursOnDate(event, date)).forEach(event => {
    activities.push({
      id: `${event.id}-${date}`,
      kind: 'event',
      title: event.title,
      time: event.startTime || '',
      sortTime: event.startTime || '00:00',
      status: 'scheduled',
      detail: [event.category, event.repeat !== 'none' ? `Repeats ${event.repeat}` : ''].filter(Boolean).join(' · '),
      notes: event.notes,
    })
  })

  notes.filter(note => localDateKey(note.createdAt) === date).forEach(note => {
    activities.push({
      id: `${note.id}-created-${date}`,
      kind: 'note',
      title: note.title || 'Untitled note',
      time: formatClock(note.createdAt),
      sortTime: localTimeKey(note.createdAt),
      status: 'created',
      detail: note.body,
    })
  })

  history.forEach(entry => {
    const changedDate = entry.fromDate && entry.toDate && entry.fromDate !== entry.toDate
      ? `${formatDate(parseDateKey(entry.fromDate))} → ${formatDate(parseDateKey(entry.toDate))}`
      : ''
    const time = formatClock(entry.at)
    activities.push({
      id: `history-${entry.id}`,
      kind: 'activity',
      title: entry.title,
      time,
      sortTime: localTimeKey(entry.at),
      status: entry.action.toLowerCase().includes('complet') ? 'completed' : 'changed',
      detail: [entry.action, changedDate].filter(Boolean).join(' · '),
      taskId: entry.taskId,
    })
  })

  reminders.forEach(reminder => {
    const completedAt = reminder.completedAt || reminder.lastCompletedAt
    const completedOnDate = completedAt && localDateKey(completedAt) === date
    const activityAt = completedOnDate
      ? completedAt
      : reminder.lastNotifiedAt && localDateKey(reminder.lastNotifiedAt) === date
        ? reminder.lastNotifiedAt
        : reminder.nextAt && localDateKey(reminder.nextAt) === date
          ? reminder.nextAt
          : reminder.scheduledAt && localDateKey(reminder.scheduledAt) === date
            ? reminder.scheduledAt
            : ''
    if (!activityAt) return
    activities.push({
      id: `${reminder.id}-${date}`,
      kind: 'reminder',
      title: reminder.title,
      time: formatClock(activityAt),
      sortTime: localTimeKey(activityAt),
      status: reminder.status === 'completed' || completedOnDate
        ? 'completed'
        : reminder.status === 'paused'
          ? 'changed'
          : reminder.lastNotifiedAt && localDateKey(reminder.lastNotifiedAt) === date
            ? 'triggered'
            : 'scheduled',
      detail: [
        reminder.sourceTitle ? `For ${reminder.sourceTitle}` : '',
        reminder.repeat !== 'none' ? `Repeats ${reminder.repeat}` : '',
        reminder.lastDeliveryKind === 'escalation' ? 'Escalated' : '',
      ].filter(Boolean).join(' · '),
      taskId: reminder.sourceType === 'task' ? reminder.sourceId : '',
    })
  })

  return activities.sort((left, right) => left.sortTime.localeCompare(right.sortTime))
}

function displayTaskStatus(task, today = dateKey(new Date())) {
  if (task.status === 'completed' || task.done) return 'completed'
  if (task.status === 'postponed') return 'postponed'
  if (task.dueDate && task.dueDate < today) return 'overdue'
  return 'pending'
}

function addTaskHistory(task, action, fromDate = '', toDate = '') {
  return [...task.history, {
    id: createId(),
    at: new Date().toISOString(),
    action,
    fromDate,
    toDate,
  }]
}

function nextRecurringDate(value, repeat) {
  if (!value) return ''
  const date = parseDateKey(value)
  if (repeat === 'daily') date.setDate(date.getDate() + 1)
  else if (repeat === 'weekly') date.setDate(date.getDate() + 7)
  else if (repeat === 'monthly') {
    const originalDay = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + 1)
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(originalDay, daysInMonth))
  }
  return dateKey(date)
}

function eventOccursOnDate(event, key) {
  if (event.repeat === 'daily') return key >= event.date
  if (event.repeat === 'weekly') {
    return key >= event.date && parseDateKey(key).getDay() === parseDateKey(event.date).getDay()
  }
  if (event.repeat === 'monthly') {
    return key >= event.date && parseDateKey(key).getDate() === parseDateKey(event.date).getDate()
  }
  return event.date === key
}

function timeToMinutes(value) {
  if (!value) return 0
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(value) {
  const hours = Math.floor(value / 60) % 24
  const minutes = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function App() {
  const [storedContent] = useState(() => ({
    tasks: readStorage('mydesk-tasks', initialTasks),
    notes: readStorage('mydesk-notes', initialNotes),
    events: readStorage('mydesk-events', []),
    reminders: readStorage('mydesk-reminders', []),
  }))
  const [tasks, setTasks] = useState(() => storedContent.tasks.map(normalizeTask))
  const [notes, setNotes] = useState(() => storedContent.notes.map(normalizeNote))
  const [events, setEvents] = useState(storedContent.events)
  const [reminders, setReminders] = useState(() => {
    if (window.mydesk?.reminders) return storedContent.reminders
    const savedLegacyImports = readStorage('mydesk-reminder-legacy-imports', [])
    const existingLegacyKeys = new Set([
      ...storedContent.reminders.map(reminder => reminder.legacyKey),
      ...(Array.isArray(savedLegacyImports) ? savedLegacyImports : []),
    ])
    const imported = storedContent.tasks
      .filter(task => task.reminderAt
        && Number.isFinite(new Date(task.reminderAt).getTime())
        && !existingLegacyKeys.has(`task:${task.id}`))
      .map(legacyTaskReminder)
    return [...imported, ...storedContent.reminders]
  })
  const [activeView, setActiveView] = useState('Dashboard')
  const [taskFilter, setTaskFilter] = useState('All')
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStoreReady, setTaskStoreReady] = useState(() => !window.mydesk?.tasks)
  const [taskStoreError, setTaskStoreError] = useState('')
  const [reminderStoreReady, setReminderStoreReady] = useState(() => !window.mydesk?.reminders)
  const [reminderStoreError, setReminderStoreError] = useState('')
  const [taskActionError, setTaskActionError] = useState('')
  const [noteSearch, setNoteSearch] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState(storedContent.notes[0]?.id ?? null)

  useEffect(() => {
    const taskDatabase = window.mydesk?.tasks
    if (!taskDatabase) return undefined
    let active = true
    taskDatabase.load().then(async saved => {
      if (!active) return
      if (saved.tasks.length) {
        setTasks(saved.tasks.map(normalizeTask))
      } else if (!saved.hasImportedLegacyTasks && storedContent.tasks.length) {
        const migratedTasks = storedContent.tasks.map(normalizeTask)
        const migratedReminders = await taskDatabase.save(migratedTasks)
        if (active) {
          setTasks(migratedTasks)
          if (Array.isArray(migratedReminders)) {
            setReminders(migratedReminders)
            setReminderStoreReady(true)
          }
        }
      } else {
        setTasks([])
      }
      if (active) setTaskStoreReady(true)
    }).catch(error => {
      if (active) setTaskStoreError(`Tasks could not be loaded from the local database: ${error.message}`)
    })
    return () => { active = false }
  }, [storedContent.tasks])

  useEffect(() => {
    const reminderDatabase = window.mydesk?.reminders
    if (!reminderDatabase) return undefined

    let active = true
    reminderDatabase.load().then(saved => {
      if (!active) return
      setReminders(saved)
      setReminderStoreReady(true)
    }).catch(error => {
      if (active) setReminderStoreError(`Reminders could not be loaded from the local database: ${error.message}`)
    })
    return () => { active = false }
  }, [storedContent.reminders, storedContent.tasks])

  useEffect(() => {
    const taskDatabase = window.mydesk?.tasks
    if (taskDatabase) {
      if (!taskStoreReady) return
      taskDatabase.save(tasks).then(() => setTaskStoreError('')).catch(error => {
        setTaskStoreError(`Tasks could not be saved to the local database: ${error.message}`)
      })
    } else {
      localStorage.setItem('mydesk-tasks', JSON.stringify(tasks))
    }
  }, [tasks, taskStoreReady])

  useEffect(() => {
    localStorage.setItem('mydesk-notes', JSON.stringify(notes))
  }, [notes])

  useEffect(() => {
    localStorage.setItem('mydesk-events', JSON.stringify(events))
  }, [events])

  useEffect(() => {
    const reminderDatabase = window.mydesk?.reminders
    if (reminderDatabase) {
      if (!reminderStoreReady || !taskStoreReady) return
      reminderDatabase.save(reminders).then(() => setReminderStoreError('')).catch(error => {
        setReminderStoreError(`Reminders could not be saved to the local database: ${error.message}`)
      })
    } else {
      localStorage.setItem('mydesk-reminders', JSON.stringify(reminders))
    }
  }, [reminders, reminderStoreReady, taskStoreReady])

  useEffect(() => {
    const reminderDatabase = window.mydesk?.reminders
    if (!reminderDatabase?.onTriggered) return undefined
    const unsubscribeTriggered = reminderDatabase.onTriggered(({ reminder }) => {
      setReminders(current => current.map(item => item.id === reminder.id ? reminder : item))
      playReminderSound(reminder.sound)
    })
    const unsubscribeError = reminderDatabase.onError?.(message => setReminderStoreError(message))
    return () => {
      unsubscribeTriggered()
      unsubscribeError?.()
    }
  }, [])

  const completedTasks = tasks.filter(task => displayTaskStatus(task) === 'completed').length
  const activeTasks = tasks.length - completedTasks
  const selectedNote = notes.find(note => note.id === selectedNoteId)
  const filteredTasks = useMemo(() => tasks.filter(task => {
    const status = displayTaskStatus(task)
    if (taskFilter !== 'All' && status !== taskFilter.toLowerCase()) return false
    if (!taskSearch.trim()) return true
    const query = taskSearch.toLowerCase()
    return `${task.title} ${task.category} ${task.project} ${task.goal} ${task.tags.join(' ')}`
      .toLowerCase().includes(query)
  }), [taskFilter, taskSearch, tasks])
  const filteredNotes = useMemo(() => notes.filter(note => (
    `${note.title} ${note.body}`.toLowerCase().includes(noteSearch.toLowerCase())
  )), [noteSearch, notes])

  function hasDependencyCycle(taskId, dependencies) {
    const tasksById = new Map(tasks.map(task => [task.id, task]))
    const visited = new Set()
    function reachesTask(id) {
      if (id === taskId) return true
      if (visited.has(id)) return false
      visited.add(id)
      return (tasksById.get(id)?.dependencies || []).some(reachesTask)
    }
    return dependencies.some(reachesTask)
  }

  function saveTask(draft) {
    const id = draft.id || createId()
    const dependencies = draft.dependencies.filter(dependency => dependency !== id)
    if (hasDependencyCycle(id, dependencies)) {
      setTaskActionError('That dependency would create a task cycle. Choose a different dependency.')
      return false
    }
    if (draft.status === 'completed') {
      const blockingDependency = tasks.find(task => dependencies.includes(task.id) && displayTaskStatus(task) !== 'completed')
      if (blockingDependency) {
        setTaskActionError(`Complete “${blockingDependency.title}” before completing this task.`)
        return false
      }
      if (draft.subtasks.some(subtask => !subtask.done)) {
        setTaskActionError('Finish or remove the remaining subtasks before completing this task.')
        return false
      }
    }
    const existing = tasks.find(task => task.id === id)
    const nextTask = normalizeTask({
      ...existing,
      ...draft,
      id,
      dependencies,
      status: draft.status || existing?.status || 'pending',
      done: (draft.status || existing?.status) === 'completed',
      originalDueDate: existing
        ? (existing.originalDueDate || existing.dueDate || draft.dueDate || '')
        : (draft.dueDate || ''),
      createdAt: existing?.createdAt || new Date().toISOString(),
      completedAt: (draft.status || existing?.status) === 'completed'
        ? (existing?.completedAt || new Date().toISOString())
        : '',
      history: existing?.history || [],
    })
    let history = nextTask.history
    if (existing && existing.dueDate !== nextTask.dueDate) {
      history = addTaskHistory({ ...nextTask, history }, 'Due date changed', existing.dueDate, nextTask.dueDate)
    }
    if (existing && existing.startDate !== nextTask.startDate) {
      history = addTaskHistory({ ...nextTask, history }, 'Start date changed', existing.startDate, nextTask.startDate)
    }
    if (existing && existing.status !== nextTask.status) {
      history = addTaskHistory({ ...nextTask, history }, `Status changed to ${nextTask.status}`)
    }
    if (!existing) history = addTaskHistory({ ...nextTask, history: [] }, 'Task created', '', nextTask.dueDate)
    setTasks(current => existing
      ? current.map(task => task.id === id ? { ...nextTask, history } : task)
      : [{ ...nextTask, history }, ...current])
    if (existing && existing.title !== nextTask.title) {
      setReminders(current => current.map(reminder => (
        reminder.sourceType === 'task' && reminder.sourceId === id
          ? { ...reminder, sourceTitle: nextTask.title }
          : reminder
      )))
    }
    setTaskActionError('')
    return true
  }

  function toggleTask(id) {
    const task = tasks.find(item => item.id === id)
    if (!task) return
    if (displayTaskStatus(task) !== 'completed') {
      const blockingDependency = tasks.find(item => task.dependencies.includes(item.id) && displayTaskStatus(item) !== 'completed')
      if (blockingDependency) {
        setTaskActionError(`Complete “${blockingDependency.title}” before completing this task.`)
        return
      }
      if (task.subtasks.some(subtask => !subtask.done)) {
        setTaskActionError('Finish or remove the remaining subtasks before completing this task.')
        return
      }
    }
    setTasks(current => current.flatMap(item => {
      if (item.id !== id) return [item]
      const completing = displayTaskStatus(item) !== 'completed'
      const updated = {
        ...item,
        status: completing ? 'completed' : 'pending',
        done: completing,
        completedAt: completing ? new Date().toISOString() : '',
        history: addTaskHistory(item, completing ? 'Task completed' : 'Task reopened'),
      }
      if (!completing || item.repeat === 'none') return [updated]
      const nextDueDate = nextRecurringDate(item.dueDate, item.repeat)
      const nextStartDate = nextRecurringDate(item.startDate, item.repeat)
      return [updated, normalizeTask({
        ...item,
        id: createId(),
        status: 'pending',
        done: false,
        dueDate: nextDueDate,
        originalDueDate: nextDueDate,
        startDate: nextStartDate,
        completedAt: '',
        actualMinutes: 0,
        subtasks: item.subtasks.map(subtask => ({ ...subtask, id: createId(), done: false })),
        dependencies: [],
        attachments: [],
        createdAt: new Date().toISOString(),
        history: [{
          id: createId(),
          at: new Date().toISOString(),
          action: 'Recurring task created',
          fromDate: '',
          toDate: nextDueDate,
        }],
      })]
    }))
    setTaskActionError('')
  }

  function deleteTask(id) {
    setTasks(current => current
      .filter(task => task.id !== id)
      .map(task => ({ ...task, dependencies: task.dependencies.filter(dependency => dependency !== id) })))
    setReminders(current => current.map(reminder => (
      reminder.sourceType === 'task' && reminder.sourceId === id && reminder.status === 'active'
        ? { ...reminder, status: 'paused', nextAt: '', nextKind: '', pausedReason: 'The linked task was deleted.', scheduleRevisionAt: new Date().toISOString() }
        : reminder
    )))
  }

  function updateTask(id, changes, action) {
    setTasks(current => current.map(task => task.id === id ? {
      ...task,
      ...changes,
      history: action ? addTaskHistory(task, action) : task.history,
    } : task))
  }

  function scheduleTask(id, date, startTime) {
    const task = tasks.find(item => item.id === id)
    if (!task) return
    const previousDate = task.startDate
    setTasks(current => current.map(item => item.id === id ? {
      ...item,
      startDate: date,
      startTime,
      history: addTaskHistory(item, 'Task smart-scheduled', previousDate, date),
    } : item))
    setTaskActionError('')
  }

  function createNote() {
    const now = new Date().toISOString()
    const note = {
      id: createId(),
      title: 'Untitled note',
      body: '',
      createdAt: now,
      updatedAt: now,
    }
    setNotes(current => [note, ...current])
    setSelectedNoteId(note.id)
    setActiveView('Notes')
  }

  function updateNote(field, value) {
    setNotes(current => current.map(note => (
      note.id === selectedNoteId
        ? { ...note, [field]: value, updatedAt: new Date().toISOString() }
        : note
    )))
  }

  function deleteNote(id) {
    setNotes(current => current.filter(note => note.id !== id))
    if (selectedNoteId === id) {
      setSelectedNoteId(notes.find(note => note.id !== id)?.id ?? null)
    }
  }

  function saveReminder(draft) {
    const source = draft.sourceType === 'task'
      ? tasks.find(task => task.id === draft.sourceId)
      : draft.sourceType === 'event'
        ? events.find(event => event.id === draft.sourceId)
        : null
    const scheduledAt = new Date(draft.scheduledAt).toISOString()
    const existing = reminders.find(reminder => reminder.id === draft.id)
    const now = new Date().toISOString()
    const reminder = {
      ...existing,
      ...draft,
      id: existing?.id || draft.id || createId(),
      scheduledAt,
      nextAt: scheduledAt,
      nextKind: 'schedule',
      status: 'active',
      sourceTitle: source?.title || '',
      createdAt: existing?.createdAt || now,
      scheduleRevisionAt: now,
      lastNotifiedAt: '',
      lastDeliveryKind: '',
      completedAt: '',
      snoozedUntil: '',
      escalationCount: 0,
      legacyKey: existing?.legacyKey || '',
    }
    setReminders(current => existing
      ? current.map(item => item.id === reminder.id ? reminder : item)
      : [reminder, ...current])
    return true
  }

  function completeReminder(id) {
    const reminderDatabase = window.mydesk?.reminders
    if (reminderDatabase) {
      reminderDatabase.complete(id).then(updated => {
        if (updated) setReminders(current => current.map(item => item.id === id ? updated : item))
      }).catch(error => setReminderStoreError(`Reminder could not be completed: ${error.message}`))
      return
    }
    const now = new Date()
    setReminders(current => current.map(reminder => {
      if (reminder.id !== id || reminder.status !== 'active') return reminder
      if (reminder.repeat === 'none') {
        return { ...reminder, status: 'completed', completedAt: now.toISOString(), nextAt: '', nextKind: '' }
      }
      const next = new Date(reminder.scheduledAt)
      do {
        if (reminder.repeat === 'daily') next.setDate(next.getDate() + 1)
        else if (reminder.repeat === 'weekly') next.setDate(next.getDate() + 7)
        else if (reminder.repeat === 'monthly') {
          const day = next.getDate()
          next.setDate(1)
          next.setMonth(next.getMonth() + 1)
          next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))
        }
      } while (next <= now)
      return {
        ...reminder,
        lastCompletedAt: now.toISOString(),
        scheduledAt: next.toISOString(),
        nextAt: next.toISOString(),
        nextKind: 'schedule',
        escalationCount: 0,
        snoozedUntil: '',
      }
    }))
  }

  function snoozeReminder(id, minutes) {
    const reminderDatabase = window.mydesk?.reminders
    if (reminderDatabase) {
      reminderDatabase.snooze(id, minutes).then(updated => {
        if (updated) setReminders(current => current.map(item => item.id === id ? updated : item))
      }).catch(error => setReminderStoreError(`Reminder could not be snoozed: ${error.message}`))
      return
    }
    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString()
    setReminders(current => current.map(reminder => reminder.id === id
      ? { ...reminder, snoozedUntil, nextAt: snoozedUntil, nextKind: 'snooze', escalationCount: 0 }
      : reminder))
  }

  function deleteReminder(id) {
    const reminderDatabase = window.mydesk?.reminders
    if (reminderDatabase) {
      reminderDatabase.delete(id).then(() => setReminders(current => current.filter(reminder => reminder.id !== id)))
        .catch(error => setReminderStoreError(`Reminder could not be deleted: ${error.message}`))
      return
    }
    const deletedReminder = reminders.find(reminder => reminder.id === id)
    if (deletedReminder?.legacyKey) {
      const savedImports = readStorage('mydesk-reminder-legacy-imports', [])
      const imports = Array.isArray(savedImports) ? savedImports : []
      localStorage.setItem('mydesk-reminder-legacy-imports', JSON.stringify([...new Set([...imports, deletedReminder.legacyKey])]))
    }
    setReminders(current => current.filter(reminder => reminder.id !== id))
  }

  function syncEventReminders(event) {
    setReminders(current => current.map(reminder => {
      if (reminder.sourceType !== 'event' || reminder.sourceId !== event.id) return reminder
      const sourceUpdated = reminder.sourceTitle === event.title
        ? reminder
        : { ...reminder, sourceTitle: event.title }
      if (!reminder.contextRule || !['active', 'paused'].includes(reminder.status)) return sourceUpdated
      const scheduledAt = eventContextReminderAt(event, reminder.contextRule)
      if (!scheduledAt || Date.parse(scheduledAt) <= Date.now()) {
        return {
          ...sourceUpdated,
          scheduledAt: scheduledAt || reminder.scheduledAt,
          nextAt: '',
          nextKind: '',
          status: 'paused',
          pausedReason: 'The updated event no longer has a future reminder time.',
          scheduleRevisionAt: new Date().toISOString(),
        }
      }
      return {
        ...sourceUpdated,
        scheduledAt,
        nextAt: scheduledAt,
        nextKind: 'schedule',
        status: 'active',
        pausedReason: '',
        escalationCount: 0,
        scheduleRevisionAt: new Date().toISOString(),
        lastNotifiedAt: '',
        lastDeliveryKind: '',
      }
    }))
  }

  function saveEvent(event) {
    setEvents(current => {
      const exists = current.some(item => item.id === event.id)
      return exists
        ? current.map(item => item.id === event.id ? event : item)
        : [event, ...current]
    })
    syncEventReminders(event)
  }

  function deleteEvent(id) {
    setEvents(current => current.filter(event => event.id !== id))
    setReminders(current => current.map(reminder => (
      reminder.sourceType === 'event' && reminder.sourceId === id && reminder.status === 'active'
        ? { ...reminder, status: 'paused', nextAt: '', nextKind: '', pausedReason: 'The linked event was deleted.', scheduleRevisionAt: new Date().toISOString() }
        : reminder
    )))
  }

  const [greeting] = useState(() => (
    new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' })
      .format(new Date())
  ))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="spark" size={21} /></div>
          <span>mydesk<span className="brand-period">.</span></span>
        </div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(item => (
            <button
              key={item.label}
              className={`nav-item ${activeView === item.label ? 'nav-item-active' : ''}`}
              onClick={() => setActiveView(item.label)}
              type="button"
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.label === 'Tasks' && activeTasks > 0 && (
                <span className="nav-count">{activeTasks}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon"><Icon name="spark" size={17} /></div>
            <p>A little progress each day adds up.</p>
            <span>Keep going, you’re doing great.</span>
          </div>
          <div className="profile-row">
            <div className="avatar">H</div>
            <div><strong>My workspace</strong><span>Personal space</span></div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeView}</strong></div>
          <div className="topbar-right">
            <span className="today-label"><span className="status-dot" /> All changes saved</span>
            <div className="top-avatar">H</div>
          </div>
        </header>
        <div className="page-content">
          {taskStoreError && <div className="task-storage-error" role="alert">{taskStoreError}</div>}
          {reminderStoreError && <div className="task-storage-error" role="alert">{reminderStoreError}</div>}
          {taskActionError && <div className="task-action-error" role="alert"><span>{taskActionError}</span><button type="button" onClick={() => setTaskActionError('')}>Dismiss</button></div>}
          {activeView === 'Dashboard' && (
            <Dashboard
              greeting={greeting}
              tasks={tasks}
              notes={notes}
              completedTasks={completedTasks}
              activeTasks={activeTasks}
              onNavigate={setActiveView}
              onToggleTask={toggleTask}
              onOpenNote={id => {
                setSelectedNoteId(id)
                setActiveView('Notes')
              }}
              onCreateNote={createNote}
            />
          )}

          {activeView === 'Tasks' && (
            <TasksPage
              tasks={filteredTasks}
              allTasks={tasks}
              events={events}
              taskFilter={taskFilter}
              taskSearch={taskSearch}
              taskActionError={taskActionError}
              setTaskFilter={setTaskFilter}
              setTaskSearch={setTaskSearch}
              onSaveTask={saveTask}
              onUpdateTask={updateTask}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onScheduleTask={scheduleTask}
            />
          )}

          {activeView === 'Timeline' && (
            <TimelinePage tasks={tasks} events={events} notes={notes} reminders={reminders} />
          )}

          {activeView === 'Reminders' && (
            <RemindersPage
              tasks={tasks}
              events={events}
              reminders={reminders}
              onSave={saveReminder}
              onComplete={completeReminder}
              onSnooze={snoozeReminder}
              onDelete={deleteReminder}
              onSetError={setReminderStoreError}
            />
          )}

          {activeView === 'Calendar' && (
            <CalendarPage
              events={events}
              tasks={tasks}
              onSaveEvent={saveEvent}
              onDeleteEvent={deleteEvent}
              onMoveItem={(item, date) => {
                if (item.type === 'task') {
                  const key = item.calendarKind === 'scheduled' ? 'startDate' : 'dueDate'
                  const prior = tasks.find(task => task.id === item.id)
                  setTasks(current => current.map(task => task.id === item.id ? {
                    ...task,
                    [key]: date,
                    history: addTaskHistory(task, key === 'startDate' ? 'Scheduled date changed' : 'Due date changed', task[key], date),
                  } : task))
                  if (prior) setTaskActionError('')
                } else {
                  const event = events.find(current => current.id === item.id)
                  if (event) {
                    const updatedEvent = { ...event, date }
                    setEvents(current => current.map(item => item.id === event.id ? updatedEvent : item))
                    syncEventReminders(updatedEvent)
                  }
                }
              }}
              onToggleTask={toggleTask}
            />
          )}

          {activeView === 'Notes' && (
            <NotesPage
              notes={filteredNotes}
              selectedNote={selectedNote}
              noteSearch={noteSearch}
              setNoteSearch={setNoteSearch}
              setSelectedNoteId={setSelectedNoteId}
              onCreateNote={createNote}
              onUpdateNote={updateNote}
              onDeleteNote={deleteNote}
            />
          )}

          {!['Dashboard', 'Tasks', 'Timeline', 'Calendar', 'Reminders', 'Notes'].includes(activeView) && (
            <ComingSoonPage title={activeView} />
          )}
        </div>
      </main>
    </div>
  )
}

function Dashboard({ greeting, tasks, notes, completedTasks, activeTasks, onNavigate, onToggleTask, onOpenNote, onCreateNote }) {
  const openTasks = tasks.filter(task => !task.done).slice(0, 3)
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">YOUR DAY, AT A GLANCE</p>
          <h1>Good things start here<span>.</span></h1>
          <p className="welcome-subtitle">A little structure for a more thoughtful day.</p>
        </div>
        <div className="date-pill"><Icon name="calendar" size={16} /> {greeting}</div>
      </section>

      <section className="focus-card">
        <div className="focus-copy">
          <div className="focus-kicker"><Icon name="spark" size={16} /> YOUR DAILY FOCUS</div>
          <h2>Make today<br />a good one.</h2>
          <p>You’ve got this. Take it one task at a time and make space for what matters.</p>
          <button type="button" className="focus-button" onClick={() => onNavigate('Tasks')}>
            See your tasks <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className="focus-art" aria-hidden="true">
          <div className="sun-glow" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-sparkle sparkle-one">✳</div>
          <div className="art-sparkle sparkle-two">✦</div>
          <div className="focus-plant"><span /><i /><b /></div>
          <div className="focus-book book-back" />
          <div className="focus-book book-front" />
          <div className="focus-check"><Icon name="check" size={22} /></div>
        </div>
        <div className="focus-progress">
          <div className="progress-caption"><span>TODAY’S PROGRESS</span><strong>{completedTasks} of {tasks.length} done</strong></div>
          <div className="progress-track"><div className="progress-value" style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      <section className="stats-grid" aria-label="Workspace summary">
        <SummaryCard icon="check" label="To do" value={activeTasks} detail="tasks to take on" color="peach" />
        <SummaryCard icon="spark" label="Completed" value={completedTasks} detail="small wins today" color="mint" />
        <SummaryCard icon="note" label="Your notes" value={notes.length} detail="ideas saved" color="lavender" />
      </section>

      <section className="dashboard-grid">
        <div className="surface-card task-preview">
          <div className="section-heading">
            <div><p className="eyebrow">KEEP THE MOMENTUM</p><h2>Up next</h2></div>
            <button type="button" className="text-link" onClick={() => onNavigate('Tasks')}>All tasks <Icon name="arrow" size={15} /></button>
          </div>
          {openTasks.length ? (
            <div className="preview-list">
              {openTasks.map(task => (
                <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
              ))}
            </div>
          ) : (
            <div className="empty-mini"><span className="empty-check"><Icon name="check" size={18} /></span><div><strong>All caught up</strong><span>You’ve cleared your task list.</span></div></div>
          )}
          <button type="button" className="add-inline" onClick={() => onNavigate('Tasks')}><Icon name="plus" size={17} /> Add a task</button>
        </div>

        <div className="surface-card notes-preview">
          <div className="section-heading">
            <div><p className="eyebrow">THOUGHTS & IDEAS</p><h2>Recent notes</h2></div>
            <button type="button" className="icon-button" aria-label="Create a note" onClick={onCreateNote}><Icon name="plus" size={18} /></button>
          </div>
          {notes.length ? notes.slice(0, 2).map((note, index) => (
            <button type="button" className={`note-preview-item note-tint-${index % 2}`} key={note.id} onClick={() => onOpenNote(note.id)}>
              <span className="note-preview-icon"><Icon name="edit" size={16} /></span>
              <span className="note-preview-copy"><strong>{note.title || 'Untitled note'}</strong><span>{note.body || 'Nothing written yet'}</span></span>
              <Icon name="arrow" size={15} />
            </button>
          )) : (
            <div className="empty-mini"><span className="empty-note"><Icon name="note" size={18} /></span><div><strong>No notes yet</strong><span>Save an idea for later.</span></div></div>
          )}
          <button type="button" className="notes-link" onClick={() => onNavigate('Notes')}>Open your notes <Icon name="arrow" size={15} /></button>
        </div>
      </section>
      <footer className="page-footer">A calm space to get things done <span>·</span> Made for you</footer>
    </>
  )
}

function SummaryCard({ icon, label, value, detail, color }) {
  return (
    <div className="summary-card">
      <span className={`summary-icon summary-${color}`}><Icon name={icon} size={18} /></span>
      <div className="summary-number">{value}</div>
      <div className="summary-label">{label}</div>
      <div className="summary-detail">{detail}</div>
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete }) {
  return (
    <div className={`task-row ${task.done ? 'task-row-done' : ''}`}>
      <button
        type="button"
        className={`task-checkbox ${task.done ? 'task-checkbox-checked' : ''}`}
        aria-label={task.done ? `Mark ${task.title} as not done` : `Complete ${task.title}`}
        onClick={() => onToggle(task.id)}
      >
        {task.done && <Icon name="check" size={14} />}
      </button>
      <span className="task-title">{task.title}</span>
      {task.dueDate && <span className="task-due-date">{formatDate(parseDateKey(task.dueDate))}</span>}
      {onDelete && <button type="button" className="row-delete" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}><Icon name="trash" size={16} /></button>}
    </div>
  )
}

function getSmartSuggestion(tasks, events) {
  const tomorrow = dateKey(addDays(parseDateKey(dateKey(new Date())), 1))
  const priorityRank = { Urgent: 4, High: 3, Medium: 2, Low: 1 }
  const candidates = tasks.filter(task => (
    displayTaskStatus(task) === 'pending'
    && !task.startDate
    && (!task.dueDate || task.dueDate >= tomorrow)
    && Number(task.estimatedMinutes || 60) <= 60
    && task.dependencies.every(id => tasks.some(dep => dep.id === id && displayTaskStatus(dep) === 'completed'))
  )).sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])
  if (!candidates.length) return null

  const busySlots = [
    ...events.filter(event => eventOccursOnDate(event, tomorrow)).map(event => ({
      start: timeToMinutes(event.startTime),
      end: timeToMinutes(event.endTime),
    })),
    ...tasks.filter(task => task.startDate === tomorrow && task.startTime).map(task => ({
      start: timeToMinutes(task.startTime),
      end: timeToMinutes(task.startTime) + Number(task.estimatedMinutes || 60),
    })),
  ]
  for (let start = 9 * 60; start + 60 <= 17 * 60; start += 30) {
    if (!busySlots.some(slot => start < slot.end && slot.start < start + 60)) {
      return { task: candidates[0], date: tomorrow, startTime: minutesToTime(start) }
    }
  }
  return null
}

function TasksPage({ tasks, allTasks, events, taskFilter, taskSearch, taskActionError, setTaskFilter, setTaskSearch, onSaveTask, onUpdateTask, onToggleTask, onDeleteTask, onScheduleTask }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [suggestion, setSuggestion] = useState(null)

  function openTaskForm(task = null) {
    setEditingTask(task)
    setFormOpen(true)
  }

  function submitTask(task) {
    if (onSaveTask(task)) setFormOpen(false)
  }

  function showSuggestion() {
    setSuggestion(getSmartSuggestion(allTasks, events))
  }

  return (
    <>
      <section className="page-title-row tasks-title-row">
        <div><p className="eyebrow">MAKE IT HAPPEN</p><h1>Your tasks<span>.</span></h1><p className="welcome-subtitle">Small steps make big things feel possible.</p></div>
        <button type="button" className="primary-button" onClick={() => openTaskForm()}><Icon name="plus" size={16} /> New task</button>
      </section>

      <section className="smart-schedule-card">
        <span className="smart-schedule-icon"><Icon name="spark" size={18} /></span>
        <div className="smart-schedule-copy">
          <strong>Smart scheduling</strong>
          <span>Find a free hour tomorrow for a task that fits.</span>
          {suggestion && (
            <div className="smart-schedule-result">
              {suggestion.task
                ? <><span><b>{suggestion.task.title}</b> · {formatDate(parseDateKey(suggestion.date))} at {formatTime(suggestion.startTime)}</span><button type="button" className="primary-button" onClick={() => { onScheduleTask(suggestion.task.id, suggestion.date, suggestion.startTime); setSuggestion(null) }}>Schedule task</button></>
                : <span>No suitable task or free hour found for tomorrow.</span>}
            </div>
          )}
        </div>
        <button type="button" className="calendar-today smart-schedule-button" onClick={showSuggestion}>Suggest a time</button>
      </section>

      <section className="surface-card task-list-card task-manager-card">
        <div className="task-manager-toolbar">
          <div className="list-toolbar">
            <div><h2>All tasks</h2><span>{tasks.length} {tasks.length === 1 ? 'item' : 'items'}</span></div>
            <div className="filter-tabs" role="group" aria-label="Filter tasks">
              {['All', 'Pending', 'Postponed', 'Overdue', 'Completed'].map(filter => (
                <button type="button" key={filter} className={taskFilter === filter ? 'filter-active' : ''} onClick={() => setTaskFilter(filter)}>{filter}</button>
              ))}
            </div>
          </div>
          <label className="task-search-field"><Icon name="search" size={16} /><input aria-label="Search tasks" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} placeholder="Search title, tag, project..." /></label>
        </div>
        {tasks.length ? (
          <div className="task-manager-list">
            {tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                allTasks={allTasks}
                onEdit={() => openTaskForm(task)}
                onToggle={onToggleTask}
                onUpdate={onUpdateTask}
                onDelete={() => {
                  if (window.confirm(`Delete “${task.title}” and its task history?`)) onDeleteTask(task.id)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state"><span className="empty-state-icon"><Icon name="check" size={23} /></span><h3>Nothing on this list</h3><p>No tasks match this view. Create one when you’re ready.</p></div>
        )}
      </section>
      {formOpen && <TaskEditorModal task={editingTask} allTasks={allTasks} events={events} error={taskActionError} onClose={() => setFormOpen(false)} onSave={submitTask} />}
    </>
  )
}

function TaskCard({ task, allTasks, onEdit, onToggle, onUpdate, onDelete }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const status = displayTaskStatus(task)
  const blockedBy = task.dependencies
    .map(id => allTasks.find(item => item.id === id))
    .filter(item => item && displayTaskStatus(item) !== 'completed')
  const subtaskProgress = task.subtasks.length
    ? task.subtasks.filter(subtask => subtask.done).length
    : 0

  return (
    <article className={`task-manager-item task-status-${status}`}>
      <div className="task-manager-main">
        <button
          type="button"
          className={`task-checkbox ${status === 'completed' ? 'task-checkbox-checked' : ''}`}
          aria-label={status === 'completed' ? `Reopen ${task.title}` : `Complete ${task.title}`}
          onClick={() => onToggle(task.id)}
        >
          {status === 'completed' && <Icon name="check" size={14} />}
        </button>
        <div className="task-manager-copy">
          <strong className="task-manager-title">{task.title}</strong>
          <div className="task-manager-meta">
            <span className={`task-priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
            <span className={`task-status-label task-status-label-${status}`}>{status}</span>
            {task.startDate && <span>Starts {formatDate(parseDateKey(task.startDate))}{task.startTime ? ` · ${formatTime(task.startTime)}` : ''}</span>}
            {task.dueDate && <span>Due {formatDate(parseDateKey(task.dueDate))}</span>}
            <span>{task.category}</span>
          </div>
          {task.tags.length > 0 && <div className="task-tags">{task.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
          {blockedBy.length > 0 && <div className="task-blocked-note">Waiting for {blockedBy.map(item => item.title).join(', ')}</div>}
        </div>
        <div className="task-manager-actions">
          <button type="button" className="icon-button" aria-label={`Edit ${task.title}`} onClick={onEdit}><Icon name="edit" size={16} /></button>
          <button type="button" className="row-delete" aria-label={`Delete ${task.title}`} onClick={onDelete}><Icon name="trash" size={16} /></button>
        </div>
      </div>

      {(task.subtasks.length > 0 || task.estimatedMinutes || task.actualMinutes || task.project || task.goal || task.eventId || task.notes || task.attachments.length > 0) && (
        <div className="task-manager-details">
          {task.subtasks.length > 0 && (
            <div className="task-subtasks">
              <span className="task-detail-caption">Checklist {subtaskProgress}/{task.subtasks.length}</span>
              {task.subtasks.map(subtask => (
                <label key={subtask.id} className={`task-subtask ${subtask.done ? 'task-subtask-done' : ''}`}>
                  <input type="checkbox" checked={subtask.done} onChange={event => onUpdate(task.id, {
                    subtasks: task.subtasks.map(item => item.id === subtask.id ? { ...item, done: event.target.checked } : item),
                  })} />
                  <span>{subtask.title}</span>
                </label>
              ))}
            </div>
          )}
          <div className="task-detail-pills">
            {task.estimatedMinutes && <span>Estimate {task.estimatedMinutes} min</span>}
            <label className="task-actual-time">Actual <input type="number" min="0" aria-label={`Actual minutes for ${task.title}`} value={task.actualMinutes} onChange={event => onUpdate(task.id, { actualMinutes: Number(event.target.value) })} /> min</label>
            {task.project && <span>Project: {task.project}</span>}
            {task.goal && <span>Goal: {task.goal}</span>}
            {task.eventId && <span>Linked event: {task.eventId}</span>}
            {task.repeat !== 'none' && <span>Repeats {task.repeat}</span>}
          </div>
          {task.notes && <p className="task-notes-preview">{task.notes}</p>}
          {task.attachments.length > 0 && (
            <div className="task-attachments">
              {task.attachments.map(file => <a key={file.id} download={file.name} href={file.dataUrl}>{file.name}</a>)}
            </div>
          )}
        </div>
      )}

      <div className="task-manager-footer">
        {task.dependencies.length > 0 && <span>{task.dependencies.length} prerequisite{task.dependencies.length === 1 ? '' : 's'}</span>}
        <button type="button" className="task-history-toggle" onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? 'Hide history' : `History (${task.history.length})`}</button>
      </div>
      {historyOpen && (
        <ol className="task-history-list">
          <li><span>Original due date</span><time>{task.originalDueDate ? formatDate(parseDateKey(task.originalDueDate)) : 'Not set'}</time></li>
          {task.history.map(item => (
            <li key={item.id}>
              <span>{item.action}{item.fromDate !== item.toDate && (item.fromDate || item.toDate) ? ` · ${item.fromDate ? formatDate(parseDateKey(item.fromDate)) : 'No date'} → ${item.toDate ? formatDate(parseDateKey(item.toDate)) : 'No date'}` : ''}</span>
              <time>{formatDate(new Date(item.at))}</time>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

function TaskEditorModal({ task, allTasks, events, error, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeTask(task || { title: '', status: 'pending' }))
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const dateError = (draft.startDate && draft.dueDate && draft.dueDate < draft.startDate)
    || (draft.repeat !== 'none' && !draft.startDate && !draft.dueDate)
  const candidates = allTasks.filter(item => item.id !== task?.id)

  function update(field, value) {
    setDraft(current => ({ ...current, [field]: value }))
  }

  function addSubtask(event) {
    event.preventDefault()
    const title = subtaskDraft.trim()
    if (!title) return
    update('subtasks', [...draft.subtasks, { id: createId(), title, done: false }])
    setSubtaskDraft('')
  }

  async function addAttachments(event) {
    const files = Array.from(event.target.files || [])
    const invalidFile = files.find(file => file.size > 2 * 1024 * 1024)
    if (invalidFile) {
      setAttachmentError(`${invalidFile.name} is larger than the 2 MB per-file limit.`)
      event.target.value = ''
      return
    }
    try {
      const attachments = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({
          id: createId(),
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          dataUrl: reader.result,
        })
        reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}.`))
        reader.readAsDataURL(file)
      })))
      update('attachments', [...draft.attachments, ...attachments])
      setAttachmentError('')
    } catch (error) {
      setAttachmentError(`Attachment could not be added: ${error.message}`)
    }
    event.target.value = ''
  }

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="task-editor-modal" onSubmit={event => { event.preventDefault(); onSave({ ...draft, title: draft.title.trim() }) }}>
        <div className="task-editor-heading">
          <div><p className="eyebrow">TASK DETAILS</p><h2>{task ? 'Edit task' : 'Create a task'}</h2></div>
          <button type="button" className="icon-button" aria-label="Close task form" onClick={onClose}>×</button>
        </div>
        <label className="task-form-field task-form-title"><span>Task title</span><input autoFocus required maxLength={180} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="What needs to get done?" /></label>
        <div className="task-form-grid">
          <label className="task-form-field"><span>Start date</span><input type="date" value={draft.startDate} onChange={event => update('startDate', event.target.value)} /></label>
          <label className="task-form-field"><span>Start time</span><input type="time" value={draft.startTime} onChange={event => update('startTime', event.target.value)} /></label>
          <label className="task-form-field"><span>Due date</span><input type="date" value={draft.dueDate} onChange={event => update('dueDate', event.target.value)} /></label>
          <label className="task-form-field"><span>Priority</span><select value={draft.priority} onChange={event => update('priority', event.target.value)}>{taskPriorities.map(priority => <option key={priority}>{priority}</option>)}</select></label>
          <label className="task-form-field"><span>Status</span><select value={draft.status} onChange={event => update('status', event.target.value)}>{taskStatuses.map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
          <label className="task-form-field"><span>Category</span><input maxLength={40} value={draft.category} onChange={event => update('category', event.target.value)} /></label>
          <label className="task-form-field"><span>Tags (comma-separated)</span><input value={draft.tags.join(', ')} onChange={event => update('tags', event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))} placeholder="planning, focus" /></label>
          <label className="task-form-field"><span>Repeat</span><select value={draft.repeat} onChange={event => update('repeat', event.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label className="task-form-field"><span>Estimated minutes</span><input type="number" min="0" value={draft.estimatedMinutes} onChange={event => update('estimatedMinutes', event.target.value === '' ? '' : Number(event.target.value))} /></label>
          <label className="task-form-field"><span>Actual minutes</span><input type="number" min="0" value={draft.actualMinutes} onChange={event => update('actualMinutes', Number(event.target.value))} /></label>
          <label className="task-form-field"><span>Project</span><input maxLength={80} value={draft.project} onChange={event => update('project', event.target.value)} placeholder="Optional project" /></label>
          <label className="task-form-field"><span>Goal</span><input maxLength={80} value={draft.goal} onChange={event => update('goal', event.target.value)} placeholder="Optional goal" /></label>
          <label className="task-form-field"><span>Related event</span><select value={draft.eventId} onChange={event => update('eventId', event.target.value)}><option value="">None</option>{events.map(item => <option key={item.id} value={item.id}>{item.title} · {formatDate(parseDateKey(item.date))}</option>)}</select></label>
        </div>
        {dateError && <p className="task-form-error">{draft.startDate && draft.dueDate && draft.dueDate < draft.startDate ? 'The start date must be on or before the due date.' : 'A recurring task needs a start or due date.'}</p>}

        <section className="task-form-section">
          <div className="task-form-section-heading"><strong>Subtasks & checklist</strong><span>{draft.subtasks.filter(item => item.done).length}/{draft.subtasks.length}</span></div>
          <div className="subtask-entry"><input aria-label="New subtask" value={subtaskDraft} onChange={event => setSubtaskDraft(event.target.value)} placeholder="Add a checklist item" /><button type="button" className="calendar-today" onClick={addSubtask}>Add</button></div>
          {draft.subtasks.map(item => (
            <div className="task-form-subtask" key={item.id}>
              <label><input type="checkbox" checked={item.done} onChange={event => update('subtasks', draft.subtasks.map(subtask => subtask.id === item.id ? { ...subtask, done: event.target.checked } : subtask))} /><span>{item.title}</span></label>
              <button type="button" aria-label={`Remove ${item.title}`} onClick={() => update('subtasks', draft.subtasks.filter(subtask => subtask.id !== item.id))}>×</button>
            </div>
          ))}
        </section>

        <section className="task-form-section">
          <div className="task-form-section-heading"><strong>Dependencies</strong><span>Complete these first</span></div>
          <div className="task-dependency-list">
            {candidates.map(item => (
              <label key={item.id}><input type="checkbox" checked={draft.dependencies.includes(item.id)} onChange={event => update('dependencies', event.target.checked ? [...draft.dependencies, item.id] : draft.dependencies.filter(id => id !== item.id))} /><span>{item.title}</span><small>{displayTaskStatus(item)}</small></label>
            ))}
            {!candidates.length && <span className="task-form-hint">Add another task to create a dependency.</span>}
          </div>
        </section>

        <label className="task-form-field task-form-notes"><span>Notes</span><textarea rows="3" maxLength={3000} value={draft.notes} onChange={event => update('notes', event.target.value)} placeholder="Context, details, or links" /></label>
        <section className="task-form-section">
          <div className="task-form-section-heading"><strong>Attachments</strong><span>Up to 2 MB per file</span></div>
          <input type="file" multiple onChange={addAttachments} />
          {attachmentError && <p className="task-form-error">{attachmentError}</p>}
          {draft.attachments.map(file => <div className="task-form-attachment" key={file.id}><span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span><button type="button" onClick={() => update('attachments', draft.attachments.filter(item => item.id !== file.id))}>Remove</button></div>)}
        </section>
        <div className="task-editor-actions">
          <button type="button" className="calendar-today" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!draft.title.trim() || Boolean(dateError)}>Save task</button>
        </div>
        {error && <p className="task-form-error" role="alert">{error}</p>}
      </form>
    </div>
  )
}

function getTimelineSummary(activities) {
  const taskIds = new Set(activities
    .filter(activity => activity.kind === 'task' || (activity.kind === 'activity' && activity.status === 'completed'))
    .map(activity => activity.taskId))
  const completedTaskIds = new Set(activities
    .filter(activity => activity.status === 'completed' && activity.taskId)
    .map(activity => activity.taskId))
  return {
    tasks: taskIds.size,
    completed: completedTaskIds.size,
    events: activities.filter(activity => activity.kind === 'event').length,
    reminders: activities.filter(activity => activity.kind === 'reminder').length,
    notes: activities.filter(activity => activity.kind === 'note').length,
    changes: activities.filter(activity => activity.kind === 'activity' && activity.status === 'changed').length,
  }
}

function TimelineSummary({ activities, label }) {
  const summary = getTimelineSummary(activities)
  return (
    <section className="timeline-summary surface-card" aria-label={`${label} summary`}>
      <div className="timeline-summary-heading"><span>{label}</span><strong>{summary.completed} of {summary.tasks} tasks complete</strong></div>
      <div className="timeline-progress-track"><span style={{ width: `${summary.tasks ? Math.min(100, Math.round(summary.completed / summary.tasks * 100)) : 0}%` }} /></div>
      <div className="timeline-summary-counts">
        <span><b>{summary.tasks}</b> tasks</span>
        <span><b>{summary.events}</b> events</span>
        <span><b>{summary.reminders}</b> {summary.reminders === 1 ? 'reminder' : 'reminders'}</span>
        <span><b>{summary.notes}</b> notes</span>
        <span><b>{summary.changes}</b> schedule changes</span>
      </div>
    </section>
  )
}

function TimelinePage({ tasks, events, notes, reminders }) {
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()))
  const [compareDate, setCompareDate] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [historyByDate, setHistoryByDate] = useState({})
  const [historyErrors, setHistoryErrors] = useState({})

  useEffect(() => {
    let active = true
    const dates = [...new Set([selectedDate, compareDate].filter(Boolean))]
    const taskStore = window.mydesk?.tasks
    Promise.all(dates.map(date => {
      if (taskStore?.historyForDate) return taskStore.historyForDate(date)
      return Promise.resolve(tasks.flatMap(task => task.history
        .filter(item => localDateKey(item.at) === date)
        .map(item => ({ ...item, taskId: task.id, title: task.title }))))
    })).then(records => {
      if (!active) return
      setHistoryByDate(current => ({
        ...current,
        ...Object.fromEntries(dates.map((date, index) => [date, records[index]])),
      }))
      setHistoryErrors(current => {
        const next = { ...current }
        dates.forEach(date => delete next[date])
        return next
      })
    }).catch(error => {
      if (!active) return
      setHistoryErrors(current => {
        const next = { ...current }
        dates.forEach(date => {
          next[date] = `Task history could not be loaded: ${error.message}`
        })
        return next
      })
    })
    return () => { active = false }
  }, [compareDate, selectedDate, tasks])

  function moveDate(amount) {
    setSelectedDate(dateKey(addDays(parseDateKey(selectedDate), amount)))
  }

  const currentActivities = timelineActivities(
    selectedDate,
    tasks,
    events,
    notes,
    historyByDate[selectedDate] || [],
    reminders,
  )
  const formattedDate = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parseDateKey(selectedDate))
  const query = search.trim().toLowerCase()
  const visibleActivities = currentActivities.filter(activity => {
    if (typeFilter !== 'all' && activity.kind !== typeFilter) return false
    if (statusFilter !== 'all' && activity.status !== statusFilter) return false
    if (!query) return true
    return `${activity.title} ${activity.kind} ${activity.status} ${activity.detail} ${activity.notes || ''} ${formattedDate}`
      .toLowerCase().includes(query)
  })
  const compareActivities = compareDate
    ? timelineActivities(compareDate, tasks, events, notes, historyByDate[compareDate] || [], reminders)
    : []
  const selectedSummary = getTimelineSummary(currentActivities)
  const compareSummary = getTimelineSummary(compareActivities)
  const historyLoading = (
    !Object.prototype.hasOwnProperty.call(historyByDate, selectedDate) && !historyErrors[selectedDate]
  ) || Boolean(compareDate && !Object.prototype.hasOwnProperty.call(historyByDate, compareDate) && !historyErrors[compareDate])
  const historyError = historyErrors[selectedDate] || (compareDate && historyErrors[compareDate])
  const compareDifference = selectedSummary.completed - compareSummary.completed
  const comparisonMessage = compareDate === selectedDate
    ? 'Choose a different date to compare.'
    : compareDifference === 0
      ? 'Both days had the same number of completed tasks.'
      : `${Math.abs(compareDifference)} more task${Math.abs(compareDifference) === 1 ? '' : 's'} completed on ${compareDifference > 0 ? formattedDate : new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(parseDateKey(compareDate))}.`

  return (
    <>
      <section className="page-title-row timeline-title-row">
        <div>
          <p className="eyebrow">YOUR DAY, IN ONE PLACE</p>
          <h1>Daily timeline<span>.</span></h1>
          <p className="welcome-subtitle">A living record of what you planned, did, and changed.</p>
        </div>
        <div className="timeline-date-picker">
          <button type="button" className="calendar-arrow" aria-label="Previous day" onClick={() => moveDate(-1)}>‹</button>
          <input aria-label="Timeline date" type="date" value={selectedDate} onChange={event => { if (event.target.value) setSelectedDate(event.target.value) }} />
          <button type="button" className="calendar-arrow" aria-label="Next day" onClick={() => moveDate(1)}>›</button>
          <button type="button" className="calendar-today" onClick={() => setSelectedDate(dateKey(new Date()))}>Today</button>
        </div>
      </section>

      <TimelineSummary activities={currentActivities} label={formattedDate} />

      <section className="timeline-controls surface-card">
        <label><Icon name="search" size={17} /><input aria-label="Search timeline" placeholder="Search this day’s activities..." value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="timeline-select-label"><span>Type</span><select aria-label="Filter timeline by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
          <option value="all">All activity</option><option value="task">Tasks</option><option value="event">Events</option><option value="reminder">Reminders</option><option value="note">Notes</option><option value="activity">Schedule changes</option>
        </select></label>
        <label className="timeline-select-label"><span>Status</span><select aria-label="Filter timeline by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="all">Any status</option><option value="scheduled">Scheduled</option><option value="triggered">Triggered</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="postponed">Postponed</option><option value="changed">Changed</option><option value="created">Created</option>
        </select></label>
        <button type="button" className="calendar-today timeline-compare-toggle" onClick={() => setCompareDate(value => value || dateKey(addDays(parseDateKey(selectedDate), -1)))}>{compareDate ? 'Comparing days' : 'Compare days'}</button>
      </section>

      {compareDate && (
        <section className="timeline-compare-panel">
          <label className="timeline-select-label"><span>Compare with</span><input aria-label="Compare date" type="date" value={compareDate} onChange={event => { if (event.target.value) setCompareDate(event.target.value) }} /></label>
          <TimelineSummary activities={compareActivities} label={new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(parseDateKey(compareDate))} />
          <p>{comparisonMessage}</p>
          <button type="button" className="timeline-clear-compare" onClick={() => setCompareDate('')}>Close comparison</button>
        </section>
      )}

      {historyError && <div className="task-storage-error" role="alert">{historyError}</div>}
      <section className="timeline-list-card surface-card">
        <div className="timeline-list-heading">
          <div><p className="eyebrow">THE DAY, IN ORDER</p><h2>{formattedDate}</h2></div>
          <span>{historyLoading ? 'Loading activity…' : `${visibleActivities.length} ${visibleActivities.length === 1 ? 'activity' : 'activities'}`}</span>
        </div>
        {visibleActivities.length ? (
          <div className="daily-timeline">
            {visibleActivities.map(activity => <TimelineEntry key={activity.id} activity={activity} />)}
          </div>
        ) : (
          <div className="timeline-empty"><span className="coming-soon-icon"><Icon name="clock" size={21} /></span><strong>No matching activity</strong><span>Try another date or clear the current filters.</span></div>
        )}
        <p className="timeline-sources">Timeline combines tasks, reminders, events, notes, and task schedule history. Alarms, focus sessions, and journal entries will appear when those modules are available.</p>
      </section>
    </>
  )
}

function TimelineEntry({ activity }) {
  const icon = {
    task: 'check',
    event: 'calendar',
    reminder: 'bell',
    note: 'note',
    activity: 'arrow',
  }[activity.kind] || 'spark'
  return (
    <article className={`timeline-entry timeline-entry-${activity.kind}`}>
      <time className="timeline-entry-time">{activity.time || 'Any time'}</time>
      <span className="timeline-entry-icon"><Icon name={icon} size={16} /></span>
      <div className="timeline-entry-copy">
        <div className="timeline-entry-heading"><strong>{activity.title}</strong><span className={`timeline-status timeline-status-${activity.status}`}>{activity.status}</span></div>
        {activity.detail && <p>{activity.detail}</p>}
        {activity.notes && <p className="timeline-entry-note">{activity.notes}</p>}
      </div>
    </article>
  )
}

function CalendarPage({ events, tasks, onSaveEvent, onDeleteEvent, onMoveItem, onToggleTask }) {
  const [viewType, setViewType] = useState('Month')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()))
  const [todayKey] = useState(() => dateKey(new Date()))
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draggedItem, setDraggedItem] = useState(null)
  const [eventDraft, setEventDraft] = useState({})

  function openEventForm(date = selectedDate, event = null) {
    setEditingId(event?.id ?? null)
    setEventDraft(event ? { ...event } : {
      title: '',
      date,
      startTime: '09:00',
      endTime: '10:00',
      category: 'Personal',
      repeat: 'none',
      notes: '',
    })
    setFormOpen(true)
  }

  function submitEvent(event) {
    event.preventDefault()
    if (eventDraft.endTime <= eventDraft.startTime) return
    onSaveEvent({
      ...eventDraft,
      id: editingId ?? createId(),
      title: eventDraft.title.trim(),
    })
    setFormOpen(false)
  }

  function changeDate(direction) {
    const next = new Date(currentDate)
    if (viewType === 'Week') next.setDate(next.getDate() + direction * 7)
    else if (viewType === 'Day') next.setDate(next.getDate() + direction)
    else if (viewType === 'Agenda') next.setDate(next.getDate() + direction * 30)
    else next.setMonth(next.getMonth() + direction, 1)
    setCurrentDate(next)
    setSelectedDate(dateKey(next))
  }

  function chooseView(nextView) {
    setViewType(nextView)
    setSelectedDate(dateKey(currentDate))
  }

  function moveItemToDate(date) {
    if (draggedItem) onMoveItem(draggedItem, date)
    setDraggedItem(null)
  }

  let visibleDates
  if (viewType === 'Month') {
    const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const gridStart = startOfWeek(firstOfMonth)
    visibleDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  } else if (viewType === 'Week') {
    const weekStart = startOfWeek(currentDate)
    visibleDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  } else if (viewType === 'Agenda') {
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    visibleDates = Array.from(
      { length: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate() },
      (_, index) => addDays(monthStart, index),
    )
  } else {
    visibleDates = [currentDate]
  }

  function itemsForDate(date) {
    const key = dateKey(date)
    const eventItems = events.filter(event => eventOccursOnDate(event, key))
      .map(event => ({ ...event, type: 'event', occurrenceDate: key }))
    const taskItems = tasks.flatMap(task => {
      const scheduled = task.startDate === key
      const due = task.dueDate === key
      if (!scheduled && !due) return []
      return [{
        ...task,
        type: 'task',
        calendarKind: scheduled ? 'scheduled' : 'due',
        occurrenceDate: key,
        startTime: scheduled ? (task.startTime || '09:00') : '23:59',
        endTime: scheduled
          ? minutesToTime(timeToMinutes(task.startTime || '09:00') + Number(task.estimatedMinutes || 60))
          : '',
      }]
    })
    return [...eventItems, ...taskItems].sort((a, b) => (
      (a.startTime || '00:00').localeCompare(b.startTime || '00:00')
    ))
  }

  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(currentDate)
  const rangeLabel = viewType === 'Week'
    ? `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(visibleDates[0])} – ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(visibleDates[6])}`
    : viewType === 'Day'
      ? new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(currentDate)
      : viewType === 'Agenda'
        ? monthLabel
        : monthLabel
  const viewDates = viewType === 'Month' ? visibleDates : visibleDates

  function renderItems(date, compact = false) {
    const items = itemsForDate(date)
    const timedEvents = items.filter(item => item.startTime && item.endTime)
    const conflicts = new Set()
    timedEvents.forEach((item, index) => {
      timedEvents.slice(index + 1).forEach(other => {
        if (item.startTime < other.endTime && other.startTime < item.endTime) {
          conflicts.add(item.id)
          conflicts.add(other.id)
        }
      })
    })
    const visibleItems = compact ? items.slice(0, 3) : items
    return (
      <>
        {conflicts.size > 0 && <span className="calendar-conflict" title="Events overlap">Overlap</span>}
        {visibleItems.map(item => (
          <CalendarItem
            key={`${item.type}-${item.id}-${item.occurrenceDate}`}
            item={item}
            compact={compact}
            conflicted={conflicts.has(item.id)}
            onOpenEvent={() => openEventForm(item.occurrenceDate, events.find(event => event.id === item.id))}
            onToggleTask={onToggleTask}
            onDragStart={() => setDraggedItem(item)}
          />
        ))}
        {compact && items.length > 3 && <span className="calendar-more">+{items.length - 3} more</span>}
      </>
    )
  }

  return (
    <>
      <section className="page-title-row calendar-title-row">
        <div>
          <p className="eyebrow">YOUR TIME, IN ONE PLACE</p>
          <h1>Your calendar<span>.</span></h1>
          <p className="welcome-subtitle">Events and task due dates, together.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => openEventForm()}><Icon name="plus" size={16} /> New event</button>
      </section>

      <section className="surface-card calendar-card">
        <div className="calendar-toolbar">
          <div className="calendar-navigation">
            <button type="button" className="calendar-arrow" aria-label="Previous date range" onClick={() => changeDate(-1)}>‹</button>
            <button type="button" className="calendar-arrow" aria-label="Next date range" onClick={() => changeDate(1)}>›</button>
            <button type="button" className="calendar-today" onClick={() => {
              const today = new Date()
              setCurrentDate(today)
              setSelectedDate(dateKey(today))
            }}>Today</button>
            <h2>{rangeLabel}</h2>
          </div>
          <div className="calendar-view-tabs" role="group" aria-label="Calendar view">
            {['Month', 'Week', 'Day', 'Agenda'].map(view => (
              <button type="button" key={view} className={viewType === view ? 'calendar-view-active' : ''} onClick={() => chooseView(view)}>{view}</button>
            ))}
          </div>
        </div>

        {formOpen && (
          <form className="calendar-event-form" onSubmit={submitEvent}>
            <div className="event-form-heading">
              <h3>{editingId ? 'Edit event' : 'New event'}</h3>
              <button type="button" className="icon-button" aria-label="Close event form" onClick={() => setFormOpen(false)}>×</button>
            </div>
            <label className="event-field event-title-field">
              <span>Title</span>
              <input autoFocus required maxLength={100} value={eventDraft.title || ''} onChange={event => setEventDraft(current => ({ ...current, title: event.target.value }))} placeholder="What’s happening?" />
            </label>
            <div className="event-form-fields">
              <label className="event-field"><span>Date</span><input type="date" required value={eventDraft.date || ''} onChange={event => setEventDraft(current => ({ ...current, date: event.target.value }))} /></label>
              <label className="event-field"><span>Starts</span><input type="time" required value={eventDraft.startTime || ''} onChange={event => setEventDraft(current => ({ ...current, startTime: event.target.value }))} /></label>
              <label className="event-field"><span>Ends</span><input type="time" required value={eventDraft.endTime || ''} onChange={event => setEventDraft(current => ({ ...current, endTime: event.target.value }))} /></label>
              <label className="event-field"><span>Category</span><select value={eventDraft.category || 'Personal'} onChange={event => setEventDraft(current => ({ ...current, category: event.target.value }))}>{eventCategories.map(category => <option key={category.name}>{category.name}</option>)}</select></label>
              <label className="event-field"><span>Repeat</span><select value={eventDraft.repeat || 'none'} onChange={event => setEventDraft(current => ({ ...current, repeat: event.target.value }))}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
            </div>
            {eventDraft.endTime && eventDraft.startTime && eventDraft.endTime <= eventDraft.startTime && <p className="event-form-error">End time must be after start time.</p>}
            <label className="event-field event-notes-field"><span>Notes</span><textarea rows="2" maxLength={1000} value={eventDraft.notes || ''} onChange={event => setEventDraft(current => ({ ...current, notes: event.target.value }))} placeholder="Add a note to this event" /></label>
            <div className="event-form-actions">
              {editingId && <button type="button" className="event-delete-button" onClick={() => { onDeleteEvent(editingId); setFormOpen(false) }}>Delete event</button>}
              <button type="button" className="calendar-today" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={!eventDraft.title?.trim() || eventDraft.endTime <= eventDraft.startTime}>Save event</button>
            </div>
          </form>
        )}

        {viewType === 'Month' ? (
          <div className="calendar-month">
            <div className="calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>
            <div className="calendar-month-grid">
              {viewDates.map(date => {
                const key = dateKey(date)
                return (
                  <div
                    key={key}
                    className={`calendar-month-day ${date.getMonth() !== currentDate.getMonth() ? 'calendar-outside-month' : ''} ${key === todayKey ? 'calendar-today-cell' : ''} ${selectedDate === key ? 'calendar-selected-cell' : ''}`}
                    onDragOver={event => event.preventDefault()}
                    onDrop={() => moveItemToDate(key)}
                    onClick={() => setSelectedDate(key)}
                  >
                    <button type="button" className="calendar-day-number" onClick={event => { event.stopPropagation(); setSelectedDate(key) }}>{date.getDate()}</button>
                    <div className="calendar-day-items">{renderItems(date, true)}</div>
                    <button type="button" className="calendar-add-day" aria-label={`Add event on ${key}`} onClick={event => { event.stopPropagation(); setSelectedDate(key); openEventForm(key) }}>+</button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className={`calendar-list-view calendar-list-${viewType.toLowerCase()}`}>
            {visibleDates.map(date => {
              const key = dateKey(date)
              const dateItems = itemsForDate(date)
              return (
                <section key={key} className={`calendar-list-day ${key === todayKey ? 'calendar-list-today' : ''}`} onDragOver={event => event.preventDefault()} onDrop={() => moveItemToDate(key)}>
                  <div className="calendar-list-date">
                    <span>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)}</span>
                    <strong>{date.getDate()}</strong>
                    <small>{new Intl.DateTimeFormat('en', { month: 'short' }).format(date)}</small>
                  </div>
                  <div className="calendar-list-items">
                    {dateItems.length ? renderItems(date) : <span className="calendar-no-events">Nothing scheduled</span>}
                    <button type="button" className="calendar-add-list-event" onClick={() => { setSelectedDate(key); openEventForm(key) }}>+ Add event</button>
                  </div>
                </section>
              )
            })}
          </div>
        )}

        <div className="calendar-legend">
          {eventCategories.map(category => <span key={category.name}><i style={{ backgroundColor: category.color }} />{category.name}</span>)}
          <span><i className="task-legend-dot" />Task due</span>
        </div>
      </section>
    </>
  )
}

function CalendarItem({ item, compact, conflicted, onOpenEvent, onToggleTask, onDragStart }) {
  if (item.type === 'task') {
    return (
      <div className={`calendar-item calendar-task-item ${item.calendarKind === 'scheduled' ? 'calendar-task-scheduled' : ''} ${item.done ? 'calendar-item-done' : ''}`} draggable onDragStart={onDragStart} title={`${item.calendarKind === 'scheduled' ? 'Scheduled' : 'Due'} ${item.occurrenceDate}: ${item.title}`}>
        <button type="button" className="calendar-task-check" aria-label={item.done ? `Mark ${item.title} as not done` : `Complete ${item.title}`} onClick={() => onToggleTask(item.id)}>{item.done ? '✓' : ''}</button>
        <span className="calendar-item-title">{item.title}</span>
        {!compact && <><span className="calendar-event-time">{formatTime(item.startTime)}</span><small>{item.calendarKind === 'scheduled' ? 'Scheduled' : 'Due'}</small></>}
      </div>
    )
  }
  const category = eventCategories.find(option => option.name === item.category) || eventCategories[0]
  return (
    <div
      className={`calendar-item calendar-event-item ${conflicted ? 'calendar-item-conflict' : ''}`}
      draggable
      onDragStart={onDragStart}
      style={{ '--event-color': category.color }}
      title={`${item.title}${item.notes ? ` — ${item.notes}` : ''}${item.repeat !== 'none' ? ` · Repeats ${item.repeat}` : ''}`}
    >
      <button type="button" className="calendar-event-open" onClick={onOpenEvent}>
        {!compact && <span className="calendar-event-time">{formatTime(item.startTime)}</span>}
        <span className="calendar-item-title">{item.title}</span>
        {item.repeat !== 'none' && <span className="calendar-repeat-mark" aria-label={`Repeats ${item.repeat}`}>↻</span>}
      </button>
    </div>
  )
}

function NotesPage({ notes, selectedNote, noteSearch, setNoteSearch, setSelectedNoteId, onCreateNote, onUpdateNote, onDeleteNote }) {
  return (
    <>
      <section className="page-title-row notes-title-row">
        <div><p className="eyebrow">YOUR THOUGHTS, KEPT CLOSE</p><h1>A place for notes<span>.</span></h1><p className="welcome-subtitle">Catch an idea before it wanders off.</p></div>
        <button type="button" className="primary-button create-note-button" onClick={onCreateNote}><Icon name="plus" size={17} /> New note</button>
      </section>
      <section className="notes-workspace">
        <aside className="notes-list surface-card">
          <div className="notes-list-header"><h2>All notes <span>{notes.length}</span></h2></div>
          <label className="search-field"><Icon name="search" size={17} /><input aria-label="Search notes" placeholder="Search notes..." value={noteSearch} onChange={event => setNoteSearch(event.target.value)} /></label>
          <div className="notes-list-items">
            {notes.map(note => (
              <button type="button" key={note.id} className={`note-list-item ${selectedNote?.id === note.id ? 'note-list-selected' : ''}`} onClick={() => setSelectedNoteId(note.id)}>
                <strong>{note.title || 'Untitled note'}</strong>
                <span>{note.body || 'No additional text'}</span>
                <small>{formatDate(note.updatedAt)}</small>
              </button>
            ))}
            {!notes.length && <div className="notes-empty-list">No notes match your search.</div>}
          </div>
        </aside>
        <article className="note-editor surface-card">
          {selectedNote ? (
            <>
              <div className="editor-toolbar"><span><span className="status-dot" /> Saved locally</span><button type="button" aria-label="Delete note" className="icon-button delete-note-button" onClick={() => onDeleteNote(selectedNote.id)}><Icon name="trash" size={17} /></button></div>
              <input className="note-title-input" aria-label="Note title" value={selectedNote.title} onChange={event => onUpdateNote('title', event.target.value)} placeholder="Untitled note" />
              <div className="editor-date">Last edited {formatDate(selectedNote.updatedAt)}</div>
              <textarea className="note-body-input" aria-label="Note content" value={selectedNote.body} onChange={event => onUpdateNote('body', event.target.value)} placeholder="Start writing here..." />
              <div className="editor-footer">Your notes are saved automatically on this device.</div>
            </>
          ) : (
            <div className="empty-state note-empty-state"><span className="empty-state-icon empty-note"><Icon name="note" size={22} /></span><h3>{noteSearch ? 'No notes found' : 'Your page is blank'}</h3><p>{noteSearch ? 'Try another search, or clear the search field.' : 'Create a note to collect your thoughts and ideas.'}</p>{!noteSearch && <button type="button" className="primary-button" onClick={onCreateNote}><Icon name="plus" size={16} /> Create a note</button>}</div>
          )}
        </article>
      </section>
    </>
  )
}

function RemindersPage({ tasks, events, reminders, onSave, onComplete, onSnooze, onDelete }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingReminder, setEditingReminder] = useState(null)
  const [eventId, setEventId] = useState('')
  const [filter, setFilter] = useState('Upcoming')
  const [contextMessage, setContextMessage] = useState('')

  const filteredReminders = reminders.filter(reminder => (
    filter === 'All'
      || (filter === 'Upcoming' && reminder.status !== 'completed')
      || (filter === 'Completed' && reminder.status === 'completed')
  )).sort((left, right) => (
    (Date.parse(left.nextAt || left.scheduledAt) || Infinity)
    - (Date.parse(right.nextAt || right.scheduledAt) || Infinity)
  ))

  function openForm(reminder = null) {
    setEditingReminder(reminder)
    setFormOpen(true)
  }

  function addContextualSet() {
    const event = events.find(item => item.id === eventId)
    if (!event) {
      setContextMessage('Choose an event before creating preparation reminders.')
      return
    }
    const rules = [
      { key: 'previous-evening', label: 'Previous evening prep' },
      { key: 'one-hour', label: 'Event in one hour' },
      { key: 'fifteen-minutes', label: 'Event in fifteen minutes' },
    ]
    const created = rules.map(rule => {
      const scheduledAt = eventContextReminderAt(event, rule.key)
      if (!scheduledAt || Date.parse(scheduledAt) <= Date.now()) return null
      return {
        id: createId(),
        title: `${event.title} · ${rule.label}`,
        description: `Upcoming event: ${event.title}`,
        sourceType: 'event',
        sourceId: event.id,
        sourceTitle: event.title,
        scheduledAt,
        nextAt: scheduledAt,
        nextKind: 'schedule',
        repeat: 'none',
        priority: 'High',
        sound: 'system',
        escalationMinutes: 0,
        escalationCount: 0,
        maxEscalations: 3,
        status: 'active',
        createdAt: new Date().toISOString(),
        scheduleRevisionAt: new Date().toISOString(),
        contextRule: rule.key,
      }
    }).filter(Boolean)

    if (!created.length) {
      setContextMessage('This event has no preparation reminders left in the future.')
      return
    }
    created.forEach(onSave)
    setContextMessage(`${created.length} contextual reminder${created.length === 1 ? '' : 's'} added for ${event.title}.`)
  }

  function sourceName(reminder) {
    if (reminder.sourceType === 'task') {
      return tasks.find(task => task.id === reminder.sourceId)?.title || reminder.sourceTitle || 'Task no longer available'
    }
    if (reminder.sourceType === 'event') {
      return events.find(event => event.id === reminder.sourceId)?.title || reminder.sourceTitle || 'Event no longer available'
    }
    return ''
  }

  return (
    <>
      <section className="page-title-row reminders-title-row">
        <div><p className="eyebrow">KEEP THE IMPORTANT THINGS CLOSE</p><h1>Smart reminders<span>.</span></h1><p className="welcome-subtitle">A gentle nudge, connected to the things already on your schedule.</p></div>
        <button type="button" className="primary-button" onClick={() => openForm()}><Icon name="plus" size={16} /> New reminder</button>
      </section>

      <section className="surface-card contextual-reminder-card">
        <div>
          <p className="eyebrow">CONTEXTUAL PREPARATION</p>
          <h2>Get ready for an event.</h2>
          <p>Add a reminder the evening before, one hour before, and fifteen minutes before an event.</p>
        </div>
        <div className="contextual-reminder-actions">
          <label className="task-form-field"><span>Choose an event</span><select aria-label="Event for contextual reminders" value={eventId} onChange={event => { setEventId(event.target.value); setContextMessage('') }}><option value="">Select an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {formatDate(parseDateKey(event.date))}</option>)}</select></label>
          <button type="button" className="calendar-today" onClick={addContextualSet} disabled={!eventId}>Create preparation set</button>
        </div>
        {contextMessage && <p className="contextual-reminder-message" role="status">{contextMessage}</p>}
      </section>

      <section className="surface-card reminder-list-card">
        <div className="reminder-list-heading">
          <div><h2>Your reminders</h2><span>{filteredReminders.length} {filteredReminders.length === 1 ? 'reminder' : 'reminders'}</span></div>
          <div className="filter-tabs" role="group" aria-label="Filter reminders">
            {['Upcoming', 'All', 'Completed'].map(option => <button type="button" key={option} className={filter === option ? 'filter-active' : ''} onClick={() => setFilter(option)}>{option}</button>)}
          </div>
        </div>
        {filteredReminders.length ? (
          <div className="reminder-list">
            {filteredReminders.map(reminder => {
              const when = reminder.status === 'active'
                ? reminder.nextAt
                : reminder.completedAt || reminder.scheduledAt
              const linkedSource = sourceName(reminder)
              return (
                <article className={`reminder-card reminder-card-${reminder.status}`} key={reminder.id}>
                  <div className="reminder-card-content">
                    <span className={`reminder-priority reminder-priority-${(reminder.priority || 'Medium').toLowerCase()}`}>{reminder.priority || 'Medium'}</span>
                    <div className="reminder-card-copy">
                      <div className="reminder-card-title"><strong>{reminder.title}</strong><span className={`reminder-status reminder-status-${reminder.status}`}>{reminder.status}</span></div>
                      <p>{when ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(when)) : 'No further alerts scheduled'}</p>
                      {linkedSource && <span className="reminder-linked-source">Linked {reminder.sourceType}: {linkedSource}</span>}
                      {reminder.repeat !== 'none' && <span className="reminder-linked-source">Repeats {reminder.repeat}</span>}
                      {reminder.escalationMinutes > 0 && <span className="reminder-linked-source">Escalates every {reminder.escalationMinutes} min · up to {reminder.maxEscalations} times</span>}
                      {reminder.pausedReason && <span className="reminder-paused-reason">{reminder.pausedReason}</span>}
                      {reminder.description && <span className="reminder-linked-source">{reminder.description}</span>}
                    </div>
                  </div>
                  <div className="reminder-card-actions">
                    {reminder.status === 'active' && <>
                      <button type="button" className="calendar-today" onClick={() => onSnooze(reminder.id, 10)}>Snooze 10 min</button>
                      <button type="button" className="calendar-today" onClick={() => onSnooze(reminder.id, 60)}>Snooze 1 hour</button>
                      <button type="button" className="calendar-today" onClick={() => onComplete(reminder.id)}>{reminder.repeat === 'none' ? 'Mark complete' : 'Done for now'}</button>
                    </>}
                    <button type="button" className="icon-button" aria-label={`Edit ${reminder.title}`} onClick={() => openForm(reminder)}><Icon name="edit" size={16} /></button>
                    <button type="button" className="row-delete" aria-label={`Delete ${reminder.title}`} onClick={() => onDelete(reminder.id)}><Icon name="trash" size={16} /></button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="empty-state"><span className="empty-state-icon"><Icon name="bell" size={22} /></span><h3>No reminders here</h3><p>Create a reminder or connect one to an existing task or event.</p><button type="button" className="primary-button" onClick={() => openForm()}><Icon name="plus" size={16} /> New reminder</button></div>
        )}
      </section>

      {formOpen && <ReminderEditor
        reminder={editingReminder}
        tasks={tasks}
        events={events}
        onClose={() => setFormOpen(false)}
        onSave={draft => {
          if (onSave(draft)) setFormOpen(false)
        }}
      />}
    </>
  )
}

function ReminderEditor({ reminder, tasks, events, onClose, onSave }) {
  const [draft, setDraft] = useState(() => ({
    id: reminder?.id,
    title: reminder?.title || '',
    description: reminder?.description || '',
    sourceType: reminder?.sourceType || 'none',
    sourceId: reminder?.sourceId || '',
    scheduledAt: localDateTimeValue(
      reminder?.nextAt || (Date.parse(reminder?.scheduledAt) > Date.now() ? reminder.scheduledAt : ''),
    ),
    repeat: reminder?.repeat || 'none',
    priority: reminder?.priority || 'Medium',
    sound: reminder?.sound || 'system',
    escalationMinutes: reminder?.escalationMinutes || 0,
    maxEscalations: reminder?.maxEscalations || 3,
    legacyKey: reminder?.legacyKey || '',
  }))
  const [error, setError] = useState('')
  const sourceValue = draft.sourceType === 'none' ? '' : `${draft.sourceType}:${draft.sourceId}`

  function update(field, value) {
    setDraft(current => ({ ...current, [field]: value }))
  }

  function submit(event) {
    event.preventDefault()
    const scheduledAt = new Date(draft.scheduledAt)
    if (!draft.title.trim()) {
      setError('Enter a title for this reminder.')
      return
    }
    if (!Number.isFinite(scheduledAt.getTime())) {
      setError('Choose a valid date and time.')
      return
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError('Choose a date and time in the future.')
      return
    }
    if (draft.repeat !== 'none' && Number(draft.escalationMinutes)) {
      setError('Escalation is available for one-time reminders. Choose no repeat or turn escalation off.')
      return
    }
    const [sourceType = 'none', sourceId = ''] = (sourceValue || 'none:').split(':')
    onSave({
      ...draft,
      id: draft.id || createId(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      sourceType,
      sourceId,
      scheduledAt: scheduledAt.toISOString(),
      escalationMinutes: Number(draft.escalationMinutes),
      contextRule: '',
    })
  }

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="task-editor-modal reminder-editor-modal" onSubmit={submit}>
        <div className="task-editor-heading">
          <div><p className="eyebrow">REMINDER DETAILS</p><h2>{reminder ? 'Edit reminder' : 'Create a reminder'}</h2></div>
          <button type="button" className="icon-button" aria-label="Close reminder form" onClick={onClose}>×</button>
        </div>
        <div className="task-form-grid">
          <label className="task-form-field task-form-title"><span>Reminder title</span><input autoFocus required maxLength={180} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="What should you remember?" /></label>
          <label className="task-form-field"><span>Date and time</span><input required type="datetime-local" value={draft.scheduledAt} onChange={event => update('scheduledAt', event.target.value)} /></label>
          <label className="task-form-field"><span>Link to task or event</span><select value={sourceValue} onChange={event => {
            const [sourceType = 'none', sourceId = ''] = (event.target.value || 'none:').split(':')
            const source = sourceType === 'task' ? tasks.find(item => item.id === sourceId) : events.find(item => item.id === sourceId)
            setDraft(current => ({ ...current, sourceType, sourceId, title: current.title || source?.title || '' }))
          }}><option value="">Not linked</option><optgroup label="Tasks">{tasks.map(task => <option key={task.id} value={`task:${task.id}`}>{task.title}</option>)}</optgroup><optgroup label="Events">{events.map(event => <option key={event.id} value={`event:${event.id}`}>{event.title} · {formatDate(parseDateKey(event.date))}</option>)}</optgroup></select></label>
          <label className="task-form-field"><span>Repeat</span><select value={draft.repeat} onChange={event => update('repeat', event.target.value)}>{reminderRepeats.map(repeat => <option key={repeat} value={repeat}>{repeat === 'none' ? 'One time' : repeat[0].toUpperCase() + repeat.slice(1)}</option>)}</select></label>
          <label className="task-form-field"><span>Priority</span><select value={draft.priority} onChange={event => update('priority', event.target.value)}>{taskPriorities.map(priority => <option key={priority}>{priority}</option>)}</select></label>
          <label className="task-form-field"><span>Notification sound</span><select value={draft.sound} onChange={event => update('sound', event.target.value)}><option value="system">System default</option><option value="gentle">Gentle tone</option><option value="chime">Chime</option><option value="silent">Silent</option></select></label>
          <label className="task-form-field"><span>Escalate if incomplete</span><select value={draft.escalationMinutes} disabled={draft.repeat !== 'none'} onChange={event => update('escalationMinutes', Number(event.target.value))}><option value={0}>No escalation</option><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option></select></label>
          <label className="task-form-field"><span>Reminder note</span><input maxLength={240} value={draft.description} onChange={event => update('description', event.target.value)} placeholder="Optional detail" /></label>
        </div>
        <p className="reminder-editor-hint">Snooze or complete this reminder from your reminder list. One-time reminders can escalate up to three times.</p>
        {error && <p className="task-form-error" role="alert">{error}</p>}
        <div className="task-editor-actions"><button type="button" className="calendar-today" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">{reminder ? 'Save changes' : 'Create reminder'}</button></div>
      </form>
    </div>
  )
}

function ComingSoonPage({ title }) {
  return (
    <section className="coming-soon surface-card">
      <span className="coming-soon-icon"><Icon name="spark" size={24} /></span>
      <p className="eyebrow">A LITTLE MORE SPACE TO GROW</p>
      <h1>{title}<span>.</span></h1>
      <p>This part of your workspace is coming soon. Your tasks and notes are ready to use today.</p>
    </section>
  )
}

export default App
