import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { appVersion } from '../version'
import { parseChecksum } from './checksum'
import type { UpdateInfo } from './check'

const MAC_APPLY_SCRIPT = `#!/bin/sh
pid="$1"
target="$2"
staged="$3"
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
done
rm -rf "$target"
if cp -R "$staged" "$target"; then
  open "$target"
else
  osascript -e 'display alert "PromptDeck 更新失败" message "无法替换应用程序。"'
fi
`

export function updateTempDir(): string {
  return path.join(os.tmpdir(), 'promptdeck-update')
}

export function isSafeAssetName(name: string): boolean {
  return name.length > 0 && name.length <= 180 && name === path.basename(name) && !name.includes('..') && !/[\\/]/.test(name)
}

export function appBundleFromExecutable(executable: string): string | null {
  const normalized = executable.replaceAll('\\', '/')
  if (normalized.includes('/AppTranslocation/') || normalized.startsWith('/Volumes/')) return null
  const parts = normalized.split('/')
  const index = parts.findIndex((part) => part.endsWith('.app'))
  if (index < 0) return null
  return parts.slice(0, index + 1).join('/')
}

export function windowsInstallerArgs(): string[] {
  return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/PROMPTDECKRESTART=1']
}

export async function downloadUpdate(info: UpdateInfo, onProgress: (percent: number) => void): Promise<string> {
  if (!isSafeAssetName(info.assetName)) throw new Error('更新包不可用。')
  const dir = updateTempDir()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, info.assetName)
  let response: Response
  try {
    response = await fetch(info.downloadUrl, { headers: { 'User-Agent': `PromptDeck/${appVersion}`, Accept: 'application/octet-stream' } })
  } catch (error) {
    throw new Error(downloadFailure(error))
  }
  if (!response.ok || !response.body) throw new Error(`下载更新失败（HTTP ${response.status}）。`)
  const total = Number(response.headers.get('content-length') ?? '') || info.assetSize || 0
  let received = 0
  let reported = -1
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
  source.on('data', (chunk: Buffer | Uint8Array) => {
    received += chunk.length
    if (total <= 0) return
    const percent = Math.min(99, Math.round((received / total) * 100))
    if (percent === reported) return
    reported = percent
    onProgress(percent)
  })
  await pipeline(source, createWriteStream(file))
  onProgress(100)
  return file
}

export async function verifyUpdate(file: string, info: UpdateInfo): Promise<void> {
  let response: Response
  try {
    response = await fetch(info.checksumUrl, { headers: { 'User-Agent': `PromptDeck/${appVersion}` } })
  } catch (error) {
    throw new Error(verifyFailure(error))
  }
  if (!response.ok) throw new Error(`更新校验失败（HTTP ${response.status}）。`)
  const expected = parseChecksum(await response.text())
  const actual = createHash('sha256').update(await readFile(file)).digest('hex')
  if (!expected || expected !== actual) throw new Error('更新校验失败。')
}

export async function prepareUpdate(file: string): Promise<void> {
  if (!existsSync(file)) throw new Error('更新包不可用。')
  if (process.platform === 'win32') return
  if (process.platform !== 'darwin') throw new Error('当前平台不支持自动更新。')
  if (!appBundleFromExecutable(process.execPath)) throw new Error('请先把 PromptDeck 放进应用程序文件夹。')
  const dir = updateTempDir()
  const mount = path.join(dir, 'mount')
  await rm(mount, { recursive: true, force: true })
  await mkdir(mount, { recursive: true })
  const attached = await runCommand('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file])
  if (attached.code !== 0) throw new Error(attached.stderr ? `无法挂载更新包。（${attached.stderr}）` : '无法挂载更新包。')
  const staged = path.join(dir, 'PromptDeck.app')
  const source = path.join(mount, 'PromptDeck.app')
  try {
    if (!existsSync(path.join(source, 'Contents', 'MacOS', 'PromptDeck'))) throw new Error('更新包不可用。')
    await rm(staged, { recursive: true, force: true })
    const copied = await runCommand('cp', ['-R', source, staged])
    if (copied.code !== 0) throw new Error(copied.stderr ? `准备更新失败。（${copied.stderr}）` : '准备更新失败。')
  } finally {
    await runCommand('hdiutil', ['detach', '-force', mount])
  }
  await writeFile(path.join(dir, 'apply-update.sh'), MAC_APPLY_SCRIPT, { mode: 0o755 })
}

export function restartToApplyUpdate(assetName: string): void {
  if (!isSafeAssetName(assetName)) throw new Error('更新包不可用。')
  const dir = updateTempDir()
  if (process.platform === 'darwin') {
    const bundle = appBundleFromExecutable(process.execPath)
    if (!bundle) throw new Error('请先把 PromptDeck 放进应用程序文件夹。')
    const staged = path.join(dir, 'PromptDeck.app')
    const script = path.join(dir, 'apply-update.sh')
    if (!existsSync(path.join(staged, 'Contents', 'MacOS', 'PromptDeck')) || !existsSync(script)) throw new Error('准备更新失败。')
    spawn('/bin/sh', [script, String(process.pid), bundle, staged], { detached: true, stdio: 'ignore' }).unref()
    process.exit(0)
  }
  if (process.platform === 'win32') {
    const installer = path.join(dir, assetName)
    if (!existsSync(installer)) throw new Error('更新包不可用。')
    spawn(installer, windowsInstallerArgs(), { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    process.exit(0)
  }
  throw new Error('当前平台不支持自动更新。')
}

function downloadFailure(error: unknown): string {
  const detail = error instanceof Error && error.message && error.message !== 'fetch failed' ? error.message : ''
  return detail ? `下载更新失败。（${detail}）` : '下载更新失败。'
}

function verifyFailure(error: unknown): string {
  const detail = error instanceof Error && error.message && error.message !== 'fetch failed' ? error.message : ''
  return detail ? `更新校验失败。（${detail}）` : '更新校验失败。'
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }))
  })
}
