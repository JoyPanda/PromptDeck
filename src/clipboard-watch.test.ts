import { describe, expect, test } from 'bun:test'
import { armOwnClipboardWrite, consumeOwnClipboardMark, extendOwnClipboardMark, ownClipboardMark, resetOwnClipboardMark } from './clipboard-own'
import { createClipboardWatchState, runClipboardWatchTick, type ClipboardWatchDeps } from './clipboard-watch'

function deps(overrides: Partial<ClipboardWatchDeps> = {}): ClipboardWatchDeps {
  return {
    readCount: () => 1,
    readSample: async () => ({ kind: 'text', text: 'hello' }),
    getSettings: () => ({ clipboardLimit: 100, recordOwnClipboard: false }),
    ingest: () => true,
    now: () => 1_000,
    platform: 'darwin',
    stopped: () => false,
    onRecorded: () => undefined,
    ...overrides,
  }
}

describe('clipboard watch', () => {
  test('keeps polling when saving throws and does not treat the sample as seen', async () => {
    const state = createClipboardWatchState()
    const delay = await runClipboardWatchTick(state, deps({
      ingest: () => {
        throw new Error('busy')
      },
    }))
    expect(state.failures).toBe(1)
    const again = await runClipboardWatchTick(state, deps({
      ingest: () => {
        throw new Error('busy')
      },
    }))
    const third = await runClipboardWatchTick(state, deps({
      ingest: () => {
        throw new Error('busy')
      },
    }))
    expect([delay, again, third]).toEqual([100, 300, 800])
    expect(state.seenCount).toBeNull()
    expect(state.startup).toBe(true)
  })

  test('does not read again while the change count stays the same', async () => {
    const state = createClipboardWatchState()
    state.seenCount = 4
    let reads = 0
    const delay = await runClipboardWatchTick(state, deps({
      readCount: () => 4,
      readSample: async () => {
        reads += 1
        return { kind: 'text', text: 'hello' }
      },
    }))
    expect(delay).toBe(400)
    expect(reads).toBe(0)
  })

  test('extends an own mark when the clipboard changes during a read', async () => {
    resetOwnClipboardMark()
    armOwnClipboardWrite('mine', 1_000)
    const state = createClipboardWatchState()
    let counts = 0
    const delay = await runClipboardWatchTick(state, deps({
      readCount: () => {
        counts += 1
        return counts === 1 ? 1 : 2
      },
      readSample: async () => ({ kind: 'text', text: 'mine' }),
      now: () => 1_500,
    }))
    expect(delay).toBe(40)
    expect(state.seenCount).toBeNull()
    expect(ownClipboardMark(1_500)?.until).toBe(3_500)
    consumeOwnClipboardMark()
    extendOwnClipboardMark(ownClipboardMark(1_500)?.hash ?? 'mine', 1_800)
    expect(ownClipboardMark(1_800)).toBeNull()
    resetOwnClipboardMark()
  })

  test('records the time the read started', async () => {
    const state = createClipboardWatchState()
    let seenAt = -1
    await runClipboardWatchTick(state, deps({
      readCount: () => 8,
      now: () => 42,
      ingest: (input) => {
        seenAt = input.now ?? -1
        return false
      },
    }))
    expect(seenAt).toBe(42)
    expect(state.seenCount).toBe(8)
    expect(state.startup).toBe(false)
  })
})
