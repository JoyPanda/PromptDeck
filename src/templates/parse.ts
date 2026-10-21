import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const SLOT_NAME = /^[A-Za-z0-9_-]+$/
const SLOT_KINDS = ['text', 'textarea', 'select', 'number', 'boolean'] as const

export type SlotKind = (typeof SLOT_KINDS)[number]

export type Slot = {
  name: string
  label: string
  kind: SlotKind
  placeholder?: string
  description?: string
  options?: string[]
  defaultValue?: string
  required?: boolean
}

export type Template = {
  id: string
  title: string
  description: string
  slots: Slot[]
  body: string
  favorite: boolean
  tags: string[]
  category: string
  updatedAt: number
}

export type LibrarySort = 'updated' | 'uses' | 'title'

export function slotPattern(): RegExp {
  return /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g
}

export function removeSlotFromBody(body: string, name: string): string {
  if (!SLOT_NAME.test(name)) return body
  const pattern = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g')
  const lines = body.split('\n').flatMap((line) => {
    const next = line.replace(pattern, '')
    if (next === line) return [line]
    const cleaned = next.replace(/[^\S\n]{2,}/g, ' ').trim()
    return cleaned ? [cleaned] : []
  })
  return lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
}

export function renameSlotInBody(body: string, previous: string, next: string): string {
  if (!SLOT_NAME.test(previous) || !SLOT_NAME.test(next) || previous === next) return body
  return body.replace(new RegExp(`\\{\\{\\s*${previous}\\s*\\}\\}`, 'g'), `{{${next}}}`)
}

export function slotNamesIn(body: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const range of placeholderRanges(body)) {
    if (seen.has(range.name)) continue
    seen.add(range.name)
    names.push(range.name)
  }
  return names
}

function placeholderRanges(body: string): Array<{ name: string; start: number; end: number }> {
  const ranges: Array<{ name: string; start: number; end: number }> = []
  for (const match of body.matchAll(slotPattern())) {
    const name = match[1]
    if (!name || match.index == null) continue
    ranges.push({ name, start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function editBounds(before: string, after: string): { start: number; beforeEnd: number; afterEnd: number } {
  let start = 0
  while (start < before.length && start < after.length && before.charCodeAt(start) === after.charCodeAt(start)) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return { start, beforeEnd, afterEnd }
}

function rangesOverlap(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return rangeStart < end && rangeEnd > start
}

/** Names of complete placeholders introduced by an insertion, not by editing inside an existing one. */
export function introducedSlotNames(before: string, after: string): string[] {
  if (before === after || !after.includes('{{')) return []
  const { start, beforeEnd, afterEnd } = editBounds(before, after)
  if (placeholderRanges(before).some((range) => rangesOverlap(start, beforeEnd, range.start, range.end))) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const range of placeholderRanges(after)) {
    if (!rangesOverlap(start, afterEnd, range.start, range.end) || seen.has(range.name)) continue
    seen.add(range.name)
    names.push(range.name)
  }
  return names
}

export function slotUsedInBody(body: string, name: string): boolean {
  return slotNamesIn(body).includes(name)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseKind(record: Record<string, unknown>): SlotKind {
  const kind = asString(record.kind).trim()
  if ((SLOT_KINDS as readonly string[]).includes(kind)) return kind as SlotKind
  return record.multiline === true ? 'textarea' : 'text'
}

function parseStringList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n|[,，]/) : []
  const items: string[] = []
  const seen = new Set<string>()
  for (const item of source) {
    const text = asString(item).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    items.push(text)
  }
  return items
}

export function parseTagList(text: string): string[] {
  return parseStringList(text)
}

export function normalizeSlot(value: unknown): Slot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = asString(record.name).trim()
  if (!SLOT_NAME.test(name)) return null
  const label = asString(record.label).trim() || name
  const placeholder = asString(record.placeholder).trim()
  const description = asString(record.description).trim()
  const defaultValue = asString(record.defaultValue).trim()
  const options = parseStringList(record.options)
  const slot: Slot = { name, label, kind: parseKind(record) }
  if (placeholder) slot.placeholder = placeholder
  if (description) slot.description = description
  if (options.length > 0) slot.options = options
  if (defaultValue) slot.defaultValue = defaultValue
  if (record.required === false) slot.required = false
  return slot
}

function parseTags(value: unknown): string[] {
  if (typeof value === 'string') return parseTagList(value)
  return parseStringList(value)
}

export function parseTemplate(id: string, markdown: string): Template {
  const match = markdown.match(FRONTMATTER)
  let meta: Record<string, unknown> = {}
  let body = markdown
  if (match) {
    try {
      const parsed = parseYaml(match[1] ?? '')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>
      }
    } catch {
      meta = {}
    }
    body = markdown.slice(match[0].length)
  }
  const slots = Array.isArray(meta.slots) ? meta.slots.flatMap((item) => {
    const slot = normalizeSlot(item)
    return slot ? [slot] : []
  }) : []
  return {
    id,
    title: asString(meta.title).trim() || id,
    description: asString(meta.description).trim(),
    slots,
    body: body.replace(/^\n/, '').replace(/\s+$/, ''),
    favorite: meta.favorite === true,
    tags: parseTags(meta.tags),
    category: asString(meta.category).trim(),
    updatedAt: parseUpdatedAt(meta.updatedAt),
  }
}

function parseUpdatedAt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function isMirrorSlot(slot: Slot): boolean {
  return slot.kind === 'text'
    && slot.label.trim() === slot.name
    && !slot.placeholder?.trim()
    && !slot.description?.trim()
    && !slot.defaultValue?.trim()
    && !(slot.options && slot.options.length > 0)
    && slot.required !== false
}

function replaceMirrorSlots(slots: Slot[], previousBody: string, body: string): Slot[] | null {
  const { start, beforeEnd } = editBounds(previousBody, body)
  const touched = placeholderRanges(previousBody).some((range) => rangesOverlap(start, beforeEnd, range.start, range.end))
  if (!touched) return null
  const beforeNames = new Set(slotNamesIn(previousBody))
  const afterNames = slotNamesIn(body)
  const afterSet = new Set(afterNames)
  const drop = new Set(slots.filter((slot) => beforeNames.has(slot.name) && !afterSet.has(slot.name) && isMirrorSlot(slot)).map((slot) => slot.name))
  if (drop.size === 0) return null
  const kept = new Set(slots.filter((slot) => !drop.has(slot.name)).map((slot) => slot.name))
  const incoming = afterNames.filter((name) => !beforeNames.has(name) && !kept.has(name))
  const next: Slot[] = []
  for (const slot of slots) {
    if (!drop.has(slot.name)) {
      next.push(slot)
      continue
    }
    const name = incoming.shift()
    if (!name) continue
    kept.add(name)
    next.push({ name, label: name, kind: 'text' })
  }
  for (const name of incoming) {
    if (kept.has(name)) continue
    kept.add(name)
    next.push({ name, label: name, kind: 'text' })
  }
  return next
}

export function reconcileSlots(template: Template, previousBody?: string): Template {
  const replaced = previousBody == null ? null : replaceMirrorSlots(template.slots, previousBody, template.body)
  const slots = replaced ?? template.slots
  const found = replaced != null || previousBody == null ? (replaced == null ? slotNamesIn(template.body) : []) : introducedSlotNames(previousBody, template.body)
  const known = new Set(slots.map((slot) => slot.name))
  const extra: Slot[] = []
  for (const name of found) {
    if (known.has(name)) continue
    known.add(name)
    extra.push({ name, label: name, kind: 'text' })
  }
  if (extra.length === 0 && slots === template.slots) return template
  return { ...template, slots: [...slots, ...extra] }
}

export function ensureSlots(template: Template): Template {
  return reconcileSlots(template)
}

export function serializeTemplate(template: Template): string {
  const ensured = reconcileSlots({
    ...template,
    title: template.title.trim(),
    description: template.description.trim(),
    category: template.category.trim(),
    tags: template.tags.map((tag) => tag.trim()).filter(Boolean),
    body: template.body.replace(/\s+$/, ''),
  })
  const slots = ensured.slots.map((slot) => {
    const entry: Record<string, unknown> = {
      name: slot.name,
      label: slot.label.trim() || slot.name,
      kind: slot.kind,
    }
    if (slot.placeholder?.trim()) entry.placeholder = slot.placeholder.trim()
    if (slot.description?.trim()) entry.description = slot.description.trim()
    if (slot.options && slot.options.length > 0) entry.options = slot.options
    if (slot.defaultValue?.trim()) entry.defaultValue = slot.defaultValue.trim()
    if (slot.required === false) entry.required = false
    return entry
  })
  const meta: Record<string, unknown> = {
    title: ensured.title,
    description: ensured.description,
    slots,
  }
  if (ensured.updatedAt > 0) meta.updatedAt = ensured.updatedAt
  if (ensured.category) meta.category = ensured.category
  if (ensured.tags.length > 0) meta.tags = ensured.tags
  if (ensured.favorite) meta.favorite = true
  const yamlText = stringifyYaml(meta).trimEnd()
  return `---\n${yamlText}\n---\n\n${ensured.body}\n`
}

export function slugify(title: string): string {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (ascii) return ascii
  return `prompt-${Date.now().toString(36)}`
}

export function uniqueId(title: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const base = slugify(title)
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export function blankTemplate(existing: Iterable<string>): Template {
  const title = '未命名模板'
  return {
    id: uniqueId(title, existing),
    title,
    description: '',
    slots: [{ name: 'content', label: '内容', kind: 'textarea' }],
    body: '请根据下面的内容完成任务。\n\n{{content}}',
    favorite: false,
    tags: [],
    category: '',
    updatedAt: 0,
  }
}

export function defaultValues(template: Template): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of template.slots) {
    const value = slot.defaultValue?.trim() ?? ''
    if (value) values[slot.name] = value
  }
  return values
}

function slotSignature(slot: Slot): string {
  return [
    slot.name,
    slot.label,
    slot.placeholder ?? '',
    slot.kind,
    slot.description ?? '',
    (slot.options ?? []).join('\n'),
    slot.defaultValue ?? '',
    slot.required === false ? '0' : '1',
  ].join('\0')
}

export function isTemplateDirty(saved: Template | null | undefined, draft: Template | null): boolean {
  if (!saved || !draft || saved.id !== draft.id) return false
  if (saved.title !== draft.title || saved.description !== draft.description || saved.body !== draft.body) return true
  if (saved.favorite !== draft.favorite || saved.category !== draft.category) return true
  if (saved.tags.join('\0') !== draft.tags.join('\0')) return true
  if (saved.slots.length !== draft.slots.length) return true
  return saved.slots.some((slot, index) => slotSignature(slot) !== slotSignature(draft.slots[index]!))
}

export function filterTemplates(
  templates: Template[],
  query: { text: string; favoriteOnly: boolean; category: string; sort: LibrarySort; useCounts: Record<string, number> },
): Template[] {
  const needle = query.text.trim().toLowerCase()
  const matched = templates.filter((template) => {
    if (query.favoriteOnly && !template.favorite) return false
    if (query.category && template.category !== query.category) return false
    if (!needle) return true
    return [template.title, template.description, template.category, ...template.tags].join('\n').toLowerCase().includes(needle)
  })
  const sorted = [...matched]
  sorted.sort((left, right) => {
    if (query.sort === 'title') return left.title.localeCompare(right.title, 'zh')
    if (query.sort === 'uses') {
      const delta = (query.useCounts[right.id] ?? 0) - (query.useCounts[left.id] ?? 0)
      if (delta !== 0) return delta
      return left.title.localeCompare(right.title, 'zh')
    }
    const delta = right.updatedAt - left.updatedAt
    if (delta !== 0) return delta
    return left.title.localeCompare(right.title, 'zh')
  })
  return sorted
}

export function validateTemplate(template: Template): string | null {
  if (!template.title.trim()) return '请填写标题'
  if (!/^[A-Za-z0-9_-]+$/.test(template.id)) return '模板 id 无效'
  const names = new Set<string>()
  for (const slot of template.slots) {
    if (!SLOT_NAME.test(slot.name)) return `槽位名无效：${slot.name || '空'}`
    if (names.has(slot.name)) return `槽位名重复：${slot.name}`
    names.add(slot.name)
  }
  return null
}
