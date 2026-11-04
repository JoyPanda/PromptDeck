import { spawn, type ChildProcess } from 'node:child_process'
import { CLIPBOARD_BYTE_LIMIT } from './clipboard-text'

export function clipboardCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
      ],
    }
  }
  return { command: 'pbcopy', args: [] }
}

export function clipboardEnv(platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'darwin') return process.env
  const current = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || ''
  if (current.toLowerCase().includes('utf')) return process.env
  return { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
}

export function writeClipboardText(text: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const { command, args } = clipboardCommand(platform)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, env: clipboardEnv(platform) })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      reject(new Error('无法写入系统剪贴板'))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || '无法写入系统剪贴板'))
    })
    child.stdin.end(text)
  })
}

export async function copyText(text: string, renderer?: object | null): Promise<void> {
  const writer = renderer && 'writeClipboardText' in renderer ? renderer.writeClipboardText : undefined
  if (typeof writer === 'function') {
    ;(writer as (value: string) => void)(text)
    return
  }
  await writeClipboardText(text)
}

export function clipboardStdoutLimit(platform: NodeJS.Platform, byteLimit = CLIPBOARD_BYTE_LIMIT): number {
  if (platform !== 'win32') return byteLimit + 64
  const encoded = Math.ceil((byteLimit + 1) / 3) * 4
  return 'CLIP:'.length + encoded + 64
}

export function clipboardReadCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    const limit = CLIPBOARD_BYTE_LIMIT + 1
    const script = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'Add-Type -AssemblyName System.Windows.Forms',
      'try { $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText) } catch { [Console]::Out.Write(\'CLIP:FAIL\'); exit 0 }',
      'if ($null -eq $text) { $text = \'\' }',
      '$bytes = [System.Text.Encoding]::UTF8.GetBytes($text)',
      `if ($bytes.Length -gt ${limit}) { [Console]::Out.Write('CLIP:OVERSIZE'); exit 0 }`,
      '$payload = [Convert]::ToBase64String($bytes)',
      "[Console]::Out.Write('CLIP:' + $payload)",
    ].join('; ')
    return { command: 'powershell.exe', args: ['-STA', '-NoProfile', '-NonInteractive', '-Command', script] }
  }
  return { command: 'pbpaste', args: [] }
}

export function parseWindowsClipboardOutput(raw: string): { kind: 'text'; text: string } | { kind: 'blank' } | { kind: 'oversize' } | { kind: 'failed' } {
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (text === 'CLIP:FAIL') return { kind: 'failed' }
  if (text === 'CLIP:OVERSIZE') return { kind: 'oversize' }
  if (!text.startsWith('CLIP:')) return { kind: 'failed' }
  const body = text.slice('CLIP:'.length).trim()
  if (!body) return { kind: 'blank' }
  try {
    const decoded = Buffer.from(body, 'base64').toString('utf8')
    if (Buffer.byteLength(decoded, 'utf8') > CLIPBOARD_BYTE_LIMIT) return { kind: 'oversize' }
    if (!decoded.trim()) return { kind: 'blank' }
    return { kind: 'text', text: decoded }
  } catch {
    return { kind: 'failed' }
  }
}

export function readClipboardSample(platform: NodeJS.Platform = process.platform, onChild?: (child: ChildProcess) => void): Promise<{ kind: 'text'; text: string } | { kind: 'blank' } | { kind: 'oversize' } | { kind: 'failed' }> {
  const { command, args } = clipboardReadCommand(platform)
  return new Promise((resolve) => {
    let settled = false
    const finish = (sample: { kind: 'text'; text: string } | { kind: 'blank' } | { kind: 'oversize' } | { kind: 'failed' }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(sample)
    }
    const child = spawn(command, args, { windowsHide: true, env: clipboardEnv(platform), stdio: ['ignore', 'pipe', 'ignore'] })
    onChild?.(child)
    const chunks: Buffer[] = []
    let size = 0
    let oversize = false
    const timer = setTimeout(() => {
      child.kill()
      finish({ kind: 'failed' })
    }, 4000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > clipboardStdoutLimit(platform)) {
        oversize = true
        chunks.length = 0
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.on('error', () => finish({ kind: 'failed' }))
    child.on('close', (code) => {
      if (oversize) {
        finish({ kind: 'oversize' })
        return
      }
      if (code !== 0) {
        finish({ kind: 'failed' })
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      if (platform === 'win32') {
        finish(parseWindowsClipboardOutput(raw))
        return
      }
      if (Buffer.byteLength(raw, 'utf8') > CLIPBOARD_BYTE_LIMIT) {
        finish({ kind: 'oversize' })
        return
      }
      if (!raw.trim()) {
        finish({ kind: 'blank' })
        return
      }
      finish({ kind: 'text', text: raw })
    })
  })
}
