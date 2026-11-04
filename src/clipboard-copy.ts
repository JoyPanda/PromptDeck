import { copyText } from './clipboard'
import { armOwnClipboardWrite, consumeOwnClipboardMark } from './clipboard-own'
import { touchClipboard } from './clipboard-live'
import { acceptClipboardText, clearLastOwnClipboardHash, lastOwnClipboardHash, setLastOwnClipboardHash } from './templates/db'

type CopySettings = {
  recordOwn: boolean
  limit: number
}

let settings = (): CopySettings => ({ recordOwn: false, limit: 100 })

export function setClipboardCopySettings(next: () => CopySettings): void {
  settings = next
}

export async function copyOwnText(text: string, renderer?: object | null): Promise<void> {
  const current = settings()
  const previous = lastOwnClipboardHash()
  const hash = armOwnClipboardWrite(text)
  setLastOwnClipboardHash(hash)
  try {
    await copyText(text, renderer)
  } catch (error) {
    consumeOwnClipboardMark()
    if (previous) setLastOwnClipboardHash(previous)
    else clearLastOwnClipboardHash()
    throw error
  }
  if (current.recordOwn) {
    acceptClipboardText(text, current.limit)
    touchClipboard()
  }
}
