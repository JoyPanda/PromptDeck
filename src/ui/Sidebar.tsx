import { useMemo, useState } from 'react'
import { generationCounts } from '../templates/db'
import { filterTemplates, type LibrarySort, type Template } from '../templates/parse'
import { Icon } from './icons'
import { Button, Dropdown, Field, FocusGroup, IconButton, Pressable, Text } from './widgets'
import { scaleFont, useTheme } from './theme'

export function Sidebar({
  templates,
  selectedId,
  busy,
  dirtyId,
  draft,
  historyTick,
  onSelect,
  onCreate,
  onOpenHistory,
}: {
  templates: Template[]
  selectedId: string | null
  busy: boolean
  dirtyId: string | null
  draft: Template | null
  historyTick: number
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenHistory: (id: string) => void
}) {
  const { palette, fontSize } = useTheme()
  const [query, setQuery] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState<LibrarySort>('updated')
  const useCounts = useMemo(() => generationCounts(), [templates, historyTick])
  const categories = [...new Set(templates.map((template) => template.category.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh'))
  const visible = filterTemplates(templates, { text: query, favoriteOnly, category, sort, useCounts })

  return (
    <FocusGroup style={{ display: 'flex', flexDirection: 'column', width: 260, height: '100%', minHeight: 0, backgroundColor: palette.sidebar, borderRightWidth: 1, borderColor: palette.line }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field icon="search" value={query} placeholder="搜索模板" onChange={setQuery} />
          </div>
          <IconButton testId="create-template" icon="plus" label="新建" primary disabled={busy} onClick={onCreate} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Button icon="star" label="只看收藏" block align="start" boxHeight={26} primary={favoriteOnly} onClick={() => setFavoriteOnly((current) => !current)} />
          <Dropdown
            testId="category-dropdown"
            icon="folder"
            boxHeight={26}
            value={category}
            options={[{ id: '', label: '全部分类' }, ...categories.map((item) => ({ id: item, label: item }))]}
            onChange={setCategory}
          />
          <Dropdown
            icon="sort"
            boxHeight={26}
            value={sort}
            options={[{ id: 'updated', label: '最近更新' }, { id: 'uses', label: '使用次数' }, { id: 'title', label: '标题' }]}
            onChange={(id) => setSort(id === 'uses' || id === 'title' ? id : 'updated')}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0, width: '100%', overflowY: 'scroll', overflowX: 'hidden', paddingLeft: 8, paddingRight: 8, gap: 4 }}>
        {visible.length === 0 ? <div style={{ padding: 8 }}><Text color={palette.muted} size={12}>{templates.length === 0 ? '还没有模板' : '没有匹配的模板'}</Text></div> : null}
        {visible.map((template) => {
          const selected = template.id === selectedId
          const pending = template.id === dirtyId && draft ? draft : null
          const source = pending ?? template
          const title = pending ? (pending.title.trim() || '未命名') : template.title
          const meta = [source.category, ...source.tags].filter((part) => part.trim()).join(' · ')
          const detail = [source.description.trim(), meta].filter(Boolean).join(' · ')
          const titleLine = textLine(12, fontSize)
          const detailLine = textLine(11, fontSize)
          return (
            <div
              key={template.id}
              testId="sidebar-item"
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
                minWidth: 0,
                gap: 4,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 6,
                overflow: 'hidden',
                backgroundColor: selected ? palette.selected : palette.sidebar,
                hover: { backgroundColor: selected ? palette.selectedPress : palette.hover },
                active: { backgroundColor: selected ? palette.selectedPress : palette.press },
              }}
            >
              <Pressable
                onPress={() => onSelect(template.id)}
                style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, cursor: 'pointer', active: { backgroundColor: selected ? palette.selectedPress : palette.press } }}
              >
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: titleLine, minWidth: 0, width: '100%', overflow: 'hidden' }}>
                  {pending ? <div testId="dirty-mark" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.text, flexShrink: 0 }} /> : null}
                  {source.favorite ? <div testId="favorite-mark" style={{ flexShrink: 0 }}><Icon name="star" color={palette.accent} size={14} filled /></div> : null}
                  <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, height: titleLine, overflow: 'hidden' }}>
                    <Text weight="600" size={12} color={palette.text} ellipsis lineHeight={titleLine}>{title}</Text>
                  </div>
                </div>
                <div testId="sidebar-detail" style={{ height: detailLine, width: '100%', minWidth: 0, overflow: 'hidden' }}>
                  {detail ? <Text color={palette.muted} size={11} ellipsis lineHeight={detailLine}>{detail}</Text> : null}
                </div>
              </Pressable>
              <div style={{ flexShrink: 0 }}>
                <Button label="历史" size="sm" onClick={() => onOpenHistory(template.id)} />
              </div>
            </div>
          )
        })}
      </div>
    </FocusGroup>
  )
}

function textLine(size: number, fontSize: number): number {
  return Math.max(size, Math.round((scaleFont(size, fontSize) * 21) / 13))
}
