import { spawn } from 'node:child_process'
import { releasesPageUrl } from './repo'

export function openReleasesPage(url = releasesPageUrl()): void {
  if (!url || !url.startsWith('https://')) return
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}
