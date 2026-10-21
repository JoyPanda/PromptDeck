import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './git/config'
import { defaultShortcut, isBindableKey, type Shortcut } from './hotkey/shortcut'

export type Appearance = 'system' | 'dark' | 'light'

export const DEFAULT_HISTORY_LIMIT = 20
export const MIN_HISTORY_LIMIT = 1
export const MAX_HISTORY_LIMIT = 200
export const DEFAULT_FONT_SIZE = 12
export const MIN_FONT_SIZE = 11
export const MAX_FONT_SIZE = 20

export type Settings = {
  appearance: Appearance
  shortcut: Shortcut | null
  historyLimit: number
  fontFamily: string
  fontSize: number
  closeToTray: boolean
  autoSync: boolean
  autoCheckUpdates: boolean
  updateLastCheckAt: string
}

export function defaultFontFamily(): string {
  return process.platform === 'win32' ? 'Microsoft YaHei' : 'PingFang SC'
}

export function fontSizeChoices(): Array<{ id: string; label: string }> {
  return [12, 13, 14, 16, 18].map((size) => ({ id: String(size), label: String(size) }))
}

export function fontChoices(): Array<{ id: string; label: string }> {
  if (process.platform === 'win32') {
    return [
      { id: 'Microsoft YaHei', label: '微软雅黑' },
      { id: 'SimSun', label: '宋体' },
      { id: 'SimHei', label: '黑体' },
      { id: 'Consolas', label: '等宽' },
    ]
  }
  return [
    { id: 'PingFang SC', label: '苹方' },
    { id: 'Hiragino Sans GB', label: '冬青黑体' },
    { id: 'Songti SC', label: '宋体' },
    { id: 'Menlo', label: '等宽' },
  ]
}

export function defaultSettings(): Settings {
  return {
    appearance: 'system',
    shortcut: defaultShortcut(),
    historyLimit: DEFAULT_HISTORY_LIMIT,
    fontFamily: defaultFontFamily(),
    fontSize: DEFAULT_FONT_SIZE,
    closeToTray: false,
    autoSync: true,
    autoCheckUpdates: true,
    updateLastCheckAt: '',
  }
}

export function parseHistoryLimit(value: unknown, fallback = DEFAULT_HISTORY_LIMIT): number {
  const number = typeof value === 'number' ? value : NaN
  if (!Number.isInteger(number) || number < MIN_HISTORY_LIMIT || number > MAX_HISTORY_LIMIT) return fallback
  return number
}

export function parseFontSize(value: unknown, fallback = DEFAULT_FONT_SIZE): number {
  const number = typeof value === 'number' ? value : NaN
  if (!Number.isInteger(number) || number < MIN_FONT_SIZE || number > MAX_FONT_SIZE) return fallback
  return number
}

export function parseFontFamily(value: unknown, fallback = defaultFontFamily()): string {
  if (typeof value !== 'string') return fallback
  const name = value.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) return fallback
  return name
}

export function settingsPath(): string {
  return path.join(dataDir(), 'settings.json')
}

export function parseSettings(raw: string): Settings {
  const fallback = defaultSettings()
  try {
    const parsed = JSON.parse(raw) as { appearance?: unknown; shortcut?: unknown; historyLimit?: unknown; fontFamily?: unknown; fontSize?: unknown; closeToTray?: unknown; autoSync?: unknown; autoCheckUpdates?: unknown; updateLastCheckAt?: unknown }
    const appearance = parsed.appearance === 'dark' || parsed.appearance === 'light' || parsed.appearance === 'system' ? parsed.appearance : fallback.appearance
    return {
      appearance,
      shortcut: parseShortcut(parsed.shortcut, fallback.shortcut ?? defaultShortcut()),
      historyLimit: parseHistoryLimit(parsed.historyLimit, fallback.historyLimit),
      fontFamily: parseFontFamily(parsed.fontFamily, fallback.fontFamily),
      fontSize: parseFontSize(parsed.fontSize, fallback.fontSize),
      closeToTray: parsed.closeToTray === true,
      autoSync: parsed.autoSync !== false,
      autoCheckUpdates: parsed.autoCheckUpdates !== false,
      updateLastCheckAt: typeof parsed.updateLastCheckAt === 'string' ? parsed.updateLastCheckAt : '',
    }
  } catch {
    return fallback
  }
}

function parseShortcut(value: unknown, fallback: Shortcut): Shortcut | null {
  if (value === undefined) return fallback
  if (value === null) return null
  if (!value || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  const key = typeof record.key === 'string' ? record.key.trim().toLowerCase() : ''
  if (!isBindableKey(key)) return fallback
  const shortcut: Shortcut = {
    key,
    cmd: record.cmd === true,
    shift: record.shift === true,
    alt: record.alt === true,
    ctrl: record.ctrl === true,
  }
  if (!shortcut.cmd && !shortcut.shift && !shortcut.alt && !shortcut.ctrl) return fallback
  return shortcut
}

export async function loadSettings(): Promise<Settings> {
  const file = settingsPath()
  if (!existsSync(file)) return defaultSettings()
  try {
    return parseSettings(await readFile(file, 'utf8'))
  } catch {
    return defaultSettings()
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
