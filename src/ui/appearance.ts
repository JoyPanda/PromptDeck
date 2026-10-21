import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

export function macPrefersDark(stdout: string, status: number | null): boolean {
  return status === 0 && stdout.trim() === 'Dark'
}

export function windowsPrefersDark(stdout: string): boolean {
  const match = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(stdout)
  if (!match?.[1]) return false
  return Number.parseInt(match[1], 16) === 0
}

export function readSystemDark(): boolean {
  try {
    if (process.platform === 'darwin') {
      const result = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], { encoding: 'utf8' })
      return macPrefersDark(result.stdout ?? '', result.status)
    }
    if (process.platform === 'win32') return readWindowsDark()
  } catch {
    return false
  }
  return false
}

// HKEY_CURRENT_USER is a signed 32-bit constant, sign-extended on 64-bit Windows.
const HKEY_CURRENT_USER = 0xffffffff80000001n
const KEY_READ = 0x20019

let windowsQuery: (() => number | null) | null = null

export function watchSystemAppearance(onChange: (dark: boolean) => void): () => void {
  try {
    onChange(readSystemDark())
    if (process.platform === 'darwin') return watchMacAppearance(onChange)
    if (process.platform === 'win32') return watchWindowsAppearance(onChange)
  } catch {
    return () => {}
  }
  return () => {}
}

function watchMacAppearance(onChange: (dark: boolean) => void): () => void {
  const { dlopen, FFIType, JSCallback } = createRequire(import.meta.url)('bun:ffi') as typeof import('bun:ffi')
  const cf = dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
    CFNotificationCenterGetDistributedCenter: { args: [], returns: FFIType.ptr },
    CFNotificationCenterAddObserver: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
      returns: FFIType.void,
    },
    CFNotificationCenterRemoveObserver: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.void,
    },
    CFStringCreateWithCString: { args: [FFIType.ptr, FFIType.cstring, FFIType.u32], returns: FFIType.ptr },
  })
  const center = cf.symbols.CFNotificationCenterGetDistributedCenter()
  const name = cf.symbols.CFStringCreateWithCString(null, 'AppleInterfaceThemeChangedNotification', 0x08000100)
  const callback = new JSCallback(() => onChange(readSystemDark()), {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  })
  if (!center || !name || !callback.ptr) return () => callback.close()
  cf.symbols.CFNotificationCenterAddObserver(center, callback.ptr, callback.ptr, name, null, 4)
  return () => {
    cf.symbols.CFNotificationCenterRemoveObserver(center, callback.ptr, name, null)
    callback.close()
  }
}

function watchWindowsAppearance(onChange: (dark: boolean) => void): () => void {
  // A blocking registry watch in a worker never delivered changes, and it could
  // stall the process until a bounds query timed out. Reading the key is cheap.
  let last = readSystemDark()
  const timer = setInterval(() => {
    const next = readSystemDark()
    if (next === last) return
    last = next
    onChange(next)
  }, 1000)
  return () => clearInterval(timer)
}

function readWindowsDark(): boolean {
  try {
    if (!windowsQuery) windowsQuery = bindWindowsTheme()
    return windowsQuery() === 0
  } catch {
    return false
  }
}

function wide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le')
}

function bindWindowsTheme(): () => number | null {
  // A console child such as reg.exe flashes the title bar and shifts the window.
  const { dlopen, FFIType } = createRequire(import.meta.url)('bun:ffi') as typeof import('bun:ffi')
  const adv = dlopen('advapi32.dll', {
    RegOpenKeyExW: {
      args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    RegQueryValueExW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    RegCloseKey: {
      args: [FFIType.ptr],
      returns: FFIType.i32,
    },
  })
  const subkey = wide('Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize')
  const valueName = wide('AppsUseLightTheme')
  return () => {
    const hkey = Buffer.alloc(8)
    if (adv.symbols.RegOpenKeyExW(HKEY_CURRENT_USER, subkey, 0, KEY_READ, hkey) !== 0) return null
    const handle = hkey.readBigUInt64LE(0)
    try {
      const data = Buffer.alloc(4)
      const size = Buffer.alloc(4)
      size.writeUInt32LE(4, 0)
      if (adv.symbols.RegQueryValueExW(handle, valueName, null, null, data, size) !== 0) return null
      return data.readUInt32LE(0)
    } finally {
      adv.symbols.RegCloseKey(handle)
    }
  }
}
