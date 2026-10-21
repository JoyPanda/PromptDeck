import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Template } from './parse'
import { serializeTemplate } from './parse'
import { listTemplates, saveTemplate } from './store'

export type Tombstone = { id: string; deletedAt: number }

export type LibrarySnapshot = {
  templates: Template[]
  tombstones: Tombstone[]
}

const MARKDOWN = /^([A-Za-z0-9_-]+)\.md$/
const TOMBSTONE = /^([A-Za-z0-9_-]+)\.json$/

export function tombstoneRelativePath(id: string): string {
  return `prompts/.tombstones/${id}.json`
}

export function reconcileLibrary(local: LibrarySnapshot, remote: LibrarySnapshot): LibrarySnapshot {
  const ids = new Set<string>()
  for (const template of [...local.templates, ...remote.templates]) ids.add(template.id)
  for (const tombstone of [...local.tombstones, ...remote.tombstones]) ids.add(tombstone.id)
  const templates: Template[] = []
  const tombstones: Tombstone[] = []
  for (const id of [...ids].sort()) {
    const winner = chooseRecord(id, local, remote)
    if (winner.kind === 'template') templates.push(winner.template)
    else if (winner.kind === 'delete') tombstones.push({ id, deletedAt: winner.deletedAt })
  }
  return { templates, tombstones }
}

export function overlayLocalTemplates(disk: LibrarySnapshot, saved: Template[]): LibrarySnapshot {
  const templates = new Map(disk.templates.map((template) => [template.id, template]))
  for (const template of saved) {
    const current = templates.get(template.id)
    if (!current || template.updatedAt > current.updatedAt) templates.set(template.id, template)
  }
  const deletedAt = new Map(disk.tombstones.map((tombstone) => [tombstone.id, tombstone.deletedAt]))
  const kept = [...templates.values()].filter((template) => {
    const deleted = deletedAt.get(template.id)
    return deleted === undefined || template.updatedAt > deleted
  })
  return { templates: kept, tombstones: disk.tombstones }
}

export async function readDiskLibrary(dir: string): Promise<LibrarySnapshot> {
  return {
    templates: await listTemplates(dir),
    tombstones: await readTombstones(dir),
  }
}

export async function writeDiskLibrary(dir: string, library: LibrarySnapshot): Promise<void> {
  const promptsDir = path.join(dir, 'prompts')
  const tombDir = path.join(promptsDir, '.tombstones')
  await mkdir(tombDir, { recursive: true })
  const keptTemplates = new Set(library.templates.map((template) => template.id))
  const keptTombstones = new Set(library.tombstones.map((tombstone) => tombstone.id))
  for (const name of await readNames(promptsDir)) {
    const match = MARKDOWN.exec(name)
    if (match?.[1] && !keptTemplates.has(match[1])) await rm(path.join(promptsDir, name), { force: true })
  }
  for (const template of library.templates) {
    const serialized = serializeTemplate(template)
    const target = path.join(promptsDir, `${template.id}.md`)
    const current = await readFile(target, 'utf8').catch(() => '')
    if (current !== serialized) await saveTemplate(dir, template)
  }
  for (const name of await readNames(tombDir)) {
    const match = TOMBSTONE.exec(name)
    if (match?.[1] && !keptTombstones.has(match[1])) await rm(path.join(tombDir, name), { force: true })
  }
  for (const tombstone of library.tombstones) {
    const serialized = `${JSON.stringify({ deletedAt: tombstone.deletedAt })}\n`
    const target = path.join(tombDir, `${tombstone.id}.json`)
    const current = await readFile(target, 'utf8').catch(() => '')
    if (current !== serialized) await writeFile(target, serialized)
  }
}

export async function writeTombstone(dir: string, id: string, deletedAt: number): Promise<void> {
  const tombDir = path.join(dir, 'prompts', '.tombstones')
  await mkdir(tombDir, { recursive: true })
  await writeFile(path.join(tombDir, `${id}.json`), `${JSON.stringify({ deletedAt })}\n`)
}

export async function removeTombstone(dir: string, id: string): Promise<void> {
  await rm(path.join(dir, 'prompts', '.tombstones', `${id}.json`), { force: true })
}

export async function readTombstones(dir: string): Promise<Tombstone[]> {
  const tombDir = path.join(dir, 'prompts', '.tombstones')
  const tombstones: Tombstone[] = []
  for (const name of await readNames(tombDir)) {
    const match = TOMBSTONE.exec(name)
    if (!match?.[1]) continue
    const deletedAt = parseTombstone(await readFile(path.join(tombDir, name), 'utf8'))
    if (deletedAt > 0) tombstones.push({ id: match[1], deletedAt })
  }
  return tombstones
}

export function parseTombstone(text: string): number {
  try {
    const parsed = JSON.parse(text) as { deletedAt?: unknown }
    const value = typeof parsed.deletedAt === 'number' ? parsed.deletedAt : typeof parsed.deletedAt === 'string' ? Number(parsed.deletedAt) : 0
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.floor(value)
  } catch {
    return 0
  }
}

type Choice =
  | { kind: 'template'; template: Template }
  | { kind: 'delete'; deletedAt: number }
  | { kind: 'empty' }

function chooseRecord(id: string, local: LibrarySnapshot, remote: LibrarySnapshot): Choice {
  const candidates: Array<{ at: number; rank: number; template?: Template }> = []
  const addTemplate = (template: Template | undefined, rank: number) => {
    if (!template) return
    candidates.push({ at: Math.max(0, template.updatedAt), rank, template })
  }
  const addDelete = (tombstone: Tombstone | undefined, rank: number) => {
    if (!tombstone || tombstone.deletedAt <= 0) return
    candidates.push({ at: tombstone.deletedAt, rank })
  }
  addDelete(remote.tombstones.find((tombstone) => tombstone.id === id), 0)
  addDelete(local.tombstones.find((tombstone) => tombstone.id === id), 1)
  addTemplate(remote.templates.find((template) => template.id === id), 2)
  addTemplate(local.templates.find((template) => template.id === id), 3)
  candidates.sort((left, right) => right.at - left.at || left.rank - right.rank)
  const winner = candidates[0]
  if (!winner) return { kind: 'empty' }
  if (winner.template && winner.rank >= 2) return { kind: 'template', template: winner.template }
  return { kind: 'delete', deletedAt: winner.at }
}

async function readNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code === 'ENOENT') return []
    throw error
  }
}
