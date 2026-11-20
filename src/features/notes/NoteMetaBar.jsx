import { localDailyDate } from './note-utils.js'

export default function NoteMetaBar({ note }) {
  return (
    <div className="note-reader-metadata">
      {note.category && <span className="note-meta-chip">{note.category}</span>}
      {note.dailyDate && <span className="note-meta-chip note-daily-chip">Daily note · {localDailyDate(note.dailyDate)}</span>}
      {(note.tags || []).map(tag => <span className="note-meta-chip" key={tag}>#{tag}</span>)}
      {(note.links || []).map(link => <span className="note-meta-chip note-link-readonly" key={link.id}>{link.type === 'task' ? 'Task' : link.type === 'event' ? 'Event' : 'Project'} · {link.label}</span>)}
    </div>
  )
}
