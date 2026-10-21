import type { Shortcut } from './shortcut'
import { windowsHotkey } from './shortcut'
import { submitWindowsHotkey } from '../window/tray-win'

let shortcut: Shortcut | null = null
let suspended = false
let fault = ''
let chain: Promise<unknown> = Promise.resolve()

export function windowsHotkeyFault(): string {
  return fault
}

export function syncWindowsHotkey(next: Shortcut | null): void {
  if (process.platform !== 'win32') return
  shortcut = next
  void enqueue(() => publish())
}

export function setWindowsHotkeySuspended(value: boolean): void {
  if (process.platform !== 'win32') return
  suspended = value
  void enqueue(() => publish())
}

export function tryWindowsHotkey(next: Shortcut): Promise<'ok' | 'conflict' | 'failed'> {
  if (process.platform !== 'win32') return Promise.resolve('ok')
  return enqueue(() => claim(next))
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(() => undefined, () => undefined)
  return run
}

async function publish(): Promise<void> {
  const active = suspended ? null : windowsHotkey(shortcut)
  await submitWindowsHotkey(active?.mods ?? 0, active?.vk ?? 0)
}

async function claim(next: Shortcut): Promise<'ok' | 'conflict' | 'failed'> {
  const encoded = windowsHotkey(next)
  if (!encoded) {
    fault = '无法注册这个快捷键。'
    return 'failed'
  }
  const result = await submitWindowsHotkey(encoded.mods, encoded.vk)
  fault = result.fault
  if (result.status === 'ok') return 'ok'
  const restore = suspended ? null : windowsHotkey(shortcut)
  await submitWindowsHotkey(restore?.mods ?? 0, restore?.vk ?? 0)
  return result.status
}
