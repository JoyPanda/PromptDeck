export const CLIPBOARD_ROW_POOL = 30

export function clipboardRowStride(fontSize: number): number {
  const scale = fontSize / 12
  const caption = Math.round(16 * scale)
  const row = Math.round(40 * scale)
  return caption + 4 + row + 8
}

export function clipboardInsertShift(ids: number[], previousFirstId: number | null): number {
  if (previousFirstId == null) return 0
  const index = ids.indexOf(previousFirstId)
  return index > 0 ? index : 0
}

export function recycleWindow(scrollTop: number, viewport: number, count: number, stride: number, pool = CLIPBOARD_ROW_POOL): { start: number; length: number; contentHeight: number } {
  if (count <= 0 || stride <= 0) return { start: 0, length: 0, contentHeight: 0 }
  const length = Math.min(count, pool)
  const visible = Math.max(1, Math.ceil(Math.max(0, viewport) / stride))
  const overscan = Math.max(0, Math.floor((length - visible) / 2))
  const firstVisible = Math.floor(Math.max(0, scrollTop) / stride)
  const maxStart = Math.max(0, count - length)
  const start = Math.min(maxStart, Math.max(0, firstVisible - overscan))
  return { start, length, contentHeight: count * stride }
}
