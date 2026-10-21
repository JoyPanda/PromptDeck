import type { EventModifiers } from '@gpuix/react'

export type Shortcut = {
  key: string
  cmd: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}

const MODIFIER_KEYS = new Set(['shift', 'ctrl', 'control', 'alt', 'option', 'altgr', 'meta', 'cmd', 'command', 'super', 'win', 'os', 'function'])

const MAC_KEY: Record<string, number> = {
  a: 0x00, s: 0x01, d: 0x02, f: 0x03, h: 0x04, g: 0x05, z: 0x06, x: 0x07, c: 0x08, v: 0x09,
  b: 0x0b, q: 0x0c, w: 0x0d, e: 0x0e, r: 0x0f, y: 0x10, t: 0x11,
  '1': 0x12, '2': 0x13, '3': 0x14, '4': 0x15, '6': 0x16, '5': 0x17,
  '9': 0x19, '7': 0x1a, '8': 0x1c, '0': 0x1d,
  o: 0x1f, u: 0x20, i: 0x22, p: 0x23, l: 0x25, j: 0x26, k: 0x28, n: 0x2d, m: 0x2e,
  space: 0x31, enter: 0x24, tab: 0x30, escape: 0x35, '`': 0x32,
  left: 0x7b, right: 0x7c, down: 0x7d, up: 0x7e,
  f1: 0x7a, f2: 0x78, f3: 0x63, f4: 0x76, f5: 0x60, f6: 0x61, f7: 0x62, f8: 0x64, f9: 0x65, f10: 0x6d, f11: 0x67, f12: 0x6f,
}

const WIN_KEY: Record<string, number> = {
  space: 0x20, enter: 0x0d, tab: 0x09, escape: 0x1b, '`': 0xc0,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
}

for (let code = 0x41; code <= 0x5a; code += 1) WIN_KEY[String.fromCharCode(code).toLowerCase()] = code
for (let digit = 0; digit <= 9; digit += 1) WIN_KEY[String(digit)] = 0x30 + digit
for (let index = 1; index <= 12; index += 1) WIN_KEY[`f${index}`] = 0x6f + index

const MAC_MOD = { cmd: [0x37, 0x36], shift: [0x38, 0x3c], alt: [0x3a, 0x3d], ctrl: [0x3b, 0x3e] }
const WIN_MOD = { cmd: [0x5b, 0x5c], shift: [0x10], alt: [0x12], ctrl: [0x11] }

const KEY_ALIAS: Record<string, string> = {
  grave: '`',
  backquote: '`',
  tilde: '`',
  '·': '`',
  '˙': '`',
}

const KEY_LABEL: Record<string, string> = {
  space: 'Space', enter: 'Enter', escape: 'Esc', tab: 'Tab',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down',
  '`': '`',
}

export function defaultShortcut(platform = process.platform): Shortcut {
  if (platform === 'win32') return { key: 'space', ctrl: true, shift: true, alt: false, cmd: false }
  return { key: 'space', ctrl: false, shift: true, alt: false, cmd: true }
}

export function canonicalKey(key: string): string {
  const name = key.toLowerCase()
  return KEY_ALIAS[name] ?? name
}

export function isBindableKey(key: string): boolean {
  const name = canonicalKey(key)
  return Object.prototype.hasOwnProperty.call(MAC_KEY, name) && Object.prototype.hasOwnProperty.call(WIN_KEY, name)
}

export function isModifierKey(key: string | undefined): boolean {
  const name = key?.toLowerCase().replace(/^(left|right)/, '') ?? ''
  return MODIFIER_KEYS.has(name)
}

export function shortcutFromEvent(
  key: string | undefined,
  modifiers: EventModifiers | undefined,
  isDown?: (code: number) => boolean,
  platform = process.platform,
): Shortcut | null {
  const name = canonicalKey(key ?? '')
  if (!name || isModifierKey(key) || !isBindableKey(name)) return null
  const live = isDown ? readModifiers(isDown, platform) : undefined
  const shortcut: Shortcut = {
    key: name,
    cmd: modifiers?.cmd === true || live?.cmd === true,
    shift: modifiers?.shift === true || live?.shift === true,
    alt: modifiers?.alt === true || live?.alt === true,
    ctrl: modifiers?.ctrl === true || live?.ctrl === true,
  }
  if (!shortcut.cmd && !shortcut.shift && !shortcut.alt && !shortcut.ctrl) return null
  return shortcut
}

function readModifiers(isDown: (code: number) => boolean, platform: string): EventModifiers {
  const mods = platform === 'win32' ? WIN_MOD : MAC_MOD
  const down = (codes: number[]) => codes.some(isDown)
  return { cmd: down(mods.cmd), shift: down(mods.shift), alt: down(mods.alt), ctrl: down(mods.ctrl) }
}

export function formatShortcut(shortcut: Shortcut | null, platform = process.platform): string {
  if (!shortcut) return '未设置'
  const label = KEY_LABEL[shortcut.key] ?? shortcut.key.toUpperCase()
  if (platform === 'darwin') {
    return `${shortcut.ctrl ? '⌃' : ''}${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.cmd ? '⌘' : ''}${label}`
  }
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.cmd) parts.push('Win')
  parts.push(label)
  return parts.join('+')
}

const MOD_ALT = 0x1
const MOD_CONTROL = 0x2
const MOD_SHIFT = 0x4
const MOD_WIN = 0x8
const MOD_NOREPEAT = 0x4000

export function macHotkeyCode(shortcut: Shortcut): number | null {
  return MAC_KEY[shortcut.key] ?? null
}

export function macHotkeyModifiers(shortcut: Shortcut): number {
  let modifiers = 0
  if (shortcut.cmd) modifiers |= 256
  if (shortcut.shift) modifiers |= 512
  if (shortcut.alt) modifiers |= 2048
  if (shortcut.ctrl) modifiers |= 4096
  return modifiers
}

export function windowsHotkey(shortcut: Shortcut | null): { mods: number; vk: number } | null {
  if (!shortcut) return null
  const vk = WIN_KEY[shortcut.key]
  if (vk == null) return null
  let mods = MOD_NOREPEAT
  if (shortcut.alt) mods |= MOD_ALT
  if (shortcut.ctrl) mods |= MOD_CONTROL
  if (shortcut.shift) mods |= MOD_SHIFT
  if (shortcut.cmd) mods |= MOD_WIN
  if (mods === MOD_NOREPEAT) return null
  return { mods, vk }
}

export function shortcutIsDown(shortcut: Shortcut, isDown: (code: number) => boolean, platform = process.platform): boolean {
  const keys = platform === 'win32' ? WIN_KEY : MAC_KEY
  const mods = platform === 'win32' ? WIN_MOD : MAC_MOD
  const code = keys[shortcut.key]
  if (code == null || !isDown(code)) return false
  const held = (required: boolean, codes: number[]) => required === codes.some(isDown)
  return held(shortcut.cmd, mods.cmd) && held(shortcut.shift, mods.shift) && held(shortcut.alt, mods.alt) && held(shortcut.ctrl, mods.ctrl)
}
