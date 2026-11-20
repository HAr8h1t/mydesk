import { useEffect, useMemo, useRef, useState } from 'react'
import NoteEditor from './NoteEditor.jsx'
import NoteReader from './NoteReader.jsx'
import NotesList from './NotesList.jsx'
import { countWords, isTypingTarget } from './note-utils.js'

export default function NotesView({
  allNotes,
  notes,
  selectedNote: storedSelectedNote,
  quickCaptureNoteId,
  noteSearch,
  setNoteSearch,
  onQuickCaptureEditHandled,
  setSelectedNoteId,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onDuplicateNote,
  tasks,
  events,
  onAddAttachments,
  onRemoveAttachment,
  onOpenAttachment,
  onLoadHistory,
  formatDate,
  Icon,
  saveState,
  saveError,
}) {
  const [filter, setFilter] = useState('All')
  const [editingId, setEditingId] = useState(null)
  const [editorMode, setEditorMode] = useState('write')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [notice, setNotice] = useState(null)
  const bodyRef = useRef(null)
  const menuRef = useRef(null)
  const createAndEditNoteRef = useRef(null)

  const counts = useMemo(() => ({
    All: allNotes.filter(note => !note.archived).length,
    Pinned: allNotes.filter(note => note.pinned && !note.archived).length,
    Archived: allNotes.filter(note => note.archived).length,
  }), [allNotes])

  const visibleNotes = useMemo(() => {
    return notes.filter(note => {
      if (filter === 'Archived') return note.archived
      if (filter === 'Pinned') return note.pinned && !note.archived
      return !note.archived
    }).sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  }, [filter, notes])

  const selectedNote = visibleNotes.some(note => note.id === storedSelectedNote?.id)
    || storedSelectedNote?.id === quickCaptureNoteId
    ? storedSelectedNote
    : null
  const isEditing = selectedNote?.id === editingId || selectedNote?.id === quickCaptureNoteId
  const pinnedNotes = filter === 'All' ? visibleNotes.filter(note => note.pinned) : []
  const regularNotes = filter === 'All' ? visibleNotes.filter(note => !note.pinned) : visibleNotes
  const wordCount = countWords(selectedNote?.body || '')
  const characterCount = (selectedNote?.body || '').length

  useEffect(() => {
    if (isEditing) {
      bodyRef.current?.focus()
    }
  }, [editingId, isEditing, selectedNote?.id])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!moreOpen) return undefined
    const closeOnOutsideClick = event => {
      if (!menuRef.current?.contains(event.target)) setMoreOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

  useEffect(() => {
    const handleShortcut = event => {
      const typing = isTypingTarget(event.target)
      if ((event.ctrlKey && event.key.toLowerCase() === 'n') || (event.altKey && event.key.toLowerCase() === 'n')) {
        event.preventDefault()
        createAndEditNoteRef.current?.()
        return
      }
      if (event.key === 'Escape') {
        if (moreOpen) setMoreOpen(false)
        else if (isEditing) {
          setEditingId(null)
          onQuickCaptureEditHandled()
        }
        else if (noteSearch) {
          setNoteSearch('')
        }
        return
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'e') return
      if (selectedNote && !isEditing) {
        event.preventDefault()
        setEditingId(selectedNote.id)
      }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [isEditing, moreOpen, noteSearch, selectedNote, setNoteSearch])

  function createAndEditNote() {
    const id = onCreateNote()
    onQuickCaptureEditHandled()
    setFilter('All')
    setNoteSearch('')
    setEditingId(id || null)
    setEditorMode('write')
    setDetailsOpen(false)
    setHistoryOpen(false)
    setSelectedNoteId(id || null)
  }
  createAndEditNoteRef.current = createAndEditNote

  function selectNote(id) {
    setEditingId(null)
    onQuickCaptureEditHandled()
    setEditorMode('write')
    setDetailsOpen(false)
    setHistoryOpen(false)
    setMoreOpen(false)
    setSelectedNoteId(id)
  }

  function update(field, value, noteId = selectedNote?.id) {
    if (noteId) onUpdateNote(field, value, noteId)
  }

  function addLink() {
    if (!selectedNote || !linkTarget) return
    const separator = linkTarget.indexOf(':')
    const type = linkTarget.slice(0, separator)
    const targetId = linkTarget.slice(separator + 1)
    const target = type === 'task'
      ? tasks.find(item => item.id === targetId)
      : type === 'event'
        ? events.find(item => item.id === targetId)
        : { title: targetId }
    if (!target || selectedNote.links.some(link => link.type === type && link.targetId === targetId)) return
    update('links', [...selectedNote.links, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      targetId,
      label: target.title,
    }])
    setLinkTarget('')
  }

  function toggleArchive() {
    if (!selectedNote) return
    const noteId = selectedNote.id
    const wasArchived = selectedNote.archived
    update('archived', !wasArchived, noteId)
    setFilter(wasArchived ? 'All' : 'Archived')
    setNotice({
      message: wasArchived ? 'Note restored to All notes.' : 'Note archived.',
      onUndo: () => {
        update('archived', wasArchived, noteId)
        setFilter(wasArchived ? 'Archived' : 'All')
      },
    })
  }

  async function toggleHistory() {
    if (!selectedNote) return
    if (!historyOpen) setHistory(await onLoadHistory(selectedNote.id))
    setHistoryOpen(current => !current)
    setMoreOpen(false)
  }

  async function copyAsMarkdown() {
    if (!selectedNote) return
    try {
      await navigator.clipboard.writeText(`# ${selectedNote.title || 'Untitled note'}\n\n${selectedNote.body}`)
      setNotice({ message: 'Markdown copied to clipboard.' })
    } catch (error) {
      setNotice({ message: `Could not copy Markdown: ${error.message}` })
    }
    setMoreOpen(false)
  }

  function duplicateNote() {
    if (!selectedNote) return
    const id = onDuplicateNote(selectedNote)
    if (id) {
      setFilter('All')
      setNoteSearch('')
      setSelectedNoteId(id)
      setEditingId(id)
      setEditorMode('write')
      onQuickCaptureEditHandled()
      setNotice({ message: 'Note duplicated.' })
    }
    setMoreOpen(false)
  }

  function deleteSelectedNote() {
    if (!selectedNote || !window.confirm(`Delete “${selectedNote.title || 'Untitled note'}”? This cannot be undone.`)) return
    onDeleteNote(selectedNote.id)
    setEditingId(null)
    setMoreOpen(false)
    setNotice({ message: 'Note deleted.' })
  }

  return (
    <div className="notes-page">
      <header className="page-title-row notes-title-row">
        <div>
          <p className="eyebrow">YOUR THOUGHTS, KEPT CLOSE</p>
          <h1>A place for notes<span>.</span></h1>
          <p className="welcome-subtitle">Catch an idea before it wanders off.</p>
        </div>
        <div className="notes-header-actions">
          <div className="notes-view-filters" role="tablist" aria-label="Filter notes">
            {['All', 'Pinned', 'Archived'].map(option => (
              <button
                type="button"
                key={option}
                role="tab"
                aria-selected={filter === option}
                className={filter === option ? 'notes-view-filter-active' : ''}
                onClick={() => setFilter(option)}
              >
                {option}<span>{counts[option]}</span>
              </button>
            ))}
          </div>
          <button type="button" className="primary-button create-note-button" onClick={createAndEditNote} title="New note (Ctrl+N)">
            <Icon name="plus" size={17} /> New note <kbd>Ctrl N</kbd>
          </button>
        </div>
      </header>

      <section className="notes-workspace">
        <NotesList
          visibleNotes={visibleNotes}
          pinnedNotes={pinnedNotes}
          regularNotes={regularNotes}
          filter={filter}
          setFilter={setFilter}
          counts={counts}
          selectedNoteId={selectedNote?.id}
          noteSearch={noteSearch}
          setNoteSearch={setNoteSearch}
          onSelect={selectNote}
          formatDate={formatDate}
          Icon={Icon}
        />

        <article className={`note-editor surface-card ${isEditing ? 'note-editor-editing' : 'note-editor-reading'}`}>
          {selectedNote ? (isEditing ? (
            <NoteEditor
              note={selectedNote}
              editorMode={editorMode}
              setEditorMode={setEditorMode}
              detailsOpen={detailsOpen}
              setDetailsOpen={setDetailsOpen}
              linkTarget={linkTarget}
              setLinkTarget={setLinkTarget}
              tasks={tasks}
              events={events}
              onUpdate={update}
              onAddAttachments={() => onAddAttachments(selectedNote.id)}
              onRemoveAttachment={attachmentId => onRemoveAttachment(selectedNote.id, attachmentId)}
              onOpenAttachment={attachmentId => onOpenAttachment(selectedNote.id, attachmentId)}
              onAddLink={addLink}
              formatDate={formatDate}
              saveState={saveState}
              saveError={saveError}
              wordCount={wordCount}
              characterCount={characterCount}
              bodyRef={bodyRef}
              onDone={() => { setEditingId(null); onQuickCaptureEditHandled() }}
            />
          ) : (
            <NoteReader
              note={selectedNote}
              formatDate={formatDate}
              Icon={Icon}
              saveState={saveState}
              saveError={saveError}
              wordCount={wordCount}
              onEdit={() => setEditingId(selectedNote.id)}
              onPin={() => update('pinned', !selectedNote.pinned)}
              onToggleArchive={toggleArchive}
              moreOpen={moreOpen}
              setMoreOpen={setMoreOpen}
              menuRef={menuRef}
              onToggleHistory={toggleHistory}
              onDuplicate={duplicateNote}
              onCopy={copyAsMarkdown}
              onDelete={deleteSelectedNote}
              historyOpen={historyOpen}
              history={history}
              onAddAttachments={() => onAddAttachments(selectedNote.id)}
              onOpenAttachment={attachmentId => onOpenAttachment(selectedNote.id, attachmentId)}
            />
          )) : (
            <div className="note-empty-canvas">
              <span className="note-empty-glyph"><Icon name="note" size={25} /></span>
              <h2>{noteSearch || filter !== 'All' ? 'Nothing to read just yet' : 'Your page is blank'}</h2>
              <p>{noteSearch || filter !== 'All' ? 'Try another view or clear your search to see more notes.' : 'Create a note to collect your thoughts and ideas.'}</p>
              <button type="button" className="primary-button" onClick={noteSearch || filter !== 'All' ? () => { setFilter('All'); setNoteSearch('') } : createAndEditNote}>
                {noteSearch || filter !== 'All' ? 'Clear filters' : <><Icon name="plus" size={16} /> Create a note</>}
              </button>
            </div>
          )}
        </article>
      </section>

      {notice && (
        <div className="note-toast" role="status">
          <span>{notice.message}</span>
          {notice.onUndo && <button type="button" onClick={() => { notice.onUndo(); setNotice(null) }}>Undo</button>}
          <button type="button" className="note-toast-close" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
    </div>
  )
}
