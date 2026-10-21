import { describe, expect, test } from 'bun:test'
import { macPrefersDark, windowsPrefersDark } from './ui/appearance'
import { defaultSettings, parseSettings } from './settings'

describe('parseSettings', () => {
  test('accepts the three appearances and falls back otherwise', () => {
    expect(parseSettings('{"appearance":"light"}')).toEqual({ ...defaultSettings(), appearance: 'light' })
    expect(parseSettings('{"appearance":"nope"}')).toEqual(defaultSettings())
    expect(parseSettings('not json')).toEqual(defaultSettings())
    expect(parseSettings('{"appearance":"dark","shortcut":null}')).toEqual({ ...defaultSettings(), appearance: 'dark', shortcut: null })
    expect(parseSettings('{"historyLimit":50}')).toEqual({ ...defaultSettings(), historyLimit: 50 })
    expect(parseSettings('{"historyLimit":0}')).toEqual(defaultSettings())
    expect(parseSettings('{"fontFamily":" Menlo ","fontSize":16}')).toEqual({ ...defaultSettings(), fontFamily: 'Menlo', fontSize: 16 })
    expect(parseSettings('{"fontSize":9,"fontFamily":""}')).toEqual(defaultSettings())
  })
})

describe('system appearance', () => {
  test('reads macOS and Windows theme markers', () => {
    expect(macPrefersDark('Dark\n', 0)).toBe(true)
    expect(macPrefersDark('', 1)).toBe(false)
    expect(windowsPrefersDark('    AppsUseLightTheme    REG_DWORD    0x0\r\n')).toBe(true)
    expect(windowsPrefersDark('    AppsUseLightTheme    REG_DWORD    0x1\r\n')).toBe(false)
  })
})

describe('close to tray', () => {
  test('defaults off and turns on only for a real boolean', () => {
    expect(parseSettings('{}').closeToTray).toBe(false)
    expect(parseSettings('{"closeToTray":true}').closeToTray).toBe(true)
    expect(parseSettings('{"closeToTray":"true"}').closeToTray).toBe(false)
  })
})

describe('update check', () => {
  test('defaults on and remembers only a string timestamp', () => {
    expect(parseSettings('{}').autoCheckUpdates).toBe(true)
    expect(parseSettings('{"autoCheckUpdates":false}').autoCheckUpdates).toBe(false)
    expect(parseSettings('{"autoCheckUpdates":"false"}').autoCheckUpdates).toBe(true)
    expect(parseSettings('{"updateLastCheckAt":"2026-10-21T00:00:00.000Z"}').updateLastCheckAt).toBe('2026-10-21T00:00:00.000Z')
    expect(parseSettings('{"updateLastCheckAt":1}').updateLastCheckAt).toBe('')
  })
})

describe('auto sync', () => {
  test('defaults on and turns off only for a real false', () => {
    expect(parseSettings('{}').autoSync).toBe(true)
    expect(parseSettings('{"autoSync":false}').autoSync).toBe(false)
    expect(parseSettings('{"autoSync":"false"}').autoSync).toBe(true)
  })
})
