import type { EventPayload } from '@gpuix/react'

type KeyHandler = (event: EventPayload) => void

let handler: KeyHandler | null = null

export function setKeyCapture(next: KeyHandler | null): void {
  handler = next
}

export function dispatchKeyCapture(event: EventPayload): void {
  handler?.(event)
}
