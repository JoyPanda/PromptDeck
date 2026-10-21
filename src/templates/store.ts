import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseTemplate, serializeTemplate, type Template } from './parse'

const FILE_NAME = /^[A-Za-z0-9_-]+\.md$/

export function relativeTemplatePath(id: string): string {
  assertId(id)
  return `prompts/${id}.md`
}

export function templatePath(repoDir: string, id: string): string {
  return path.join(repoDir, ...relativeTemplatePath(id).split('/'))
}

export async function listTemplates(repoDir: string): Promise<Template[]> {
  const dir = path.join(repoDir, 'prompts')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code === 'ENOENT') return []
    throw error
  }
  const templates: Template[] = []
  for (const name of names) {
    if (!FILE_NAME.test(name)) continue
    const id = name.slice(0, -3)
    const markdown = await readFile(path.join(dir, name), 'utf8')
    templates.push(parseTemplate(id, markdown))
  }
  templates.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  return templates
}

export async function saveTemplate(repoDir: string, template: Template): Promise<void> {
  const file = templatePath(repoDir, template.id)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, serializeTemplate(template), 'utf8')
}

export async function deleteTemplateFile(repoDir: string, id: string): Promise<void> {
  await unlink(templatePath(repoDir, id))
}

function assertId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('模板 id 无效')
  }
}
