import { dlopen, FFIType } from 'bun:ffi'
import { shortcutIsDown, type Shortcut } from './shortcut'
import { setWindowsHotkeySuspended } from './win-hotkey'

let suspended = false
let probe: ((code: number) => boolean) | null = null

export function setHotkeySuspended(value: boolean): void {
  suspended = value
  setWindowsHotkeySuspended(value)
}

export function keyIsDown(code: number): boolean {
  return platformProbe()(code)
}

export function watchHotkey(read: () => Shortcut | null, onFire: () => void): () => void {
  let pressed: (code: number) => boolean
  try {
    pressed = platformProbe()
  } catch {
    return () => undefined
  }
  let wasDown = false
  const timer = setInterval(() => {
    if (suspended) {
      wasDown = false
      return
    }
    const shortcut = read()
    const down = shortcut ? shortcutIsDown(shortcut, pressed) : false
    if (down && !wasDown) onFire()
    wasDown = down
  }, 40)
  return () => clearInterval(timer)
}

function platformProbe(): (code: number) => boolean {
  if (probe) return probe
  if (process.platform === 'darwin') {
    const lib = dlopen('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics', {
      CGEventSourceKeyState: { args: [FFIType.int32_t, FFIType.int32_t], returns: FFIType.bool },
    })
    probe = (code) => lib.symbols.CGEventSourceKeyState(1, code)
    return probe
  }
  if (process.platform === 'win32') {
    const lib = dlopen('user32.dll', {
      GetAsyncKeyState: { args: [FFIType.int32_t], returns: FFIType.int16_t },
    })
    probe = (code) => lib.symbols.GetAsyncKeyState(code) < 0
    return probe
  }
  throw new Error('当前系统不能注册全局快捷键')
}
