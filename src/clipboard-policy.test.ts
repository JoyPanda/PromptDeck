import { describe, expect, test } from 'bun:test'
import { decideClipboardSample } from './clipboard-policy'
import { clipboardTextHash } from './clipboard-text'

describe('decideClipboardSample', () => {
  const hash = clipboardTextHash('same')

  test('ignores an own write and still records a later copy of the same text', () => {
    expect(decideClipboardSample({
      sample: { kind: 'text', text: 'same' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: { hash, until: 2_000 },
      now: 1_000,
    })).toEqual({ action: 'ignore', clearLastOwn: false, consumeMark: true })
    expect(decideClipboardSample({
      sample: { kind: 'text', text: 'same' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: null,
      now: 5_000,
    }).action).toBe('record')
    expect(decideClipboardSample({
      sample: { kind: 'text', text: 'other' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: { hash, until: 2_000 },
      now: 1_000,
    })).toMatchObject({ action: 'record', consumeMark: false })
    expect(decideClipboardSample({
      sample: { kind: 'blank' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: { hash, until: 2_000 },
      now: 1_000,
    }).consumeMark).toBe(false)
  })

  test('skips the last own write on startup only while recording is off', () => {
    const own = clipboardTextHash('same\r\n')
    expect(decideClipboardSample({
      sample: { kind: 'text', text: 'same\n' },
      startup: true,
      recordOwn: false,
      lastOwnHash: own,
      ownMark: null,
      now: 0,
    }).action).toBe('ignore')
    expect(decideClipboardSample({
      sample: { kind: 'text', text: 'same' },
      startup: true,
      recordOwn: true,
      lastOwnHash: hash,
      ownMark: null,
      now: 0,
    }).action).toBe('record')
  })

  test('retries a failed read and clears the own marker after another clipboard change', () => {
    expect(decideClipboardSample({
      sample: { kind: 'failed' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: { hash, until: 2_000 },
      now: 1_000,
    })).toEqual({ action: 'retry', clearLastOwn: false, consumeMark: false })
    const blank = decideClipboardSample({
      sample: { kind: 'blank' },
      startup: false,
      recordOwn: false,
      lastOwnHash: hash,
      ownMark: null,
      now: 0,
    })
    expect(blank).toEqual({ action: 'ignore', clearLastOwn: true, consumeMark: false })
  })
})
