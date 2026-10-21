import { useGpuixRequired } from '@gpuix/react'
import { copyText } from '../clipboard'
import type { Slot, Template } from '../templates/parse'
import { renderPrompt } from '../templates/render'
import { Button, Dropdown, Field, FocusGroup, Section, Segmented, Text } from './widgets'
import { useTheme } from './theme'

export function UseView({
  template,
  values,
  busy,
  onChange,
  onCopied,
  onGenerated,
}: {
  template: Template
  values: Record<string, string>
  busy: boolean
  onChange: (name: string, value: string) => void
  onCopied: (message: string) => void
  onGenerated: (prompt: string) => void
}) {
  const renderer = useGpuixRequired()
  const { palette } = useTheme()
  const resolved = Object.fromEntries(template.slots.map((slot) => [slot.name, slotValue(slot, values)]))
  const prompt = renderPrompt(template.body, resolved)
  const missing = template.slots.some((slot) => slot.required !== false && !resolved[slot.name]?.trim())
  const meta = [template.category, ...template.tags].filter((part) => part.trim())

  async function generate() {
    const snapshot = prompt
    try {
      await copyText(snapshot, renderer)
      onGenerated(snapshot)
      onCopied(missing ? '已复制到剪贴板，还有未填写的槽位' : '已复制到剪贴板')
    } catch (error) {
      onCopied(error instanceof Error ? error.message : '复制失败')
    }
  }

  return (
    <FocusGroup style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 12, padding: 16, width: '100%', minWidth: 0, alignSelf: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button label="生成" size="lg" primary disabled={busy} onClick={() => void generate()} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexGrow: 1, minWidth: 0 }}>
          <Text size={15} weight="700" align="right">{template.title}</Text>
          {template.description ? <Text color={palette.faint} size={11} align="right">{template.description}</Text> : null}
          {meta.length > 0 ? <Text color={palette.faint} size={11} align="right">{meta.join(' · ')}</Text> : null}
        </div>
      </div>
      <Section title="填写变量">
        {template.slots.length === 0 ? <Text color={palette.muted} size={13}>这个模板没有要填的变量。</Text> : null}
        {template.slots.map((slot) => (
          <SlotField key={`${template.id}-${slot.name}`} slot={slot} value={resolved[slot.name] ?? ''} onChange={(value) => onChange(slot.name, value)} />
        ))}
      </Section>
      <Section>
        <Field label="完整提示词" value={prompt} multiline readOnly minRows={5} maxRows={14} />
      </Section>
    </FocusGroup>
  )
}

function slotValue(slot: Slot, values: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(values, slot.name)) return values[slot.name] ?? ''
  return slot.defaultValue ?? ''
}

function SlotField({ slot, value, onChange }: { slot: Slot; value: string; onChange: (value: string) => void }) {
  const { palette } = useTheme()
  const required = slot.required !== false
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', minWidth: 0 }}>
      <SlotLabel slot={slot} required={required} />
      {slot.description ? <Text color={palette.faint} size={11}>{slot.description}</Text> : null}
      {slot.kind === 'textarea' || slot.kind === 'text' || slot.kind === 'number' ? (
        <Field
          value={value}
          placeholder={slot.placeholder?.trim() || `填入后替换正文里的 {{${slot.name}}}`}
          multiline={slot.kind === 'textarea'}
          minRows={3}
          maxRows={8}
          onChange={onChange}
        />
      ) : null}
      {slot.kind === 'select' ? (
        slot.options && slot.options.length > 0 ? (
          <Dropdown
            value={value}
            options={[{ id: '', label: '请选择' }, ...slot.options.map((option) => ({ id: option, label: option }))]}
            onChange={onChange}
          />
        ) : <Text color={palette.muted} size={12}>还没有选项</Text>
      ) : null}
      {slot.kind === 'boolean' ? (
        <Segmented block value={value === '是' || value === '否' ? value : ''} options={[{ id: '是', label: '是' }, { id: '否', label: '否' }]} onChange={onChange} />
      ) : null}
    </div>
  )
}

function SlotLabel({ slot, required }: { slot: Slot; required: boolean }) {
  const { palette } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <Text color={palette.muted} size={11} ellipsis>{slot.label}</Text>
        </div>
        {required ? <div style={{ flexShrink: 0 }}><Text color={palette.danger} size={11}>*</Text></div> : null}
      </div>
      <div style={{ flexShrink: 0 }}><Text color={palette.faint} size={11}>{`{{${slot.name}}}`}</Text></div>
    </div>
  )
}
