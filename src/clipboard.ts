import { spawn } from 'node:child_process'

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

function clipboardEnv(platform: NodeJS.Platform): NodeJS.ProcessEnv {
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
