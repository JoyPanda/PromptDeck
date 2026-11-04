import { describe, expect, test } from 'bun:test'
import { clipboardCommand, clipboardEnv, clipboardReadCommand, clipboardStdoutLimit, parseWindowsClipboardOutput } from './clipboard'
import { CLIPBOARD_BYTE_LIMIT } from './clipboard-text'

describe('clipboardCommand', () => {
  test('uses pbcopy on macOS and PowerShell on Windows', () => {
    expect(clipboardCommand('darwin').command).toBe('pbcopy')
    expect(clipboardCommand('win32').command).toBe('powershell.exe')
    expect(clipboardCommand('win32').args.join(' ')).toContain('UTF8Encoding')
  })
})

describe('clipboardReadCommand', () => {
  test('reads macOS with pbpaste and Windows text without file paths', () => {
    expect(clipboardReadCommand('darwin')).toEqual({ command: 'pbpaste', args: [] })
    const windows = clipboardReadCommand('win32')
    expect(windows.command).toBe('powershell.exe')
    expect(windows.args).toContain('-STA')
    expect(windows.args.join(' ')).toContain('GetText')
    expect(windows.args.join(' ')).toContain('UnicodeText')
    expect(windows.args.join(' ')).toContain('CLIP:FAIL')
    expect(windows.args.join(' ')).not.toContain('Get-Clipboard')
  })

  test('forces a UTF-8 locale for macOS clipboard commands', () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LC_CTYPE: process.env.LC_CTYPE }
    process.env.LANG = 'C'
    delete process.env.LC_ALL
    delete process.env.LC_CTYPE
    try {
      const env = clipboardEnv('darwin')
      expect(env.LANG).toBe('en_US.UTF-8')
      expect(env.LC_ALL).toBe('en_US.UTF-8')
      expect(clipboardEnv('win32')).toBe(process.env)
      process.env.LANG = 'en_US.UTF-8'
      expect(clipboardEnv('darwin')).toBe(process.env)
    } finally {
      restoreEnv('LANG', saved.LANG)
      restoreEnv('LC_ALL', saved.LC_ALL)
      restoreEnv('LC_CTYPE', saved.LC_CTYPE)
    }
  })

  test('decodes the Windows clipboard protocol', () => {
    expect(parseWindowsClipboardOutput('CLIP:')).toEqual({ kind: 'blank' })
    expect(parseWindowsClipboardOutput('CLIP:FAIL')).toEqual({ kind: 'failed' })
    expect(parseWindowsClipboardOutput('CLIP:OVERSIZE')).toEqual({ kind: 'oversize' })
    expect(parseWindowsClipboardOutput(`CLIP:${Buffer.from('你好\nnext', 'utf8').toString('base64')}`)).toEqual({ kind: 'text', text: '你好\nnext' })
    expect(parseWindowsClipboardOutput('nope')).toEqual({ kind: 'failed' })
    const full = 'a'.repeat(CLIPBOARD_BYTE_LIMIT)
    const encoded = Buffer.byteLength(`CLIP:${Buffer.from(full).toString('base64')}`)
    expect(encoded).toBeGreaterThan(CLIPBOARD_BYTE_LIMIT + 64)
    expect(encoded).toBeLessThanOrEqual(clipboardStdoutLimit('win32'))
    expect(parseWindowsClipboardOutput(`CLIP:${Buffer.from(full).toString('base64')}`)).toEqual({ kind: 'text', text: full })
    expect(clipboardStdoutLimit('darwin')).toBe(CLIPBOARD_BYTE_LIMIT + 64)
  })
})

function restoreEnv(name: 'LANG' | 'LC_ALL' | 'LC_CTYPE', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
