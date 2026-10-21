import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendGeneration, closeLocalDatabase, deleteGeneration, deleteLocalTemplate, generationCounts, importRepoTemplates, listAllGenerations, listGenerations, listLocalTemplates, migrateFilesIfEmpty, saveLocalTemplate, trimAllGenerations } from './db'
import { blankTemplate } from './parse'

const roots: string[] = []
const previousDataDir = process.env.PROMPTDECK_DATA_DIR

afterEach(async () => {
  closeLocalDatabase()
  if (previousDataDir === undefined) delete process.env.PROMPTDECK_DATA_DIR
  else process.env.PROMPTDECK_DATA_DIR = previousDataDir
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('local database', () => {
  test('stores templates in sqlite', () => {
    useDataDir()
    const template = blankTemplate([])
    template.title = '代码审查'
    template.body = '看一下 {{content}}'
    template.favorite = true
    template.tags = ['审查']
    template.category = '工作'
    saveLocalTemplate(template)
    const [loaded] = listLocalTemplates()
    expect(loaded?.title).toBe('代码审查')
    expect(loaded?.slots).toEqual(template.slots)
    expect(loaded?.favorite).toBe(true)
    expect(loaded?.tags).toEqual(['审查'])
    expect(loaded?.category).toBe('工作')
    expect(loaded?.updatedAt).toBeGreaterThan(0)
    expect(loaded?.slots[0]?.kind).toBe('textarea')
  })

  test('imports existing markdown once when the database is empty', async () => {
    const dir = useDataDir()
    const repo = path.join(dir, 'repo')
    await mkdir(path.join(repo, 'prompts'), { recursive: true })
    await writeFile(
      path.join(repo, 'prompts', 'note.md'),
      '---\ntitle: 笔记\ndescription: 本地\nslots:\n  - name: topic\n    label: 主题\n---\n\n写{{topic}}\n',
    )
    await migrateFilesIfEmpty(repo)
    await migrateFilesIfEmpty(repo)
    const items = listLocalTemplates()
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('笔记')
    expect(items[0]?.slots[0]?.name).toBe('topic')
    expect(items[0]?.body).toBe('写{{topic}}')
    expect(items[0]?.slots[0]?.kind).toBe('text')
    expect(items[0]?.favorite).toBe(false)
  })

  test('keeps the newest generations for one template', () => {
    useDataDir()
    const template = blankTemplate([])
    saveLocalTemplate(template)
    appendGeneration(template.id, '第一条', 2)
    appendGeneration(template.id, '第二条', 2)
    appendGeneration(template.id, '第一条', 2)
    expect(listGenerations(template.id).map((item) => item.prompt)).toEqual(['第一条', '第二条'])
    appendGeneration(template.id, '第三条', 2)
    expect(listGenerations(template.id).map((item) => item.prompt)).toEqual(['第三条', '第一条'])
    const older = listGenerations(template.id)[1]
    if (!older) throw new Error('缺少历史')
    deleteGeneration(older.id)
    expect(listGenerations(template.id).map((item) => item.prompt)).toEqual(['第三条'])
    trimAllGenerations(1)
    expect(listGenerations(template.id).map((item) => item.prompt)).toEqual(['第三条'])
    expect(generationCounts()[template.id]).toBe(1)
    deleteLocalTemplate(template.id)
    expect(listGenerations(template.id)).toEqual([])
    expect(generationCounts()[template.id]).toBeUndefined()
  })

  test('orders every template history the same way as one template', () => {
    useDataDir()
    const first = blankTemplate([])
    const second = blankTemplate([first.id])
    first.title = '甲'
    second.title = '乙'
    saveLocalTemplate(first)
    saveLocalTemplate(second)
    appendGeneration(first.id, '甲一', 10)
    appendGeneration(second.id, '乙一', 10)
    appendGeneration(first.id, '甲二', 10)
    const merged = [...listGenerations(first.id), ...listGenerations(second.id)]
      .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id)
    const all = listAllGenerations()
    expect(all.map((item) => item.id)).toEqual(merged.map((item) => item.id))
    expect(all.map((item) => item.title)).toEqual(merged.map((item) => item.templateId === first.id ? '甲' : '乙'))
    appendGeneration('gone', '残留', 10)
    expect(listAllGenerations().find((item) => item.prompt === '残留')?.title).toBe('')
  })

  test('drops a template removed from the repo and keeps its local history', async () => {
    const dir = useDataDir()
    const repo = path.join(dir, 'repo')
    await mkdir(path.join(repo, 'prompts'), { recursive: true })
    await writeFile(
      path.join(repo, 'prompts', 'note.md'),
      '---\ntitle: 笔记\ndescription: ""\nupdatedAt: 10\nslots: []\n---\n\n原文\n',
    )
    await migrateFilesIfEmpty(repo)
    appendGeneration('note', '用过一次', 20)
    await rm(path.join(repo, 'prompts', 'note.md'))
    await importRepoTemplates(repo)
    expect(listLocalTemplates()).toEqual([])
    expect(listGenerations('note').map((item) => item.prompt)).toEqual(['用过一次'])
  })
})

function useDataDir(): string {
  const dir = path.join(os.tmpdir(), `promptdeck-db-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  return dir
}
