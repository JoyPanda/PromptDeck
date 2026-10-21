import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'bun:test'
import { assertReleaseVersion, installerName, releaseTag } from './names'
import { innoScript, writeAppIcon } from './package'
import { bunSafeIco, groupIconResource, patchWindowsExeIcon, readIco } from './win-icon'
import { trayCode, trayData, trayExpect, trayHotkeyError } from '../src/window/tray-win-code'

test('names installers the way a desktop release does', () => {
  expect(installerName('0.1.0', 'darwin', 'arm64', true)).toBe('PromptDeck-0.1.0-macOS-arm64-unsigned.dmg')
  expect(installerName('0.1.0', 'darwin', 'arm64', false)).toBe('PromptDeck-0.1.0-macOS-arm64.dmg')
  expect(installerName('0.1.0', 'win32', 'x64', false)).toBe('PromptDeck-0.1.0-Windows-Setup.exe')
  expect(installerName('0.1.0', 'win32', 'x64', true)).toBe('PromptDeck-0.1.0-Windows-Setup-unsigned.exe')
  expect(installerName('0.1.0', 'linux', 'x64')).toBe('PromptDeck-0.1.0-linux.AppImage')
  expect(releaseTag('0.1.0')).toBe('v0.1.0')
  expect(releaseTag('v0.1.0')).toBe('v0.1.0')
  expect(assertReleaseVersion('0.1.0')).toBe('v0.1.0')
  expect(() => assertReleaseVersion('0.1')).toThrow(/v1\.2\.3/)
})

test('windows installer restarts after a silent update', () => {
  const script = innoScript('C:/PromptDeck.exe', 'C:/dist', 'PromptDeck-0.1.0-Windows-Setup', '0.1.0', '0.1.0')
  expect(script).toContain('PrivilegesRequired=lowest')
  expect(script).toContain('{param:PROMPTDECKRESTART|0}')
  expect(script).toContain('ShouldRestartPromptDeck')
  expect(script).toContain('skipifnotsilent')
})

test('windows icon is a classic bmp ico', () => {
  const bytes = readFileSync(path.join('assets', 'PromptDeck.ico'))
  expect(bytes.readUInt16LE(0)).toBe(0)
  expect(bytes.readUInt16LE(2)).toBe(1)
  const count = bytes.readUInt16LE(4)
  expect(count).toBeGreaterThanOrEqual(4)
  const image = bytes.readUInt32LE(18)
  expect(bytes.readUInt32LE(image)).toBe(40)
  expect(bytes.subarray(image, image + 8).toString('hex')).not.toBe('89504e470d0a1a0a')
  const width = bytes.readInt32LE(image + 4)
  const pixel = image + 40 + (width - 1) * width * 4
  expect(bytes[pixel + 3]).toBe(0)
  const images = readIco(bytes)
  expect(images.some((image) => image.bytes.length > 65535)).toBe(true)
  const group = groupIconResource(images)
  const large = images.findIndex((image) => image.bytes.length > 65535)
  expect(group.readUInt32LE(6 + large * 14 + 8)).toBe(images[large]?.bytes.length)
  const safe = bunSafeIco(bytes)
  const safeImages = readIco(safe)
  expect(safeImages.length).toBeGreaterThan(0)
  expect(safeImages.every((image) => image.bytes.length <= 65535)).toBe(true)
  expect(safeImages.some((image) => image.width === 64)).toBe(true)
})

test('tray hook recognizes the window title', () => {
  expect(trayCode.subarray(trayData + trayExpect, trayData + trayExpect + 22).toString('utf16le')).toBe('PromptDeck\u0000')
  expect(trayData + trayHotkeyError + 4).toBe(trayCode.length)
})

test('windows exe keeps the named icon group and replaces its image', () => {
  const ico = readFileSync(path.join('assets', 'PromptDeck.ico'))
  const images = readIco(ico)
  const largest = images.reduce((best, image) => image.bytes.length > best.bytes.length ? image : best)
  const full = exeWithIconSlot(largest.bytes.length)
  const patched = patchWindowsExeIcon(full.exe, ico)
  expect(patched.includes(largest.bytes)).toBe(true)
  expect(patched.includes(full.marker)).toBe(true)
  expect(patched.includes(Buffer.from('IDI_MYICON', 'utf16le'))).toBe(true)
  expect(patched.readUInt32LE(full.groupAt + 14)).toBe(largest.bytes.length)
  expect(Buffer.compare(patched, patchWindowsExeIcon(patched, ico))).toBe(0)

  const small = exeWithIconSlot(5000)
  const fitted = patchWindowsExeIcon(small.exe, ico)
  const medium = images.find((image) => image.width === 32)
  expect(medium).toBeTruthy()
  expect(fitted.includes(medium!.bytes)).toBe(true)
  expect(fitted[small.groupAt + 6]).toBe(32)
  expect(fitted.includes(small.marker)).toBe(true)
  expect(() => patchWindowsExeIcon(exeWithIconSlot(100).exe, ico)).toThrow(/空位/)
  expect(() => patchWindowsExeIcon(Buffer.from('not an exe'), ico)).toThrow(/可执行文件/)
})

test('app icon is a square png', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'promptdeck-icon-'))
  const file = path.join(dir, 'PromptDeck.png')
  writeAppIcon(file)
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  expect(width).toBe(height)
  expect(width).toBeGreaterThanOrEqual(256)
  rmSync(dir, { recursive: true, force: true })
})

function exeWithIconSlot(slot: number) {
  const icon = Buffer.alloc(slot, 0xab)
  const group = Buffer.alloc(20)
  group.writeUInt16LE(1, 2)
  group.writeUInt16LE(1, 4)
  group.writeUInt16LE(1, 10)
  group.writeUInt16LE(32, 12)
  group.writeUInt32LE(slot, 14)
  group.writeUInt16LE(1, 18)
  const marker = Buffer.from('PROMPTDECK-KEEP')
  const name = Buffer.from('IDI_MYICON', 'utf16le')
  const groupAt = 0x160
  const iconAt = 0x180
  const extraAt = iconAt + slot
  const blob = Buffer.alloc(extraAt + marker.length)
  writeResourceDir(blob, 0, [
    { id: 3, child: 0x40, dir: true },
    { id: 14, child: 0x60, dir: true },
    { id: 16, child: 0x80, dir: true },
  ])
  writeResourceDir(blob, 0x40, [{ id: 1, child: 0xc0, dir: true }])
  writeResourceDir(blob, 0x60, [{ nameOff: 0xa0, child: 0xe0, dir: true }])
  writeResourceDir(blob, 0x80, [{ id: 1, child: 0x100, dir: true }])
  blob.writeUInt16LE(name.length / 2, 0xa0)
  name.copy(blob, 0xa2)
  writeResourceDir(blob, 0xc0, [{ id: 1033, child: 0x120, dir: false }])
  writeResourceDir(blob, 0xe0, [{ id: 1033, child: 0x130, dir: false }])
  writeResourceDir(blob, 0x100, [{ id: 1033, child: 0x140, dir: false }])
  writeDataEntry(blob, 0x120, 0x1000 + iconAt, slot)
  writeDataEntry(blob, 0x130, 0x1000 + groupAt, group.length)
  writeDataEntry(blob, 0x140, 0x1000 + extraAt, marker.length)
  group.copy(blob, groupAt)
  icon.copy(blob, iconAt)
  marker.copy(blob, extraAt)
  return { exe: wrapPe(blob), marker, groupAt: 0x200 + groupAt }
}

function writeResourceDir(buf: Buffer, at: number, entries: Array<{ id?: number; nameOff?: number; child: number; dir: boolean }>) {
  const named = entries.filter((entry) => entry.nameOff !== undefined)
  const ids = entries.filter((entry) => entry.nameOff === undefined).sort((left, right) => left.id! - right.id!)
  buf.writeUInt16LE(named.length, at + 12)
  buf.writeUInt16LE(ids.length, at + 14)
  ;[...named, ...ids].forEach((entry, index) => {
    const pos = at + 16 + index * 8
    const name = entry.nameOff !== undefined ? (0x80000000 | entry.nameOff) >>> 0 : entry.id!
    const data = entry.dir ? (0x80000000 | entry.child) >>> 0 : entry.child
    buf.writeUInt32LE(name, pos)
    buf.writeUInt32LE(data, pos + 4)
  })
}

function writeDataEntry(buf: Buffer, at: number, rva: number, size: number) {
  buf.writeUInt32LE(rva, at)
  buf.writeUInt32LE(size, at + 4)
}

function wrapPe(blob: Buffer): Buffer {
  const header = 0x200
  const rawSize = Math.ceil(blob.length / 0x200) * 0x200
  const out = Buffer.alloc(header + rawSize)
  out.write('MZ', 0, 'latin1')
  out.writeUInt32LE(0x80, 0x3c)
  out.writeUInt32LE(0x4550, 0x80)
  out.writeUInt16LE(0x8664, 0x84)
  out.writeUInt16LE(1, 0x86)
  out.writeUInt16LE(0xf0, 0x94)
  out.writeUInt16LE(0x20b, 0x98)
  out.writeUInt32LE(0x1000, 0x98 + 32)
  out.writeUInt32LE(0x200, 0x98 + 36)
  out.writeUInt32LE(0x1000 + Math.ceil(blob.length / 0x1000) * 0x1000, 0x98 + 56)
  out.writeUInt32LE(header, 0x98 + 60)
  out.writeUInt16LE(3, 0x98 + 68)
  out.writeUInt32LE(16, 0x98 + 108)
  out.writeUInt32LE(0x1000, 0x98 + 128)
  out.writeUInt32LE(blob.length, 0x98 + 132)
  const section = 0x98 + 240
  out.write('.rsrc', section, 'latin1')
  out.writeUInt32LE(blob.length, section + 8)
  out.writeUInt32LE(0x1000, section + 12)
  out.writeUInt32LE(rawSize, section + 16)
  out.writeUInt32LE(header, section + 20)
  blob.copy(out, header)
  return out
}
