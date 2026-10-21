import { expect, test } from 'bun:test'
import { holdMacHotkey, macShortcutTaken } from './conflict'

const combo = { key: 'f12', cmd: true, shift: true, alt: true, ctrl: true }

test.skipIf(process.platform !== 'darwin')('mac hotkey registration reports a conflict while it is held', () => {
  const release = holdMacHotkey(combo)
  expect(typeof release).toBe('function')
  expect(macShortcutTaken(combo)).toBe(true)
  if (typeof release === 'function') release()
  expect(macShortcutTaken(combo)).toBe(false)
})
