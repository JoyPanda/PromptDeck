import { dlopen, FFIType, type Pointer } from 'bun:ffi'
import { macHotkeyCode, macHotkeyModifiers, type Shortcut } from './shortcut'
import { tryWindowsHotkey } from './win-hotkey'

const HOTKEY_TAKEN = -9878

export async function claimShortcut(next: Shortcut): Promise<'ok' | 'conflict' | 'failed'> {
  if (process.platform === 'win32') return tryWindowsHotkey(next)
  if (process.platform === 'darwin') return macShortcutTaken(next) ? 'conflict' : 'ok'
  return 'ok'
}

export function macShortcutTaken(shortcut: Shortcut): boolean {
  const held = holdMacHotkey(shortcut)
  if (held === 'conflict') return true
  held?.()
  return false
}

export function holdMacHotkey(shortcut: Shortcut): (() => void) | 'conflict' | null {
  const code = macHotkeyCode(shortcut)
  const modifiers = macHotkeyModifiers(shortcut)
  if (code == null || modifiers === 0) return null
  try {
    const carbon = carbonApi()
    const target = carbon.GetApplicationEventTarget()
    const out = Buffer.alloc(8)
    const status = carbon.RegisterEventHotKey(code, modifiers, 0x50444b31n | (1n << 32n), target, 0, out)
    if (status === HOTKEY_TAKEN) return 'conflict'
    if (status !== 0) return null
    const ref = out.readBigUInt64LE()
    return () => {
      carbon.UnregisterEventHotKey(ref)
    }
  } catch {
    return null
  }
}

let carbon: ReturnType<typeof loadCarbon> | null = null
function carbonApi() {
  if (!carbon) carbon = loadCarbon()
  return carbon
}

function loadCarbon() {
  const lib = dlopen('/System/Library/Frameworks/Carbon.framework/Carbon', {
    RegisterEventHotKey: { args: [FFIType.u32, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    UnregisterEventHotKey: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetApplicationEventTarget: { args: [], returns: FFIType.ptr },
  })
  return lib.symbols as {
    RegisterEventHotKey: (code: number, modifiers: number, id: bigint, target: Pointer | null, options: number, out: Buffer) => number
    UnregisterEventHotKey: (ref: bigint) => number
    GetApplicationEventTarget: () => Pointer | null
  }
}
