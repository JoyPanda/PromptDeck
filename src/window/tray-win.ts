import { dlopen, FFIType, JSCallback, type Pointer } from 'bun:ffi'
import { windowsIconPath } from './win-icon'
import {
  trayAdded,
  trayCallWindow,
  trayCode,
  trayCursor,
  trayData,
  trayDestroyMenu,
  trayEnabled,
  trayForce,
  trayForeground,
  trayGetLastError,
  trayGetText,
  trayHidden,
  trayHookHandle,
  trayHotkeyDone,
  trayHotkeyError,
  trayHotkeyMods,
  trayHotkeyResult,
  trayHotkeySeq,
  trayHotkeyVk,
  trayHwnd,
  trayMenu,
  trayNid,
  trayNidBytes,
  trayNext,
  trayNotify,
  trayOldProc,
  trayPost,
  trayRegisterHotkey,
  traySetForeground,
  traySetLong,
  trayShow,
  traySubclassed,
  trayUnregisterHotkey,
  trayWindowProc,
  trayAppend,
  trayTrack,
} from './tray-win-code'

const MEM_COMMIT = 0x1000
const MEM_RESERVE = 0x2000
const PAGE_EXECUTE_READWRITE = 0x40
const WH_CBT = 5
const WM_CLOSE = 0x10
const SW_SHOW = 5
const SW_RESTORE = 9
const WM_SYSCOMMAND = 0x0112
const SC_RESTORE = 0xf120n
const VK_MENU = 0x12
const KEYEVENTF_KEYUP = 0x2
const HWND_TOPMOST = 0xffffffffffffffffn
const HWND_NOTOPMOST = 0xfffffffffffffffen
const SWP_SHOW = 0x0001 | 0x0002 | 0x0040
const NIM_ADD = 0
const NIM_DELETE = 2
const GWLP_WNDPROC = -4
const IMAGE_ICON = 1
const LR_LOADFROMFILE = 0x10
const HOTKEY_BIND = 0x8002
const HOTKEY_OK = 1
const HOTKEY_CONFLICT = 2
const ERROR_HOTKEY_ALREADY_REGISTERED = 1409

let page: bigint | null = null
let timer: ReturnType<typeof setInterval> | null = null
let hooked = false
let remembered = 0n
let hotkeySeq = 0

export function syncWindowsTray(enabled: boolean): void {
  if (process.platform !== 'win32') return
  try {
    if (!enabled) {
      disarm()
      return
    }
    const base = ensurePage()
    if (!base) return
    writeU32(base + BigInt(trayData + trayEnabled), 1)
    if (hooked || installHook(base)) return
    if (timer) return
    let attempts = 0
    timer = setInterval(() => {
      attempts += 1
      if (installHook(base) || attempts > 150) {
        if (timer) clearInterval(timer)
        timer = null
      }
    }, 200)
  } catch {
    disarm()
  }
}

export function findPromptDeckWindow(): bigint {
  if (process.platform !== 'win32') return 0n
  try {
    const stored = page ? readU64(page + BigInt(trayData + trayHwnd)) : 0n
    if (stored && user32().IsWindow(stored) !== 0) return stored
    return findWindow()
  } catch {
    return 0n
  }
}

export function windowsTrayFlagAddress(): bigint {
  if (!page) return 0n
  return page + BigInt(trayData + trayHidden)
}

// RegisterHotKey must run on the thread that created the window. The JS thread is
// not that thread, so the request is posted and the window procedure registers it.
export async function submitWindowsHotkey(mods: number, vk: number): Promise<{ status: 'ok' | 'conflict' | 'failed'; fault: string }> {
  if (process.platform !== 'win32') return { status: 'ok', fault: '' }
  try {
    const hwnd = await windowForHotkey()
    if (!hwnd) return { status: 'failed', fault: '无法注册这个快捷键（没有找到窗口）。' }
    const alloc = page
    if (!alloc) return { status: 'failed', fault: '无法注册这个快捷键（系统接口不可用）。' }
    const data = alloc + BigInt(trayData)
    if (!readU64(data + BigInt(trayRegisterHotkey)) || !readU64(data + BigInt(trayUnregisterHotkey)) || !readU64(data + BigInt(trayGetLastError))) {
      return { status: 'failed', fault: '无法注册这个快捷键（系统接口不可用）。' }
    }
    hotkeySeq = (hotkeySeq + 1) >>> 0
    if (hotkeySeq === 0) hotkeySeq = 1
    const seq = hotkeySeq
    writeU32(data + BigInt(trayHotkeyMods), mods >>> 0)
    writeU32(data + BigInt(trayHotkeyVk), vk >>> 0)
    writeU32(data + BigInt(trayHotkeySeq), seq)
    if (user32().PostMessageW(hwnd, HOTKEY_BIND, 0n, 0n) === 0) {
      return { status: 'failed', fault: '无法注册这个快捷键（无法向窗口发送注册请求）。' }
    }
    const started = Date.now()
    while (Date.now() - started < 1200) {
      if (readU32(data + BigInt(trayHotkeyDone)) === seq) {
        const error = readU32(data + BigInt(trayHotkeyError))
        const result = readU32(data + BigInt(trayHotkeyResult))
        if (result === HOTKEY_OK) return { status: 'ok', fault: '' }
        if (result === HOTKEY_CONFLICT || error === ERROR_HOTKEY_ALREADY_REGISTERED) return { status: 'conflict', fault: '' }
        return { status: 'failed', fault: `无法注册这个快捷键（系统错误 ${error}）。` }
      }
      await delay(15)
    }
    return { status: 'failed', fault: '无法注册这个快捷键（窗口没有处理注册请求）。' }
  } catch {
    return { status: 'failed', fault: '无法注册这个快捷键（系统接口不可用）。' }
  }
}

export function revealWindowsTray(): void {
  if (process.platform !== 'win32') return
  const hwnd = findPromptDeckWindow()
  if (!hwnd) return
  // GetAsyncKeyState does not count as input, so Windows rejects a plain
  // SetForegroundWindow. A minimized window also stays iconic until SW_RESTORE.
  focusHiddenWindow(hwnd)
  if (page) writeU32(page + BigInt(trayData + trayHidden), 0)
}

function windowIsMinimized(hwnd: bigint): boolean {
  const user = user32()
  if (user.IsIconic(hwnd) !== 0) return true
  const place = Buffer.alloc(44)
  place.writeUInt32LE(44, 0)
  if (user.GetWindowPlacement(hwnd, place) === 0) return false
  const show = place.readUInt32LE(8)
  return show === 2 || show === 6
}

function focusHiddenWindow(hwnd: bigint): void {
  const user = user32()
  const iconic = windowIsMinimized(hwnd)
  const visible = user.IsWindowVisible(hwnd) !== 0
  const foreground = user.GetForegroundWindow()
  if (foreground === hwnd && visible && !iconic) return
  const owner = Buffer.alloc(4)
  const targetThread = user.GetWindowThreadProcessId(hwnd, owner)
  const foregroundThread = foreground ? user.GetWindowThreadProcessId(foreground, owner) : 0
  const currentThread = kernel32().GetCurrentThreadId()
  const attachForeground = foregroundThread !== 0 && foregroundThread !== currentThread
  const attachTarget = targetThread !== 0 && targetThread !== currentThread && targetThread !== foregroundThread
  if (attachForeground) user.AttachThreadInput(foregroundThread, currentThread, 1)
  if (attachTarget) user.AttachThreadInput(targetThread, currentThread, 1)
  if (!visible || iconic) {
    user.ShowWindow(hwnd, SW_RESTORE)
    user.ShowWindow(hwnd, SW_SHOW)
    user.PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0n)
  }
  user.keybd_event(VK_MENU, 0, 0, 0)
  user.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
  user.SwitchToThisWindow(hwnd, iconic ? 1 : 0)
  user.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_SHOW)
  user.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_SHOW)
  user.BringWindowToTop(hwnd)
  user.SetForegroundWindow(hwnd)
  if (attachTarget) user.AttachThreadInput(targetThread, currentThread, 0)
  if (attachForeground) user.AttachThreadInput(foregroundThread, currentThread, 0)
}

export function forceWindowsClose(): void {
  if (process.platform !== 'win32') return
  const basePage = page ?? ensurePage()
  if (!basePage) return
  const base = basePage + BigInt(trayData)
  writeU32(base + BigInt(trayForce), 1)
  writeU32(base + BigInt(trayEnabled), 0)
  const hwnd = readU64(base + BigInt(trayHwnd)) || findWindow()
  if (hwnd) user32().PostMessageW(hwnd, WM_CLOSE, 0n, 0n)
}

function disarm(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (!page) return
  const base = page + BigInt(trayData)
  writeU32(base + BigInt(trayEnabled), 0)
  if (readU32(base + BigInt(trayAdded)) !== 0) {
    shell32().Shell_NotifyIconW(NIM_DELETE, base + BigInt(trayNid))
    writeU32(base + BigInt(trayAdded), 0)
  }
  if (readU32(base + BigInt(trayHidden)) !== 0) {
    const hwnd = readU64(base + BigInt(trayHwnd))
    if (hwnd) user32().ShowWindow(hwnd, SW_SHOW)
    writeU32(base + BigInt(trayHidden), 0)
  }
}

function ensurePage(): bigint | null {
  if (page) return page
  const kernel = kernel32()
  const alloc = kernel.VirtualAlloc(0n, BigInt(trayCode.length), MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE)
  if (!alloc) return null
  kernel.RtlMoveMemory(alloc, trayCode, BigInt(trayCode.length))
  const user = moduleHandle('user32.dll')
  const shell = moduleHandle('shell32.dll')
  const procs: Array<[number, bigint]> = [
    [trayNext, proc(user, 'CallNextHookEx')],
    [trayCallWindow, proc(user, 'CallWindowProcW')],
    [trayShow, proc(user, 'ShowWindow')],
    [trayForeground, proc(user, 'GetForegroundWindow')],
    [trayGetText, proc(user, 'GetWindowTextW')],
    [traySetLong, proc(user, 'SetWindowLongPtrW')],
    [traySetForeground, proc(user, 'SetForegroundWindow')],
    [trayPost, proc(user, 'PostMessageW')],
    [trayNotify, proc(shell, 'Shell_NotifyIconW')],
    [trayMenu, proc(user, 'CreatePopupMenu')],
    [trayAppend, proc(user, 'AppendMenuW')],
    [trayTrack, proc(user, 'TrackPopupMenu')],
    [trayDestroyMenu, proc(user, 'DestroyMenu')],
    [trayCursor, proc(user, 'GetCursorPos')],
    [trayRegisterHotkey, proc(user, 'RegisterHotKey')],
    [trayUnregisterHotkey, proc(user, 'UnregisterHotKey')],
    [trayGetLastError, proc(moduleHandle('kernel32.dll'), 'GetLastError')],
  ]
  for (const [offset, address] of procs) {
    if (!address) return null
    writeU64(alloc + BigInt(trayData + offset), address)
  }
  const nid = Buffer.alloc(trayNidBytes)
  nid.writeUInt32LE(trayNidBytes, 0)
  nid.writeUInt32LE(1, 16)
  const icon = loadTrayIcon()
  nid.writeUInt32LE(icon ? 7 : 5, 20)
  nid.writeUInt32LE(0x8001, 24)
  if (icon) nid.writeBigUInt64LE(icon, 32)
  nid.write('PromptDeck\0', 40, 'utf16le')
  kernel.RtlMoveMemory(alloc + BigInt(trayData + trayNid), nid, BigInt(trayNidBytes))
  page = alloc
  return alloc
}

function installHook(alloc: bigint): boolean {
  const hwnd = attachWindow(alloc)
  if (!hwnd) return false
  showTrayIcon(alloc, hwnd)
  return true
}

function attachWindow(alloc: bigint): bigint {
  const hwnd = findWindow()
  if (hwnd) subclassWindow(alloc, hwnd)
  const stored = readU64(alloc + BigInt(trayData + trayHwnd))
  const target = stored && user32().IsWindow(stored) !== 0 ? stored : hwnd
  if (target) installCbt(alloc, target)
  return target
}

function installCbt(alloc: bigint, hwnd: bigint): void {
  if (hooked) return
  const threadBuf = Buffer.alloc(4)
  user32().GetWindowThreadProcessId(hwnd, threadBuf)
  const thread = threadBuf.readUInt32LE(0)
  if (!thread) return
  const hook = user32().SetWindowsHookExW(WH_CBT, alloc + BigInt(0), 0n, thread)
  if (!hook) return
  writeU64(alloc + BigInt(trayData + trayHookHandle), hook)
  hooked = true
}

function subclassWindow(alloc: bigint, hwnd: bigint): void {
  const base = alloc + BigInt(trayData)
  const stored = readU64(base + BigInt(trayHwnd))
  if (readU32(base + BigInt(traySubclassed)) !== 0 && stored && user32().IsWindow(stored) !== 0) return
  const previous = user32().SetWindowLongPtrW(hwnd, GWLP_WNDPROC, alloc + BigInt(trayWindowProc))
  if (!previous) return
  writeU64(base + BigInt(trayOldProc), previous)
  writeU64(base + BigInt(trayHwnd), hwnd)
  writeU32(base + BigInt(traySubclassed), 1)
}

async function windowForHotkey(): Promise<bigint> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const alloc = ensurePage()
    if (!alloc) return 0n
    const hwnd = attachWindow(alloc)
    if (hwnd && user32().IsWindow(hwnd) !== 0) return hwnd
    await delay(40)
  }
  return 0n
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function showTrayIcon(alloc: bigint, hwnd: bigint): void {
  const base = alloc + BigInt(trayData)
  const nid = base + BigInt(trayNid)
  writeU64(nid + 8n, hwnd)
  if (readU32(base + BigInt(trayAdded)) !== 0) return
  if (shell32().Shell_NotifyIconW(NIM_ADD, nid) === 0) return
  writeU32(base + BigInt(trayAdded), 1)
}

function findWindow(): bigint {
  let titled = 0n
  let owned = 0n
  const pid = process.pid
  const api = user32()
  const callback = new JSCallback((hwnd: Pointer) => {
    try {
      const handle = pointerValue(hwnd)
      const owner = Buffer.alloc(4)
      api.GetWindowThreadProcessId(handle, owner)
      if (owner.readUInt32LE(0) !== pid) return 1
      const visible = api.IsWindowVisible(hwnd) !== 0
      const iconic = api.IsIconic(handle) !== 0
      const title = windowTitle(hwnd) === 'PromptDeck'
      if (!title && !visible && !iconic) return 1
      if (title) titled = handle
      else if (!owned && (visible || iconic)) owned = handle
    } catch {
      return 1
    }
    return 1
  }, { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 })
  api.EnumWindows(callback.ptr, null)
  callback.close()
  if (titled) remembered = titled
  if (titled || owned) return titled || owned
  if (remembered && api.IsWindow(remembered) !== 0) return remembered
  return 0n
}

function windowTitle(hwnd: Pointer): string {
  const buf = Buffer.alloc(512)
  const count = user32().GetWindowTextW(hwnd, buf, 256)
  if (count <= 0) return ''
  return buf.toString('utf16le', 0, count * 2)
}

function loadTrayIcon(): bigint {
  const file = windowsIconPath()
  if (!file) return 0n
  return user32().LoadImageW(0n, wide(file), IMAGE_ICON, 32, 32, LR_LOADFROMFILE) ?? 0n
}

function pointerValue(value: Pointer): bigint {
  return typeof value === 'bigint' ? value : BigInt(value)
}

function writeU64(address: bigint, value: bigint): void {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  kernel32().RtlMoveMemory(address, buf, 8n)
}

function writeU32(address: bigint, value: number): void {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value)
  kernel32().RtlMoveMemory(address, buf, 4n)
}

function readU64(address: bigint): bigint {
  const buf = Buffer.alloc(8)
  kernel32().RtlMoveMemory(buf, address, 8n)
  return buf.readBigUInt64LE()
}

function readU32(address: bigint): number {
  const buf = Buffer.alloc(4)
  kernel32().RtlMoveMemory(buf, address, 4n)
  return buf.readUInt32LE()
}

function proc(module: bigint, name: string): bigint {
  return kernel32().GetProcAddress(module, name) ?? 0n
}

function moduleHandle(name: string): bigint {
  return kernel32().GetModuleHandleW(wide(name)) ?? 0n
}

function wide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le')
}

let kernelApi: ReturnType<typeof loadKernel> | null = null
function kernel32() {
  if (!kernelApi) kernelApi = loadKernel()
  return kernelApi
}

function loadKernel() {
  const memory = dlopen('ntdll.dll', {
    RtlMoveMemory: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
  })
  const lib = dlopen('kernel32.dll', {
    VirtualAlloc: { args: [FFIType.u64, FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.u64 },
    GetProcAddress: { args: [FFIType.u64, FFIType.cstring], returns: FFIType.u64 },
    GetCurrentThreadId: { args: [], returns: FFIType.u32 },
  })
  return { ...lib.symbols, RtlMoveMemory: memory.symbols.RtlMoveMemory }
}

let userApi: ReturnType<typeof loadUser32> | null = null
function user32() {
  if (!userApi) userApi = loadUser32()
  return userApi
}

function loadUser32() {
  const lib = dlopen('user32.dll', {
    EnumWindows: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetWindowTextW: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
    IsIconic: { args: [FFIType.u64], returns: FFIType.i32 },
    IsWindow: { args: [FFIType.u64], returns: FFIType.i32 },
    GetWindowPlacement: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    SetWindowsHookExW: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u32], returns: FFIType.u64 },
    SetWindowLongPtrW: { args: [FFIType.u64, FFIType.i32, FFIType.u64], returns: FFIType.u64 },
    ShowWindow: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    SetForegroundWindow: { args: [FFIType.u64], returns: FFIType.i32 },
    GetForegroundWindow: { args: [], returns: FFIType.u64 },
    AttachThreadInput: { args: [FFIType.u32, FFIType.u32, FFIType.i32], returns: FFIType.i32 },
    SetWindowPos: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    BringWindowToTop: { args: [FFIType.u64], returns: FFIType.i32 },
    SwitchToThisWindow: { args: [FFIType.u64, FFIType.i32], returns: FFIType.void },
    keybd_event: { args: [FFIType.u8, FFIType.u8, FFIType.u32, FFIType.u64], returns: FFIType.void },
    PostMessageW: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    LoadImageW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
  })
  return lib.symbols
}

let shellApi: ReturnType<typeof loadShell32> | null = null
function shell32() {
  if (!shellApi) shellApi = loadShell32()
  return shellApi
}

function loadShell32() {
  const lib = dlopen('shell32.dll', {
    Shell_NotifyIconW: { args: [FFIType.u32, FFIType.u64], returns: FFIType.i32 },
  })
  return lib.symbols
}
