import { CFunction, dlopen, FFIType, JSCallback, type Pointer } from 'bun:ffi'
import { hideMacWindow } from './tray-mac'
import { forceWindowsClose } from './tray-win'

type NativePtr = Pointer | bigint

const nativeFunction = CFunction as unknown as new (fn: {
  ptr: NativePtr
  args: FFIType[]
  returns: FFIType
}) => (...args: never[]) => unknown

type CloseFn = (self: NativePtr, sel: NativePtr) => void

type GuardState = {
  unsaved: () => boolean
  onBlocked: () => void
  conceal: () => boolean
  allow: boolean
  installed: boolean
  window: NativePtr | null
  original: CloseFn | null
  callback: JSCallback | null
}

const GUARD_KEY = '__promptdeckCloseGuard'

function guardState(): GuardState {
  const existing = Reflect.get(globalThis, GUARD_KEY) as GuardState | undefined
  if (existing) return existing
  const created: GuardState = {
    unsaved: () => false,
    onBlocked: () => {},
    conceal: () => false,
    allow: false,
    installed: false,
    window: null,
    original: null,
    callback: null,
  }
  Reflect.set(globalThis, GUARD_KEY, created)
  return created
}

export function installCloseGuard(handlers: { unsaved: () => boolean; onBlocked: () => void; conceal: () => boolean }): () => void {
  const state = guardState()
  state.unsaved = handlers.unsaved
  state.onBlocked = handlers.onBlocked
  state.conceal = handlers.conceal
  if (process.platform !== 'darwin') return () => { state.unsaved = () => false; state.conceal = () => false }
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    installNative()
    if (guardState().installed || attempts > 20) clearInterval(timer)
  }, 50)
  installNative()
  return () => {
    clearInterval(timer)
    guardState().unsaved = () => false
  }
}

export function requestWindowClose(): void {
  if (process.platform === 'win32') {
    forceWindowsClose()
    return
  }
  const state = guardState()
  if (!state.window || !state.original) return
  state.allow = true
  try {
    objc().msgVoid(state.window, selector('close'))
  } catch {
    state.allow = false
  }
}

function installNative(): void {
  const state = guardState()
  if (state.installed) return
  try {
    const objcApi = objc()
    const window = listWindows().find((item) => windowTitle(item) === 'PromptDeck')
    if (!window) return
    const windowClass = objcApi.object_getClass(window)
    if (!windowClass) return
    const method = objcApi.class_getInstanceMethod(windowClass, selector('close'))
    const callbackPtr = state.callback?.ptr
    if (!method || !callbackPtr) return
    const previous = objcApi.method_setImplementation(method, callbackPtr)
    if (!previous) return
    state.installed = true
    try {
      state.original = new nativeFunction({
        ptr: previous,
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      }) as CloseFn
      state.window = window
    } catch (error) {
      objcApi.method_setImplementation(method, previous)
      state.installed = false
      throw error
    }
  } catch {
    if (!state.original) state.installed = false
  }
}

let api: ReturnType<typeof loadObjc> | null = null

function objc() {
  if (!api) api = loadObjc()
  const state = guardState()
  if (!state.callback) {
    state.callback = new JSCallback((self: NativePtr, sel: NativePtr) => {
      const state = guardState()
      try {
        if (state.allow) {
          state.allow = false
          state.original?.(self, sel)
          return
        }
        if (windowTitle(self) === 'PromptDeck' && state.conceal()) {
          hideMacWindow(self)
          return
        }
        if (windowTitle(self) === 'PromptDeck' && state.unsaved()) {
          queueMicrotask(() => guardState().onBlocked())
          return
        }
      } catch {
        // Closing for real would destroy the window, and a Dock click could not bring it back.
        if (guardState().conceal()) return
        state.original?.(self, sel)
        return
      }
      state.original?.(self, sel)
    }, {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.void,
    })
  }
  return api
}

function loadObjc() {
  const objcLib = dlopen('/usr/lib/libobjc.A.dylib', {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    object_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
    class_getInstanceMethod: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    method_setImplementation: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  })
  const system = dlopen('/usr/lib/libSystem.B.dylib', {
    dlsym: { args: [FFIType.i64, FFIType.cstring], returns: FFIType.ptr },
  })
  const sendPtr = system.symbols.dlsym(-2, 'objc_msgSend')
  if (!sendPtr) throw new Error('找不到 objc_msgSend')
  const send = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr) => NativePtr | null
  const sendIndex = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, index: number) => NativePtr | null
  const sendCount = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 }) as (receiver: NativePtr | null, sel: NativePtr) => number | bigint
  const sendString = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring }) as (receiver: NativePtr | null, sel: NativePtr) => string | null
  const sendVoid = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void }) as (receiver: NativePtr | null, sel: NativePtr) => void
  return {
    ...objcLib.symbols,
    msg: send,
    msgIndex: sendIndex,
    msgCount: sendCount,
    msgString: sendString,
    msgVoid: sendVoid,
  }
}

const selectors = new Map<string, NativePtr>()

function selector(name: string): NativePtr {
  const cached = selectors.get(name)
  if (cached) return cached
  const created = objc().sel_registerName(name)
  if (created == null) throw new Error(`无法注册 ${name}`)
  selectors.set(name, created)
  return created
}

function listWindows(): NativePtr[] {
  const apiRef = objc()
  const app = apiRef.msg(apiRef.objc_getClass('NSApplication'), selector('sharedApplication'))
  const windows = app ? apiRef.msg(app, selector('windows')) : null
  if (!windows) return []
  const count = Number(apiRef.msgCount(windows, selector('count')))
  const items: NativePtr[] = []
  for (let index = 0; index < count; index += 1) {
    const window = apiRef.msgIndex(windows, selector('objectAtIndex:'), index)
    if (window) items.push(window)
  }
  return items
}

function windowTitle(window: NativePtr | null): string {
  if (!window) return ''
  const apiRef = objc()
  const title = apiRef.msg(window, selector('title'))
  if (!title) return ''
  return apiRef.msgString(title, selector('UTF8String')) ?? ''
}
