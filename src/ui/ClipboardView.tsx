import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useGpuixRequired } from '@gpuix/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react/tooltip'
import { copyOwnText } from '../clipboard-copy'
import { clipboardSnapshot, subscribeClipboard, touchClipboard } from '../clipboard-live'
import { clipboardHoverText } from '../clipboard-secret'
import { clipboardInsertShift, clipboardRowStride, recycleWindow } from '../clipboard-window'
import { clipboardItemText, deleteClipboardItem, listClipboardEntries, type ClipboardEntry } from '../templates/db'
import { Button, Field, PanelScroll, Text } from './widgets'
import { scaleFont, textStyle, useTheme } from './theme'

type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

export function ClipboardView({
  onCopied,
  requestConfirm,
}: {
  onCopied: (message: string) => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const { palette, fontSize } = useTheme()
  const version = useSyncExternalStore(subscribeClipboard, clipboardSnapshot, clipboardSnapshot)
  const [query, setQuery] = useState('')
  const [deferred, setDeferred] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [scrollDelta, setScrollDelta] = useState<{ id: number; delta: number } | null>(null)
  const stride = clipboardRowStride(fontSize)
  const scrollTop = useRef(0)
  const strideRef = useRef(stride)
  const deltaSeq = useRef(0)
  const previous = useRef<{ length: number; firstId: number | null }>({ length: 0, firstId: null })
  const entries = useMemo(() => listClipboardEntries(deferred), [deferred, version])

  useEffect(() => {
    const handle = setTimeout(() => setDeferred(query), 150)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    setResetKey((value) => value + 1)
  }, [deferred])

  const queryRef = useRef(deferred)
  useEffect(() => {
    const previousStride = strideRef.current
    strideRef.current = stride
    if (previousStride === stride || previousStride <= 0) return
    const index = Math.floor(scrollTop.current / previousStride)
    const delta = index * stride - scrollTop.current
    if (Math.abs(delta) < 0.5) return
    deltaSeq.current += 1
    setScrollDelta({ id: deltaSeq.current, delta })
  }, [stride])

  useEffect(() => {
    const queryChanged = queryRef.current !== deferred
    queryRef.current = deferred
    const firstId = entries[0]?.id ?? null
    const shift = queryChanged ? 0 : clipboardInsertShift(entries.map((entry) => entry.id), previous.current.firstId)
    if (shift > 0 && scrollTop.current > 8) {
      deltaSeq.current += 1
      setScrollDelta({ id: deltaSeq.current, delta: shift * stride })
    }
    previous.current = { length: entries.length, firstId }
  }, [entries, stride, deferred])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, padding: 16, paddingBottom: 8 }}>
        <Text size={16} weight="700">剪贴板历史</Text>
        <Field icon="search" value={query} placeholder="搜索剪贴板" onChange={setQuery} />
      </div>
      <PanelScroll testId="clipboard-scroll" resetKey={resetKey} scrollDelta={scrollDelta}>
        {(metrics) => {
          scrollTop.current = metrics.scrollTop
          return (
            <ClipboardRows
              entries={entries}
              stride={stride}
              scrollTop={metrics.scrollTop}
              viewport={metrics.viewport}
              onCopied={onCopied}
              requestConfirm={requestConfirm}
            />
          )
        }}
      </PanelScroll>
    </div>
  )
}

function ClipboardRows({
  entries,
  stride,
  scrollTop,
  viewport,
  onCopied,
  requestConfirm,
}: {
  entries: ClipboardEntry[]
  stride: number
  scrollTop: number
  viewport: number
  onCopied: (message: string) => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const { palette, fontSize } = useTheme()
  const window = recycleWindow(scrollTop, viewport, entries.length, stride)
  if (entries.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 16, paddingRight: 16 }}>
        <Text color={palette.muted}>还没有剪贴板记录。</Text>
      </div>
    )
  }
  const caption = Math.round(16 * fontSize / 12)
  const rowHeight = Math.round(40 * fontSize / 12)
  return (
    <div style={{ position: 'relative', height: window.contentHeight, width: '100%' }}>
      {Array.from({ length: window.length }, (_, slot) => {
        const entry = entries[window.start + slot]
        if (!entry) return null
        return (
          <div key={slot} style={{ position: 'absolute', top: (window.start + slot) * stride, left: 16, right: 16, height: stride, overflow: 'hidden' }}>
            <ClipboardRow entry={entry} caption={caption} rowHeight={rowHeight} onCopied={onCopied} requestConfirm={requestConfirm} />
          </div>
        )
      })}
    </div>
  )
}

function ClipboardRow({
  entry,
  caption,
  rowHeight,
  onCopied,
  requestConfirm,
}: {
  entry: ClipboardEntry
  caption: number
  rowHeight: number
  onCopied: (message: string) => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const renderer = useGpuixRequired()
  const { palette, fontSize } = useTheme()
  const [hover, setHover] = useState('')
  const hoverId = useRef<number | null>(null)

  useEffect(() => {
    if (hoverId.current == null) return
    hoverId.current = entry.id
    const raw = clipboardItemText(entry.id)
    setHover(raw == null ? '' : clipboardHoverText(raw))
  }, [entry.id, entry.touchedAt])

  function loadHover() {
    if (hoverId.current === entry.id) return
    hoverId.current = entry.id
    const raw = clipboardItemText(entry.id)
    setHover(raw == null ? '' : clipboardHoverText(raw))
  }

  async function copy() {
    const raw = clipboardItemText(entry.id)
    if (raw == null) {
      touchClipboard()
      onCopied('这条记录已经不在了')
      return
    }
    try {
      await copyOwnText(raw, renderer)
      onCopied('已复制到剪贴板')
    } catch (error) {
      onCopied(error instanceof Error ? error.message : '复制失败')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}>
      <Text color={palette.muted} size={11} lineHeight={caption}>{formatWhen(entry.touchedAt)}</Text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 8, width: '100%', minWidth: 0 }}>
        <Button label="复制" fill primary boxHeight={rowHeight} onClick={() => void copy()} />
        <Tooltip delayDuration={300} style={{ flexGrow: 1, minWidth: 0, alignSelf: 'stretch', alignItems: 'stretch' }}>
          <TooltipTrigger asChild>
            <div testId="clipboard-entry" onMouseEnter={loadHover} style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, height: rowHeight, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: palette.line, borderRadius: 6, backgroundColor: palette.panel, overflow: 'hidden', cursor: 'default', userSelect: 'none' }}>
              <text style={{ ...textStyle(palette.text, scaleFont(12, fontSize), undefined, palette.font), whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', width: '100%', minWidth: 0, lineHeight: rowHeight, pointerEvents: 'none', userSelect: 'none' }}>{entry.preview}</text>
            </div>
          </TooltipTrigger>
          <TooltipContent key={entry.id} testId="clipboard-tooltip" side="top" sideOffset={6} style={{ backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, borderRadius: 4, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, maxWidth: 480, maxHeight: 240, overflow: 'scroll' }}>
            <text style={{ ...textStyle(palette.text, scaleFont(12, fontSize), undefined, palette.font), whiteSpace: 'normal', pointerEvents: 'none' }}>{hover}</text>
          </TooltipContent>
        </Tooltip>
        <Button
          label="删除"
          fill
          danger
          boxHeight={rowHeight}
          onClick={() => requestConfirm({
            title: '删除剪贴板记录',
            message: `确定删除「${entry.preview.slice(0, 40)}」？`,
            confirmLabel: '确认删除',
            onConfirm: () => {
              deleteClipboardItem(entry.id)
              touchClipboard()
            },
          })}
        />
      </div>
    </div>
  )
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp)
  const part = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`
}
