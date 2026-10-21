import { useMemo } from 'react'
import { useGpuixRequired } from '@gpuix/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react/tooltip'
import { copyText } from '../clipboard'
import { deleteGeneration, listAllGenerations, listGenerations, type Generation } from '../templates/db'
import { Button, Text } from './widgets'
import { scaleFont, textStyle, useTheme } from './theme'

const ROW_HEIGHT = 40

type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

export function HistoryView({
  templateId,
  revision,
  onCopied,
  onChanged,
  requestConfirm,
}: {
  templateId: string
  revision: number
  onCopied: (message: string) => void
  onChanged: () => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const entries = useMemo(() => listGenerations(templateId), [templateId, revision])
  return (
    <HistoryList
      heading="生成历史"
      empty="这个模板还没有生成记录。"
      entries={entries}
      onCopied={onCopied}
      onChanged={onChanged}
      requestConfirm={requestConfirm}
    />
  )
}

export function GlobalHistoryView({
  revision,
  onCopied,
  onChanged,
  requestConfirm,
}: {
  revision: number
  onCopied: (message: string) => void
  onChanged: () => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const entries = useMemo(() => listAllGenerations(), [revision])
  return (
    <HistoryList
      heading="全部历史"
      empty="还没有生成记录。"
      entries={entries}
      onCopied={onCopied}
      onChanged={onChanged}
      requestConfirm={requestConfirm}
    />
  )
}

function HistoryList({
  heading,
  empty,
  entries,
  onCopied,
  onChanged,
  requestConfirm,
}: {
  heading: string
  empty: string
  entries: Array<Generation & { title?: string }>
  onCopied: (message: string) => void
  onChanged: () => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const renderer = useGpuixRequired()
  const { palette, fontSize } = useTheme()
  const rowHeight = Math.round((ROW_HEIGHT * fontSize) / 12)

  async function copy(prompt: string) {
    try {
      await copyText(prompt, renderer)
      onCopied('已复制到剪贴板')
    } catch (error) {
      onCopied(error instanceof Error ? error.message : '复制失败')
    }
  }

  if (entries.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8, padding: 16, width: '100%' }}>
        <Text size={16} weight="700">{heading}</Text>
        <Text color={palette.muted}>{empty}</Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8, padding: 16, width: '100%', minWidth: 0, alignSelf: 'stretch' }}>
      <Text size={16} weight="700">{heading}</Text>
      {entries.map((entry) => (
        <div key={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text color={palette.muted} size={11}>{entryCaption(entry)}</Text>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 8, width: '100%', minWidth: 0 }}>
            <Button label="复制" fill primary boxHeight={rowHeight} onClick={() => void copy(entry.prompt)} />
            <Tooltip delayDuration={300} style={{ flexGrow: 1, minWidth: 0, alignSelf: 'stretch', alignItems: 'stretch' }}>
              <TooltipTrigger asChild>
                <div testId="history-entry" style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, height: rowHeight, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: palette.line, borderRadius: 6, backgroundColor: palette.panel, overflow: 'hidden', cursor: 'default', userSelect: 'none' }}>
                  <text style={{ ...textStyle(palette.text, scaleFont(12, fontSize), undefined, palette.font), whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', width: '100%', minWidth: 0, pointerEvents: 'none', userSelect: 'none' }}>{entry.prompt.replace(/\s+/g, ' ').trim()}</text>
                </div>
              </TooltipTrigger>
              <TooltipContent testId="history-tooltip" side="top" sideOffset={6} style={{ backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, borderRadius: 4, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, maxWidth: 480, maxHeight: 240, overflow: 'scroll' }}>
                <text style={{ ...textStyle(palette.text, scaleFont(12, fontSize), undefined, palette.font), whiteSpace: 'normal', pointerEvents: 'none' }}>{entry.prompt}</text>
              </TooltipContent>
            </Tooltip>
            <Button
              label="删除"
              fill
              danger
              boxHeight={rowHeight}
              onClick={() => requestConfirm({
                title: '删除历史',
                message: '确定删除这条生成记录？',
                confirmLabel: '确认删除',
                onConfirm: () => {
                  deleteGeneration(entry.id)
                  onChanged()
                },
              })}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function entryCaption(entry: Generation & { title?: string }): string {
  const when = formatWhen(entry.createdAt)
  if (entry.title == null) return when
  return `${entry.title.trim() || '已删除的模板'} · ${when}`
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp)
  const part = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`
}
