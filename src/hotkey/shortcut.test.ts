import { describe, expect, test } from 'bun:test'
import { defaultShortcut, formatShortcut, isModifierKey, shortcutFromEvent, shortcutIsDown, windowsHotkey } from './shortcut'
import { keyIsDown } from './watch'

const combo = { key: 'space', cmd: true, shift: true, alt: false, ctrl: false }

describe('shortcut', () => {
  test('formats macOS symbols and Windows names', () => {
    expect(formatShortcut(combo, 'darwin')).toBe('⇧⌘Space')
    expect(formatShortcut(combo, 'win32')).toBe('Shift+Win+Space')
    expect(formatShortcut(null)).toBe('未设置')
    expect(defaultShortcut('win32')).toEqual({ key: 'space', ctrl: true, shift: true, alt: false, cmd: false })
  })

  test('requires a modifier and ignores modifier keys themselves', () => {
    expect(shortcutFromEvent('space', { cmd: true, shift: true, alt: false, ctrl: false })).toEqual(combo)
    expect(shortcutFromEvent('space', { cmd: false, shift: false, alt: false, ctrl: false })).toBeNull()
    expect(shortcutFromEvent('shift', { cmd: true, shift: true, alt: false, ctrl: false })).toBeNull()
    expect(isModifierKey('alt')).toBe(true)
    expect(isModifierKey('leftcontrol')).toBe(true)
    expect(isModifierKey('k')).toBe(false)
    expect(shortcutFromEvent('·', { cmd: true, shift: false, alt: false, ctrl: false })).toEqual({
      key: '`', cmd: true, shift: false, alt: false, ctrl: false,
    })
    expect(formatShortcut({ key: '`', cmd: true, shift: false, alt: false, ctrl: false }, 'darwin')).toBe('⌘`')
    const held = new Set([0x11])
    expect(shortcutFromEvent('k', { cmd: false, shift: false, alt: false, ctrl: false }, (code) => held.has(code), 'win32')).toEqual({
      key: 'k', cmd: false, shift: false, alt: false, ctrl: true,
    })
  })

  test('matches only the requested keys', () => {
    const down = new Set([0x31, 0x37, 0x38])
    const isDown = (code: number) => down.has(code)
    expect(shortcutIsDown(combo, isDown, 'darwin')).toBe(true)
    down.add(0x3a)
    expect(shortcutIsDown(combo, isDown, 'darwin')).toBe(false)
    down.delete(0x3a)
    down.delete(0x38)
    expect(shortcutIsDown(combo, isDown, 'darwin')).toBe(false)
  })

  test('encodes a Windows registered hotkey', () => {
    expect(windowsHotkey(defaultShortcut('win32'))).toEqual({ mods: 0x4006, vk: 0x20 })
    expect(windowsHotkey({ key: 'space', cmd: true, shift: true, alt: false, ctrl: false })).toEqual({ mods: 0x400c, vk: 0x20 })
    expect(windowsHotkey({ key: '`', cmd: false, shift: false, alt: true, ctrl: false })).toEqual({ mods: 0x4001, vk: 0xc0 })
    expect(windowsHotkey(null)).toBeNull()
  })

  test('can read the platform key state', () => {
    expect(typeof keyIsDown(0)).toBe('boolean')
  })
})
