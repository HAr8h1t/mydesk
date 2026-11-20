import NoteMarkdown from './NoteMarkdown.jsx'
import NoteMetaBar from './NoteMetaBar.jsx'
import { formatBytes, noteDate, plainText } from './note-utils.js'

export default function NoteReader({
  note,
  formatDate,
  Icon,
  saveState,
  saveError,
  wordCount,
  onEdit,
  onPin,
  onToggleArchive,
  moreOpen,
  setMoreOpen,
  menuRef,
  onToggleHistory,
  onDuplicate,
  onCopy,
  onDelete,
  historyOpen,
  history,
  onAddAttachments,
  onOpenAttachment,
}) {
  return (
    <>
      <div className="note-canvas-toolbar">
        <div className="note-save-status" title={saveError || undefined} role={saveError ? 'alert' : 'status'}>
          <span className={`note-save-indicator note-save-${saveError ? 'error' : saveState}`} />
          {saveError ? 'Save issue' : saveState === 'saving' ? 'Saving…' : 'Saved locally'}
        </div>
        <div className="note-reader-actions">
          <button type="button" className={`note-quiet-action ${note.pinned ? 'note-action-active' : ''}`} onClick={onPin} aria-pressed={note.pinned}>
            <Icon name="pin" size={14} /> {note.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button type="button" className="note-quiet-action" onClick={onToggleArchive}>{note.archived ? 'Restore' : 'Archive'}</button>
          <div className="note-more-wrap" ref={menuRef}>
            <button type="button" className="note-more-button" aria-label="More note actions" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}>•••</button>
            {moreOpen && (
              <div className="note-more-menu" role="menu">
                <button type="button" role="menuitem" onClick={onToggleHistory}>Version history</button>
                <button type="button" role="menuitem" onClick={onDuplicate}>Duplicate note</button>
                <button type="button" role="menuitem" onClick={onCopy}>Copy as Markdown</button>
                <button type="button" role="menuitem" className="note-menu-danger" onClick={onDelete}>Delete note</button>
              </div>
            )}
          </div>
          <button type="button" className="primary-button note-edit-button" onClick={onEdit} title="Edit note (E)">
            <Icon name="edit" size={15} /> Edit <kbd>E</kbd>
          </button>
        </div>
      </div>
      <div className="note-reader-scroll">
        <header className="note-reader-heading">
          <h2>{note.title || 'Untitled note'}</h2>
          <p>Last edited {noteDate(note.updatedAt, formatDate)}</p>
        </header>
        <NoteMetaBar note={note} />
        <div className="note-reader-content">
          <NoteMarkdown source={note.body || ''} emptyMessage="This note is empty. Choose Edit to start writing." />
        </div>
        {Boolean(note.attachments?.length) && (
          <section className="note-reader-attachments">
            <div className="note-section-heading">
              <strong>Attachments</strong>
              <button type="button" className="note-quiet-action" onClick={onAddAttachments}>Add files</button>
            </div>
            <div className="note-attachment-list">{note.attachments.map(file => (
              <div className="note-attachment" key={file.id}>
                <button type="button" onClick={() => onOpenAttachment(file.id)}>{file.name}</button>
                <span>{formatBytes(file.size)}</span>
              </div>
            ))}</div>
          </section>
        )}
        {historyOpen && (
          <section className="note-history-panel" aria-label="Version history">
            <div className="note-section-heading">
              <strong>Version history</strong>
              <button type="button" className="note-quiet-action" onClick={onToggleHistory}>Close</button>
            </div>
            {history.length ? history.map(entry => (
              <article key={entry.id}>
                <strong>{entry.action}</strong>
                <time>{noteDate(entry.createdAt, formatDate)}</time>
                <p>{entry.title || 'Untitled note'} · {plainText(entry.body || '') || 'Empty note'}</p>
              </article>
            )) : <span className="note-empty-hint">No earlier versions yet.</span>}
          </section>
        )}
        <footer className="note-reader-footer">
          <span>{wordCount} words</span>
          <button type="button" className="note-history-link" onClick={onToggleHistory}>{historyOpen ? 'Hide version history' : `Version history${note.historyCount ? ` · ${note.historyCount}` : ''}`}</button>
        </footer>
      </div>
    </>
  )
}
