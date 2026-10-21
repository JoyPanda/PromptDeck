import { execFile } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AuthMode, Provider } from './remote'

const exec = promisify(execFile)
const KEY_ACCOUNT = 'config-key'

export type AppConfig = {
  provider: Provider
  remoteUrl: string
  branch: string
  auth: AuthMode
  token: string
  username: string
  password: string
  authorName: string
  authorEmail: string
}

export function dataDirFor(platform: string, home: string, appData?: string): string {
  if (platform === 'win32') {
    const base = appData || path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(base, 'PromptDeck')
  }
  return path.posix.join(home, 'Library', 'Application Support', 'PromptDeck')
}

export function dataDir(): string {
  const override = process.env.PROMPTDECK_DATA_DIR
  if (override) return override
  return dataDirFor(process.platform, os.homedir(), process.env.APPDATA)
}

export function configPath(): string {
  return path.join(dataDir(), 'config.json')
}

export function repoDir(): string {
  return path.join(dataDir(), 'repo')
}

export async function loadConfig(): Promise<AppConfig | null> {
  const file = configPath()
  if (!existsSync(file)) return null
  try {
    const raw = await readFile(file, 'utf8')
    const plain = await decryptStored(raw)
    return parseConfig(plain ?? raw)
  } catch {
    return null
  }
}

export function parseConfig(raw: string): AppConfig | null {
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  if (!parsed.remoteUrl || !parsed.authorName || !parsed.authorEmail) return null
  if (parsed.provider !== 'github' && parsed.provider !== 'gitlab') return null
  const auth: AuthMode = parsed.auth === 'password' ? 'password' : 'token'
  const username = parsed.username?.trim() ?? ''
  const password = parsed.password ?? ''
  const token = parsed.token?.trim() ?? ''
  if (auth === 'password') {
    if (!username || !password.trim()) return null
  } else if (!token) {
    return null
  }
  return {
    provider: parsed.provider,
    remoteUrl: parsed.remoteUrl,
    branch: parsed.branch?.trim() || 'main',
    auth,
    token,
    username,
    password,
    authorName: parsed.authorName,
    authorEmail: parsed.authorEmail,
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const dir = dataDir()
  await mkdir(dir, { recursive: true })
  const key = await loadOrCreateKey()
  const file = configPath()
  await writeFile(file, `${encryptJson(JSON.stringify(config), key)}\n`, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') await chmod(file, 0o600)
}

export function encryptJson(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  })
}

export function decryptJson(raw: string, key: Buffer): string | null {
  try {
    const parsed = JSON.parse(raw) as { v?: number; iv?: string; tag?: string; data?: string }
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return null
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function keyFile(): string {
  return path.join(dataDir(), 'config.key')
}

async function decryptStored(raw: string): Promise<string | null> {
  if (!raw.includes('"aes-256-gcm"')) return null
  const key = await readStoredKey()
  if (!key) return null
  return decryptJson(raw, key)
}

async function loadOrCreateKey(): Promise<Buffer> {
  const existing = await readStoredKey()
  if (existing) return existing
  const key = randomBytes(32)
  if (!(await writePlatformKey(key))) {
    await mkdir(dataDir(), { recursive: true })
    await writeFile(keyFile(), `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') await chmod(keyFile(), 0o600)
  }
  return key
}

async function readStoredKey(): Promise<Buffer | null> {
  const override = process.env.PROMPTDECK_CONFIG_KEY
  if (override) {
    const key = Buffer.from(override, 'base64')
    return key.length === 32 ? key : null
  }
  const stored = await readPlatformKey()
  if (stored) return stored
  if (!existsSync(keyFile())) return null
  const key = Buffer.from((await readFile(keyFile(), 'utf8')).trim(), 'base64')
  return key.length === 32 ? key : null
}

async function readPlatformKey(): Promise<Buffer | null> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await exec('security', ['find-generic-password', '-s', 'PromptDeck', '-a', KEY_ACCOUNT, '-w'], { encoding: 'utf8', timeout: 5000 })
      return decodeKey(stdout)
    }
    if (process.platform === 'linux') {
      const { stdout } = await exec('secret-tool', ['lookup', 'service', 'PromptDeck', 'account', KEY_ACCOUNT], { encoding: 'utf8', timeout: 5000 })
      return decodeKey(stdout)
    }
  } catch {
    return null
  }
  return null
}

async function writePlatformKey(key: Buffer): Promise<boolean> {
  if (process.env.PROMPTDECK_CONFIG_KEY) return true
  const encoded = key.toString('base64')
  try {
    if (process.platform === 'darwin') {
      await exec('security', ['add-generic-password', '-s', 'PromptDeck', '-a', KEY_ACCOUNT, '-w', encoded, '-U'], { timeout: 5000 })
      return true
    }
  } catch {
    return false
  }
  return false
}

function decodeKey(raw: string): Buffer | null {
  const key = Buffer.from(raw.trim(), 'base64')
  return key.length === 32 ? key : null
}

export function sameRemote(a: AppConfig, b: AppConfig): boolean {
  return a.provider === b.provider && a.remoteUrl === b.remoteUrl && a.branch === b.branch
}
