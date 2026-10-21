import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cloneKeepingLocalPrompts, cloneRepo, commitAndPush, commitMessage, formatStatus, pullRepo, readSyncStatus, syncFailureText, syncLibrary } from './sync'
import type { AppConfig } from './config'
import { relativeTemplatePath, saveTemplate } from '../templates/store'
import { parseTemplate } from '../templates/parse'

// isomorphic-git only speaks HTTP. The tests serve a local bare repo through
// git's own http-backend so clone, push, and pull never leave the machine.

const roots: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()))
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-git-'))
  roots.push(dir)
  return dir
}

const servers: Array<() => Promise<void>> = []

async function runGit(args: string[], cwd?: string): Promise<void> {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve(status ?? 1))
  })
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString() || `git ${args.join(' ')} failed`)
}

function serveGit(projectRoot: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handleGitHttp(projectRoot, request, response)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试用 Git 服务没有端口')
      const close = () => new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())))
      servers.push(close)
      resolve({ url: `http://127.0.0.1:${address.port}`, close })
    })
  })
}

async function handleGitHttp(projectRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      CONTENT_LENGTH: request.headers['content-length'] ?? '',
    },
  })
  request.pipe(child.stdin)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number>((resolve) => {
    child.on('error', () => resolve(1))
    child.on('close', (status) => resolve(status ?? 1))
  })
  if (code !== 0) {
    response.writeHead(500, { 'content-type': 'text/plain' })
    response.end(Buffer.concat(stderr).toString() || 'git http-backend failed')
    return
  }
  const output = Buffer.concat(stdout)
  const separator = output.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const splitAt = output.indexOf(separator)
  const headerText = output.subarray(0, splitAt).toString('utf8')
  const body = output.subarray(splitAt + separator.length)
  let status = 200
  const headers: Record<string, string> = {}
  for (const line of headerText.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1] ?? ''
    const value = match[2] ?? ''
    if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0] ?? 200)
    else headers[name] = value
  }
  response.writeHead(status, headers)
  response.end(body)
}

async function seedRemote(root: string, withCommit: boolean): Promise<AppConfig> {
  const projectRoot = path.join(root, 'repos')
  const bare = path.join(projectRoot, 'prompts.git')
  await fs.promises.mkdir(projectRoot, { recursive: true })
  await runGit(['init', '--bare', '--initial-branch=main', bare])
  await runGit(['config', 'http.receivepack', 'true'], bare)
  if (withCommit) {
    const seed = path.join(root, 'seed')
    await runGit(['init', '--initial-branch=main', seed])
    await fs.promises.writeFile(path.join(seed, 'README.md'), '# prompts\n')
    await runGit(['add', 'README.md'], seed)
    await runGit(['-c', 'user.name=PromptDeck', '-c', 'user.email=prompt@local', 'commit', '-m', 'init'], seed)
    await runGit(['remote', 'add', 'origin', bare], seed)
    await runGit(['push', 'origin', 'main'], seed)
  }
  const server = await serveGit(projectRoot)
  return {
    provider: 'github',
    remoteUrl: `${server.url}/prompts.git`,
    branch: 'main',
    token: 'test-token',
    auth: 'token',
    username: '',
    password: '',
    authorName: 'PromptDeck',
    authorEmail: 'prompt@local',
  }
}

describe('formatStatus', () => {
  test('describes a clean synced branch', () => {
    expect(formatStatus({ branch: 'main', ahead: 0, behind: 0, dirty: false })).toBe('main · 已同步')
    expect(formatStatus({ branch: 'main', ahead: 1, behind: 2, dirty: true })).toBe('main · 领先 1 · 落后 2 · 未提交')
  })
})

test('names the cause when a sync connection fails', () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) })
  expect(syncFailureText(error, '同步失败。')).toBe('同步失败。连接仓库失败（ECONNRESET connect ECONNRESET）')
  const http = Object.assign(new Error('HTTP Error: 500 Internal Server Error'), { code: 'HttpError', data: { statusCode: 500 } })
  expect(syncFailureText(http, '同步失败。')).toContain('HTTP 500')
  expect(syncFailureText(http, '同步失败。')).toContain('Internal Server Error')
})

describe('local git sync', () => {
  test('clones, commits, pushes, and pulls a template', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, true)
    const first = path.join(root, 'first')
    const second = path.join(root, 'second')
    await cloneRepo(first, config)

    const template = parseTemplate('code-review', '---\ntitle: 代码审查\ndescription: ""\nslots: []\n---\n\n看一下 {{code}}')
    await saveTemplate(first, template)
    await commitAndPush(first, config, [relativeTemplatePath(template.id)], commitMessage('add', template.title))

    await cloneRepo(second, config)
    const copied = await fs.promises.readFile(path.join(second, 'prompts', 'code-review.md'), 'utf8')
    expect(copied).toContain('看一下 {{code}}')
    expect(copied).toContain('name: code')

    await pullRepo(first, config)
    const status = await readSyncStatus(first, 'main')
    expect(status.ahead).toBe(0)
    expect(status.behind).toBe(0)
  })

  test('explains an empty remote', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, false)
    config.provider = 'gitlab'
    await expect(cloneRepo(path.join(root, 'work'), config)).rejects.toThrow('初始提交')
  })

  test('keeps local templates when git sync is turned on', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, true)
    const local = path.join(root, 'local')
    const elsewhere = path.join(root, 'elsewhere')
    await fs.promises.mkdir(path.join(local, 'prompts'), { recursive: true })
    await fs.promises.writeFile(path.join(local, 'prompts', 'local-note.md'), '---\ntitle: 本地笔记\ndescription: ""\nslots: []\n---\n\n只在本机\n')

    await cloneKeepingLocalPrompts(local, config)

    await cloneRepo(elsewhere, config)
    const copied = await fs.promises.readFile(path.join(elsewhere, 'prompts', 'local-note.md'), 'utf8')
    expect(copied).toContain('只在本机')
  })

  test('leaves local templates in place when the remote cannot be cloned', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, false)
    const local = path.join(root, 'local')
    const file = path.join(local, 'prompts', 'local-note.md')
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, '留在本机\n')

    await expect(cloneKeepingLocalPrompts(local, config)).rejects.toThrow('初始提交')
    expect(await fs.promises.readFile(file, 'utf8')).toBe('留在本机\n')
    expect(fs.existsSync(path.join(local, '.git'))).toBe(false)
  })

  test('keeps the newer edit when both devices changed one template', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, true)
    const left = path.join(root, 'left')
    const right = path.join(root, 'right')
    await cloneRepo(left, config)
    await cloneRepo(right, config)

    const base = parseTemplate('note', '---\ntitle: 笔记\ndescription: ""\nupdatedAt: 100\nslots: []\n---\n\n原文')
    await saveTemplate(left, base)
    await commitAndPush(left, config, [relativeTemplatePath('note')], commitMessage('add', '笔记'))
    await pullRepo(right, config)

    await saveTemplate(left, { ...base, body: '左边的版本', updatedAt: 300 })
    await commitAndPush(left, config, [relativeTemplatePath('note')], commitMessage('update', '笔记'))
    await saveTemplate(right, { ...base, body: '右边的版本', updatedAt: 200 })
    await syncLibrary(right, config)

    const kept = await fs.promises.readFile(path.join(right, 'prompts', 'note.md'), 'utf8')
    expect(kept).toContain('左边的版本')
    expect(kept).not.toContain('<<<<<<<')
    await pullRepo(left, config)
    const resolved = await fs.promises.readFile(path.join(left, 'prompts', 'note.md'), 'utf8')
    expect(resolved).toContain('左边的版本')
  })

  test('applies a remote deletion and does not push the old copy back', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, true)
    const left = path.join(root, 'left')
    const right = path.join(root, 'right')
    await cloneRepo(left, config)
    await cloneRepo(right, config)
    const note = parseTemplate('note', '---\ntitle: 笔记\ndescription: ""\nupdatedAt: 100\nslots: []\n---\n\n原文')
    await saveTemplate(left, note)
    await commitAndPush(left, config, [relativeTemplatePath('note')], commitMessage('add', '笔记'))
    await syncLibrary(right, config)

    await fs.promises.rm(path.join(left, 'prompts', 'note.md'))
    await fs.promises.mkdir(path.join(left, 'prompts', '.tombstones'), { recursive: true })
    await fs.promises.writeFile(path.join(left, 'prompts', '.tombstones', 'note.json'), '{"deletedAt":200}\n')
    await commitAndPush(left, config, [relativeTemplatePath('note'), 'prompts/.tombstones/note.json'], commitMessage('delete', '笔记'))
    await syncLibrary(right, config)

    expect(fs.existsSync(path.join(right, 'prompts', 'note.md'))).toBe(false)
    const tombstone = await fs.promises.readFile(path.join(right, 'prompts', '.tombstones', 'note.json'), 'utf8')
    expect(tombstone).toContain('200')
    await syncLibrary(left, config)
    expect(fs.existsSync(path.join(left, 'prompts', 'note.md'))).toBe(false)
  })

  test('keeps a newer local edit when another device deleted the template', async () => {
    const root = await tempDir()
    const config = await seedRemote(root, true)
    const left = path.join(root, 'left')
    const right = path.join(root, 'right')
    await cloneRepo(left, config)
    await cloneRepo(right, config)
    const note = parseTemplate('note', '---\ntitle: 笔记\ndescription: ""\nupdatedAt: 100\nslots: []\n---\n\n原文')
    await saveTemplate(left, note)
    await commitAndPush(left, config, [relativeTemplatePath('note')], commitMessage('add', '笔记'))
    await syncLibrary(right, config)

    await fs.promises.rm(path.join(left, 'prompts', 'note.md'))
    await fs.promises.mkdir(path.join(left, 'prompts', '.tombstones'), { recursive: true })
    await fs.promises.writeFile(path.join(left, 'prompts', '.tombstones', 'note.json'), '{"deletedAt":200}\n')
    await commitAndPush(left, config, [relativeTemplatePath('note'), 'prompts/.tombstones/note.json'], commitMessage('delete', '笔记'))

    await saveTemplate(right, { ...note, body: '右边后来改的', updatedAt: 300 })
    await syncLibrary(right, config)
    expect(await fs.promises.readFile(path.join(right, 'prompts', 'note.md'), 'utf8')).toContain('右边后来改的')
    await syncLibrary(left, config)
    expect(await fs.promises.readFile(path.join(left, 'prompts', 'note.md'), 'utf8')).toContain('右边后来改的')
  })
})
