import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../git/config'
import { normalizeSlot, type Template } from './parse'
import { listTemplates, saveTemplate } from './store'

type TemplateRow = {
  id: string
  title: string
  description: string
  slots: string
  body: string
  updated_at: number
  favorite: number
  tags: string
  category: string
}

let opened: { dir: string; db: Database } | null = null

function database(): Database {
  const dir = dataDir()
  if (opened?.dir === dir) return opened.db
  opened?.db.close()
  mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, 'promptdeck.db'), { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      slots TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS generations_template ON generations (template_id, id)')
  ensureTemplateColumns(db)
  opened = { dir, db }
  return db
}

export function closeLocalDatabase(): void {
  opened?.db.close()
  opened = null
}

export function listLocalTemplates(): Template[] {
  const rows = database().query<TemplateRow, []>('SELECT id, title, description, slots, body, updated_at, favorite, tags, category FROM templates').all()
  return rows.map(rowToTemplate).sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'zh'))
}

export function generationCounts(): Record<string, number> {
  const rows = database().query<{ template_id: string; n: number }, []>('SELECT template_id, COUNT(*) AS n FROM generations GROUP BY template_id').all()
  return Object.fromEntries(rows.map((row) => [row.template_id, row.n]))
}

export function saveLocalTemplate(template: Template): void {
  database()
    .query(
      `INSERT INTO templates (id, title, description, slots, body, updated_at, favorite, tags, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         slots = excluded.slots,
         body = excluded.body,
         updated_at = excluded.updated_at,
         favorite = excluded.favorite,
         tags = excluded.tags,
         category = excluded.category`,
    )
    .run(
      template.id,
      template.title,
      template.description,
      JSON.stringify(template.slots),
      template.body,
      template.updatedAt > 0 ? template.updatedAt : Date.now(),
      template.favorite ? 1 : 0,
      JSON.stringify(template.tags),
      template.category,
    )
}

export function deleteLocalTemplate(id: string): void {
  const db = database()
  db.query('DELETE FROM templates WHERE id = ?').run(id)
  db.query('DELETE FROM generations WHERE template_id = ?').run(id)
}

export type Generation = {
  id: number
  templateId: string
  prompt: string
  createdAt: number
}

type GenerationRow = {
  id: number
  template_id: string
  prompt: string
  created_at: number
}

export function listGenerations(templateId: string): Generation[] {
  const rows = database()
    .query<GenerationRow, [string]>('SELECT id, template_id, prompt, created_at FROM generations WHERE template_id = ? ORDER BY created_at DESC, id DESC')
    .all(templateId)
  return rows.map(generationFromRow)
}

export function listAllGenerations(): Array<Generation & { title: string }> {
  const rows = database()
    .query<GenerationRow & { title: string }, []>(`
      SELECT g.id, g.template_id, g.prompt, g.created_at, COALESCE(t.title, '') AS title
      FROM generations g
      LEFT JOIN templates t ON t.id = g.template_id
      ORDER BY g.created_at DESC, g.id DESC
    `)
    .all()
  return rows.map((row) => ({ ...generationFromRow(row), title: row.title }))
}

function generationFromRow(row: GenerationRow): Generation {
  return { id: row.id, templateId: row.template_id, prompt: row.prompt, createdAt: row.created_at }
}

export function appendGeneration(templateId: string, prompt: string, limit: number): void {
  const db = database()
  const createdAt = nextTimestamp(db, templateId)
  const existing = db
    .query<{ id: number }, [string, string]>('SELECT id FROM generations WHERE template_id = ? AND prompt = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(templateId, prompt)
  if (existing) {
    db.query('UPDATE generations SET created_at = ? WHERE id = ?').run(createdAt, existing.id)
  } else {
    db.query('INSERT INTO generations (template_id, prompt, created_at) VALUES (?, ?, ?)').run(templateId, prompt, createdAt)
  }
  trimGenerations(db, templateId, limit)
}

export function deleteGeneration(id: number): void {
  database().query('DELETE FROM generations WHERE id = ?').run(id)
}

export function trimAllGenerations(limit: number): void {
  const db = database()
  const rows = db.query<{ template_id: string }, []>('SELECT DISTINCT template_id FROM generations').all()
  for (const row of rows) trimGenerations(db, row.template_id, limit)
}

function nextTimestamp(db: Database, templateId: string): number {
  const row = db.query<{ t: number | null }, [string]>('SELECT MAX(created_at) AS t FROM generations WHERE template_id = ?').get(templateId)
  return Math.max(Date.now(), (row?.t ?? 0) + 1)
}

function trimGenerations(db: Database, templateId: string, limit: number): void {
  db.query(
    `DELETE FROM generations
     WHERE template_id = ?
       AND id NOT IN (
         SELECT id FROM generations WHERE template_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
       )`,
  ).run(templateId, templateId, limit)
}

export function importTemplates(templates: Template[]): void {
  const db = database()
  const write = db.transaction((items: Template[]) => {
    for (const template of items) saveImportedTemplate(template)
  })
  write(templates)
}

export async function importRepoTemplates(repo: string): Promise<void> {
  const templates = await listTemplates(repo)
  const keep = new Set(templates.map((template) => template.id))
  const db = database()
  const existing = db.query<{ id: string }, []>('SELECT id FROM templates').all()
  const write = db.transaction(() => {
    for (const row of existing) {
      if (!keep.has(row.id)) db.query('DELETE FROM templates WHERE id = ?').run(row.id)
    }
    for (const template of templates) saveImportedTemplate(template)
  })
  write()
}

function saveImportedTemplate(template: Template): void {
  database()
    .query(
      `INSERT INTO templates (id, title, description, slots, body, updated_at, favorite, tags, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         slots = excluded.slots,
         body = excluded.body,
         updated_at = excluded.updated_at,
         favorite = excluded.favorite,
         tags = excluded.tags,
         category = excluded.category`,
    )
    .run(
      template.id,
      template.title,
      template.description,
      JSON.stringify(template.slots),
      template.body,
      Math.max(0, template.updatedAt),
      template.favorite ? 1 : 0,
      JSON.stringify(template.tags),
      template.category,
    )
}

export async function exportLocalTemplates(repo: string): Promise<void> {
  for (const template of listLocalTemplates()) {
    await saveTemplate(repo, template)
  }
}

export async function migrateFilesIfEmpty(repo: string): Promise<void> {
  const row = database().query<{ n: number }, []>('SELECT COUNT(*) AS n FROM templates').get()
  if ((row?.n ?? 0) > 0) return
  await importRepoTemplates(repo)
}

function ensureTemplateColumns(db: Database): void {
  const names = new Set(db.query<{ name: string }, []>('PRAGMA table_info(templates)').all().map((column) => column.name))
  if (!names.has('favorite')) db.exec('ALTER TABLE templates ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
  if (!names.has('tags')) db.exec("ALTER TABLE templates ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
  if (!names.has('category')) db.exec("ALTER TABLE templates ADD COLUMN category TEXT NOT NULL DEFAULT ''")
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    slots: slotsFromJson(row.slots),
    body: row.body,
    favorite: row.favorite === 1,
    tags: tagsFromJson(row.tags),
    category: row.category,
    updatedAt: row.updated_at,
  }
}

function slotsFromJson(raw: string): Template['slots'] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const slot = normalizeSlot(item)
      return slot ? [slot] : []
    })
  } catch {
    return []
  }
}

function tagsFromJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
  } catch {
    return []
  }
}
