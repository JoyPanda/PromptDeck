import type { ChildProcess } from 'node:child_process'
import { readClipboardSample } from './clipboard'
import { ingestClipboardSample } from './clipboard-ingest'
import { touchClipboard } from './clipboard-live'
import { extendOwnClipboardMark, ownClipboardMark } from './clipboard-own'
import type { ClipboardSample } from './clipboard-policy'
import { readClipboardChangeCount } from './clipboard-sequence'
import { clipboardTextHash } from './clipboard-text'

export type ClipboardWatchSettings = {
  clipboardLimit: number
  recordOwnClipboard: boolean
}

export type ClipboardWatchState = {
  seenCount: number | null
  seenSample: string | null
  startup: boolean
  failures: number
}

export type ClipboardWatchDeps = {
  readCount: () => number | null
  readSample: () => Promise<ClipboardSample>
  getSettings: () => ClipboardWatchSettings
  ingest: typeof ingestClipboardSample
  now: () => number
  platform: NodeJS.Platform
  stopped: () => boolean
  onRecorded: () => void
}

export function createClipboardWatchState(): ClipboardWatchState {
  return { seenCount: null, seenSample: null, startup: true, failures: 0 }
}

export function clipboardWatchBackoff(failures: number): number {
  return [100, 300, 800][Math.min(Math.max(failures, 1) - 1, 2)] ?? 800
}

function idleDelay(counted: boolean, platform: NodeJS.Platform): number {
  if (counted) return 400
  return platform === 'win32' ? 2000 : 500
}

export async function advanceClipboardWatch(state: ClipboardWatchState, deps: ClipboardWatchDeps): Promise<number> {
  const observedAt = deps.now()
  const before = deps.readCount()
  const counted = before !== null
  if (counted && state.seenCount !== null && before === state.seenCount) return idleDelay(true, deps.platform)
  const ownHash = ownClipboardMark(observedAt)?.hash ?? null
  const sample = await deps.readSample()
  if (deps.stopped()) return idleDelay(counted, deps.platform)
  if (sample.kind === 'failed') {
    state.failures += 1
    return clipboardWatchBackoff(state.failures)
  }
  let pendingKey: string | null = null
  if (counted) {
    const after = deps.readCount()
    if (after !== before) {
      if (ownHash) extendOwnClipboardMark(ownHash, deps.now())
      return 40
    }
  } else {
    pendingKey = sample.kind === 'text' ? clipboardTextHash(sample.text) : sample.kind
    if (!state.startup && pendingKey === state.seenSample) return idleDelay(false, deps.platform)
  }
  const settings = deps.getSettings()
  const changed = deps.ingest({
    sample,
    startup: state.startup,
    recordOwn: settings.recordOwnClipboard,
    limit: settings.clipboardLimit,
    now: observedAt,
  })
  state.failures = 0
  if (counted) state.seenCount = before
  else state.seenSample = pendingKey
  state.startup = false
  if (changed) deps.onRecorded()
  return idleDelay(counted, deps.platform)
}

export async function runClipboardWatchTick(state: ClipboardWatchState, deps: ClipboardWatchDeps): Promise<number> {
  try {
    return await advanceClipboardWatch(state, deps)
  } catch {
    state.failures += 1
    return clipboardWatchBackoff(state.failures)
  }
}

export function startClipboardWatch(getSettings: () => ClipboardWatchSettings): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let child: ChildProcess | null = null
  const state = createClipboardWatchState()

  const schedule = (delay: number) => {
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
    }, delay)
  }

  const tick = async () => {
    if (stopped) return
    const delay = await runClipboardWatchTick(state, {
      readCount: () => readClipboardChangeCount(),
      readSample: () => readClipboardSample(process.platform, (next) => {
        child = next
      }),
      getSettings,
      ingest: ingestClipboardSample,
      now: () => Date.now(),
      platform: process.platform,
      stopped: () => stopped,
      onRecorded: touchClipboard,
    })
    child = null
    if (!stopped) schedule(delay)
  }

  schedule(0)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    child?.kill()
  }
}
