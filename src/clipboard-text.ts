import { createHash } from 'node:crypto'

export const CLIPBOARD_BYTE_LIMIT = 64 * 1024

export function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function clipboardTextHash(text: string): string {
  return createHash('sha256').update(normalizeClipboardText(text)).digest('hex')
}

export function clipboardByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function clipboardTextTooLong(text: string): boolean {
  return clipboardByteLength(text) > CLIPBOARD_BYTE_LIMIT
}
