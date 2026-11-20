export function plainText(markdown = '') {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function localDailyDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(year, month - 1, day))
}

export function noteDate(value, formatDate) {
  if (!value) return ''
  try {
    return formatDate(value)
  } catch {
    return ''
  }
}

export function formatBytes(size) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.ceil(size / 1024))} KB`
}

export function countWords(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

export function isTypingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
}
