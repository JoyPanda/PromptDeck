import { clipboardTextHash, clipboardTextTooLong } from './clipboard-text'

export type ClipboardSample =
  | { kind: 'text'; text: string }
  | { kind: 'blank' }
  | { kind: 'oversize' }
  | { kind: 'failed' }

export type OwnMark = { hash: string; until: number }

export type ClipboardDecision = {
  action: 'retry' | 'ignore' | 'record'
  clearLastOwn: boolean
  consumeMark: boolean
}

function textHash(text: string): string | null {
  if (!text.trim() || clipboardTextTooLong(text)) return null
  return clipboardTextHash(text)
}

export function decideClipboardSample(input: {
  sample: ClipboardSample
  startup: boolean
  recordOwn: boolean
  lastOwnHash: string | null
  ownMark: OwnMark | null
  now: number
}): ClipboardDecision {
  if (input.sample.kind === 'failed') return { action: 'retry', clearLastOwn: false, consumeMark: false }
  const hash = input.sample.kind === 'text' ? textHash(input.sample.text) : null
  const mark = input.ownMark && input.now <= input.ownMark.until ? input.ownMark : null
  if (mark && hash === mark.hash) return { action: 'ignore', clearLastOwn: false, consumeMark: true }
  if (input.startup && !input.recordOwn && hash != null && hash === input.lastOwnHash) {
    return { action: 'ignore', clearLastOwn: false, consumeMark: false }
  }
  const clearLastOwn = input.lastOwnHash != null
  if (input.sample.kind !== 'text' || hash == null) return { action: 'ignore', clearLastOwn, consumeMark: false }
  return { action: 'record', clearLastOwn: clearLastOwn && hash !== input.lastOwnHash, consumeMark: false }
}
