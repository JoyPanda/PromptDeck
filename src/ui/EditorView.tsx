import { useEffect, useState } from 'react'
import { parseTagList, reconcileSlots, removeSlotFromBody, renameSlotInBody, slotNamesIn, slotUsedInBody, type Slot, type SlotKind, type Template } from '../templates/parse'
import { Button, Dropdown, Field, FocusGroup, Section, sectionActionHeight, Segmented, Tabs, Text } from './widgets'
import { useTheme } from './theme'

type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

const KINDS: Array<{ id: SlotKind; label: string }> = [
  { id: 'text', label: '单行文本' },
  { id: 'textarea', label: '多行文本' },
  { id: 'select', label: '下拉' },
  { id: 'number', label: '数字' },
  { id: 'boolean', label: '是否' },
]

function nextSlotName(slots: Slot[]): string {
  const taken = new Set(slots.map((slot) => slot.name))
  let index = slots.length + 1
  let name = `slot${index}`
  while (taken.has(name)) {
    index += 1
    name = `slot${index}`
  }
  return name
}

export function EditorView({
  template,
  revision,
  busy,
  onChange,
  onSave,
  onDelete,
  requestConfirm,
}: {
  template: Template
  revision: number
  busy: boolean
  onChange: (update: (template: Template) => Template) => void
  onSave: () => void
  onDelete: () => void
  requestConfirm: (request: ConfirmRequest) => void
}) {
  const { palette, fontSize } = useTheme()
  const [slotIndex, setSlotIndex] = useState(0)
  const [tagText, setTagText] = useState(template.tags.join(', '))

  useEffect(() => {
    setSlotIndex(0)
    setTagText(template.tags.join(', '))
  }, [template.id, revision])

  function updateSlot(index: number, patch: Partial<Slot>) {
    onChange((current) => {
      const slot = current.slots[index]
      if (!slot) return current
      const nextName = patch.name
      const canRename = typeof nextName === 'string'
        && nextName !== slot.name
        && /^[A-Za-z0-9_-]+$/.test(nextName)
        && !current.slots.some((item, itemIndex) => itemIndex !== index && item.name === nextName)
      const body = canRename ? renameSlotInBody(current.body, slot.name, nextName) : current.body
      const slots = current.slots.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
      return reconcileSlots({ ...current, body, slots })
    })
  }

  function insertSlot(name: string) {
    onChange((current) => {
      const body = current.body.replace(/\s*$/, '')
      return reconcileSlots({ ...current, body: `${body}\n{{${name}}}` })
    })
  }

  const index = template.slots.length === 0 ? 0 : Math.min(slotIndex, template.slots.length - 1)
  const slot = template.slots[index]
  const usedNames = new Set(slotNamesIn(template.body))

  function addSlot() {
    const next: Slot = { name: nextSlotName(template.slots), label: '新槽位', kind: 'text' }
    onChange((current) => ({ ...current, slots: [...current.slots, next] }))
    setSlotIndex(template.slots.length)
  }

  return (
    <FocusGroup style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 12, padding: 16, width: '100%', minWidth: 0, alignSelf: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Text size={15} weight="700">编辑模板</Text>
          <Text color={palette.faint} size={11}>{template.id}</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Button label={busy ? '正在保存…' : '保存'} size="lg" primary disabled={busy} onClick={onSave} />
          <Button
            label="删除"
            size="sm"
            danger
            disabled={busy}
            onClick={() => requestConfirm({
              title: '删除模板',
              message: `确定删除模板「${template.title}」？`,
              confirmLabel: '确认删除',
              onConfirm: onDelete,
            })}
          />
        </div>
      </div>
      <Section
        title="模板信息"
        action={<Button label={template.favorite ? '已收藏' : '收藏'} boxHeight={sectionActionHeight(fontSize)} primary={template.favorite} onClick={() => onChange((current) => ({ ...current, favorite: !current.favorite }))} />}
      >
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, width: '100%', minWidth: 0 }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field key={`title-${template.id}-${revision}`} label="标题" value={template.title} onChange={(title) => onChange((current) => ({ ...current, title }))} />
          </div>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field key={`description-${template.id}-${revision}`} label="说明" value={template.description} onChange={(description) => onChange((current) => ({ ...current, description }))} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, width: '100%', minWidth: 0 }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field label="分类" value={template.category} placeholder="例如 工作" onChange={(category) => onChange((current) => ({ ...current, category }))} />
          </div>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field
              label="标签"
              value={tagText}
              placeholder="用逗号分隔"
              onChange={(text) => {
                setTagText(text)
                onChange((current) => ({ ...current, tags: parseTagList(text) }))
              }}
            />
          </div>
        </div>
      </Section>
      <Section title="槽位" action={<Button label="添加槽位" boxHeight={sectionActionHeight(fontSize)} disabled={busy} onClick={addSlot} />}>
        {template.slots.length > 0 ? (
          <Tabs
            placement="inline"
            value={String(index)}
            onChange={(id) => setSlotIndex(Number(id))}
            options={template.slots.map((item, itemIndex) => ({
              id: String(itemIndex),
              label: `${item.label.trim() || item.name || `槽位 ${itemIndex + 1}`}${usedNames.has(item.name) ? '' : ' · 未使用'}`,
            }))}
          />
        ) : (
          <Text color={palette.muted} size={12}>还没有槽位</Text>
        )}
        {slot ? <SlotEditor key={`${template.id}-${index}`} slot={slot} body={template.body} onPatch={(patch) => updateSlot(index, patch)} onInsert={() => insertSlot(slot.name)} onDelete={() => {
          const name = slot.label.trim() || slot.name || '未命名'
          requestConfirm({
            title: '删除槽位',
            message: `确定删除槽位「${name}」？正文里的 {{${slot.name}}} 也会去掉。`,
            confirmLabel: '确认删除',
            onConfirm: () => {
              const name = slot.name
              onChange((current) => ({
                ...current,
                slots: current.slots.filter((_, itemIndex) => itemIndex !== index),
                body: removeSlotFromBody(current.body, name),
              }))
              setSlotIndex(Math.max(0, index - 1))
            },
          })
        }} /> : null}
      </Section>
      <Section title="正文">
        <Text color={palette.faint} size={11}>{'新的 {{变量名}} 会添加槽位，同名只留一个。自动加上、还没改过的槽会换成新名字，旧名字不会留下。改过的槽会保留，没出现在正文里的会标成未使用。'}</Text>
        <Field
          key={`body-${template.id}-${revision}`}
          value={template.body}
          multiline
          minRows={8}
          maxRows={18}
          placeholder="用 {{变量名}} 标出需要填写的部分"
          onChange={(body) => onChange((current) => reconcileSlots({ ...current, body }, current.body))}
        />
      </Section>
    </FocusGroup>
  )
}

function SlotEditor({
  slot,
  body,
  onPatch,
  onInsert,
  onDelete,
}: {
  slot: Slot
  body: string
  onPatch: (patch: Partial<Slot>) => void
  onInsert: () => void
  onDelete: () => void
}) {
  const { palette } = useTheme()
  const used = slotUsedInBody(body, slot.name)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: 0, alignSelf: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, width: '100%', minWidth: 0 }}>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <Field label="变量名" value={slot.name} placeholder="language" onChange={(name) => onPatch({ name: name.trim() })} />
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <Field label="显示名" value={slot.label} onChange={(label) => onPatch({ label })} />
        </div>
      </div>
      <Field label="说明" value={slot.description ?? ''} placeholder="选填，显示在使用页" onChange={(description) => onPatch({ description })} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
        <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <Dropdown value={slot.kind} options={KINDS} onChange={(id) => onPatch({ kind: id as SlotKind })} />
        </div>
        <Segmented
          value={slot.required === false ? 'optional' : 'required'}
          options={[{ id: 'required', label: '必填' }, { id: 'optional', label: '选填' }]}
          onChange={(id) => onPatch({ required: id === 'required' })}
        />
        {!used ? <Text color={palette.faint} size={11}>未使用</Text> : null}
      </div>
      {slot.kind === 'text' || slot.kind === 'textarea' ? (
        <Field label="占位提示" value={slot.placeholder ?? ''} onChange={(placeholder) => onPatch({ placeholder })} />
      ) : null}
      {slot.kind === 'select' ? <OptionsField options={slot.options ?? []} onChange={(options) => onPatch({ options })} /> : null}
      <DefaultField slot={slot} onChange={(defaultValue) => onPatch({ defaultValue })} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Button label="插入到正文" size="sm" disabled={!/^[A-Za-z0-9_-]+$/.test(slot.name)} onClick={onInsert} />
        <Button label="删除槽位" size="sm" danger onClick={onDelete} />
      </div>
    </div>
  )
}

function OptionsField({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState(options.join('\n'))
  return (
    <Field
      label="选项"
      value={text}
      multiline
      minRows={3}
      maxRows={8}
      placeholder="一行一个选项"
      onChange={(value) => {
        setText(value)
        onChange(value.split('\n').map((line) => line.trim()).filter(Boolean))
      }}
    />
  )
}

function DefaultField({ slot, onChange }: { slot: Slot; onChange: (value: string) => void }) {
  if (slot.kind === 'boolean') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextLabel text="默认值" />
        <Segmented
          value={slot.defaultValue === '是' || slot.defaultValue === '否' ? slot.defaultValue : ''}
          options={[{ id: '', label: '无' }, { id: '是', label: '是' }, { id: '否', label: '否' }]}
          onChange={onChange}
        />
      </div>
    )
  }
  if (slot.kind === 'select') {
    const options = [{ id: '', label: '无' }, ...(slot.options ?? []).map((option) => ({ id: option, label: option }))]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextLabel text="默认值" />
        <Dropdown value={slot.defaultValue && options.some((option) => option.id === slot.defaultValue) ? slot.defaultValue : ''} options={options} onChange={onChange} />
      </div>
    )
  }
  return <Field label="默认值" value={slot.defaultValue ?? ''} onChange={onChange} />
}

function TextLabel({ text }: { text: string }) {
  const { palette } = useTheme()
  return <Text color={palette.muted} size={11}>{text}</Text>
}
