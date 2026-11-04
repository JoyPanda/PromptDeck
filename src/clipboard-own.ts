import { clipboardTextHash } from './clipboard-text'

export const OWN_WRITE_TTL_MS = 2000

export type OwnMark = { hash: string; until: number }

let ownMark: OwnMark | null = null

export function ownClipboardMark(now = Date.now()): OwnMark | null {
  if (ownMark && now > ownMark.until) ownMark = null
  return ownMark
}

export function armOwnClipboardWrite(text: string, now = Date.now()): string {
  const hash = clipboardTextHash(text)
  ownMark = { hash, until: now + OWN_WRITE_TTL_MS }
  return hash
}

export function extendOwnClipboardMark(hash: string, now = Date.now()): void {
  if (!ownMark || ownMark.hash !== hash) return
  ownMark = { hash, until: now + OWN_WRITE_TTL_MS }
}

export function consumeOwnClipboardMark(): void {
  ownMark = null
}

export function resetOwnClipboardMark(): void {
  ownMark = null
}
