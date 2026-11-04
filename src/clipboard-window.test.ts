import { describe, expect, test } from 'bun:test'
import { clipboardInsertShift, clipboardRowStride, recycleWindow } from './clipboard-window'

describe('recycleWindow', () => {
  test('keeps thirty rows at the top, middle, and end', () => {
    expect(recycleWindow(0, 400, 80, 40)).toEqual({ start: 0, length: 30, contentHeight: 3200 })
    const middle = recycleWindow(2000, 400, 80, 40)
    expect(middle.length).toBe(30)
    expect(middle.start).toBeLessThanOrEqual(50)
    expect(middle.start + middle.length).toBeGreaterThan(50)
    expect(recycleWindow(10_000, 400, 80, 40)).toEqual({ start: 50, length: 30, contentHeight: 3200 })
    expect(recycleWindow(0, 400, 12, 40)).toEqual({ start: 0, length: 12, contentHeight: 480 })
    expect(clipboardRowStride(12)).toBeGreaterThan(40)
    expect(clipboardInsertShift([4, 1, 2, 3], 1)).toBe(1)
    expect(clipboardInsertShift([9, 8, 1], 1)).toBe(2)
    expect(clipboardInsertShift([1, 2, 3], 1)).toBe(0)
    expect(clipboardInsertShift([2, 3], 1)).toBe(0)
    expect(clipboardInsertShift([1], null)).toBe(0)
  })
})
