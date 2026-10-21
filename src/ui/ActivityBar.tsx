import type { IconName } from './icons'
import { Icon } from './icons'
import { Pressable } from './widgets'
import { useTheme } from './theme'

export function ActivityBar({
  active,
  busy,
  canSync,
  onLibrary,
  onHistory,
  onSync,
  onSettings,
}: {
  active: 'library' | 'history' | 'settings'
  busy: boolean
  canSync: boolean
  onLibrary: () => void
  onHistory: () => void
  onSync: () => void
  onSettings: () => void
}) {
  const { palette } = useTheme()
  return (
    <div
      testId="activity-bar"
      style={{
        width: 48,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        paddingTop: 8,
        paddingBottom: 8,
        gap: 4,
        backgroundColor: palette.panel,
        borderRightWidth: 1,
        borderColor: palette.line,
      }}
    >
      <RailButton testId="open-library" icon="library" label="模板" selected={active === 'library'} onClick={onLibrary} />
      <RailButton testId="open-history" icon="history" label="历史" selected={active === 'history'} onClick={onHistory} />
      <div style={{ flexGrow: 1 }} />
      <RailButton testId="pull-repo" icon="sync" label="同步" disabled={busy || !canSync} onClick={onSync} />
      <RailButton testId="open-settings" icon="settings" label="设置" selected={active === 'settings'} disabled={busy} onClick={onSettings} />
    </div>
  )
}

function RailButton({
  icon,
  label,
  selected = false,
  disabled = false,
  testId,
  onClick,
}: {
  icon: IconName
  label: string
  selected?: boolean
  disabled?: boolean
  testId?: string
  onClick: () => void
}) {
  const { palette } = useTheme()
  return (
    <Pressable
      testId={testId}
      role="button"
      ariaLabel={label}
      disabled={disabled}
      onPress={onClick}
      style={{
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 8,
        backgroundColor: selected ? palette.selected : 'transparent',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled || selected ? undefined : { backgroundColor: palette.hover },
        active: disabled ? undefined : { backgroundColor: selected ? palette.selectedPress : palette.press },
      }}
    >
      <Icon name={icon} color={selected ? palette.text : palette.muted} size={20} />
    </Pressable>
  )
}
