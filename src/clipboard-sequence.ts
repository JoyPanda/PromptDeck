import { CFunction, dlopen, FFIType, type Pointer } from 'bun:ffi'

type NativePtr = Pointer | bigint

const nativeFunction = CFunction as unknown as new (fn: {
  ptr: NativePtr
  args: FFIType[]
  returns: FFIType
}) => (...args: never[]) => unknown

let windowsCount: (() => number) | null = null
let macCount: (() => number) | null = null

export function readClipboardChangeCount(platform: NodeJS.Platform = process.platform): number | null {
  try {
    if (platform === 'win32') return windowsChangeCount()
    if (platform === 'darwin') return macChangeCount()
    return null
  } catch {
    return null
  }
}

function windowsChangeCount(): number {
  if (!windowsCount) {
    const lib = dlopen('user32.dll', {
      GetClipboardSequenceNumber: { args: [], returns: FFIType.u32 },
    })
    windowsCount = () => Number(lib.symbols.GetClipboardSequenceNumber())
  }
  return windowsCount()
}

function macChangeCount(): number {
  if (!macCount) macCount = loadMacChangeCount()
  return macCount()
}

function loadMacChangeCount(): () => number {
  const objc = dlopen('/usr/lib/libobjc.A.dylib', {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
  })
  const system = dlopen('/usr/lib/libSystem.B.dylib', {
    dlsym: { args: [FFIType.i64, FFIType.cstring], returns: FFIType.ptr },
  })
  const sendPtr = system.symbols.dlsym(-2, 'objc_msgSend')
  if (!sendPtr) throw new Error('找不到 objc_msgSend')
  const send = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr) => NativePtr | null
  const sendCount = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 }) as (receiver: NativePtr | null, sel: NativePtr) => number | bigint
  const selectors = new Map<string, NativePtr>()
  const selector = (name: string) => {
    const cached = selectors.get(name)
    if (cached) return cached
    const created = objc.symbols.sel_registerName(name)
    if (created == null) throw new Error(`无法注册 ${name}`)
    selectors.set(name, created)
    return created
  }
  return () => {
    const pasteboardClass = objc.symbols.objc_getClass('NSPasteboard')
    if (!pasteboardClass) throw new Error('找不到剪贴板')
    const pasteboard = send(pasteboardClass, selector('generalPasteboard'))
    if (!pasteboard) throw new Error('找不到剪贴板')
    return Number(sendCount(pasteboard, selector('changeCount')))
  }
}
