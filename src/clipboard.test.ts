import { describe, expect, test } from 'bun:test'
import { clipboardCommand } from './clipboard'

describe('clipboardCommand', () => {
  test('uses pbcopy on macOS and PowerShell on Windows', () => {
    expect(clipboardCommand('darwin').command).toBe('pbcopy')
    expect(clipboardCommand('win32').command).toBe('powershell.exe')
    expect(clipboardCommand('win32').args.join(' ')).toContain('UTF8Encoding')
  })
})
