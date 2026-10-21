import { useEffect, useRef, useState } from 'react'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadConfig, repoDir, sameRemote, saveConfig, type AppConfig } from './git/config'
import { cloneKeepingLocalPrompts, commitAndPush, commitMessage, readSyncStatus, syncLibrary, SyncError, type SyncStatus } from './git/sync'
import { removeTombstone, tombstoneRelativePath, writeTombstone } from './templates/library'
import { blankTemplate, defaultValues, ensureSlots, isTemplateDirty, validateTemplate, type Template } from './templates/parse'
import { appendGeneration, deleteLocalTemplate, exportLocalTemplates, importRepoTemplates, listLocalTemplates, migrateFilesIfEmpty, saveLocalTemplate, trimAllGenerations } from './templates/db'
import { deleteTemplateFile, relativeTemplatePath, saveTemplate } from './templates/store'
import { useGpuixRequired } from '@gpuix/react'
import { syncWindowsHotkey } from './hotkey/win-hotkey'
import { watchHotkey } from './hotkey/watch'
import { revealMacTray, setMacTrayQuit, syncMacTray } from './window/tray-mac'
import { syncWindowsTray } from './window/tray-win'
import type { Settings } from './settings'
import { defaultSettings, loadSettings, saveSettings } from './settings'
import { appVersion } from './version'
import { checkForUpdate, scheduledUpdateCheckDue, type UpdateInfo, type UpdatePhase } from './update/check'
import { downloadUpdate, prepareUpdate, restartToApplyUpdate, verifyUpdate } from './update/install'
import { openReleasesPage } from './update/open'
import { releasesPageUrl } from './update/repo'
import { EditorView } from './ui/EditorView'
import { GlobalHistoryView, HistoryView } from './ui/HistoryView'
import { SettingsView } from './ui/SettingsView'
import { Sidebar } from './ui/Sidebar'
import { UseView } from './ui/UseView'
import { ActivityBar } from './ui/ActivityBar'
import { StatusBar } from './ui/StatusBar'
import { ConfirmDialog, PanelScroll, ResizeScope, Tabs, Text, Toast, UpdatePrompt } from './ui/widgets'
import { ThemeProvider, useTheme } from './ui/theme'
import { installCloseGuard, requestWindowClose } from './window/close-guard'

type Phase = 'loading' | 'settings' | 'history' | 'main'
type Mode = 'use' | 'edit' | 'history'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function detachTemplate(template: Template): Template {
  return {
    ...template,
    tags: [...template.tags],
    slots: template.slots.map((slot) => ({ ...slot, options: slot.options ? [...slot.options] : undefined })),
  }
}

function Workspace({
  settings,
  settingsReady,
  onChangeSettings,
}: {
  settings: Settings
  settingsReady: boolean
  onChangeSettings: (patch: Partial<Settings>) => void
}) {
  const { palette } = useTheme()
  const [phase, setPhase] = useState<Phase>('loading')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Template | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Mode>('use')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [message, setMessage] = useState('')
  const [toastKey, setToastKey] = useState(0)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateError, setUpdateError] = useState('')
  const [updatePrompt, setUpdatePrompt] = useState('')
  const [settingsSection, setSettingsSection] = useState<'general' | 'appearance' | 'shortcut' | 'sync' | 'version'>('appearance')
  const [focusVersion, setFocusVersion] = useState(0)
  const updatePhaseRef = useRef<UpdatePhase>('idle')
  const updateInfoRef = useRef<UpdateInfo | null>(null)
  const updateTask = useRef(false)
  const updateChecked = useRef(false)
  function notify(text: string) {
    setMessage(text)
    setToastKey((value) => value + 1)
  }
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const syncing = useRef(false)
  function setBusy(value: boolean) {
    busyRef.current = value
    setBusyState(value)
  }
  const [revision, setRevision] = useState(0)
  const [historyTick, setHistoryTick] = useState(0)
  const preferEdit = useRef(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null)
  const configRef = useRef(config)
  configRef.current = config
  const draftRef = useRef(draft)
  const templatesRef = useRef(templates)
  const settingsRef = useRef(settings)
  draftRef.current = draft
  templatesRef.current = templates
  settingsRef.current = settings
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const settingsSectionRef = useRef(settingsSection)
  settingsSectionRef.current = settingsSection
  const savedDraft = templates.find((item) => item.id === draft?.id)
  const dirty = isTemplateDirty(savedDraft, draft)

  useEffect(() => {
    setMacTrayQuit(() => {
      if (isTemplateDirty(templatesRef.current.find((item) => item.id === draftRef.current?.id), draftRef.current)) {
        const title = draftRef.current?.title.trim() || '未命名'
        setConfirm({
          title: '未保存的修改',
          message: `「${title}」还有未保存的修改。`,
          confirmLabel: '仍然退出',
          onConfirm: () => requestWindowClose(),
        })
        return
      }
      requestWindowClose()
    })
    return installCloseGuard({
      unsaved: () => isTemplateDirty(templatesRef.current.find((item) => item.id === draftRef.current?.id), draftRef.current),
      onBlocked: () => {
        const title = draftRef.current?.title.trim() || '未命名'
        setConfirm({
          title: '未保存的修改',
          message: `「${title}」还有未保存的修改。`,
          confirmLabel: '仍然关闭',
          onConfirm: () => requestWindowClose(),
        })
      },
      conceal: () => settingsRef.current.closeToTray,
    })
  }, [])

  useEffect(() => {
    if (process.platform === 'win32') syncWindowsTray(settings.closeToTray)
    else syncMacTray(settings.closeToTray)
  }, [settings.closeToTray])

  function confirmDiscard(action: () => void) {
    const current = draftRef.current
    const saved = templatesRef.current.find((item) => item.id === current?.id)
    if (!isTemplateDirty(saved, current) || !current) {
      action()
      return
    }
    const title = current.title.trim() || '未命名'
    setConfirm({
      title: '未保存的修改',
      message: `「${title}」还有未保存的修改。`,
      confirmLabel: '放弃修改',
      onConfirm: action,
    })
  }

  async function reload(dir: string, gitConfig: AppConfig | null) {
    const items = listLocalTemplates()
    setTemplates(items)
    setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null))
    if (gitConfig && existsSync(path.join(dir, '.git'))) {
      setStatus(await readSyncStatus(dir, gitConfig.branch))
    } else {
      setStatus(null)
    }
    setRevision((value) => value + 1)
  }

  async function connect(next: AppConfig, forceClone: boolean): Promise<boolean> {
    setBusy(true)
    notify(forceClone ? '正在克隆仓库…' : '正在同步…')
    const dir = repoDir()
    try {
      if (forceClone) {
        await exportLocalTemplates(dir)
        await cloneKeepingLocalPrompts(dir, next)
      } else {
        await syncLibrary(dir, next, listLocalTemplates())
      }
      await importRepoTemplates(dir)
      await reload(dir, next)
      setPhase('main')
      notify('已同步')
      return true
    } catch (error) {
      notify(errorText(error))
      try {
        if (existsSync(path.join(dir, '.git'))) await importRepoTemplates(dir)
        await reload(dir, next)
      } catch {
        setStatus(null)
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  async function syncQuietly() {
    if (syncing.current || busyRef.current || !settingsRef.current.autoSync) return
    const gitConfig = configRef.current
    if (!gitConfig) return
    const dir = repoDir()
    if (!existsSync(path.join(dir, '.git'))) return
    const current = draftRef.current
    const saved = templatesRef.current.find((item) => item.id === current?.id)
    if (isTemplateDirty(saved, current)) return
    syncing.current = true
    try {
      const before = listLocalTemplates().map((item) => `${item.id}:${item.updatedAt}`).sort().join('|')
      await syncLibrary(dir, gitConfig, listLocalTemplates())
      await importRepoTemplates(dir)
      if (busyRef.current) return
      const after = listLocalTemplates().map((item) => `${item.id}:${item.updatedAt}`).sort().join('|')
      if (before !== after) {
        await reload(dir, gitConfig)
        notify('已同步')
      } else {
        setStatus(await readSyncStatus(dir, gitConfig.branch))
      }
    } catch (error) {
      notify(errorText(error))
    } finally {
      syncing.current = false
    }
  }

  useEffect(() => {
    if (!settingsReady || updateChecked.current) return
    updateChecked.current = true
    if (!settingsRef.current.autoCheckUpdates) return
    if (!scheduledUpdateCheckDue(settingsRef.current.updateLastCheckAt)) return
    onChangeSettings({ updateLastCheckAt: new Date().toISOString() })
    void runUpdateCheck('scheduled')
    // The check reads the latest settings through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady])

  function assignUpdatePhase(next: UpdatePhase) {
    updatePhaseRef.current = next
    setUpdatePhase(next)
  }

  async function runUpdateCheck(mode: 'manual' | 'scheduled') {
    const current = updatePhaseRef.current
    if (updateTask.current || current === 'downloading' || current === 'verifying' || current === 'installing' || current === 'ready') return
    updateTask.current = true
    if (mode === 'manual') {
      assignUpdatePhase('checking')
      setUpdateError('')
    }
    try {
      const result = await checkForUpdate(appVersion)
      if (result.status === 'available') {
        updateInfoRef.current = result.info
        setUpdateInfo(result.info)
        assignUpdatePhase('available')
        const onVersion = phaseRef.current === 'settings' && settingsSectionRef.current === 'version'
        if (!onVersion) setUpdatePrompt(result.info.latestVersion)
        return
      }
      if (result.status === 'current') {
        updateInfoRef.current = null
        setUpdateInfo(null)
        setUpdatePrompt('')
        assignUpdatePhase('current')
        return
      }
      if (mode === 'manual') {
        assignUpdatePhase('error')
        setUpdateError(result.status === 'empty' ? '还没有配置更新仓库。' : result.message)
      }
    } finally {
      updateTask.current = false
    }
  }

  async function beginDownload() {
    const info = updateInfoRef.current
    if (!info || updateTask.current) return
    updateTask.current = true
    setUpdatePrompt('')
    setUpdateProgress(0)
    assignUpdatePhase('downloading')
    try {
      const file = await downloadUpdate(info, setUpdateProgress)
      assignUpdatePhase('verifying')
      await verifyUpdate(file, info)
      assignUpdatePhase('installing')
      await prepareUpdate(file)
      assignUpdatePhase('ready')
    } catch (error) {
      assignUpdatePhase('error')
      setUpdateError(errorText(error))
    } finally {
      updateTask.current = false
    }
  }

  function beginRestart() {
    const info = updateInfoRef.current
    if (!info) return
    confirmDiscard(() => {
      try {
        restartToApplyUpdate(info.assetName)
      } catch (error) {
        assignUpdatePhase('error')
        setUpdateError(errorText(error))
      }
    })
  }

  function showUpdateDownload() {
    setSettingsSection('version')
    setFocusVersion((value) => value + 1)
    setPhase('settings')
    void beginDownload()
  }

  useEffect(() => {
    if (!settingsReady) return
    const saved = configRef.current
    void (async () => {
      const loaded = saved ?? (await loadConfig())
      setConfig(loaded)
      const dir = repoDir()
      await migrateFilesIfEmpty(dir)
      if (!loaded || !settingsRef.current.autoSync) {
        await reload(dir, loaded)
        setPhase('main')
        return
      }
      const synced = await connect(loaded, !existsSync(path.join(dir, '.git')))
      if (!synced) setPhase('main')
    })()
    // The bootstrap reads the config once, after settings are loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady])

  useEffect(() => {
    if (preferEdit.current) return
    setMode('use')
  }, [selectedId])

  useEffect(() => {
    trimAllGenerations(settings.historyLimit)
    setHistoryTick((value) => value + 1)
  }, [settings.historyLimit])

  useEffect(() => {
    const next = templates.find((item) => item.id === selectedId) ?? null
    const detached = next ? detachTemplate(next) : null
    setDraft(detached)
    setValues(detached ? defaultValues(detached) : {})
    if (preferEdit.current) {
      setMode('edit')
      preferEdit.current = false
    }
  }, [selectedId, revision, templates])

  async function submitConfig(next: AppConfig) {
    const previous = config
    try {
      await saveConfig(next)
      setConfig(next)
      const forceClone = !previous || !sameRemote(previous, next) || !existsSync(path.join(repoDir(), '.git'))
      const synced = await connect(next, forceClone)
      if (!synced) setPhase('settings')
    } catch (error) {
      notify(errorText(error))
      setPhase('settings')
      setBusy(false)
    }
  }

  async function publish(dir: string, filepaths: string[], action: 'add' | 'update' | 'delete', title: string): Promise<boolean> {
    if (!config) return false
    await commitAndPush(dir, config, filepaths, commitMessage(action, title))
    return true
  }

  async function saveDraft() {
    if (!draft || busy || syncing.current) return
    const ensured = ensureSlots(draft)
    const problem = validateTemplate(ensured)
    if (problem) {
      notify(problem)
      setDraft(ensured)
      return
    }
    const stamped = { ...ensured, updatedAt: Date.now() }
    setBusy(true)
    notify('正在保存…')
    const dir = repoDir()
    try {
      const existed = templates.some((item) => item.id === stamped.id)
      saveLocalTemplate(stamped)
      let pushed = false
      if (config) {
        await saveTemplate(dir, stamped)
        await removeTombstone(dir, stamped.id)
        if (settingsRef.current.autoSync) pushed = await publish(dir, [relativeTemplatePath(stamped.id), tombstoneRelativePath(stamped.id)], existed ? 'update' : 'add', stamped.title)
      }
      await reload(dir, config)
      notify(pushed ? '已保存并推送' : '已保存在本机')
    } catch (error) {
      if (error instanceof SyncError && error.conflictIds[0]) {
        preferEdit.current = true
        setSelectedId(error.conflictIds[0])
        try {
          await importRepoTemplates(dir)
        } catch {
          setDraft(ensured)
        }
      }
      try {
        await reload(dir, config)
      } catch {
        setDraft(ensured)
      }
      notify(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function createTemplate() {
    if (busy || syncing.current) return
    const template = { ...blankTemplate(templates.map((item) => item.id)), updatedAt: Date.now() }
    setBusy(true)
    notify('正在新建…')
    const dir = repoDir()
    try {
      saveLocalTemplate(template)
      let pushed = false
      if (config) {
        await saveTemplate(dir, template)
        await removeTombstone(dir, template.id)
        if (settingsRef.current.autoSync) pushed = await publish(dir, [relativeTemplatePath(template.id), tombstoneRelativePath(template.id)], 'add', template.title)
      }
      preferEdit.current = true
      setSelectedId(template.id)
      await reload(dir, config)
      notify(pushed ? '已新建并推送' : '已保存在本机')
    } catch (error) {
      notify(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft() {
    if (!draft || busy || syncing.current) return
    setBusy(true)
    notify('正在删除…')
    const dir = repoDir()
    const removed = draft
    try {
      deleteLocalTemplate(removed.id)
      let pushed = false
      if (config) {
        try {
          await deleteTemplateFile(dir, removed.id)
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
          if (code !== 'ENOENT') throw error
        }
        await writeTombstone(dir, removed.id, Date.now())
        if (settingsRef.current.autoSync) pushed = await publish(dir, [relativeTemplatePath(removed.id), tombstoneRelativePath(removed.id)], 'delete', removed.title)
      }
      setSelectedId(null)
      await reload(dir, config)
      notify(pushed ? '已删除并推送' : '已从本机删除')
    } catch (error) {
      notify(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100%', width: '100%', backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text color={palette.muted}>正在打开 PromptDeck…</Text>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', width: '100%', backgroundColor: palette.bg }}>
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, minWidth: 0 }}>
      <ActivityBar
        active={phase === 'settings' ? 'settings' : phase === 'history' ? 'history' : 'library'}
        busy={busy}
        canSync={status !== null}
        onLibrary={() => {
          notify('')
          setPhase('main')
        }}
        onHistory={() => {
          notify('')
          setPhase('history')
        }}
        onSync={() => confirmDiscard(() => {
          if (config) void connect(config, false)
        })}
        onSettings={() => {
          notify('')
          if (phaseRef.current !== 'settings') {
            setFocusVersion(0)
            setSettingsSection('appearance')
          }
          setPhase('settings')
        }}
      />
      {phase === 'settings' ? (
        <div style={{ display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, minWidth: 0 }}>
          <SettingsView
            appearance={settings.appearance}
            shortcut={settings.shortcut}
            historyLimit={settings.historyLimit}
            closeToTray={settings.closeToTray}
            autoSync={settings.autoSync}
            autoCheckUpdates={settings.autoCheckUpdates}
            updatePhase={updatePhase}
            updateVersion={updateInfo?.latestVersion ?? ''}
            updateNotes={updateInfo?.releaseNotes ?? ''}
            updateProgress={updateProgress}
            updateError={updateError}
            updateBadge={updatePhase === 'available' || updatePhase === 'downloading' || updatePhase === 'verifying' || updatePhase === 'installing' || updatePhase === 'ready'}
            canOpenReleases={Boolean(updateInfo?.pageUrl || releasesPageUrl())}
            focusVersion={focusVersion}
            config={config}
            busy={busy}
            error={message}
            fontFamily={settings.fontFamily}
            fontSize={settings.fontSize}
            onAppearance={(appearance) => onChangeSettings({ appearance })}
            onFontFamily={(fontFamily) => onChangeSettings({ fontFamily })}
            onFontSize={(fontSize) => onChangeSettings({ fontSize })}
            onShortcut={(shortcut) => onChangeSettings({ shortcut })}
            onHistoryLimit={(historyLimit) => onChangeSettings({ historyLimit })}
            onCloseToTray={(closeToTray) => onChangeSettings({ closeToTray })}
            onAutoSync={(autoSync) => {
              settingsRef.current = { ...settingsRef.current, autoSync }
              onChangeSettings({ autoSync })
              if (autoSync) void syncQuietly()
            }}
            onAutoCheckUpdates={(autoCheckUpdates) => onChangeSettings({ autoCheckUpdates })}
            onCheckUpdate={() => { void runUpdateCheck('manual') }}
            onDownloadUpdate={() => { void beginDownload() }}
            onRestartUpdate={beginRestart}
            onOpenReleases={() => openReleasesPage(updateInfo?.pageUrl || releasesPageUrl() || undefined)}
            onSection={setSettingsSection}
            onSubmit={(next) => void submitConfig(next)}
            onClose={() => {
              notify('')
              setPhase('main')
            }}
          />
        </div>
      ) : phase === 'history' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, height: '100%' }}>
          <PanelScroll testId="history-scroll">
            <GlobalHistoryView
              revision={historyTick}
              onCopied={notify}
              onChanged={() => setHistoryTick((value) => value + 1)}
              requestConfirm={setConfirm}
            />
          </PanelScroll>
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, minWidth: 0 }}>
      <ResizeScope>
      <Sidebar
        templates={templates}
        selectedId={selectedId}
        busy={busy}
        dirtyId={dirty && draft ? draft.id : null}
        draft={dirty ? draft : null}
        historyTick={historyTick}
        onSelect={(id) => {
          if (id !== selectedId) confirmDiscard(() => setSelectedId(id))
        }}
        onCreate={() => confirmDiscard(() => void createTemplate())}
        onOpenHistory={(id) => {
          const open = () => {
            setSelectedId(id)
            setMode('history')
          }
          if (id === selectedId) setMode('history')
          else confirmDiscard(open)
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0, height: '100%' }}>
        <PanelScroll testId="panel-scroll">
          {!draft ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16 }}>
              <Text size={15} weight="700">还没有模板</Text>
              <Text color={palette.muted}>{'新建一个模板，用 {{变量名}} 标出每天要填的部分。'}</Text>
            </div>
          ) : null}
          {draft && mode === 'use' ? (
            <UseView
              template={draft}
              values={values}
              busy={busy}
              onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
              onCopied={notify}
              onGenerated={(prompt) => {
                appendGeneration(draft.id, prompt, settings.historyLimit)
                setHistoryTick((value) => value + 1)
              }}
            />
          ) : null}
          {draft && mode === 'history' ? (
            <HistoryView
              templateId={draft.id}
              revision={historyTick}
              onCopied={notify}
              onChanged={() => setHistoryTick((value) => value + 1)}
              requestConfirm={setConfirm}
            />
          ) : null}
          {draft && mode === 'edit' ? (
            <EditorView template={draft} revision={revision} busy={busy} onChange={(update) => setDraft((current) => (current ? update(current) : current))} onSave={() => void saveDraft()} onDelete={() => void deleteDraft()} requestConfirm={setConfirm} />
          ) : null}
        </PanelScroll>
        <Tabs
          value={mode}
          disabled={!draft}
          onChange={(id) => setMode(id === 'edit' || id === 'history' ? id : 'use')}
          options={[
            { id: 'use', label: '使用' },
            { id: 'history', label: '历史' },
            { id: 'edit', label: '编辑' },
          ]}
        />
      </div>
      </ResizeScope>
      </div>
      )}
      </div>
      <StatusBar status={status} />
      {updatePrompt && !(phase === 'settings' && settingsSection === 'version') ? (
        <UpdatePrompt version={updatePrompt} raised={Boolean(message)} onDownload={showUpdateDownload} onLater={() => setUpdatePrompt('')} />
      ) : null}
      {message ? <Toast key={toastKey} message={message} /> : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm.onConfirm
            setConfirm(null)
            action()
          }}
        />
      ) : null}
    </div>
  )
}

export function App() {
  const renderer = useGpuixRequired()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const settingsRef = useRef(settings)
  const saveChain = useRef(Promise.resolve())
  settingsRef.current = settings

  useEffect(() => {
    void loadSettings().then((loaded) => {
      settingsRef.current = loaded
      setSettings(loaded)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (!ready) return
    // Windows shows the window from WM_HOTKEY inside the window procedure.
    // This poll only asks GPUI to activate; it cannot take the foreground itself.
    const reveal = () => {
      try {
        if (process.platform === 'darwin') revealMacTray()
      } catch {
        // The menu bar item can already be gone.
      }
      renderer.activateWindow?.()
    }
    syncWindowsHotkey(settingsRef.current.shortcut)
    const stopWatch = watchHotkey(() => settingsRef.current.shortcut, reveal)
    return () => {
      stopWatch()
    }
  }, [ready, renderer])

  useEffect(() => {
    if (!ready) return
    syncWindowsHotkey(settings.shortcut)
  }, [ready, settings.shortcut])

  function changeSettings(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    saveChain.current = saveChain.current.then(() => saveSettings(settingsRef.current)).catch(() => undefined)
  }

  return (
    <ThemeProvider appearance={settings.appearance} fontFamily={settings.fontFamily} fontSize={settings.fontSize}>
      <Workspace settings={settings} settingsReady={ready} onChangeSettings={changeSettings} />
    </ThemeProvider>
  )
}
