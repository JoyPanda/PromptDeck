const listeners = new Set<() => void>()
let version = 0

export function clipboardSnapshot(): number {
  return version
}

export function subscribeClipboard(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function touchClipboard(): void {
  version += 1
  for (const listener of listeners) listener()
}
