import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const WM_SETICON = 0x0080
const ICON_SMALL = 0
const ICON_BIG = 1
const IMAGE_ICON = 1
const LR_LOADFROMFILE = 0x00000010

type NativePtr = bigint | number
type User32 = {
  EnumWindows: (callback: NativePtr, param: null) => number
  GetWindowTextW: (hwnd: NativePtr, buffer: Buffer, count: number) => number
  IsWindowVisible: (hwnd: NativePtr) => number
  IsIconic: (hwnd: NativePtr) => number
  GetForegroundWindow: () => NativePtr | null
  LoadImageW: (instance: null, path: Buffer, type: number, width: number, height: number, flags: number) => NativePtr | null
  SendMessageW: (hwnd: NativePtr, message: number, wparam: bigint, lparam: NativePtr) => bigint | number
}

let user32: User32 | null = null
let ffi: typeof import('bun:ffi') | null = null

export function installWindowsIcon(): void {
  if (process.platform !== 'win32') return
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (applyWindowsIcon() || attempts > 30) clearInterval(timer)
  }, 100)
  if (applyWindowsIcon()) clearInterval(timer)
}

export function promptDeckIsForeground(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const api = loadUser32()
    const foreground = api.GetForegroundWindow()
    if (foreground == null || windowTitle(foreground) !== 'PromptDeck') return false
    return api.IsIconic(foreground) === 0
  } catch {
    return false
  }
}

function applyWindowsIcon(): boolean {
  const file = windowsIconPath()
  if (!file) return false
  try {
    const api = loadUser32()
    const big = api.LoadImageW(null, wide(file), IMAGE_ICON, 32, 32, LR_LOADFROMFILE)
    const small = api.LoadImageW(null, wide(file), IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
    if (!big && !small) return false
    const windows = promptDeckWindows()
    if (windows.length === 0) return false
    for (const hwnd of windows) {
      if (big) api.SendMessageW(hwnd, WM_SETICON, BigInt(ICON_BIG), big)
      if (small) api.SendMessageW(hwnd, WM_SETICON, BigInt(ICON_SMALL), small)
    }
    return true
  } catch {
    return false
  }
}

export function windowsIconPath(): string | null {
  const candidates = [
    process.env.PROMPTDECK_ICON,
    path.join(process.cwd(), 'assets', 'PromptDeck.ico'),
    path.join(path.dirname(process.execPath), 'PromptDeck.ico'),
  ]
  return candidates.find((file) => file && existsSync(file)) ?? null
}

function promptDeckWindows(): NativePtr[] {
  const found: NativePtr[] = []
  const { JSCallback, FFIType } = loadFFI()
  const callback = new JSCallback((hwnd: NativePtr) => {
    try {
      if (loadUser32().IsWindowVisible(hwnd) && windowTitle(hwnd) === 'PromptDeck') found.push(hwnd)
    } catch {
      return 1
    }
    return 1
  }, {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  })
  const callbackPtr = callback.ptr as NativePtr | null
  if (callbackPtr == null) return []
  loadUser32().EnumWindows(callbackPtr, null)
  return found
}

function windowTitle(hwnd: NativePtr): string {
  const buf = Buffer.alloc(512)
  const count = loadUser32().GetWindowTextW(hwnd, buf, 256)
  if (count <= 0) return ''
  return buf.toString('utf16le', 0, count * 2)
}

function wide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le')
}

function loadFFI(): typeof import('bun:ffi') {
  if (!ffi) ffi = createRequire(import.meta.url)('bun:ffi') as typeof import('bun:ffi')
  return ffi
}

function loadUser32(): User32 {
  if (user32) return user32
  const { dlopen, FFIType } = loadFFI()
  const lib = dlopen('user32.dll', {
    EnumWindows: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetWindowTextW: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
    IsIconic: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetForegroundWindow: { args: [], returns: FFIType.ptr },
    LoadImageW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
      returns: FFIType.ptr,
    },
    SendMessageW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
      returns: FFIType.i64,
    },
  })
  user32 = lib.symbols as User32
  return user32
}
