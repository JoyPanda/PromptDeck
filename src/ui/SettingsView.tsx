import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import type { AppConfig } from '../git/config'
import { setKeyCapture } from '../hotkey/capture'
import { claimShortcut } from '../hotkey/conflict'
import { windowsHotkeyFault } from '../hotkey/win-hotkey'
import { formatShortcut, isBindableKey, isModifierKey, shortcutFromEvent, type Shortcut } from '../hotkey/shortcut'
import { keyIsDown, setHotkeySuspended } from '../hotkey/watch'
import type { AuthMode, Provider } from '../git/remote'
import { normalizeRemoteUrl } from '../git/remote'
import { fontChoices, fontSizeChoices, MAX_FONT_SIZE, MAX_HISTORY_LIMIT, MIN_FONT_SIZE, MIN_HISTORY_LIMIT, parseFontFamily, parseFontSize, parseHistoryLimit, type Appearance } from '../settings'
import type { UpdatePhase } from '../update/check'
import { appVersion } from '../version'
import { Icon, type IconName } from './icons'
import { Button, Field, FocusGroup, Pressable, Segmented, Text } from './widgets'
import { useTheme } from './theme'

type Section = 'general' | 'appearance' | 'shortcut' | 'sync' | 'version'

export function SettingsView({
  appearance,
  fontFamily,
  fontSize,
  shortcut,
  historyLimit,
  closeToTray,
  autoSync,
  autoCheckUpdates,
  updatePhase,
  updateVersion,
  updateNotes,
  updateProgress,
  updateError,
  updateBadge,
  canOpenReleases,
  focusVersion = 0,
  config,
  busy,
  error,
  onAppearance,
  onFontFamily,
  onFontSize,
  onShortcut,
  onHistoryLimit,
  onCloseToTray,
  onAutoSync,
  onAutoCheckUpdates,
  onCheckUpdate,
  onDownloadUpdate,
  onRestartUpdate,
  onOpenReleases,
  onSection,
  onSubmit,
  onClose,
}: {
  appearance: Appearance
  fontFamily: string
  fontSize: number
  shortcut: Shortcut | null
  historyLimit: number
  closeToTray: boolean
  autoSync: boolean
  autoCheckUpdates: boolean
  updatePhase: UpdatePhase
  updateVersion: string
  updateNotes: string
  updateProgress: number
  updateError: string
  updateBadge: boolean
  canOpenReleases: boolean
  focusVersion?: number
  config: AppConfig | null
  busy: boolean
  error: string
  onAppearance: (appearance: Appearance) => void
  onFontFamily: (fontFamily: string) => void
  onFontSize: (fontSize: number) => void
  onShortcut: (shortcut: Shortcut | null) => void
  onHistoryLimit: (limit: number) => void
  onCloseToTray: (enabled: boolean) => void
  onAutoSync: (enabled: boolean) => void
  onAutoCheckUpdates: (enabled: boolean) => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onRestartUpdate: () => void
  onOpenReleases: () => void
  onSection?: (section: Section) => void
  onSubmit: (config: AppConfig) => void
  onClose: () => void
}) {
  const { palette, resolved } = useTheme()
  const [section, setSection] = useState<Section>('appearance')
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState('')
  const onShortcutRef = useRef(onShortcut)
  onShortcutRef.current = onShortcut
  const onSectionRef = useRef(onSection)
  onSectionRef.current = onSection
  useEffect(() => {
    if (!focusVersion) return
    setSection('version')
    onSectionRef.current?.('version')
  }, [focusVersion])
  const [provider, setProvider] = useState<Provider>(config?.provider ?? 'github')
  const [auth, setAuth] = useState<AuthMode>(config?.auth ?? 'token')
  const [remoteUrl, setRemoteUrl] = useState(config?.remoteUrl ?? '')
  const [branch, setBranch] = useState(config?.branch ?? 'main')
  const [token, setToken] = useState(config?.token ?? '')
  const [username, setUsername] = useState(config?.username ?? '')
  const [password, setPassword] = useState(config?.password ?? '')
  const [authorName, setAuthorName] = useState(config?.authorName ?? '')
  const [authorEmail, setAuthorEmail] = useState(config?.authorEmail ?? '')
  const [localError, setLocalError] = useState('')
  const [limitText, setLimitText] = useState(String(historyLimit))
  const [fontText, setFontText] = useState(fontFamily)
  const [sizeText, setSizeText] = useState(String(fontSize))
  const shownError = localError || error
  const column = { display: 'flex' as const, flexDirection: 'column' as const, gap: 8, width: '100%', minWidth: 0, maxWidth: 520 }
  const wideColumn = { ...column, maxWidth: 560 }
  const fieldRow = { display: 'flex' as const, flexDirection: 'row' as const, gap: 8, width: '100%', minWidth: 0 }
  const fieldCell = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }

  useEffect(() => {
    setLimitText(String(historyLimit))
  }, [historyLimit])

  useEffect(() => {
    setFontText(fontFamily)
  }, [fontFamily])

  useEffect(() => {
    setSizeText(String(fontSize))
  }, [fontSize])

  useEffect(() => {
    setHotkeySuspended(recording)
    if (!recording) return
    let checking = false
    let cancelled = false
    setKeyCapture((event) => {
      if (event.isHeld || checking) return
      const name = event.key && isBindableKey(event.key) ? event.key : (event.keyChar || event.key || '')
      if (!name || isModifierKey(name)) return
      if (!isBindableKey(name)) {
        setRecordError('这个键不能用作快捷键。')
        return
      }
      const next = shortcutFromEvent(event.key, event.modifiers, keyIsDown)
      if (!next) {
        setRecordError('请至少按住一个修饰键，再按主键。')
        return
      }
      checking = true
      setRecordError('')
      void claimShortcut(next).then((result) => {
        checking = false
        if (cancelled) return
        if (result === 'conflict') {
          setRecordError('这个快捷键已被其他程序占用。')
          return
        }
        if (result === 'failed') {
          setRecordError(windowsHotkeyFault() || '无法注册这个快捷键。')
          return
        }
        onShortcutRef.current(next)
        setRecording(false)
      })
    })
    return () => {
      cancelled = true
      setKeyCapture(null)
      setHotkeySuspended(false)
    }
  }, [recording])

  function chooseSection(next: Section) {
    setSection(next)
    onSectionRef.current?.(next)
  }

  function submit() {
    try {
      const next: AppConfig = {
        provider,
        remoteUrl: normalizeRemoteUrl(remoteUrl),
        branch: branch.trim(),
        auth,
        token: token.trim(),
        username: username.trim(),
        password,
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
      }
      if (!next.branch) throw new Error('请填写分支')
      if (!/^[A-Za-z0-9._/-]+$/.test(next.branch)) throw new Error('分支名无效')
      if (next.auth === 'password') {
        if (!next.username) throw new Error('请填写用户名')
        if (!next.password.trim()) throw new Error('请填写密码')
      } else if (!next.token) {
        throw new Error('请填写个人访问令牌')
      }
      if (!next.authorName) throw new Error('请填写提交者姓名')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.authorEmail)) throw new Error('请填写有效的邮箱')
      setLocalError('')
      onSubmit(next)
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : '无法保存')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', width: '100%', minWidth: 0, overflow: 'hidden', backgroundColor: palette.bg }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 168, height: '100%', minHeight: 0, backgroundColor: palette.sidebar, borderRightWidth: 1, borderColor: palette.line }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 8, paddingLeft: 12, paddingRight: 12 }}>
          <Icon name="settings" color={palette.text} size={16} />
          <Text size={13} weight="700">设置</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8, paddingRight: 8 }}>
          <NavItem icon="sliders" label="通用" selected={section === 'general'} onClick={() => chooseSection('general')} />
          <NavItem icon="palette" label="外观" selected={section === 'appearance'} onClick={() => chooseSection('appearance')} />
          <NavItem icon="keyboard" label="快捷键" selected={section === 'shortcut'} onClick={() => chooseSection('shortcut')} />
          <NavItem icon="sync" label="同步" selected={section === 'sync'} onClick={() => chooseSection('sync')} />
          <NavItem icon="info" label="版本" mark={updateBadge} selected={section === 'version'} onClick={() => chooseSection('version')} />
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ padding: 8, borderTopWidth: 1, borderColor: palette.line }}>
          <Button icon="check" label="完成" block disabled={busy} onClick={onClose} />
        </div>
      </div>
      <SettingsBody>
        {section === 'general' ? (
          <div style={column}>
            <SectionTitle icon="sliders" label="通用" />
            <Field
              label="每个模板保留的生成记录"
              value={limitText}
              onChange={(value) => {
                setLimitText(value)
                const next = parseHistoryLimit(Number(value), -1)
                if (next !== -1) onHistoryLimit(next)
              }}
            />
            <Text color={palette.faint} size={11} wrap>{`填写 ${MIN_HISTORY_LIMIT} 到 ${MAX_HISTORY_LIMIT}。超出后丢掉该模板最早的记录。`}</Text>
            <Text color={palette.muted} size={12}>关闭窗口</Text>
            <Segmented
              block
              value={closeToTray ? 'tray' : 'quit'}
              onChange={(id) => onCloseToTray(id === 'tray')}
              options={[
                { id: 'quit', label: '退出程序' },
                { id: 'tray', label: '最小化到托盘' },
              ]}
            />
            <Text color={palette.faint} size={11} wrap>
              {process.platform === 'darwin'
                ? '最小化后程序继续运行。点击 Dock 图标或菜单栏图标可以重新打开，也可以从菜单栏退出。'
                : '最小化后程序继续运行。从托盘图标可以重新打开，也可以退出。'}
            </Text>
          </div>
        ) : null}
        {section === 'appearance' ? (
          <div style={column}>
            <SectionTitle icon="palette" label="外观" />
            <Text color={palette.muted} size={12}>主题</Text>
            <Segmented
              block
              value={appearance}
              onChange={(id) => onAppearance(id as Appearance)}
              options={[
                { id: 'system', label: '跟随系统' },
                { id: 'dark', label: '深色' },
                { id: 'light', label: '浅色' },
              ]}
            />
            <Text color={palette.faint} size={11} wrap>
              {appearance === 'system'
                ? `正在跟随系统，当前是${resolved === 'dark' ? '深色' : '浅色'}。`
                : '只使用这里选择的外观。'}
            </Text>
            <Text color={palette.muted} size={12}>字体</Text>
            <Segmented block value={fontFamily} onChange={onFontFamily} options={fontChoices()} />
            <Field
              label="字体名称"
              value={fontText}
              placeholder="已安装的字体名称"
              onChange={(value) => {
                setFontText(value)
                const next = parseFontFamily(value, '')
                if (next) onFontFamily(next)
              }}
            />
            <Text color={palette.muted} size={12}>字号</Text>
            <Segmented block value={String(fontSize)} onChange={(id) => onFontSize(Number(id))} options={fontSizeChoices()} />
            <Field
              value={sizeText}
              onChange={(value) => {
                setSizeText(value)
                const next = parseFontSize(Number(value), -1)
                if (next !== -1) onFontSize(next)
              }}
            />
            <Text color={palette.faint} size={11} wrap>{`填写 ${MIN_FONT_SIZE} 到 ${MAX_FONT_SIZE}。界面文字按 12 号为基准缩放。`}</Text>
          </div>
        ) : null}
        {section === 'shortcut' ? (
          <div style={column}>
            <SectionTitle icon="keyboard" label="快捷键" />
            <Text color={palette.muted} size={12}>呼出窗口</Text>
            <Text size={13} weight="600">{recording ? '请按下快捷键…' : formatShortcut(shortcut)}</Text>
            <Text color={palette.faint} size={11} wrap>在其他应用中按下这个组合键，PromptDeck 会回到前面。至少要包含一个修饰键。</Text>
            {recordError ? <Text color={palette.danger} size={12}>{recordError}</Text> : null}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Button icon="keyboard" label={recording ? '取消录制' : '录制快捷键'} size="md" primary={!recording} disabled={busy} onClick={() => { setRecordError(''); setRecording((value) => !value) }} />
              <Button icon="x" label="清除" size="sm" disabled={busy || !shortcut} onClick={() => { setRecording(false); setRecordError(''); onShortcut(null) }} />
            </div>
          </div>
        ) : null}
        {section === 'sync' ? (
          <div style={wideColumn}>
            <SectionTitle icon="sync" label="同步" />
            <Text color={palette.muted} size={12}>自动同步</Text>
            <Segmented
              block
              value={autoSync ? 'on' : 'off'}
              disabled={busy}
              onChange={(id) => onAutoSync(id === 'on')}
              options={[
                { id: 'on', label: '开启' },
                { id: 'off', label: '关闭' },
              ]}
            />
            <Text color={palette.faint} size={11} wrap>
              开启后，启动、保存、新建和删除都会同步。正在编辑还没保存的内容时会先跳过。关闭后，只有点击同步或保存并同步才会连接仓库。
            </Text>
            <Text color={palette.muted} size={12} wrap>
              {config ? `已保存 ${config.remoteUrl}` : '未连接。模板保存在本机 SQLite，可以稍后再同步。'}
            </Text>
            <Text color={palette.faint} size={11} wrap>同步时按修改时间比较。其他设备没再改过的模板会一起删掉；改得更晚的内容会留下来。凭据加密后只留在本机。</Text>
            <Segmented
              block
              value={provider}
              disabled={busy}
              onChange={(id) => setProvider(id as Provider)}
              options={[
                { id: 'github', label: 'GitHub' },
                { id: 'gitlab', label: 'GitLab' },
              ]}
            />
            <Segmented
              block
              value={auth}
              disabled={busy}
              onChange={(id) => setAuth(id as AuthMode)}
              options={[
                { id: 'token', label: '访问令牌' },
                { id: 'password', label: '用户名密码' },
              ]}
            />
            <Field label="仓库 HTTPS 地址" value={remoteUrl} placeholder="https://github.com/owner/prompts" onChange={setRemoteUrl} />
            {auth === 'password' ? (
              <div style={fieldRow}>
                <div style={fieldCell}><Field label="用户名" value={username} placeholder="仓库账号" onChange={setUsername} /></div>
                <div style={fieldCell}><Field label="密码" secret value={password} placeholder="账户密码" onChange={setPassword} /></div>
              </div>
            ) : (
              <div style={fieldRow}>
                <div style={fieldCell}><Field label="分支" value={branch} placeholder="main" onChange={setBranch} /></div>
                <div style={{ ...fieldCell, flexGrow: 2 }}><Field label="个人访问令牌" secret value={token} placeholder={provider === 'github' ? '仓库读写权限' : 'write_repository'} onChange={setToken} /></div>
              </div>
            )}
            {auth === 'password' ? (
              <Field label="分支" value={branch} placeholder="main" onChange={setBranch} />
            ) : null}
            <div style={fieldRow}>
              <div style={fieldCell}><Field label="提交者姓名" value={authorName} placeholder="用于 git commit" onChange={setAuthorName} /></div>
              <div style={fieldCell}><Field label="提交者邮箱" value={authorEmail} placeholder="you@example.com" onChange={setAuthorEmail} /></div>
            </div>
            <Text color={palette.faint} size={11} wrap>
              {auth === 'password'
                ? '用户名和密码会发给仓库的 HTTPS 接口。GitLab 经常不接受网页登录密码，这时密码栏填个人访问令牌，用户名填仓库账号。'
                : '远端仓库需要已经有初始提交。自建 GitLab 填写它的 HTTPS 地址即可。'}
            </Text>
            {shownError ? <Text color={palette.danger} size={12}>{shownError}</Text> : null}
            <div style={{ display: 'flex', flexDirection: 'row' }}>
              <Button icon="sync" label={busy ? '正在连接…' : '保存并同步'} size="lg" primary disabled={busy} onClick={submit} />
            </div>
          </div>
        ) : null}
        {section === 'version' ? (
          <div style={column}>
            <SectionTitle icon="info" label="版本" />
            <Text size={13} weight="600">{`PromptDeck v${appVersion}`}</Text>
            <Text color={updatePhase === 'error' ? palette.danger : updatePhase === 'available' ? palette.accent : palette.faint} size={11} wrap>{versionStatus(updatePhase, updateVersion, updateProgress, updateError)}</Text>
            <Text color={palette.muted} size={12}>自动检查更新</Text>
            <Segmented
              block
              value={autoCheckUpdates ? 'on' : 'off'}
              onChange={(id) => onAutoCheckUpdates(id === 'on')}
              options={[
                { id: 'on', label: '开启' },
                { id: 'off', label: '关闭' },
              ]}
            />
            <Text color={palette.faint} size={11} wrap>开启后大约每天检查一次。关闭后，只有在这里点击检查更新才会连接。</Text>
            {updatePhase === 'downloading' ? <ProgressBar progress={updateProgress} /> : null}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Button
                icon={updatePhase === 'ready' ? 'check' : 'sync'}
                label={versionButtonLabel(updatePhase, updateProgress)}
                size="md"
                primary={!versionButtonDisabled(updatePhase)}
                disabled={versionButtonDisabled(updatePhase)}
                onClick={() => {
                  if (updatePhase === 'available') onDownloadUpdate()
                  else if (updatePhase === 'ready') onRestartUpdate()
                  else onCheckUpdate()
                }}
              />
              <Button icon="info" label="打开发布页" size="md" disabled={!canOpenReleases} onClick={onOpenReleases} />
            </div>
            {showReleaseNotes(updatePhase) && updateNotes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size={12} weight="600">更新内容</Text>
                <Text color={palette.muted} size={12} wrap>{updateNotes}</Text>
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsBody>
    </div>
  )
}

function SettingsBody({ children }: { children: ReactNode }) {
  const renderer = useGpuixRequired()
  const frameRef = useRef<PublicInstance | null>(null)
  const scrollerRef = useRef<PublicInstance | null>(null)
  const contentRef = useRef<PublicInstance | null>(null)
  const [scrolls, setScrolls] = useState(false)

  useEffect(() => {
    const measure = () => {
      const frame = frameRef.current
      const content = contentRef.current
      const scroller = scrollerRef.current
      if (!frame || !content) return
      let view: { height: number } | null = null
      let body: { height: number } | null = null
      try {
        view = renderer.getElementBounds?.(frame.id) ?? null
        body = renderer.getElementBounds?.(content.id) ?? null
      } catch {
        return
      }
      if (!view || !body) return
      const next = body.height > view.height + 1
      setScrolls((current) => (current === next ? current : next))
      if (!next && scroller) renderer.scrollTo?.(scroller.id, 0, 0)
    }
    measure()
    const timer = setInterval(measure, 200)
    return () => clearInterval(timer)
  }, [renderer])

  return (
    <div ref={frameRef} style={{ position: 'relative', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, height: '100%' }}>
      <FocusGroup
        testId="settings-body"
        nodeRef={scrollerRef as RefObject<PublicInstance | null>}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', overflowX: 'hidden', overflowY: scrolls ? 'scroll' : 'hidden' }}
      >
        <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, alignSelf: 'stretch', width: '100%', minWidth: 0, padding: 16, gap: 10 }}>
          {children}
        </div>
      </FocusGroup>
    </div>
  )
}

function versionStatus(phase: UpdatePhase, version: string, progress: number, error: string): string {
  if (phase === 'checking') return '正在检查…'
  if (phase === 'current') return '已是最新版本'
  if (phase === 'available') return `发现新版本 v${version}`
  if (phase === 'downloading') return `正在下载 ${progress}%…`
  if (phase === 'verifying') return '正在验证…'
  if (phase === 'installing') return '正在安装…'
  if (phase === 'ready') return '更新准备就绪，点击重启'
  if (phase === 'error') return error || '检查更新失败。'
  return '当前安装的版本。'
}

function versionButtonLabel(phase: UpdatePhase, progress: number): string {
  if (phase === 'checking') return '正在检查…'
  if (phase === 'downloading') return `${progress}%`
  if (phase === 'verifying') return '正在验证…'
  if (phase === 'installing') return '正在安装…'
  if (phase === 'available') return '下载更新'
  if (phase === 'ready') return '立即重启'
  return '检查更新'
}

function versionButtonDisabled(phase: UpdatePhase): boolean {
  return phase === 'checking' || phase === 'downloading' || phase === 'verifying' || phase === 'installing'
}

function showReleaseNotes(phase: UpdatePhase): boolean {
  return phase === 'available' || phase === 'downloading' || phase === 'verifying' || phase === 'installing' || phase === 'ready'
}

function ProgressBar({ progress }: { progress: number }) {
  const { palette } = useTheme()
  const filled = Math.max(0, Math.min(100, progress))
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: palette.line }}>
      <div style={{ flexGrow: filled, flexShrink: 1, flexBasis: 0, backgroundColor: palette.accent }} />
      <div style={{ flexGrow: Math.max(0, 100 - filled), flexShrink: 1, flexBasis: 0 }} />
    </div>
  )
}

function NavItem({ icon, label, mark = false, selected, onClick }: { icon: IconName; label: string; mark?: boolean; selected: boolean; onClick: () => void }) {
  const { palette } = useTheme()
  const color = selected ? palette.text : palette.muted
  return (
    <Pressable
      onPress={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 6,
        backgroundColor: selected ? palette.selected : palette.sidebar,
        cursor: 'pointer',
        hover: { backgroundColor: selected ? palette.selectedPress : palette.hover },
        active: { backgroundColor: selected ? palette.selectedPress : palette.press },
      }}
    >
      <Icon name={icon} color={color} size={16} />
      <Text size={13} weight={selected ? '600' : undefined} color={color}>{label}</Text>
      {mark ? <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent, marginLeft: 4 }} /> : null}
    </Pressable>
  )
}

function SectionTitle({ icon, label }: { icon: IconName; label: string }) {
  const { palette } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} color={palette.text} size={16} />
      <Text size={15} weight="700">{label}</Text>
    </div>
  )
}
