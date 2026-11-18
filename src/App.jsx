import { useEffect, useMemo, useState } from 'react'
import './App.css'

const initialTasks = [
  { id: 'task-1', title: 'Review weekly priorities', done: false },
  { id: 'task-2', title: 'Send the project proposal', done: false },
  { id: 'task-3', title: 'Set up your MyDesk workspace', done: true },
]

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

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function App() {
  const [storedContent] = useState(() => ({
    tasks: readStorage('mydesk-tasks', initialTasks),
    notes: readStorage('mydesk-notes', initialNotes),
  }))
  const [tasks, setTasks] = useState(storedContent.tasks)
  const [notes, setNotes] = useState(storedContent.notes)
  const [activeView, setActiveView] = useState('Dashboard')
  const [taskFilter, setTaskFilter] = useState('All')
  const [taskDraft, setTaskDraft] = useState('')
  const [noteSearch, setNoteSearch] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState(storedContent.notes[0]?.id ?? null)

  useEffect(() => {
    localStorage.setItem('mydesk-tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    localStorage.setItem('mydesk-notes', JSON.stringify(notes))
  }, [notes])

  const completedTasks = tasks.filter(task => task.done).length
  const activeTasks = tasks.length - completedTasks
  const selectedNote = notes.find(note => note.id === selectedNoteId)
  const filteredTasks = useMemo(() => tasks.filter(task => {
    if (taskFilter === 'Active') return !task.done
    if (taskFilter === 'Completed') return task.done
    return true
  }), [taskFilter, tasks])
  const filteredNotes = useMemo(() => notes.filter(note => (
    `${note.title} ${note.body}`.toLowerCase().includes(noteSearch.toLowerCase())
  )), [noteSearch, notes])

  function addTask(event) {
    event.preventDefault()
    const title = taskDraft.trim()
    if (!title) return
    setTasks(current => [{ id: createId(), title, done: false }, ...current])
    setTaskDraft('')
  }

  function toggleTask(id) {
    setTasks(current => current.map(task => (
      task.id === id ? { ...task, done: !task.done } : task
    )))
  }

  function deleteTask(id) {
    setTasks(current => current.filter(task => task.id !== id))
  }

  function createNote() {
    const note = {
      id: createId(),
      title: 'Untitled note',
      body: '',
      updatedAt: new Date().toISOString(),
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
              taskFilter={taskFilter}
              taskDraft={taskDraft}
              setTaskFilter={setTaskFilter}
              setTaskDraft={setTaskDraft}
              onAddTask={addTask}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
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

          {!['Dashboard', 'Tasks', 'Notes'].includes(activeView) && (
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
      {onDelete && <button type="button" className="row-delete" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}><Icon name="trash" size={16} /></button>}
    </div>
  )
}

function TasksPage({ tasks, taskFilter, taskDraft, setTaskFilter, setTaskDraft, onAddTask, onToggleTask, onDeleteTask }) {
  return (
    <>
      <section className="page-title-row">
        <div><p className="eyebrow">MAKE IT HAPPEN</p><h1>Your tasks<span>.</span></h1><p className="welcome-subtitle">Small steps make big things feel possible.</p></div>
        <div className="title-icon title-icon-peach"><Icon name="check" size={25} /></div>
      </section>
      <form className="task-entry" onSubmit={onAddTask}>
        <span className="entry-plus"><Icon name="plus" size={19} /></span>
        <input aria-label="New task" placeholder="What would you like to get done?" value={taskDraft} onChange={event => setTaskDraft(event.target.value)} />
        <button type="submit" className="primary-button">Add task</button>
      </form>
      <section className="surface-card task-list-card">
        <div className="list-toolbar">
          <div><h2>All tasks</h2><span>{tasks.length} {tasks.length === 1 ? 'item' : 'items'}</span></div>
          <div className="filter-tabs" role="group" aria-label="Filter tasks">
            {['All', 'Active', 'Completed'].map(filter => (
              <button type="button" key={filter} className={taskFilter === filter ? 'filter-active' : ''} onClick={() => setTaskFilter(filter)}>{filter}</button>
            ))}
          </div>
        </div>
        {tasks.length ? (
          <div className="task-list">
            {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={onToggleTask} onDelete={onDeleteTask} />)}
          </div>
        ) : (
          <div className="empty-state"><span className="empty-state-icon"><Icon name="check" size={23} /></span><h3>Nothing on this list</h3><p>Enjoy the breathing room, or add your next task above.</p></div>
        )}
      </section>
    </>
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
