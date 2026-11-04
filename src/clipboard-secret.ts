const MASK = '****'
const PREVIEW_CHARS = 180
const HOVER_CHARS = 4000

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/gd
const KNOWN_KEY = /github_pat_[A-Za-z0-9_]{22,}|gh[pousr]_[A-Za-z0-9_]{16,}|sk-(?:proj-[A-Za-z0-9_-]{8,}-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gd
const FIELD_KEY = /(?<![A-Za-z0-9])(?:export\s+)?["']?(?:api[_-]?key|access_key|secret_key|client_secret|access_token|auth_token|refresh_token|private_key|token)["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^&\s,;}#\r\n]+))/gid
const BEARER = /\bBearer\s+([A-Za-z0-9\-._~+/]{16,}={0,2})/gid

type Range = { start: number; end: number }

function maskValue(value: string): string {
  const chars = [...value]
  if (chars.length < 16) return MASK
  return `${chars.slice(0, 4).join('')}${MASK}${chars.slice(-4).join('')}`
}

function rangesFrom(pattern: RegExp, text: string, group = 0): Range[] {
  pattern.lastIndex = 0
  const found: Range[] = []
  for (const match of text.matchAll(pattern)) {
    const span = match.indices?.[group]
    if (!span) continue
    const [start, end] = span
    if (end <= start) continue
    found.push({ start, end })
  }
  return found
}

function mergeRanges(ranges: Range[]): Range[] {
  const ordered = ranges.filter((range) => range.end > range.start).sort((left, right) => left.start - right.start || right.end - left.end)
  const merged: Range[] = []
  for (const range of ordered) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end) merged.push({ ...range })
    else last.end = Math.max(last.end, range.end)
  }
  return merged
}

export function secretRanges(text: string): Range[] {
  return mergeRanges([
    ...rangesFrom(PRIVATE_KEY, text),
    ...rangesFrom(KNOWN_KEY, text),
    ...rangesFrom(FIELD_KEY, text, 1),
    ...rangesFrom(FIELD_KEY, text, 2),
    ...rangesFrom(FIELD_KEY, text, 3),
    ...rangesFrom(BEARER, text, 1),
  ])
}

export function maskClipboardSecrets(text: string): string {
  const ranges = secretRanges(text)
  if (ranges.length === 0) return text
  let cursor = 0
  let masked = ''
  for (const range of ranges) {
    masked += text.slice(cursor, range.start)
    masked += maskValue(text.slice(range.start, range.end))
    cursor = range.end
  }
  return masked + text.slice(cursor)
}

function clipChars(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, max).join('')}…`
}

export function clipboardPreview(text: string): string {
  return clipChars(maskClipboardSecrets(text).replace(/\s+/g, ' ').trim(), PREVIEW_CHARS)
}

export function clipboardHoverText(text: string): string {
  return clipChars(maskClipboardSecrets(text), HOVER_CHARS)
}
