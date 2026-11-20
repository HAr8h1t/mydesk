function renderInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`
      if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
        return <strong key={key}>{part.slice(2, -2)}</strong>
      }
      if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
        return <em key={key}>{part.slice(1, -1)}</em>
      }
      if (part.startsWith('~~') && part.endsWith('~~')) return <del key={key}>{part.slice(2, -2)}</del>
      if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
      return part
    })
}

export default function NoteMarkdown({ source = '', emptyMessage }) {
  if (!source.trim()) return <p className="note-reader-empty">{emptyMessage}</p>

  const lines = source.split(/\r?\n/)
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^\s*```/.test(line)) {
      const codeLines = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(<pre key={`code-${index}`}><code>{codeLines.join('\n')}</code></pre>)
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      const Heading = `h${heading[1].length}`
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2], `heading-${index}`)}</Heading>)
      index += 1
      continue
    }

    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />)
      index += 1
      continue
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quoteLines.map((quote, quoteIndex) => (
        <p key={`quote-${index}-${quoteIndex}`}>{renderInline(quote, `quote-${index}-${quoteIndex}`)}</p>
      ))}</blockquote>)
      continue
    }

    const listMatch = line.match(/^\s{0,3}([-*+]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1])
      const listLines = []
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}([-*+]|\d+\.)\s+(.*)$/)
        if (!item || /^\d/.test(item[1]) !== ordered) break
        listLines.push(item[2])
        index += 1
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={`list-${index}`} className="note-markdown-list">{listLines.map((item, itemIndex) => {
        const task = item.match(/^\[([ xX])\]\s+(.*)$/)
        return (
          <li key={`list-${index}-${itemIndex}`} className={task ? 'note-markdown-task' : undefined}>
            {task && <input type="checkbox" checked={task[1].toLowerCase() === 'x'} readOnly aria-label={task[1].toLowerCase() === 'x' ? 'Completed task' : 'Incomplete task'} />}
            {renderInline(task ? task[2] : item, `list-${index}-${itemIndex}`)}
          </li>
        )
      })}</List>)
      continue
    }

    const paragraph = []
    while (index < lines.length && lines[index].trim()
      && !/^\s{0,3}(?:#{1,6}\s|>|```|[-*+]\s|\d+\.\s)/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    if (!paragraph.length) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((text, lineIndex) => (
      <span key={`paragraph-${index}-${lineIndex}`}>{lineIndex > 0 && <br />}{renderInline(text, `paragraph-${index}-${lineIndex}`)}</span>
    ))}</p>)
  }

  return blocks
}
