import NoteMarkdown from './NoteMarkdown.jsx'
import { formatBytes, noteDate } from './note-utils.js'

export default function NoteEditor({
  note,
  editorMode,
  setEditorMode,
  detailsOpen,
  setDetailsOpen,
  linkTarget,
  setLinkTarget,
  tasks,
  events,
  onUpdate,
  onAddAttachments,
  onRemoveAttachment,
  onOpenAttachment,
  formatDate,
  saveState,
  saveError,
  wordCount,
  characterCount,
  bodyRef,
  onDone,
  onAddLink,
}) {
  return (
    <>
      <div className="note-canvas-toolbar">
        <div className="note-save-status" title={saveError || undefined} role={saveError ? 'alert' : 'status'}>
          <span className={`note-save-indicator note-save-${saveError ? 'error' : saveState}`} />
          {saveError ? 'Save issue' : saveState === 'saving' ? 'Saving…' : 'Saved locally'}
        </div>
        <div className="note-edit-actions">
          <span className="note-editing-pill">Editing</span>
          <button type="button" className="primary-button note-done-button" onClick={onDone}>Done</button>
        </div>
      </div>
      <input
        className="note-title-input"
        aria-label="Note title"
        value={note.title}
        onChange={event => onUpdate('title', event.target.value)}
        placeholder="Untitled note"
        maxLength={240}
      />
      <div className="note-edit-date-row">
        <span>Last edited {noteDate(note.updatedAt, formatDate)}</span>
        <span>{wordCount} words · {characterCount} characters</span>
      </div>
      <button type="button" className="note-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>
        <span><strong>Details, Tags &amp; Links</strong><small>Category, daily date, tags and related items</small></span>
        <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
      </button>
      {detailsOpen && (
        <div className="note-details-panel">
          <div className="note-metadata-row">
            <label>Category<input aria-label="Note category" maxLength={80} value={note.category || ''} onChange={event => onUpdate('category', event.target.value)} placeholder="Add a category" /></label>
            <label>Daily note<input aria-label="Daily note date" type="date" value={note.dailyDate || ''} onChange={event => onUpdate('dailyDate', event.target.value)} /></label>
            <label>Tags<input aria-label="Note tags" value={(note.tags || []).join(', ')} onChange={event => onUpdate('tags', [...new Set(event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))])} placeholder="Separate with commas" /></label>
          </div>
          <div className="note-link-controls">
            <select aria-label="Link task or event" value={linkTarget} onChange={event => setLinkTarget(event.target.value)}>
              <option value="">Choose a task, event or project</option>
              <optgroup label="Tasks">{tasks.map(task => <option key={task.id} value={`task:${task.id}`}>{task.title}</option>)}</optgroup>
              <optgroup label="Events">{events.map(event => <option key={event.id} value={`event:${event.id}`}>{event.title}</option>)}</optgroup>
              <optgroup label="Projects">{[...new Set(tasks.map(task => task.project).filter(Boolean))].map(project => <option key={project} value={`project:${project}`}>{project}</option>)}</optgroup>
            </select>
            <button type="button" className="note-quiet-action" onClick={onAddLink} disabled={!linkTarget}>Link</button>
          </div>
          {Boolean(note.links?.length) && <div className="note-link-list">{note.links.map(link => (
            <span className="note-meta-chip note-link-chip" key={link.id}>
              {link.type === 'task' ? 'Task' : link.type === 'event' ? 'Event' : 'Project'} · {link.label}
              <button type="button" aria-label={`Remove link to ${link.label}`} onClick={() => onUpdate('links', note.links.filter(item => item.id !== link.id))}>×</button>
            </span>
          ))}</div>}
        </div>
      )}

      <div className="note-editor-mode-tabs" role="tablist" aria-label="Editor layout">
        {[
          ['write', 'Write'],
          ['split', 'Split'],
          ['preview', 'Preview'],
        ].map(([mode, label]) => (
          <button key={mode} type="button" role="tab" aria-selected={editorMode === mode} className={`${editorMode === mode ? 'note-mode-active' : ''} ${mode === 'split' ? 'note-mode-split-tab' : ''}`} onClick={() => setEditorMode(mode)}>{label}</button>
        ))}
        <span className="note-markdown-hint">Markdown supported</span>
      </div>
      <div className={`note-editor-workspace note-mode-${editorMode}`}>
        {(editorMode === 'write' || editorMode === 'split') && (
          <textarea
            ref={bodyRef}
            className="note-body-input"
            aria-label="Note content in Markdown"
            value={note.body}
            onChange={event => onUpdate('body', event.target.value)}
            placeholder="Start writing here..."
          />
        )}
        {(editorMode === 'preview' || editorMode === 'split') && (
          <div className="note-markdown-preview" aria-label="Markdown preview">
            <NoteMarkdown source={note.body} emptyMessage="Your preview will appear here as you write." />
          </div>
        )}
      </div>

      <section className="note-related-section note-attachments-section">
        <div className="note-section-heading">
          <strong>Attachments</strong>
          <button type="button" className="note-quiet-action" onClick={onAddAttachments}>Add files</button>
        </div>
        {note.attachments?.length ? (
          <div className="note-attachment-list">{note.attachments.map(file => (
            <div className="note-attachment" key={file.id}>
              <button type="button" onClick={() => onOpenAttachment(file.id)}>{file.name}</button>
              <span>{formatBytes(file.size)}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemoveAttachment(file.id)}>×</button>
            </div>
          ))}</div>
        ) : <span className="note-empty-hint">No attachments</span>}
      </section>
    </>
  )
}
