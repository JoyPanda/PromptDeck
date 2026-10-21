import { motion, useGpuixRequired, type EventPayload, type PublicInstance, type StyleDesc } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DEFAULT_FONT_SIZE } from '../settings'
import { Icon, type IconName } from './icons'
import { applySecretEdit, maskSecret } from './secret-field'
import { scaleFont, textStyle, useTheme } from './theme'

function elementBounds(
  renderer: { getElementBounds?: (id: number) => { x: number; y: number; width: number; height: number } | null },
  id: number,
): { x: number; y: number; width: number; height: number } | null {
  try {
    return renderer.getElementBounds?.(id) ?? null
  } catch {
    return null
  }
}

function leftButton(event: EventPayload): boolean {
  return event.button == null || event.button === 0
}

/** 只有按下和松开都落在这个控件上才算一次点击。 */
export function Pressable({
  onPress,
  disabled = false,
  children,
  style,
  testId,
  role,
  ariaLabel,
  tabIndex,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  nodeRef,
}: {
  onPress: () => void
  disabled?: boolean
  children?: ReactNode
  style?: StyleDesc
  testId?: string
  role?: string
  ariaLabel?: string
  tabIndex?: number
  onKeyDown?: (event: EventPayload) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  nodeRef?: RefObject<PublicInstance | null>
}) {
  const pressed = useRef(false)
  return (
    <div
      ref={nodeRef}
      testId={testId}
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => {
        pressed.current = false
        onMouseLeave?.()
      }}
      onMouseDown={(event) => {
        if (disabled || !leftButton(event)) return
        pressed.current = true
      }}
      onMouseUp={(event) => {
        const ready = pressed.current
        pressed.current = false
        if (!ready || disabled || !leftButton(event)) return
        onPress()
      }}
      style={style}
    >
      {children}
    </div>
  )
}

type ResizeDrag = {
  startY: number
  startHeight: number
  minHeight: number
  maxHeight: number
  setHeight: (height: number) => void
}

const ResizeContext = createContext<{
  begin: (drag: ResizeDrag) => void
  move: (event: EventPayload) => void
  end: () => void
} | null>(null)
const FocusGroupContext = createContext<{ current: PublicInstance | null } | null>(null)

export function FocusGroup({ children, style, testId, nodeRef }: { children: ReactNode; style?: StyleDesc; testId?: string; nodeRef?: RefObject<PublicInstance | null> }) {
  const localRef = useRef<PublicInstance | null>(null)
  const ref = nodeRef ?? localRef
  return (
    <FocusGroupContext.Provider value={ref}>
      <div ref={ref} testId={testId} style={style}>{children}</div>
    </FocusGroupContext.Provider>
  )
}

export function ResizeScope({ children }: { children: ReactNode }) {
  const dragRef = useRef<ResizeDrag | null>(null)
  const api = useRef({
    begin(drag: ResizeDrag) {
      dragRef.current = drag
    },
    move(event: EventPayload) {
      const current = dragRef.current
      if (!current || event.y == null) return
      // 松开后如果没收到 mouseup，下一次移动不能继续改高度。
      if (event.pressedButton !== 0) {
        dragRef.current = null
        return
      }
      const next = Math.round(Math.min(current.maxHeight, Math.max(current.minHeight, current.startHeight + event.y - current.startY)))
      current.setHeight(next)
    },
    end() {
      dragRef.current = null
    },
  })
  return <ResizeContext.Provider value={api.current}>{children}</ResizeContext.Provider>
}

function toastIsDanger(message: string): boolean {
  return message.includes('失败') || message.includes('冲突') || message.includes('无效') || message.includes('请')
}

export function Toast({ message }: { message: string }) {
  const { palette } = useTheme()
  const [shown, setShown] = useState(true)
  const danger = toastIsDanger(message)
  useEffect(() => {
    if (message.startsWith('正在')) return
    const timer = setTimeout(() => setShown(false), danger ? 8000 : 2400)
    return () => clearTimeout(timer)
  }, [danger, message])
  if (!shown) return null
  return (
    <motion.div
      initial={{ opacity: 0, bottom: 24 }}
      animate={{ opacity: 1, bottom: 44 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}
    >
      <div
        testId="toast"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          maxWidth: 520,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: danger ? palette.danger : palette.line,
          backgroundColor: danger ? palette.dangerBg : palette.card,
          boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 16, spreadRadius: 0, color: '#00000055' },
        }}
      >
        <Text size={13} wrap color={danger ? palette.danger : palette.text}>{message}</Text>
      </div>
    </motion.div>
  )
}

export function UpdatePrompt({ version, raised = false, onDownload, onLater }: { version: string; raised?: boolean; onDownload: () => void; onLater: () => void }) {
  const { palette } = useTheme()
  const laterRef = useRef(onLater)
  laterRef.current = onLater
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(false)
      laterRef.current()
    }, 15000)
    return () => clearTimeout(timer)
  }, [version])
  if (!shown) return null
  return (
    <motion.div
      initial={{ opacity: 0, bottom: raised ? 88 : 24 }}
      animate={{ opacity: 1, bottom: raised ? 108 : 44 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}
    >
      <div
        testId="update-prompt"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          maxWidth: 520,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.card,
          pointerEvents: 'auto',
          boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 16, spreadRadius: 0, color: '#00000055' },
        }}
      >
        <Text size={13} color={palette.text}>{`发现新版本 v${version}`}</Text>
        <Button label="下载" size="sm" primary onClick={onDownload} />
        <Button label="稍后" size="sm" onClick={() => { setShown(false); onLater() }} />
      </div>
    </motion.div>
  )
}

export function PanelScroll({ children, testId }: { children: ReactNode; testId?: string }) {
  const renderer = useGpuixRequired()
  const { palette } = useTheme()
  const scrollerRef = useRef<PublicInstance | null>(null)
  const contentRef = useRef<PublicInstance | null>(null)
  const dragRef = useRef<{ startY: number; startScroll: number; thumbTravel: number; maxScroll: number } | null>(null)
  const [metrics, setMetrics] = useState({ viewport: 0, content: 0, scrollTop: 0, top: 0 })
  const scheduled = useRef(false)

  function readMetrics() {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return null
    const view = elementBounds(renderer, scroller.id)
    const body = elementBounds(renderer, content.id)
    const offset = renderer.getScrollOffset?.(scroller.id)
    if (!view || !body) return null
    return { viewport: view.height, content: body.height, scrollTop: Math.max(0, -(offset?.[1] ?? 0)), top: view.y }
  }

  function publishMetrics() {
    const next = readMetrics()
    if (!next) return
    setMetrics((current) => (
      current.viewport === next.viewport && current.content === next.content && current.top === next.top && Math.abs(current.scrollTop - next.scrollTop) < 0.5
        ? current
        : next
    ))
  }

  function scheduleMetrics() {
    if (scheduled.current) return
    scheduled.current = true
    setTimeout(() => {
      scheduled.current = false
      publishMetrics()
    }, 0)
  }

  useEffect(() => {
    publishMetrics()
    const timer = setInterval(publishMetrics, 200)
    return () => clearInterval(timer)
    // The measurer only reads refs, so it stays valid for the life of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const maxScroll = Math.max(0, metrics.content - metrics.viewport)
  const overflow = maxScroll > 1
  const thumbHeight = overflow ? Math.max(28, (metrics.viewport * metrics.viewport) / metrics.content) : 0
  const thumbTravel = Math.max(1, metrics.viewport - 8 - thumbHeight)
  const thumbTop = maxScroll > 0 ? (metrics.scrollTop / maxScroll) * thumbTravel : 0

  function scrollTo(top: number) {
    const scroller = scrollerRef.current
    if (!scroller || !renderer.scrollTo) return
    const next = Math.min(maxScroll, Math.max(0, top))
    renderer.scrollTo(scroller.id, 0, -next)
    scheduleMetrics()
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <div
        ref={scrollerRef}
        testId={testId}
        onScroll={scheduleMetrics}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflowY: 'scroll', overflowX: 'hidden' }}
      >
        <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, width: '100%', minWidth: 0, paddingRight: overflow ? 14 : 0 }}>
          {children}
        </div>
      </div>
      {overflow ? (
        <div
          onMouseDown={(event) => {
            const local = (event.y ?? 0) - metrics.top - 4
            scrollTo(((local - thumbHeight / 2) / thumbTravel) * maxScroll)
          }}
          style={{ position: 'absolute', top: 4, right: 3, bottom: 4, width: 10, borderRadius: 5, backgroundColor: palette.hover }}
        />
      ) : null}
      {overflow ? (
        <div
          testId="panel-scrollbar"
          onMouseDown={(event) => {
            if (!leftButton(event)) return
            dragRef.current = { startY: event.y ?? 0, startScroll: metrics.scrollTop, thumbTravel, maxScroll }
          }}
          onMouseMove={(event) => {
            const current = dragRef.current
            if (!current || event.y == null) return
            // 按下时这三个监听都在滑块上，松手即使离开窗口也会送到这里。
            // 万一没送到，按钮已经松开的移动也不能继续滚。
            if (event.pressedButton !== 0) {
              dragRef.current = null
              return
            }
            const delta = ((event.y - current.startY) / current.thumbTravel) * current.maxScroll
            scrollTo(current.startScroll + delta)
          }}
          onMouseUp={() => {
            dragRef.current = null
          }}
          style={{ position: 'absolute', top: 4 + thumbTop, right: 4, width: 8, height: thumbHeight, borderRadius: 4, backgroundColor: palette.muted, cursor: 'default' }}
        />
      ) : null}
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { palette } = useTheme()
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      <Pressable onPress={onCancel} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000000', opacity: 0.45 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 320, padding: 14, borderRadius: 6, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, pointerEvents: 'auto' }}>
          <Text size={14} weight="700">{title}</Text>
          <Text color={palette.muted} size={12}>{message}</Text>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
            <Button label="取消" size="md" onClick={onCancel} />
            <Button label={confirmLabel} size="md" danger onClick={onConfirm} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Text({
  children,
  color,
  size = 12,
  weight,
  align,
  ellipsis = false,
  wrap = false,
  lineHeight,
}: {
  children: string
  color?: string
  size?: number
  weight?: string
  align?: 'left' | 'right'
  ellipsis?: boolean
  wrap?: boolean
  lineHeight?: number
}) {
  const { palette, fontSize } = useTheme()
  return (
    <text style={{
      ...textStyle(color ?? palette.text, scaleFont(size, fontSize), weight, palette.font),
      pointerEvents: 'none',
      userSelect: 'none',
      ...(lineHeight ? { lineHeight } : {}),
      ...(align || ellipsis || wrap ? { width: '100%' } : {}),
      ...(align ? { textAlign: align } : {}),
      ...(wrap ? { whiteSpace: 'normal', minWidth: 0 } : {}),
      ...(ellipsis ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', minWidth: 0 } : {}),
    }}>{children}</text>
  )
}

const BUTTON_SIZE = {
  sm: { padX: 10 },
  md: { padX: 12 },
  lg: { padX: 14 },
} as const

function controlHeight(fontSize: number): number {
  return Math.round((32 * fontSize) / DEFAULT_FONT_SIZE)
}

export function Button({
  label,
  onClick,
  primary = false,
  danger = false,
  disabled = false,
  size = 'md',
  boxHeight,
  fill = false,
  block = false,
  icon,
  align = 'center',
}: {
  label: string
  onClick: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  size?: keyof typeof BUTTON_SIZE
  boxHeight?: number
  fill?: boolean
  block?: boolean
  icon?: IconName
  align?: 'center' | 'start'
}) {
  const { palette, fontSize } = useTheme()
  const metrics = BUTTON_SIZE[size]
  const height = boxHeight ?? (fill ? undefined : controlHeight(fontSize))
  const compact = boxHeight != null && boxHeight < 30
  const backgroundColor = primary ? palette.accent : danger ? palette.dangerBg : palette.card
  const color = primary ? palette.accentText : danger ? palette.danger : palette.text
  const iconColor = primary ? palette.accentText : align === 'start' ? palette.muted : color
  const hover = primary ? palette.accentHover : danger ? palette.dangerHover : palette.hover
  return (
    <Pressable
      role="button"
      ariaLabel={label}
      disabled={disabled}
      onPress={onClick}
      style={{
        height,
        minHeight: height,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: align === 'start' ? 'flex-start' : 'center',
        gap: icon ? 8 : 0,
        alignSelf: fill || block ? 'stretch' : undefined,
        width: block ? '100%' : undefined,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: align === 'start' ? 8 : metrics.padX,
        paddingRight: align === 'start' ? 8 : metrics.padX,
        borderRadius: 6,
        backgroundColor,
        borderWidth: 1,
        borderColor: primary ? palette.accent : palette.line,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        hover: disabled ? undefined : { backgroundColor: hover },
        active: disabled ? undefined : { backgroundColor: primary ? palette.accentPress : danger ? palette.dangerPress : palette.press },
      }}
    >
      {icon ? <Icon name={icon} color={iconColor} size={compact ? 14 : 16} /> : null}
      {label ? <Text color={color} size={compact ? 12 : 13} weight={align === 'start' ? undefined : '600'}>{label}</Text> : null}
    </Pressable>
  )
}

export function IconButton({
  icon,
  label,
  onClick,
  primary = false,
  disabled = false,
  testId,
  boxHeight,
}: {
  icon: IconName
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  testId?: string
  boxHeight?: number
}) {
  const { palette, fontSize } = useTheme()
  const [over, setOver] = useState(false)
  const height = boxHeight ?? controlHeight(fontSize)
  const iconSize = boxHeight != null && boxHeight < 28 ? 14 : 16
  const labelSize = boxHeight != null && boxHeight < 28 ? 12 : 13
  const backgroundColor = primary ? palette.accent : palette.card
  const color = primary ? palette.accentText : palette.text
  const hover = primary ? palette.accentHover : palette.hover
  return (
    <Pressable
      testId={testId}
      role="button"
      ariaLabel={label}
      disabled={disabled}
      onPress={onClick}
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{
        height,
        minHeight: height,
        minWidth: height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        paddingLeft: over ? 10 : 0,
        paddingRight: over ? 10 : 0,
        borderRadius: 6,
        backgroundColor,
        borderWidth: 1,
        borderColor: primary ? palette.accent : palette.line,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        hover: disabled ? undefined : { backgroundColor: hover },
        active: disabled ? undefined : { backgroundColor: primary ? palette.accentPress : palette.press },
      }}
    >
      {over ? <Text color={color} size={labelSize} weight="600">{label}</Text> : <Icon name={icon} color={color} size={iconSize} />}
    </Pressable>
  )
}

export function sectionActionHeight(fontSize: number): number {
  return Math.max(20, Math.round((scaleFont(13, fontSize) * 21) / 13))
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  const { palette, fontSize } = useTheme()
  const barHeight = sectionActionHeight(fontSize)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 6, backgroundColor: palette.panel, width: '100%', minWidth: 0, alignSelf: 'stretch' }}>
      {title ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0, height: barHeight }}>
          <Text size={13} weight="600" lineHeight={barHeight}>{title}</Text>
          {action}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function Dropdown({
  value,
  options,
  onChange,
  icon,
  boxHeight,
  testId,
}: {
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (id: string) => void
  icon?: IconName
  boxHeight?: number
  testId?: string
}) {
  const renderer = useGpuixRequired()
  const { palette, fontSize } = useTheme()
  const anchorRef = useRef<PublicInstance | null>(null)
  const triggerRef = useRef<PublicInstance | null>(null)
  const triggerBox = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const [menuWidth, setMenuWidth] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => {
      measureMenu()
      const trigger = triggerRef.current
      triggerBox.current = trigger ? elementBounds(renderer, trigger.id) : null
    }, 0)
    return () => clearTimeout(timer)
  })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const height = boxHeight ?? controlHeight(fontSize)
  const compact = boxHeight != null && boxHeight < 30
  const iconSize = compact ? 14 : 16
  const pad = compact ? 8 : 10
  const current = options.find((option) => option.id === value)

  function measureMenu() {
    const anchor = anchorRef.current
    const bounds = anchor ? elementBounds(renderer, anchor.id) : null
    if (bounds && bounds.width > 0) setMenuWidth(bounds.width)
  }

  function openMenu() {
    if (process.platform !== 'win32') measureMenu()
    const index = options.findIndex((option) => option.id === value)
    setActive(index < 0 ? 0 : index)
    setOpen(true)
  }

  function choose(id: string) {
    onChange(id)
    setOpen(false)
  }

  function onKeyDown(event: EventPayload) {
    if (event.key === 'escape') {
      setOpen(false)
      return
    }
    if (event.key === 'down' || event.key === 'up') {
      if (!open) {
        openMenu()
        return
      }
      const step = event.key === 'down' ? 1 : -1
      setActive((index) => (options.length === 0 ? 0 : (index + step + options.length) % options.length))
      return
    }
    if (event.key !== 'enter' && event.key !== 'space' && event.key !== ' ') return
    if (!open) {
      openMenu()
      return
    }
    const option = options[active]
    if (option) choose(option.id)
  }

  function pressedOutside(event: EventPayload) {
    const trigger = triggerRef.current
    const bounds = process.platform === 'win32' ? triggerBox.current : trigger ? elementBounds(renderer, trigger.id) : null
    const onTrigger = bounds != null && event.x != null && event.y != null && event.x >= bounds.x && event.x < bounds.x + bounds.width && event.y >= bounds.y && event.y < bounds.y + bounds.height
    if (!onTrigger) setOpen(false)
  }

  return (
    <div ref={anchorRef} testId={testId} style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', alignSelf: 'stretch', minWidth: 0 }}>
      <Pressable
        nodeRef={triggerRef}
        role="button"
        ariaLabel={current?.label ?? value}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPress={() => (open ? setOpen(false) : openMenu())}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height,
          minHeight: height,
          gap: 8,
          paddingLeft: pad,
          paddingRight: pad,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: 6,
          backgroundColor: palette.card,
          cursor: 'pointer',
          hover: { backgroundColor: palette.hover },
          active: { backgroundColor: palette.press },
        }}
      >
        {icon ? <Icon name={icon} color={palette.muted} size={iconSize} /> : null}
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <Text size={compact ? 12 : 13}>{current?.label ?? value}</Text>
        </div>
        <Icon name="chevron-down" color={palette.muted} size={iconSize} />
      </Pressable>
      {open ? (
        <FloatingLayer
          testId={testId ? `${testId}-menu` : undefined}
          side="bottom"
          sideOffset={4}
          align="start"
          onMouseDownOutside={pressedOutside}
          style={{ backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, borderRadius: 6, paddingTop: 4, paddingBottom: 4, width: menuWidth > 0 ? menuWidth : undefined, minWidth: menuWidth > 0 ? menuWidth : undefined }}
        >
          {options.map((option, index) => (
            <Pressable
              key={option.id}
              role="button"
              ariaLabel={option.label}
              onPress={() => choose(option.id)}
              onMouseEnter={() => setActive(index)}
              style={{
                width: '100%',
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 10,
                paddingRight: 10,
                backgroundColor: index === active || option.id === value ? palette.selected : palette.panel,
                cursor: 'pointer',
                hover: { backgroundColor: palette.hover },
                active: { backgroundColor: palette.press },
              }}
            >
              <Text size={12}>{option.label}</Text>
            </Pressable>
          ))}
        </FloatingLayer>
      ) : null}
    </div>
  )
}

export function Segmented({
  options,
  value,
  onChange,
  disabled = false,
  block = false,
}: {
  options: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  block?: boolean
}) {
  const { palette, fontSize } = useTheme()
  const height = controlHeight(fontSize)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignSelf: block ? 'stretch' : 'flex-start', width: block ? '100%' : undefined, height, borderWidth: 1, borderColor: palette.line, borderRadius: 6, overflow: 'hidden' }}>
      {options.map((option) => {
        const selected = option.id === value
        return (
          <Pressable
            key={option.id}
            role="button"
            ariaLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexGrow: block ? 1 : undefined,
              flexBasis: block ? 0 : undefined,
              height,
              paddingLeft: 12,
              paddingRight: 12,
              backgroundColor: selected ? palette.accent : palette.input,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.45 : 1,
              hover: disabled ? undefined : { backgroundColor: selected ? palette.accentPress : palette.hover },
              active: disabled ? undefined : { backgroundColor: selected ? palette.accentPress : palette.press },
            }}
          >
            <Text color={selected ? palette.accentText : palette.text} size={12} weight="600">{option.label}</Text>
          </Pressable>
        )
      })}
    </div>
  )
}

export function Tabs({
  options,
  value,
  onChange,
  disabled = false,
  placement = 'bottom',
}: {
  options: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  placement?: 'bottom' | 'inline'
}) {
  const { palette } = useTheme()
  const inline = placement === 'inline'
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: inline ? 'wrap' : undefined, justifyContent: 'flex-start', alignItems: 'stretch', width: inline ? '100%' : undefined, backgroundColor: inline ? undefined : palette.sidebar, borderTopWidth: inline ? 0 : 1, borderBottomWidth: inline ? 1 : 0, borderColor: palette.line, paddingLeft: inline ? 0 : 8 }}>
      {options.map((option) => {
        const selected = option.id === value
        return (
          <Pressable
            key={option.id}
            role="button"
            ariaLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.id)}
            style={{
              paddingTop: inline ? 4 : 9,
              paddingBottom: inline ? 4 : 9,
              paddingLeft: inline ? 10 : 16,
              paddingRight: inline ? 10 : 16,
              borderTopWidth: inline ? 0 : 2,
              borderBottomWidth: inline ? 2 : 0,
              borderColor: selected ? palette.accent : inline ? palette.bg : palette.sidebar,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.45 : 1,
              hover: disabled ? undefined : { backgroundColor: selected ? palette.press : palette.hover },
              active: disabled ? undefined : { backgroundColor: palette.press },
            }}
          >
            <Text color={selected ? palette.text : palette.muted} size={inline ? 12 : 13} weight={selected ? '600' : undefined}>{option.label}</Text>
          </Pressable>
        )
      })}
    </div>
  )
}

export function Field({
  label,
  value,
  placeholder,
  onChange,
  multiline = false,
  readOnly = false,
  minRows = 3,
  maxRows = 8,
  resizable = true,
  boxHeight,
  required = false,
  icon,
  secret = false,
}: {
  label?: string
  value: string
  placeholder?: string
  onChange?: (value: string) => void
  multiline?: boolean
  readOnly?: boolean
  minRows?: number
  maxRows?: number
  resizable?: boolean
  boxHeight?: number
  required?: boolean
  icon?: IconName
  secret?: boolean
}) {
  const { palette, fontSize } = useTheme()
  const renderer = useGpuixRequired()
  const focusGroup = useContext(FocusGroupContext)
  const beginResize = useContext(ResizeContext)
  const frameRef = useRef<PublicInstance | null>(null)
  const scrollerRef = useRef<PublicInstance | null>(null)
  const areaRef = useRef<PublicInstance | null>(null)
  const measuredHeight = useRef<number | null>(null)
  const scrollDrag = useRef<{ startY: number; startScroll: number; thumbTravel: number; maxScroll: number } | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [metrics, setMetrics] = useState({ viewport: 0, content: 0, scrollTop: 0, top: 0 })
  const scheduled = useRef(false)
  const lineHeight = scaleFont(20, fontSize)
  const padBottom = resizable ? 14 : 8
  const textChrome = 8 + padBottom + 2
  const minBox = Math.max(2, minRows) * lineHeight + textChrome
  const maxBox = Math.max(minBox, maxRows * lineHeight + textChrome)
  const [revealed, setRevealed] = useState(false)
  const hidden = secret && !revealed
  const shown = hidden ? maskSecret(value) : value
  const singleHeight = boxHeight ?? controlHeight(fontSize)
  const style: StyleDesc = {
    width: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    color: palette.text,
    fontFamily: palette.font,
    fontSize: scaleFont(13, fontSize),
    backgroundColor: readOnly ? palette.panel : palette.input,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    paddingTop: multiline ? 8 : 0,
    paddingBottom: multiline ? 8 : 0,
    paddingLeft: 10,
    paddingRight: 10,
    ...(multiline || boxHeight != null ? {} : { height: singleHeight, minHeight: singleHeight }),
    ...(boxHeight == null ? {} : { height: boxHeight, minHeight: boxHeight }),
  }
  function moveFocus(event: EventPayload) {
    if (event.key !== 'tab' && event.key !== 'Tab') return
    const group = focusGroup?.current
    if (group) {
      if (event.modifiers?.shift) renderer.focusPreviousWithin?.(group.id)
      else renderer.focusNextWithin?.(group.id)
      return
    }
    if (event.modifiers?.shift) renderer.focusPrevious?.()
    else renderer.focusNext?.()
  }
  function change(next: string) {
    if (!onChange) return
    onChange(hidden ? applySecretEdit(value, next) : next)
  }
  const fieldProps = {
    value: shown,
    placeholder,
    readOnly,
    tabIndex: 0,
    onKeyDown: moveFocus,
    onChange: onChange ? (event: EventPayload) => change(event.value ?? '') : undefined,
  }
  const guessed = Math.max(1, shown.split('\n').length) * lineHeight + textChrome
  const natural = Math.min(maxBox, Math.max(minBox, metrics.content > 0 ? metrics.content + 2 : guessed))
  const viewport = height == null ? natural : Math.min(48 * lineHeight + textChrome, Math.max(minBox, height))
  const maxScroll = Math.max(0, metrics.content - metrics.viewport)
  const overflow = metrics.viewport > 0 && maxScroll > 8
  const thumbHeight = overflow ? Math.max(28, (metrics.viewport * metrics.viewport) / metrics.content) : 0
  const thumbTravel = Math.max(1, metrics.viewport - 22 - thumbHeight)
  const thumbTop = maxScroll > 0 ? (metrics.scrollTop / maxScroll) * thumbTravel : 0

  function readFieldMetrics() {
    const scroller = scrollerRef.current
    const area = areaRef.current
    const frame = frameRef.current
    if (!scroller || !area) return null
    const view = elementBounds(renderer, scroller.id)
    const body = elementBounds(renderer, area.id)
    const box = frame ? elementBounds(renderer, frame.id) : null
    const offset = renderer.getScrollOffset?.(scroller.id)
    if (!view || !body) return null
    if (box) measuredHeight.current = box.height
    return { viewport: view.height, content: body.height, scrollTop: Math.max(0, -(offset?.[1] ?? 0)), top: view.y }
  }

  function publishFieldMetrics() {
    const next = readFieldMetrics()
    if (!next) return
    setMetrics((current) => (
      current.viewport === next.viewport && current.content === next.content && current.top === next.top && Math.abs(current.scrollTop - next.scrollTop) < 0.5
        ? current
        : next
    ))
  }

  function scheduleFieldMetrics() {
    if (scheduled.current) return
    scheduled.current = true
    setTimeout(() => {
      scheduled.current = false
      publishFieldMetrics()
    }, 0)
  }

  function scrollField(top: number) {
    const scroller = scrollerRef.current
    if (!scroller || !renderer.scrollTo) return
    const next = Math.min(maxScroll, Math.max(0, top))
    renderer.scrollTo(scroller.id, 0, -next)
    scheduleFieldMetrics()
  }

  useEffect(() => {
    if (!multiline) return
    publishFieldMetrics()
    const timer = setInterval(publishFieldMetrics, 200)
    return () => clearInterval(timer)
    // Measuring only reads refs that stay valid while the field is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiline])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', minWidth: 0, alignSelf: 'stretch', flexGrow: 1, ...(boxHeight == null ? {} : { height: boxHeight }) }}>
      {label ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text color={palette.muted} size={11}>{label}</Text>
          {required ? <Text color={palette.danger} size={11}>*</Text> : null}
        </div>
      ) : null}
      {multiline ? (
        <div
          ref={frameRef}
          testId={label ? undefined : 'field-frame'}
          style={{ position: 'relative', width: '100%', minWidth: 0, alignSelf: 'stretch', height: viewport, backgroundColor: readOnly ? palette.panel : palette.input, borderWidth: 1, borderColor: palette.line, borderRadius: 6 }}
        >
          <div
            ref={scrollerRef}
            testId={`field-scroller-${label ?? 'field'}`}
            onScroll={scheduleFieldMetrics}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflowY: 'scroll', overflowX: 'hidden', borderRadius: 6 }}
          >
            <textarea
              ref={areaRef}
              {...fieldProps}
              minRows={1}
              maxRows={200}
              style={{ width: '100%', minWidth: 0, color: palette.text, fontFamily: palette.font, fontSize: scaleFont(13, fontSize), lineHeight, backgroundColor: readOnly ? palette.panel : palette.input, borderWidth: 0, paddingTop: 8, paddingBottom: padBottom, paddingLeft: 10, paddingRight: 16 }}
            />
          </div>
          {overflow ? (
            <div
              onMouseDown={(event) => {
                if (!leftButton(event)) return
                const local = (event.y ?? 0) - metrics.top - 4
                scrollField(((local - thumbHeight / 2) / thumbTravel) * maxScroll)
              }}
              style={{ position: 'absolute', top: 4, right: 3, bottom: 16, width: 10, borderRadius: 5, backgroundColor: palette.hover }}
            />
          ) : null}
          {overflow ? (
            <div
              testId={label ? `field-scrollbar-${label}` : 'field-scrollbar'}
              onMouseDown={(event) => {
                if (!leftButton(event)) return
                scrollDrag.current = { startY: event.y ?? 0, startScroll: metrics.scrollTop, thumbTravel, maxScroll }
              }}
              onMouseMove={(event) => {
                const current = scrollDrag.current
                if (!current || event.y == null) return
                if (event.pressedButton !== 0) {
                  scrollDrag.current = null
                  return
                }
                const delta = ((event.y - current.startY) / current.thumbTravel) * current.maxScroll
                scrollField(current.startScroll + delta)
              }}
              onMouseUp={() => {
                scrollDrag.current = null
              }}
              style={{ position: 'absolute', top: 4 + thumbTop, right: 4, width: 8, height: thumbHeight, borderRadius: 4, backgroundColor: palette.muted, cursor: 'default' }}
            />
          ) : null}
          {resizable ? <div
            testId={label ? `resize-${label}` : 'resize-field'}
            onMouseDown={(event) => {
              if (!beginResize || (event.button != null && event.button !== 0)) return
              const startHeight = measuredHeight.current ?? minRows * lineHeight + textChrome
              beginResize.begin({
                startY: event.y ?? 0,
                startHeight,
                minHeight: Math.max(2, minRows) * lineHeight + textChrome,
                maxHeight: 48 * lineHeight + textChrome,
                setHeight,
              })
            }}
            onMouseMove={(event) => beginResize?.move(event)}
            onMouseUp={() => beginResize?.end()}
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 14,
              height: 14,
              cursor: 'nwse-resize',
              userSelect: 'none',
            }}
          >
            <svg
              source={`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M12 2 L12 12 L2 12 Z" fill="#000"/></svg>`}
              style={{ width: 12, height: 12, color: palette.muted, pointerEvents: 'none' }}
            />
          </div> : null}
        </div>
      ) : secret ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', height: singleHeight, minHeight: singleHeight, borderWidth: 1, borderColor: palette.line, borderRadius: 6, backgroundColor: palette.input, paddingRight: 4 }}>
          <input
            {...fieldProps}
            style={{ ...style, flexGrow: 1, height: singleHeight, minHeight: singleHeight, borderWidth: 0, backgroundColor: palette.input }}
          />
          <Pressable
            testId="secret-toggle"
            ariaLabel={revealed ? '隐藏明文' : '显示明文'}
            onPress={() => setRevealed((current) => !current)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, flexShrink: 0, cursor: 'pointer', borderRadius: 4, hover: { backgroundColor: palette.hover }, active: { backgroundColor: palette.press } }}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} color={palette.muted} size={16} />
          </Pressable>
        </div>
      ) : icon ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', height: singleHeight, minHeight: singleHeight, gap: 6, paddingLeft: 8, borderWidth: 1, borderColor: palette.line, borderRadius: 6, backgroundColor: readOnly ? palette.panel : palette.input }}>
          <Icon name={icon} color={palette.muted} size={16} />
          <input
            {...fieldProps}
            style={{ ...style, height: singleHeight, minHeight: singleHeight, borderWidth: 0, paddingLeft: 0, backgroundColor: readOnly ? palette.panel : palette.input }}
          />
        </div>
      ) : (
        <input {...fieldProps} style={style} />
      )}
    </div>
  )
}
