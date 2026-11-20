import { useRef } from 'react'
import { localDailyDate, noteDate, plainText } from './note-utils.js'

function NoteCard({ note, selected, onSelect, formatDate, Icon }) {
  return (
    <button
      type="button"
      className={`note-list-item ${selected ? 'note-list-selected' : ''}`}
      onClick={() => onSelect(note.id)}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="note-list-title-row">
        <strong>{note.title || 'Untitled note'}</strong>
        {note.pinned && <span className="note-pin-indicator" title="Pinned" aria-label="Pinned"><Icon name="pin" size={12} /></span>}
      </span>
      <span className="note-list-preview">{plainText(note.body) || 'No additional text'}</span>
      <span className="note-list-foot">
        {note.dailyDate && <span className="note-list-date">{localDailyDate(note.dailyDate)}</span>}
        <small>{noteDate(note.updatedAt, formatDate)}</small>
        {(note.attachments?.length > 0 || note.links?.length > 0) && (
          <span className="note-list-indicators">
            {note.attachments?.length > 0 && <span title={`${note.attachments.length} attachment${note.attachments.length === 1 ? '' : 's'}`} aria-label={`${note.attachments.length} attachments`}>↗ {note.attachments.length}</span>}
            {note.links?.length > 0 && <span title={`${note.links.length} linked item${note.links.length === 1 ? '' : 's'}`} aria-label={`${note.links.length} linked items`}>⌁ {note.links.length}</span>}
          </span>
        )}
      </span>
    </button>
  )
}

function NoteSection({ notes, label, selectedNoteId, onSelect, formatDate, Icon }) {
  if (!notes.length) return null
  return (
    <section className="notes-list-section" aria-label={label || 'Notes'}>
      {label && <h3 className="notes-section-label">{label}</h3>}
      {notes.map(note => (
        <NoteCard
          key={note.id}
          note={note}
          selected={selectedNoteId === note.id}
          onSelect={onSelect}
          formatDate={formatDate}
          Icon={Icon}
        />
      ))}
    </section>
  )
}

export default function NotesList({
  visibleNotes,
  pinnedNotes,
  regularNotes,
  filter,
  setFilter,
  counts,
  selectedNoteId,
  noteSearch,
  setNoteSearch,
  onSelect,
  formatDate,
  Icon,
}) {
  const searchRef = useRef(null)

  function renderEmptyList() {
    if (visibleNotes.length) return null
    return (
      <div className="notes-empty-list">
        <span>{noteSearch ? 'No matching notes.' : filter === 'Pinned' ? 'Nothing pinned yet.' : filter === 'Archived' ? 'No archived notes.' : 'Your notes will appear here.'}</span>
        {(noteSearch || filter !== 'All') && <button type="button" onClick={() => { setNoteSearch(''); setFilter('All') }}>Clear filters</button>}
      </div>
    )
  }

  return (
    <aside className="notes-list surface-card" aria-label="Notes list">
      <div className="notes-list-header">
        <h2>Your library</h2>
        <span>{filter === 'Archived' ? counts.Archived : filter === 'Pinned' ? counts.Pinned : counts.All}</span>
      </div>
      <label className="search-field notes-search-field">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          aria-label="Search notes"
          placeholder="Search notes..."
          value={noteSearch}
          onChange={event => setNoteSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              setNoteSearch('')
              event.currentTarget.focus()
            }
          }}
        />
        {noteSearch && <button type="button" aria-label="Clear search" onClick={() => { setNoteSearch(''); searchRef.current?.focus() }}>×</button>}
      </label>
      <div className="notes-list-items">
        {filter === 'All' ? (
          <>
            <NoteSection notes={pinnedNotes} label={pinnedNotes.length ? 'PINNED' : ''} {...{ selectedNoteId, onSelect, formatDate, Icon }} />
            <NoteSection notes={regularNotes} label={pinnedNotes.length ? 'NOTES' : ''} {...{ selectedNoteId, onSelect, formatDate, Icon }} />
          </>
        ) : (
          <NoteSection
            notes={visibleNotes}
            label={filter === 'Pinned' ? 'PINNED' : 'ARCHIVED'}
            selectedNoteId={selectedNoteId}
            onSelect={onSelect}
            formatDate={formatDate}
            Icon={Icon}
          />
        )}
        {renderEmptyList()}
      </div>
    </aside>
  )
}
