import type { SyncStatus } from '../git/sync'
import { formatStatus } from '../git/sync'
import { Text } from './widgets'
import { useTheme } from './theme'

export function StatusBar({ status }: { status: SyncStatus | null }) {
  const { palette } = useTheme()
  const statusText = status ? formatStatus(status) : '仅保存在本机'

  return (
    <div
      testId="status-bar"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 28,
        minHeight: 28,
        paddingLeft: 10,
        paddingRight: 10,
        borderTopWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.sidebar,
        width: '100%',
        flexShrink: 0,
      }}
    >
      <Text color={palette.muted} size={12}>{statusText}</Text>
    </div>
  )
}
