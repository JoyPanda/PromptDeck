import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import git from 'isomorphic-git'
import type { Template } from '../templates/parse'
import { parseTemplate } from '../templates/parse'
import { overlayLocalTemplates, parseTombstone, readDiskLibrary, reconcileLibrary, writeDiskLibrary, type LibrarySnapshot } from '../templates/library'
import type { AppConfig } from './config'
import { gitHttp } from './http'
import { authFor, gitAuthFailureMessage, gitHttpUrl } from './remote'

export class SyncError extends Error {
  readonly conflictIds: string[]

  constructor(message: string, conflictIds: string[] = [], options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SyncError'
    this.conflictIds = conflictIds
  }
}

export type SyncStatus = {
  branch: string
  ahead: number
  behind: number
  dirty: boolean
}

const authorOf = (config: AppConfig) => ({ name: config.authorName, email: config.authorEmail })

function onAuth(config: AppConfig) {
  return () => authFor(config)
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function conflictIdsFrom(error: unknown): string[] {
  if (!error || typeof error !== 'object' || !('data' in error)) return []
  const data = (error as { data?: { filepaths?: unknown } }).data
  if (!data || !Array.isArray(data.filepaths)) return []
  return data.filepaths.flatMap((filepath) => {
    if (typeof filepath !== 'string') return []
    const match = filepath.match(/(?:^|\/)prompts\/([A-Za-z0-9_-]+)\.md$/)
    return match?.[1] ? [match[1]] : []
  })
}

function explain(error: unknown, fallback: string, auth: AppConfig['auth'] = 'token', provider: AppConfig['provider'] = 'github'): SyncError {
  if (error instanceof SyncError) return error
  const code = errorCode(error)
  const message = errorMessage(error)
  if (code === 'MergeConflictError') {
    return new SyncError('拉取时发生冲突。冲突标记已留在文件里，请改完后再保存。', conflictIdsFrom(error), { cause: error })
  }
  if (code === 'CheckoutConflictError') {
    return new SyncError('本地有未提交的修改，拉取已取消。', [], { cause: error })
  }
  if (
    (code === 'NotFoundError' && /refs\/heads|branch|HEAD/i.test(message)) ||
    /empty repository|does not have any commits|could not find refs\/heads/i.test(message)
  ) {
    return new SyncError('远端仓库需要已经有初始提交。请先在网页上创建仓库并勾选 Initialize README。', [], { cause: error })
  }
  const status = httpStatus(error)
  if (status === 401 || status === 403 || /unauthorized|authentication|forbidden/i.test(`${message}\n${responseText(error)}`)) {
    return new SyncError(gitAuthFailureMessage(provider, auth, responseText(error)), [], { cause: error })
  }
  return new SyncError(syncFailureText(error, fallback), [], { cause: error })
}

export function syncFailureText(error: unknown, fallback: string): string {
  const detail = failureDetail(error)
  return detail ? `${fallback}${detail}` : `${fallback}没有更具体的原因。`
}

function httpStatus(error: unknown): number {
  if (!error || typeof error !== 'object' || !('data' in error)) return 0
  const statusCode = (error as { data?: { statusCode?: unknown } }).data?.statusCode
  return typeof statusCode === 'number' ? statusCode : 0
}

function failureDetail(error: unknown): string {
  const codes: string[] = []
  const messages: string[] = []
  collectFailure(error, codes, messages, new Set())
  const summary = summarizeFailure(codes, messages)
  const raw = [...codes, ...messages].filter((item) => item && item !== summary && !summary.includes(item)).join(' ')
  if (summary && raw) return `${summary}（${raw}）`
  return summary || raw
}

function collectFailure(error: unknown, codes: string[], messages: string[], seen: Set<unknown>): void {
  if (!error || typeof error !== 'object' || seen.has(error)) return
  seen.add(error)
  const code = errorCode(error)
  if (code && code !== 'HttpError' && !codes.includes(code)) codes.push(code)
  const status = httpStatus(error)
  if (status) messages.push(`HTTP ${status}`)
  const message = errorMessage(error).trim()
  if (message && message !== 'fetch failed' && message !== 'Error' && !messages.includes(message)) messages.push(message)
  const nested = (error as { errors?: unknown }).errors
  if (Array.isArray(nested)) {
    for (const item of nested) collectFailure(item, codes, messages, seen)
  }
  collectFailure((error as { cause?: unknown }).cause, codes, messages, seen)
}

function summarizeFailure(codes: string[], messages: string[]): string {
  const blob = `${codes.join(' ')} ${messages.join(' ')}`
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(blob)) return '找不到仓库地址'
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(blob)) return '连接仓库超时'
  if (/ECONNRESET|ECONNREFUSED|EPIPE|EHOSTUNREACH|ENETUNREACH/i.test(blob)) return '连接仓库失败'
  if (/CERT_|UNABLE_TO_VERIFY|certificate/i.test(blob)) return '证书校验失败'
  if (/EPERM|EBUSY|EACCES|index\.lock/i.test(blob)) return '仓库文件被占用'
  const status = messages.find((item) => /^HTTP \d+/.test(item))
  if (status) return status
  return messages.find((item) => item !== 'fetch failed' && item !== 'Error') ?? ''
}

function responseText(error: unknown): string {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const response = (error as { data?: { response?: unknown } }).data?.response
  return typeof response === 'string' ? response : ''
}

function isAuthFailure(error: unknown): boolean {
  const code = errorCode(error)
  const message = `${errorMessage(error)}\n${responseText(error)}`
  return code === 'HttpError' || /401|403|unauthorized|authentication|forbidden/i.test(message)
}

async function gitlabTokenConfig(config: AppConfig, error: unknown): Promise<AppConfig | null> {
  if (config.provider !== 'gitlab' || config.auth !== 'password' || !isAuthFailure(error)) return null
  const token = await exchangeGitlabPassword(config.remoteUrl, config.username, config.password)
  if (!token) return null
  return { ...config, auth: 'token', token }
}

async function exchangeGitlabPassword(remoteUrl: string, username: string, password: string): Promise<string | null> {
  try {
    const response = await fetch(new URL('/oauth/token', remoteUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'password', username, password }),
    })
    if (!response.ok) return null
    const payload = await response.json() as { access_token?: unknown }
    return typeof payload.access_token === 'string' && payload.access_token ? payload.access_token : null
  } catch {
    return null
  }
}
function isPushRejected(error: unknown): boolean {
  const code = errorCode(error)
  const message = errorMessage(error)
  return code === 'PushRejectedError' || /non-fast-forward|push declined|rejected non-fast-forward/i.test(message)
}

async function moveDir(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code !== 'EXDEV') throw error
    await fs.promises.cp(from, to, { recursive: true })
    await fs.promises.rm(from, { recursive: true, force: true })
  }
}

export async function cloneKeepingLocalPrompts(dir: string, config: AppConfig): Promise<void> {
  const kept = await readDiskLibrary(dir)
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'promptdeck-clone-'))
  try {
    await cloneRepo(staging, config)
    const decision = reconcileLibrary(kept, await readDiskLibrary(staging))
    await writeDiskLibrary(staging, decision)
    await commitPromptChanges(staging, config, 'prompt: sync library')
    await pushRepo(staging, config)
    await fs.promises.mkdir(path.dirname(dir), { recursive: true })
    if (fs.existsSync(dir)) {
      const backup = `${dir}.bak-${Date.now()}`
      await fs.promises.rename(dir, backup)
      try {
        await moveDir(staging, dir)
      } catch (error) {
        await fs.promises.rename(backup, dir)
        throw error
      }
      await fs.promises.rm(backup, { recursive: true, force: true })
    } else {
      await moveDir(staging, dir)
    }
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function cloneRepo(dir: string, config: AppConfig): Promise<void> {
  try {
    await withGitlabLogin(config, (active) => cloneOnce(dir, active))
  } catch (error) {
    throw explain(error, '克隆仓库失败。', config.auth, config.provider)
  }
}

async function cloneOnce(dir: string, config: AppConfig): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true })
  await fs.promises.mkdir(path.dirname(dir), { recursive: true })
  await git.clone({
    fs,
    http: gitHttp,
    dir,
    url: gitHttpUrl(config.remoteUrl),
    ref: config.branch,
    singleBranch: true,
    onAuth: onAuth(config),
  })
  let commits: unknown[] = []
  try {
    commits = await git.log({ fs, dir, depth: 1 })
  } catch (error) {
    if (errorCode(error) !== 'NotFoundError') throw error
  }
  if (commits.length === 0) {
    throw new SyncError('远端仓库需要已经有初始提交。请先在网页上创建仓库并勾选 Initialize README。')
  }
}

async function withGitlabLogin(config: AppConfig, run: (config: AppConfig) => Promise<void>): Promise<void> {
  try {
    await run(config)
  } catch (error) {
    const next = await gitlabTokenConfig(config, error)
    if (!next) throw error
    await run(next)
  }
}

export async function pullRepo(dir: string, config: AppConfig): Promise<void> {
  try {
    await withGitlabLogin(config, (active) => pullOnce(dir, active))
  } catch (error) {
    throw explain(error, '拉取失败。', config.auth, config.provider)
  }
}

async function pullOnce(dir: string, config: AppConfig): Promise<void> {
  await git.fetch({
    fs,
    http: gitHttp,
    dir,
    url: gitHttpUrl(config.remoteUrl),
    remote: 'origin',
    ref: config.branch,
    remoteRef: config.branch,
    singleBranch: true,
    onAuth: onAuth(config),
  })
  const merged = await git.merge({
    fs,
    dir,
    ours: config.branch,
    theirs: `origin/${config.branch}`,
    author: authorOf(config),
    abortOnConflict: false,
    fastForward: true,
  })
  if (!merged.alreadyMerged) {
    await git.checkout({ fs, dir, ref: config.branch })
  }
}

async function mergeParents(dir: string, branch: string): Promise<string[] | undefined> {
  const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
  let theirs = ''
  try {
    theirs = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
  } catch {
    return undefined
  }
  if (!theirs || head === theirs) return undefined
  const bases = await git.findMergeBase({ fs, dir, oids: [head, theirs] })
  const base = bases[0]
  if (bases.length === 1 && base === theirs) return undefined
  return [head, theirs]
}

function isDirtyRow(row: [string, number, number, number]): boolean {
  return row[1] !== 1 || row[2] !== 1 || row[3] !== 1
}

export async function commitFiles(dir: string, config: AppConfig, filepaths: string[], message: string): Promise<void> {
  for (const filepath of filepaths) {
    const absolute = path.join(dir, ...filepath.split('/'))
    if (fs.existsSync(absolute)) {
      await git.add({ fs, dir, filepath })
    } else {
      try {
        await git.remove({ fs, dir, filepath })
      } catch (error) {
        if (errorCode(error) !== 'NotFoundError') throw error
      }
    }
  }
  const matrix = await git.statusMatrix({ fs, dir })
  if (!matrix.some(isDirtyRow)) return
  const parent = await mergeParents(dir, config.branch)
  await git.commit({
    fs,
    dir,
    message,
    author: authorOf(config),
    ...(parent ? { parent } : {}),
  })
}

async function pushHead(dir: string, config: AppConfig): Promise<void> {
  await withGitlabLogin(config, async (active) => {
    await git.push({
      fs,
      http: gitHttp,
      dir,
      url: gitHttpUrl(active.remoteUrl),
      remote: 'origin',
      ref: active.branch,
      remoteRef: active.branch,
      onAuth: onAuth(active),
    })
  })
}

export async function pushRepo(dir: string, config: AppConfig, localTemplates: Template[] = []): Promise<void> {
  try {
    await pushHead(dir, config)
  } catch (error) {
    if (!isPushRejected(error)) throw explain(error, '推送失败。', config.auth, config.provider)
    await reconcilePrompts(dir, config, localTemplates)
    try {
      await pushHead(dir, config)
    } catch (retry) {
      throw explain(retry, '推送失败。', config.auth, config.provider)
    }
  }
}

export async function syncLibrary(dir: string, config: AppConfig, localTemplates: Template[] = []): Promise<void> {
  try {
    await withGitlabLogin(config, async (active) => {
      await reconcilePrompts(dir, active, localTemplates)
      await pushHead(dir, active)
    })
  } catch (error) {
    if (!isPushRejected(error)) throw explain(error, '同步失败。', config.auth, config.provider)
    try {
      await withGitlabLogin(config, async (active) => {
        await reconcilePrompts(dir, active, localTemplates)
        await pushHead(dir, active)
      })
    } catch (retry) {
      throw explain(retry, '同步失败。', config.auth, config.provider)
    }
  }
}

async function reconcilePrompts(dir: string, config: AppConfig, localTemplates: Template[]): Promise<void> {
  await git.fetch({
    fs,
    http: gitHttp,
    dir,
    url: gitHttpUrl(config.remoteUrl),
    remote: 'origin',
    ref: config.branch,
    remoteRef: config.branch,
    singleBranch: true,
    onAuth: onAuth(config),
  })
  const local = overlayLocalTemplates(await readDiskLibrary(dir), localTemplates)
  const remote = await readRefLibrary(dir, `refs/remotes/origin/${config.branch}`)
  const decision = reconcileLibrary(local, remote)
  if (await canFastForward(dir, config.branch) && !(await isWorkingTreeDirty(dir))) {
    await git.merge({
      fs,
      dir,
      ours: config.branch,
      theirs: `origin/${config.branch}`,
      author: authorOf(config),
      fastForward: true,
      abortOnConflict: true,
    })
    await git.checkout({ fs, dir, ref: config.branch })
  } else {
    await adoptUnchangedRemoteFiles(dir, config.branch)
  }
  await writeDiskLibrary(dir, decision)
  await commitPromptChanges(dir, config, 'prompt: sync library')
}

async function canFastForward(dir: string, branch: string): Promise<boolean> {
  try {
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const theirs = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
    if (head === theirs) return false
    const bases = await git.findMergeBase({ fs, dir, oids: [head, theirs] })
    return bases.length === 1 && bases[0] === head
  } catch {
    return false
  }
}

async function isWorkingTreeDirty(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir })
  return matrix.some(isDirtyRow)
}

async function adoptUnchangedRemoteFiles(dir: string, branch: string): Promise<void> {
  let oid = ''
  try {
    oid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
  } catch {
    return
  }
  const files = await git.listFiles({ fs, dir, ref: oid })
  for (const filepath of files) {
    if (filepath.startsWith('prompts/')) continue
    let state = ''
    try {
      state = await git.status({ fs, dir, filepath })
    } catch {
      state = ''
    }
    if (state !== 'unmodified') continue
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    const absolute = path.join(dir, ...filepath.split('/'))
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true })
    await fs.promises.writeFile(absolute, blob)
    await git.add({ fs, dir, filepath })
  }
}

async function readRefLibrary(dir: string, ref: string): Promise<LibrarySnapshot> {
  const oid = await git.resolveRef({ fs, dir, ref })
  const files = await git.listFiles({ fs, dir, ref: oid })
  const templates: Template[] = []
  const tombstones: LibrarySnapshot['tombstones'] = []
  for (const filepath of files) {
    const markdown = /^prompts\/([A-Za-z0-9_-]+)\.md$/.exec(filepath)
    const tombstone = /^prompts\/\.tombstones\/([A-Za-z0-9_-]+)\.json$/.exec(filepath)
    if (!markdown && !tombstone) continue
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    const text = new TextDecoder().decode(blob)
    if (markdown?.[1]) templates.push(parseTemplate(markdown[1], text))
    if (tombstone?.[1]) {
      const deletedAt = parseTombstone(text)
      if (deletedAt > 0) tombstones.push({ id: tombstone[1], deletedAt })
    }
  }
  return { templates, tombstones }
}

async function commitPromptChanges(dir: string, config: AppConfig, message: string): Promise<void> {
  const matrix = await git.statusMatrix({ fs, dir })
  const paths = matrix.filter((row) => isDirtyRow(row)).map((row) => row[0])
  if (paths.length === 0) return
  await commitFiles(dir, config, paths, message)
}

export async function commitAndPush(dir: string, config: AppConfig, filepaths: string[], message: string): Promise<void> {
  await commitFiles(dir, config, filepaths, message)
  await pushRepo(dir, config)
}

export function commitMessage(action: 'add' | 'update' | 'delete', title: string): string {
  const verb = action === 'add' ? 'add' : action === 'delete' ? 'delete' : 'update'
  const clean = title.replace(/\s+/g, ' ').trim() || 'untitled'
  return `prompt: ${verb} ${clean}`
}

export async function readSyncStatus(dir: string, branch: string): Promise<SyncStatus> {
  const matrix = await git.statusMatrix({ fs, dir })
  const dirty = matrix.some(isDirtyRow)
  let ahead = 0
  let behind = 0
  try {
    const local = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const remote = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
    if (local !== remote) {
      const localLog = await git.log({ fs, dir, ref: 'HEAD', depth: 300 })
      const remoteLog = await git.log({ fs, dir, ref: `refs/remotes/origin/${branch}`, depth: 300 })
      const remoteOids = new Set(remoteLog.map((entry) => entry.oid))
      const localOids = new Set(localLog.map((entry) => entry.oid))
      ahead = localLog.filter((entry) => !remoteOids.has(entry.oid)).length
      behind = remoteLog.filter((entry) => !localOids.has(entry.oid)).length
    }
  } catch {
    ahead = 0
    behind = 0
  }
  return { branch, ahead, behind, dirty }
}

export function formatStatus(status: SyncStatus): string {
  const sync = status.ahead === 0 && status.behind === 0 ? '已同步' : `领先 ${status.ahead} · 落后 ${status.behind}`
  return status.dirty ? `${status.branch} · ${sync} · 未提交` : `${status.branch} · ${sync}`
}
