import type { ClipboardSample } from './clipboard-policy'
import { decideClipboardSample } from './clipboard-policy'
import { ownClipboardMark, consumeOwnClipboardMark } from './clipboard-own'
import {
  acceptClipboardText,
  clearLastOwnClipboardHash,
  lastOwnClipboardHash,
} from './templates/db'

export function ingestClipboardSample(input: {
  sample: ClipboardSample
  startup: boolean
  recordOwn: boolean
  limit: number
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  const decision = decideClipboardSample({
    sample: input.sample,
    startup: input.startup,
    recordOwn: input.recordOwn,
    lastOwnHash: lastOwnClipboardHash(),
    ownMark: ownClipboardMark(now),
    now,
  })
  if (decision.consumeMark) consumeOwnClipboardMark()
  if (decision.clearLastOwn) clearLastOwnClipboardHash()
  if (decision.action !== 'record' || input.sample.kind !== 'text') return false
  return acceptClipboardText(input.sample.text, input.limit) !== 'ignored'
}
