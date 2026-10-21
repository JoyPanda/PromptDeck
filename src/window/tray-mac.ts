import { existsSync } from 'node:fs'
import path from 'node:path'
import { CFunction, dlopen, FFIType, JSCallback, type Pointer } from 'bun:ffi'

type NativePtr = Pointer | bigint

const nativeFunction = CFunction as unknown as new (fn: {
  ptr: NativePtr
  args: FFIType[]
  returns: FFIType
}) => (...args: never[]) => unknown

let quitHandler: () => void = () => {}
let statusItem: NativePtr | null = null
let concealed = false
let hiddenWindow: NativePtr | null = null

export function setMacTrayQuit(quit: () => void): void {
  quitHandler = quit
}

export function syncMacTray(enabled: boolean): void {
  if (process.platform !== 'darwin') return
  if (!enabled) {
    if (concealed) revealMacTray()
    removeStatusItem()
    return
  }
  ensureStatusItem()
  ensureDockRestore()
}

export function hideMacWindow(window: NativePtr): void {
  hiddenWindow = window
  concealed = true
  // Hide first. A failure while creating the status item must not fall through to a real close.
  objc().msgVoidArg(window, selector('orderOut:'), null)
  try {
    ensureStatusItem()
  } catch {
    // The Dock icon can still bring the window back.
  }
  ensureDockRestore()
}

export function revealMacTray(): void {
  if (process.platform !== 'darwin') return
  const window = liveWindow(hiddenWindow) ?? promptDeckWindow()
  if (!window) return
  hiddenWindow = window
  const api = objc()
  api.msgVoidArg(window, selector('deminiaturize:'), null)
  api.msgVoidArg(window, selector('makeKeyAndOrderFront:'), null)
  const app = api.msg(api.objc_getClass('NSApplication'), selector('sharedApplication'))
  if (app) {
    api.msgBool(app, selector('activateIgnoringOtherApps:'), 1)
    api.msgVoidArg(app, selector('unhide:'), null)
  }
  concealed = false
}

let reopenInstalled = false
let reopenCallback: JSCallback | null = null
let originalReopen: ((self: NativePtr, sel: NativePtr, app: NativePtr, visible: number | boolean) => number | boolean) | null = null
let restoreTimer: ReturnType<typeof setInterval> | null = null

function ensureDockRestore(): void {
  if (reopenInstalled) return
  try {
    installDockRestore()
  } catch {
    // The delegate may not exist on the first frames.
  }
  if (reopenInstalled || restoreTimer) return
  let attempts = 0
  restoreTimer = setInterval(() => {
    attempts += 1
    try {
      installDockRestore()
    } catch {
      // Retry until NSApplication has a delegate.
    }
    if (reopenInstalled || attempts > 40) {
      if (restoreTimer) clearInterval(restoreTimer)
      restoreTimer = null
    }
  }, 50)
}

function installDockRestore(): void {
  if (reopenInstalled) return
  const api = objc()
  const app = api.msg(api.objc_getClass('NSApplication'), selector('sharedApplication'))
  const delegate = app ? api.msg(app, selector('delegate')) : null
  if (!delegate) return
  const delegateClass = api.object_getClass(delegate)
  if (!delegateClass) return
  const reopen = selector('applicationShouldHandleReopen:hasVisibleWindows:')
  const method = api.class_getInstanceMethod(delegateClass, reopen)
  const encoding = method ? String(api.method_getTypeEncoding(method) ?? '') : 'B@:@B'
  const flag = encoding.startsWith('B') ? FFIType.bool : FFIType.i8
  const yes = flag === FFIType.bool ? true : 1
  const callback = new JSCallback((self: NativePtr, sel: NativePtr, sender: NativePtr, visible: number | boolean) => {
    if (concealed) {
      try {
        revealMacTray()
      } catch {
        // Leave the window hidden so the next Dock click can try again.
      }
      return yes
    }
    try {
      return originalReopen?.(self, sel, sender, visible) ?? yes
    } catch {
      return yes
    }
  }, { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, flag], returns: flag })
  if (!callback.ptr) return
  if (!method) {
    if (!api.class_addMethod(delegateClass, reopen, callback.ptr, encoding)) {
      callback.close()
      return
    }
    reopenCallback = callback
    reopenInstalled = true
    return
  }
  const previous = api.method_setImplementation(method, callback.ptr)
  if (!previous) {
    callback.close()
    return
  }
  try {
    originalReopen = new nativeFunction({
      ptr: previous,
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, flag],
      returns: flag,
    }) as (self: NativePtr, sel: NativePtr, app: NativePtr, visible: number | boolean) => number | boolean
  } catch (error) {
    api.method_setImplementation(method, previous)
    callback.close()
    throw error
  }
  reopenCallback = callback
  reopenInstalled = true
}

function liveWindow(window: NativePtr | null): NativePtr | null {
  if (!window) return null
  const api = objc()
  const app = api.msg(api.objc_getClass('NSApplication'), selector('sharedApplication'))
  const windows = app ? api.msg(app, selector('windows')) : null
  if (!windows) return null
  const count = Number(api.msgCount(windows, selector('count')))
  for (let index = 0; index < count; index += 1) {
    const item = api.msgIndex(windows, selector('objectAtIndex:'), index)
    if (item && samePointer(item, window)) return item
  }
  return null
}

function samePointer(left: NativePtr, right: NativePtr): boolean {
  if (left === right) return true
  try {
    const first = typeof left === 'bigint' ? left : BigInt(left as number)
    const second = typeof right === 'bigint' ? right : BigInt(right as number)
    return first === second
  } catch {
    return false
  }
}

function ensureStatusItem(): void {
  if (statusItem) return
  const api = objc()
  const bar = api.msg(api.objc_getClass('NSStatusBar'), selector('systemStatusBar'))
  if (!bar) return
  const item = api.msgDouble(bar, selector('statusItemWithLength:'), -1)
  if (!item) return
  const button = api.msg(item, selector('button'))
  const image = loadImage()
  if (button && image) {
    api.msgSize(image, selector('setSize:'), 18, 18)
    api.msgVoidArg(button, selector('setImage:'), image)
  } else if (button) {
    api.msgVoidArg(button, selector('setTitle:'), ns('PD'))
  }
  const menu = api.msg(api.msg(api.objc_getClass('NSMenu'), selector('alloc')), selector('init'))
  if (menu) {
    addMenuItem(menu, '显示 PromptDeck', selector('show:'), showCallback)
    addMenuItem(menu, '退出', selector('quit:'), quitCallback)
    api.msgVoidArg(item, selector('setMenu:'), menu)
  }
  statusItem = item
}

function removeStatusItem(): void {
  if (!statusItem) return
  const api = objc()
  const bar = api.msg(api.objc_getClass('NSStatusBar'), selector('systemStatusBar'))
  if (bar) api.msgVoidArg(bar, selector('removeStatusItem:'), statusItem)
  statusItem = null
}

function addMenuItem(menu: NativePtr, title: string, action: NativePtr, callback: JSCallback): void {
  const api = objc()
  const target = trayTarget(callback, action)
  const item = api.msgInit(
    api.msg(api.objc_getClass('NSMenuItem'), selector('alloc')),
    selector('initWithTitle:action:keyEquivalent:'),
    ns(title),
    action,
    ns(''),
  )
  if (!item || !target) return
  api.msgVoidArg(item, selector('setTarget:'), target)
  api.msgVoidArg(menu, selector('addItem:'), item)
}

const targets = new Map<NativePtr, NativePtr>()

function trayTarget(callback: JSCallback, action: NativePtr): NativePtr | null {
  const existing = targets.get(action)
  if (existing) return existing
  const api = objc()
  const name = `PromptDeckTray${targets.size}`
  let cls = api.objc_getClass(name)
  if (!cls) {
    cls = api.objc_allocateClassPair(api.objc_getClass('NSObject'), name, 0n)
    if (!cls || !callback.ptr) return null
    api.class_addMethod(cls, action, callback.ptr, 'v@:@')
    api.objc_registerClassPair(cls)
  }
  const object = api.msg(api.msg(cls, selector('alloc')), selector('init'))
  if (!object) return null
  targets.set(action, object)
  return object
}

const showCallback = new JSCallback(() => {
  revealMacTray()
}, { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void })

const quitCallback = new JSCallback(() => {
  quitHandler()
}, { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void })

function loadImage(): NativePtr | null {
  const candidates = [
    path.join(process.cwd(), 'assets', 'PromptDeck.png'),
    path.join(path.dirname(process.execPath), '..', 'Resources', 'PromptDeck.icns'),
  ]
  const file = candidates.find((candidate) => existsSync(candidate))
  if (!file) return null
  const api = objc()
  return api.msgArg(
    api.msg(api.objc_getClass('NSImage'), selector('alloc')),
    selector('initWithContentsOfFile:'),
    ns(file),
  )
}

function promptDeckWindow(): NativePtr | null {
  const api = objc()
  const app = api.msg(api.objc_getClass('NSApplication'), selector('sharedApplication'))
  const windows = app ? api.msg(app, selector('windows')) : null
  if (!windows) return null
  const count = Number(api.msgCount(windows, selector('count')))
  for (let index = 0; index < count; index += 1) {
    const window = api.msgIndex(windows, selector('objectAtIndex:'), index)
    if (window && windowTitle(window) === 'PromptDeck') return window
  }
  return null
}

function windowTitle(window: NativePtr): string {
  const api = objc()
  const title = api.msg(window, selector('title'))
  if (!title) return ''
  return api.msgString(title, selector('UTF8String')) ?? ''
}

function ns(value: string): NativePtr | null {
  const api = objc()
  return api.msgC(api.objc_getClass('NSString'), selector('stringWithUTF8String:'), value)
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

let api: ReturnType<typeof loadObjc> | null = null

function objc() {
  if (!api) api = loadObjc()
  return api
}

function loadObjc() {
  const objcLib = dlopen('/usr/lib/libobjc.A.dylib', {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_allocateClassPair: { args: [FFIType.ptr, FFIType.cstring, FFIType.u64], returns: FFIType.ptr },
    objc_registerClassPair: { args: [FFIType.ptr], returns: FFIType.void },
    class_addMethod: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.cstring], returns: FFIType.u8 },
    object_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
    class_getInstanceMethod: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    method_getTypeEncoding: { args: [FFIType.ptr], returns: FFIType.cstring },
    method_setImplementation: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  })
  const system = dlopen('/usr/lib/libSystem.B.dylib', {
    dlsym: { args: [FFIType.i64, FFIType.cstring], returns: FFIType.ptr },
  })
  const sendPtr = system.symbols.dlsym(-2, 'objc_msgSend')
  if (!sendPtr) throw new Error('找不到 objc_msgSend')
  const send = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr) => NativePtr | null
  const sendArg = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, arg: NativePtr | null) => NativePtr | null
  const sendVoid = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void }) as (receiver: NativePtr | null, sel: NativePtr) => void
  const sendVoidArg = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void }) as (receiver: NativePtr | null, sel: NativePtr, arg: NativePtr | null) => void
  const sendDouble = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.f64], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, value: number) => NativePtr | null
  const sendSize = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.void }) as (receiver: NativePtr | null, sel: NativePtr, width: number, height: number) => void
  const sendBool = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.u8], returns: FFIType.void }) as (receiver: NativePtr | null, sel: NativePtr, value: number) => void
  const sendInit = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, title: NativePtr | null, action: NativePtr, key: NativePtr | null) => NativePtr | null
  const sendC = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.cstring], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, value: string) => NativePtr | null
  const sendIndex = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr }) as (receiver: NativePtr | null, sel: NativePtr, index: number) => NativePtr | null
  const sendCount = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 }) as (receiver: NativePtr | null, sel: NativePtr) => number | bigint
  const sendString = new nativeFunction({ ptr: sendPtr, args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring }) as (receiver: NativePtr | null, sel: NativePtr) => string | null
  return {
    ...objcLib.symbols,
    msg: send,
    msgArg: sendArg,
    msgVoid: sendVoid,
    msgVoidArg: sendVoidArg,
    msgDouble: sendDouble,
    msgSize: sendSize,
    msgBool: sendBool,
    msgInit: sendInit,
    msgC: sendC,
    msgIndex: sendIndex,
    msgCount: sendCount,
    msgString: sendString,
  }
}
