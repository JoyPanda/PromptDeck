import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ingestClipboardSample } from './clipboard-ingest'
import { armOwnClipboardWrite, resetOwnClipboardMark } from './clipboard-own'
import { CLIPBOARD_BYTE_LIMIT } from './clipboard-text'
import {
  acceptClipboardText,
  applyLoadedClipboardLimit,
  clipboardItemText,
  closeLocalDatabase,
  deleteClipboardItem,
  lastOwnClipboardHash,
  listClipboardEntries,
  setLastOwnClipboardHash,
} from './templates/db'

const roots: string[] = []
const previousDataDir = process.env.PROMPTDECK_DATA_DIR

afterEach(async () => {
  resetOwnClipboardMark()
  closeLocalDatabase()
  if (previousDataDir === undefined) delete process.env.PROMPTDECK_DATA_DIR
  else process.env.PROMPTDECK_DATA_DIR = previousDataDir
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('clipboard history', () => {
  test('bumps the same text, trims to the limit, and waits until settings are ready', () => {
    useDataDir()
    expect(acceptClipboardText('   ', 20)).toBe('ignored')
    expect(acceptClipboardText('a'.repeat(CLIPBOARD_BYTE_LIMIT + 1), 20)).toBe('ignored')
    expect(acceptClipboardText('第一行', 20)).toBe('inserted')
    expect(acceptClipboardText('第二行\r\n', 20)).toBe('inserted')
    expect(acceptClipboardText('第二行\n', 20)).toBe('bumped')
    expect(listClipboardEntries().map((item) => item.preview)).toEqual(['第二行', '第一行'])
    expect(clipboardItemText(listClipboardEntries()[0]?.id ?? 0)).toBe('第二行\n')
    for (let index = 0; index < 20; index += 1) acceptClipboardText(`条目 ${index}`, 20)
    expect(listClipboardEntries()).toHaveLength(20)
    expect(listClipboardEntries().some((item) => item.preview === '第一行')).toBe(false)
    const removed = listClipboardEntries()[0]
    if (!removed) throw new Error('缺少记录')
    deleteClipboardItem(removed.id)
    expect(listClipboardEntries().some((item) => item.id === removed.id)).toBe(false)
    acceptClipboardText('保留', 100)
    applyLoadedClipboardLimit(false, 1)
    expect(listClipboardEntries().some((item) => item.preview === '保留')).toBe(true)
    applyLoadedClipboardLimit(true, 1)
    expect(listClipboardEntries()).toHaveLength(1)
  })

  test('searches the original text and skips the last own write on startup', () => {
    useDataDir()
    acceptClipboardText('api_key=abcdefghijklmnop', 100)
    expect(listClipboardEntries('abcdefghijklmnop')[0]?.preview).not.toContain('abcdefghijklmnop')
    expect(listClipboardEntries('API_KEY')).toHaveLength(1)
    setLastOwnClipboardHash(armOwnClipboardWrite('刚复制的'))
    resetOwnClipboardMark()
    expect(lastOwnClipboardHash()).toBeTruthy()
    expect(ingestClipboardSample({ sample: { kind: 'text', text: '刚复制的' }, startup: true, recordOwn: false, limit: 100 })).toBe(false)
    expect(listClipboardEntries().some((item) => item.preview === '刚复制的')).toBe(false)
    expect(ingestClipboardSample({ sample: { kind: 'text', text: '刚复制的' }, startup: false, recordOwn: false, limit: 100 })).toBe(true)
    expect(listClipboardEntries()[0]?.preview).toBe('刚复制的')
    expect(ingestClipboardSample({ sample: { kind: 'text', text: '外部新文本' }, startup: false, recordOwn: true, limit: 100 })).toBe(true)
    expect(listClipboardEntries()[0]?.preview).toBe('外部新文本')
    expect(ingestClipboardSample({ sample: { kind: 'text', text: '刚复制的' }, startup: false, recordOwn: true, limit: 100 })).toBe(true)
    expect(listClipboardEntries()[0]?.preview).toBe('刚复制的')
    armOwnClipboardWrite('刚复制的')
    expect(ingestClipboardSample({ sample: { kind: 'text', text: '刚复制的' }, startup: false, recordOwn: false, limit: 100 })).toBe(false)
    expect(listClipboardEntries().map((item) => item.preview).slice(0, 2)).toEqual(['刚复制的', '外部新文本'])
    acceptClipboardText('100%_done', 100)
    expect(listClipboardEntries('%_')[0]?.preview).toBe('100%_done')
    acceptClipboardText('hello world', 100)
    expect(listClipboardEntries('hello ')[0]?.preview).toBe('hello world')
    expect(listClipboardEntries(' ').map((item) => item.preview)).toEqual(['hello world'])
  })
})

function useDataDir(): string {
  const dir = path.join(os.tmpdir(), `promptdeck-clip-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  return dir
}
