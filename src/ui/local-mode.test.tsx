import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTestRoot, hasNativeTestRenderer, type TestElement, type TestRenderer } from '@gpuix/react/testing'
import { App } from '../app'
import { appVersion } from '../version'
import { closeLocalDatabase, listLocalTemplates, saveLocalTemplate } from '../templates/db'
import { ThemeProvider } from './theme'
import { Field, FocusGroup } from './widgets'

const roots: string[] = []
const previousDataDir = process.env.PROMPTDECK_DATA_DIR

afterEach(async () => {
  closeLocalDatabase()
  if (previousDataDir === undefined) delete process.env.PROMPTDECK_DATA_DIR
  else process.env.PROMPTDECK_DATA_DIR = previousDataDir
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test.serial.skipIf(!hasNativeTestRenderer || process.env.CI === 'true')('starts locally and keeps git setup optional', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-ui-'))
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  const { renderer, render, unmount } = createTestRoot({ width: 1120, height: 760 })
  try {
    render(<App />)
    await waitFor(renderer, '仅保存在本机')
    expect(renderer.findByText('同步到 Git')).toBeUndefined()

    clickTestId(renderer, 'create-template')
    await waitFor(renderer, '已保存在本机')
    expect(renderer.findByText('未命名模板')).toBeDefined()
    expect(existsSync(path.join(dir, 'promptdeck.db'))).toBe(true)
    expect(listLocalTemplates().some((template) => template.title === '未命名模板')).toBe(true)
    expect(existsSync(path.join(dir, 'repo', '.git'))).toBe(false)
    const sidebarItem = renderer.findByTestId('sidebar-item')
    const sidebarDetail = renderer.findByTestId('sidebar-detail')
    const sidebarItemBox = sidebarItem ? renderer.getElementBounds(sidebarItem.id) : null
    const sidebarDetailBox = sidebarDetail ? renderer.getElementBounds(sidebarDetail.id) : null
    expect(sidebarDetailBox?.height ?? 0).toBeGreaterThan(12)
    expect(sidebarItemBox?.height ?? 0).toBeGreaterThan((sidebarDetailBox?.height ?? 0) + 20)
    const sidebarTitle = styledText(renderer, '未命名模板')
    expect(sidebarTitle.style.textOverflow).toBe('ellipsis')
    expect(sidebarTitle.style.whiteSpace).toBe('nowrap')
    expect(sidebarTitle.style.overflow).toBe('hidden')

    const frame = surface(renderer)
    const useTab = boundsFor(renderer, '使用')
    const editTab = boundsFor(renderer, '编辑')
    const historyTab = bottomText(renderer, '历史', frame.height - 80)
    expect(useTab.y).toBeGreaterThan(frame.height - 80)
    expect(useTab.x).toBeLessThan(360)
    expect(historyTab.x).toBeGreaterThan(useTab.x)
    expect(historyTab.y).toBe(useTab.y)
    expect(editTab.x).toBeGreaterThan(historyTab.x)
    expect(editTab.y).toBe(useTab.y)
    const sideHistory = renderer.findByType('text').map((item) => item.text === '历史' ? renderer.getElementBounds(item.id) : null).find((bounds) => bounds != null && bounds.x < 270)
    expect(sideHistory).toBeDefined()
    const createBounds = renderer.findByTestId('create-template')
    const createBox = createBounds ? renderer.getElementBounds(createBounds.id) : null
    const searchBox = renderer.findByType('input').map((element) => renderer.getElementBounds(element.id)).find((bounds) => bounds != null && bounds.x < 270)
    expect(createBox?.height ?? 0).toBeGreaterThan(24)
    expect(Math.abs((createBox?.height ?? 0) - (searchBox?.height ?? 0))).toBeLessThan(6)
    expect(Math.abs((createBox?.y ?? 0) - (searchBox?.y ?? 0))).toBeLessThan(6)
    expect(widestAncestor(renderer, '全部分类')).toBeGreaterThan(180)
    expect(widestAncestor(renderer, '只看收藏')).toBeGreaterThan(180)
    expect(Math.abs(widestAncestor(renderer, '全部分类') - widestAncestor(renderer, '最近更新'))).toBeLessThan(4)
    click(renderer, '全部分类')
    await waitForTestId(renderer, 'category-dropdown-menu')
    const categoryBox = renderer.getElementBounds(renderer.findByTestId('category-dropdown')?.id ?? -1)
    const categoryMenu = renderer.getElementBounds(renderer.findByTestId('category-dropdown-menu')?.id ?? -1)
    expect(Math.abs((categoryMenu?.width ?? 0) + 2 - (categoryBox?.width ?? 0))).toBeLessThan(1)
    expect(Math.abs((categoryMenu?.x ?? 0) - 1 - (categoryBox?.x ?? 0))).toBeLessThan(1)
    click(renderer, '全部分类')
    expect(renderer.findByTestId('category-dropdown-menu')).toBeUndefined()
    const release = renderer.getElementBounds(renderer.findByTestId('category-dropdown')?.id ?? -1)
    if (!release) throw new Error('找不到分类下拉')
    renderer.nativeSimulateMouseDown(8, 8)
    renderer.nativeSimulateMouseMove(release.x + release.width / 2, release.y + release.height / 2, 0)
    renderer.nativeSimulateMouseUp(release.x + release.width / 2, release.y + release.height / 2)
    renderer.flush()
    expect(renderer.findByTestId('category-dropdown-menu')).toBeUndefined()
    expect(renderer.findByText('未命名模板')).toBeDefined()
    const favorite = boundsFor(renderer, '只看收藏')
    renderer.nativeSimulateMouseDown(8, 8)
    renderer.nativeSimulateMouseMove(favorite.x + 20, favorite.y + 8, 0)
    renderer.nativeSimulateMouseUp(favorite.x + 20, favorite.y + 8)
    renderer.flush()
    expect(renderer.findByText('未命名模板')).toBeDefined()
    const scroller = renderer.findByTestId('panel-scroll')
    if (!scroller) throw new Error('面板不能滚动')
    expect(renderer.getScrollOffset(scroller.id)).not.toBeNull()
    const fieldWidths = renderer
      .findByType('input')
      .map((element) => renderer.getElementBounds(element.id))
      .flatMap((bounds) => (bounds && bounds.x >= 270 ? [bounds.width] : []))
    expect(Math.max(...fieldWidths)).toBeGreaterThan(frame.width - 420)
    const saveBox = buttonBox(renderer, '保存')
    const deleteBox = buttonBox(renderer, '删除')
    expect(Math.abs((saveBox?.height ?? 0) - (deleteBox?.height ?? 0))).toBeLessThan(3)
    bringIntoView(renderer, 'resize-field')
    const body = renderer.findByTestId('field-frame')
    const before = body ? renderer.getElementBounds(body.id) : null
    const handle = renderer.findByTestId('resize-field')
    const handleBounds = handle ? renderer.getElementBounds(handle.id) : null
    if (!before || !handleBounds) throw new Error('正文不能调整高度')
    expect(handleBounds.x).toBeGreaterThan(before.x + before.width - 28)
    expect(handleBounds.y).toBeGreaterThan(before.y + before.height - 28)
    expect(handleBounds.x + handleBounds.width).toBeLessThan(before.x + before.width + 4)
    const gripX = handleBounds.x + handleBounds.width / 2
    const gripY = handleBounds.y + handleBounds.height / 2
    renderer.nativeSimulateMouseDown(gripX, gripY)
    renderer.flush()
    renderer.nativeSimulateMouseMove(gripX, gripY + 60, 0)
    renderer.nativeSimulateMouseUp(gripX, gripY + 60)
    renderer.flush()
    const after = renderer.getElementBounds(renderer.findByTestId('field-frame')?.id ?? -1)
    expect(after?.height).toBeGreaterThan(before.height + 50)
    bringIntoView(renderer, 'resize-field')
    const grown = renderer.findByTestId('resize-field')
    const grownBounds = grown ? renderer.getElementBounds(grown.id) : null
    if (!grownBounds) throw new Error('正文不能继续调整高度')
    const grownX = grownBounds.x + grownBounds.width / 2
    const grownY = grownBounds.y + grownBounds.height / 2
    renderer.nativeSimulateMouseDown(grownX, grownY)
    renderer.flush()
    renderer.nativeSimulateMouseMove(grownX, grownY + 60, 0)
    renderer.nativeSimulateMouseUp(grownX, grownY + 60)
    renderer.flush()
    await waitForTestId(renderer, 'panel-scrollbar')
    const thumb = renderer.findByTestId('panel-scrollbar')
    const thumbBox = thumb ? renderer.getElementBounds(thumb.id) : null
    if (!thumbBox) throw new Error('滚动条没有出现')
    const thumbX = thumbBox.x + thumbBox.width / 2
    const thumbY = thumbBox.y + Math.min(6, thumbBox.height / 2)
    renderer.nativeSimulateMouseDown(thumbX, thumbY)
    renderer.flush()
    renderer.nativeSimulateMouseMove(8, thumbY + 140, 0)
    renderer.flush()
    const dragged = renderer.getScrollOffset(scroller.id)?.[1] ?? 0
    expect(Math.abs(dragged)).toBeGreaterThan(20)
    renderer.nativeSimulateMouseUp(8, 8)
    renderer.flush()
    const released = renderer.getScrollOffset(scroller.id)?.[1] ?? 0
    renderer.nativeSimulateMouseMove(40, thumbY + 220)
    renderer.flush()
    expect(renderer.getScrollOffset(scroller.id)?.[1] ?? 0).toBe(released)
    renderer.scrollTo(scroller.id, 0, 0)
    renderer.flush()
    click(renderer, '多行文本')
    await waitFor(renderer, '下拉')
    click(renderer, '下拉')
    await waitFor(renderer, '选项')
    click(renderer, '下拉')
    await waitFor(renderer, '数字')
    click(renderer, '数字')
    await waitForGone(renderer, '选项')
    click(renderer, '数字')
    await waitFor(renderer, '是否')
    click(renderer, '是否')
    await waitFor(renderer, '是')
    click(renderer, '是')
    click(renderer, '使用')
    await waitFor(renderer, '填写变量')
    await waitFor(renderer, '{{content}}')
    await waitFor(renderer, '完整提示词')
    click(renderer, '生成')
    await waitFor(renderer, '已复制到剪贴板')
    await waitForClipboard('是')
    expect(renderer.findByType('text').some((item) => item.text?.includes('未填写'))).toBe(false)
    click(renderer, '编辑')
    await waitFor(renderer, '删除槽位')
    expectTitleAction(renderer, '模板信息', '收藏')
    expectTitleAction(renderer, '槽位', '添加槽位')
    click(renderer, '删除槽位')
    await waitFor(renderer, '确定删除槽位')
    click(renderer, '取消')
    expect(renderer.findByType('text').filter((item) => item.text === '变量名')).toHaveLength(1)
    click(renderer, '删除槽位')
    await waitFor(renderer, '确认删除')
    click(renderer, '确认删除')
    await waitFor(renderer, '还没有槽位')
    renderer.flush()
    const bodyText = renderer.findByType('textarea').map((item) => String(item.customProps?.value ?? '')).join('\n')
    expect(bodyText).toContain('请根据下面的内容完成任务。')
    expect(bodyText).not.toContain('{{content}}')
    click(renderer, '添加槽位')
    await waitFor(renderer, '新槽位')
    expect(renderer.findByType('text').filter((item) => item.text === '变量名')).toHaveLength(1)
    click(renderer, '使用')
    await waitFor(renderer, '完整提示词')
    const generate = boundsFor(renderer, '生成')
    const slot = boundsFor(renderer, '新槽位')
    expect(generate.x).toBeLessThan(400)
    expect(generate.y).toBeLessThan(slot.y)
    click(renderer, '生成')
    await waitFor(renderer, '已复制到剪贴板')
    await waitForClipboard('请根据下面的内容完成任务。')
    click(renderer, '历史')
    await waitFor(renderer, '生成历史')
    await waitFor(renderer, '请根据下面的内容完成任务。')
    const copyBox = buttonBox(renderer, '复制')
    const contentBox = testBox(renderer, 'history-entry')
    const removeBox = buttonBox(renderer, '删除')
    expect(contentBox?.height ?? 0).toBeLessThan(56)
    expect(Math.abs((copyBox?.height ?? 0) - (contentBox?.height ?? 0))).toBeLessThan(2)
    expect(Math.abs((copyBox?.height ?? 0) - (removeBox?.height ?? 0))).toBeLessThan(2)
    expect(copyBox?.y ?? 0).toBe(contentBox?.y ?? -1)
    expect(copyBox?.x ?? 0).toBeLessThan(contentBox?.x ?? 0)
    expect(contentBox?.x ?? 0).toBeLessThan(removeBox?.x ?? 0)
    renderer.nativeSimulateMouseMove(0, 0)
    renderer.nativeSimulateMouseMove((contentBox?.x ?? 0) + 24, (contentBox?.y ?? 0) + (contentBox?.height ?? 0) / 2)
    await waitForTestId(renderer, 'history-tooltip')
    click(renderer, '删除')
    await waitFor(renderer, '确定删除这条生成记录')
    click(renderer, '取消')
    await waitFor(renderer, '请根据下面的内容完成任务。')

    clickTestId(renderer, 'open-history')
    await waitFor(renderer, '全部历史')
    await waitFor(renderer, '未命名模板')
    await waitFor(renderer, '请根据下面的内容完成任务。')
    clickTestId(renderer, 'open-library')
    await waitFor(renderer, '使用')

    clickTestId(renderer, 'open-settings')
    await waitFor(renderer, '跟随系统')
    const settingsBody = renderer.findByTestId('settings-body')
    expect(settingsBody?.style.overflowX).toBe('hidden')
    const settingsScroll = settingsBody ? renderer.getElementBounds(settingsBody.id) : null
    if (!settingsBody || !settingsScroll) throw new Error('设置页没有内容区')
    renderer.nativeSimulateScrollWheel(settingsScroll.x + 40, settingsScroll.y + 40, 120, 0)
    expect(renderer.getScrollOffset(settingsBody.id)?.[0] ?? 0).toBe(0)
    click(renderer, '通用')
    await waitFor(renderer, '每个模板保留的生成记录')
    await waitFor(renderer, '最小化到托盘')
    click(renderer, '外观')
    await waitFor(renderer, '跟随系统')
    click(renderer, '快捷键')
    await waitFor(renderer, '录制快捷键')
    await waitFor(renderer, '⇧⌘Space')
    click(renderer, '版本')
    await waitFor(renderer, `PromptDeck v${appVersion}`)
    await waitForOverflow(renderer, 'settings-body', 'hidden')
    const versionBody = renderer.findByTestId('settings-body')
    const versionBox = versionBody ? renderer.getElementBounds(versionBody.id) : null
    if (!versionBody || !versionBox) throw new Error('版本页没有内容区')
    renderer.nativeSimulateScrollWheel(versionBox.x + 40, versionBox.y + 80, 0, -160)
    expect(renderer.getScrollOffset(versionBody.id)?.[1] ?? 0).toBe(0)
    click(renderer, '同步')
    await waitFor(renderer, '自动同步')
    await waitFor(renderer, '开启')
    await waitFor(renderer, '个人访问令牌')
    expect(renderer.findByTestId('secret-toggle')).toBeDefined()
    click(renderer, '用户名密码')
    await waitFor(renderer, '用户名')
    await waitFor(renderer, '密码')
    click(renderer, 'GitLab')
    await waitFor(renderer, '用户名')
    click(renderer, '外观')
    await waitFor(renderer, '跟随系统')
    click(renderer, '浅色')
    await waitForText(path.join(dir, 'settings.json'), '"light"')
    await waitForBackground(renderer, '外观', '#f3f3f3')
    const iconColors = renderer.findByType('svg').map((item) => String(item.style.color ?? ''))
    expect(iconColors.length).toBeGreaterThan(0)
    expect(iconColors.every((color) => color === '#1f1f1f' || color === '#616161' || color === '#0066cc')).toBe(true)
    click(renderer, '深色')
    await waitForBackground(renderer, '外观', '#1e1e1e')
    await waitFor(renderer, '字体名称')
    await waitFor(renderer, '字号')
    click(renderer, '16')
    await waitForFontSize(renderer, '字号', 16)
    click(renderer, '宋体')
    await waitForFont(renderer, '跟随系统', process.platform === 'win32' ? 'SimSun' : 'Songti SC')
    renderer.flush()
    const settingsPane = renderer.getElementBounds(renderer.findByTestId('settings-body')?.id ?? -1)
    const settingsLimit = (settingsPane?.x ?? 0) + (settingsPane?.width ?? 0) + 1
    const pastThePage = renderer.findByType('input').some((element) => {
      const box = renderer.getElementBounds(element.id)
      return box != null && box.x + box.width > settingsLimit
    })
    expect(pastThePage).toBe(false)
    click(renderer, '完成')
    await waitFor(renderer, '仅保存在本机')
    click(renderer, '使用')
    await waitFor(renderer, '生成')
    renderer.flush()
    const activity = renderer.getElementBounds(renderer.findByTestId('activity-bar')?.id ?? -1)
    const settingsBox = renderer.getElementBounds(renderer.findByTestId('open-settings')?.id ?? -1)
    const syncBox = renderer.getElementBounds(renderer.findByTestId('pull-repo')?.id ?? -1)
    const statusBar = testBox(renderer, 'status-bar')
    expect(activity?.x ?? 1).toBe(0)
    expect(activity?.width ?? 0).toBeGreaterThan(40)
    expect(activity?.width ?? 0).toBeLessThan(56)
    expect(syncBox?.y ?? 0).toBeLessThan(settingsBox?.y ?? 0)
    expect((settingsBox?.x ?? 99) + (settingsBox?.width ?? 0)).toBeLessThanOrEqual((activity?.x ?? 0) + (activity?.width ?? 0) + 1)
    expect((syncBox?.x ?? 99) + (syncBox?.width ?? 0)).toBeLessThanOrEqual((activity?.x ?? 0) + (activity?.width ?? 0) + 1)
    expect((settingsBox?.y ?? 0) + (settingsBox?.height ?? 0)).toBeLessThanOrEqual(statusBar?.y ?? 0)
    expect(statusBar?.y ?? 0).toBeGreaterThan(surface(renderer).height - 60)
    click(renderer, '编辑')
    await waitFor(renderer, '模板信息')
    await waitForTestId(renderer, 'dirty-mark')
    click(renderer, '收藏')
    await waitFor(renderer, '已收藏')
    expect(renderer.findByTestId('dirty-mark')).toBeDefined()
    expect(renderer.findByTestId('favorite-mark')).toBeDefined()
    click(renderer, '已收藏')
    await waitFor(renderer, '收藏')
    expect(renderer.findByTestId('dirty-mark')).toBeDefined()
    expect(renderer.findByTestId('favorite-mark')).toBeUndefined()
    click(renderer, '收藏')
    await waitFor(renderer, '已收藏')
    click(renderer, '保存')
    await waitFor(renderer, '已保存在本机')
    await waitForTestId(renderer, 'favorite-mark')
    await waitForGoneTestId(renderer, 'dirty-mark')
    click(renderer, '只看收藏')
    expect(renderer.findByType('text').some((item) => item.text === '未命名模板')).toBe(true)
    click(renderer, '已收藏')
    await waitForTestId(renderer, 'dirty-mark')
    clickTestId(renderer, 'create-template')
    await waitFor(renderer, '还有未保存的修改')
    click(renderer, '取消')
    expect(renderer.findByTestId('dirty-mark')).toBeDefined()
  } finally {
    unmount()
  }
})

test.serial.skipIf(!hasNativeTestRenderer)('sidebar rows keep one height and truncate overflow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-rows-'))
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  const longTitle = '未命名模板标题很长很长很长很长很长很长'
  const longDetail = '这是一段很长的说明文字用于检查省略号是否生效'
  saveLocalTemplate({
    id: 'short',
    title: '短标题',
    description: '',
    slots: [{ name: 'content', label: '内容', kind: 'textarea' }],
    body: '正文',
    favorite: false,
    tags: [],
    category: '',
    updatedAt: 1,
  })
  saveLocalTemplate({
    id: 'long',
    title: longTitle,
    description: longDetail,
    slots: [{ name: 'content', label: '内容', kind: 'textarea' }],
    body: '正文',
    favorite: false,
    tags: ['标签一', '标签二'],
    category: '工作',
    updatedAt: 2,
  })
  const { renderer, render, unmount } = createTestRoot({ width: 1120, height: 760 })
  try {
    render(<App />)
    await waitFor(renderer, '短标题')
    await waitFor(renderer, longTitle)
    const rows = renderer.findByType('div').filter((item) => item.testId === 'sidebar-item')
    expect(rows).toHaveLength(2)
    const heights = rows.map((row) => renderer.getElementBounds(row.id)?.height ?? 0)
    expect(heights[0]).toBe(heights[1])
    expect(heights[0]).toBeGreaterThan(30)
    const title = styledText(renderer, longTitle)
    const titleBox = renderer.getElementBounds(title.id)
    const detail = styledText(renderer, `${longDetail} · 工作 · 标签一 · 标签二`)
    const detailBox = renderer.getElementBounds(detail.id)
    expect(title.style.textOverflow).toBe('ellipsis')
    expect(detail.style.textOverflow).toBe('ellipsis')
    expect(titleBox?.width ?? 999).toBeLessThan(180)
    expect(detailBox?.width ?? 999).toBeLessThan(180)
    const shortRow = rows.find((row) => row.children.some((id) => renderer.getElement(id)?.text === '短标题' || containsText(renderer, id, '短标题')))
    const longRow = rows.find((row) => containsText(renderer, row.id, longTitle))
    expect(renderer.getElementBounds(shortRow?.id ?? -1)?.height).toBe(renderer.getElementBounds(longRow?.id ?? -1)?.height)
  } finally {
    unmount()
  }
})

test.serial.skipIf(!hasNativeTestRenderer)('tab moves between inputs and secrets stay masked', async () => {
  const { renderer, render, unmount } = createTestRoot({ width: 640, height: 360 })
  try {
    render(
      <ThemeProvider appearance="dark" fontFamily="sans-serif" fontSize={12}>
        <FocusGroup style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          <Field label="一" value="" onChange={() => {}} />
          <Field label="密码" secret value="secret" onChange={() => {}} />
        </FocusGroup>
      </ThemeProvider>,
    )
    await waitFor(renderer, '一')
    const inputs = renderer.findByType('input')
    expect(inputs).toHaveLength(2)
    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('******')
    expect(painted).not.toContain('secret')
    const first = inputs[0]
    const second = inputs[1]
    if (!first || !second) throw new Error('缺少输入框')
    renderer.focusElement(first.id)
    renderer.nativeSimulateKeyDown(first.id, 'tab')
    expect(renderer.getFocusedElementId()).toBe(second.id)
  } finally {
    unmount()
  }
})

test.serial.skipIf(!hasNativeTestRenderer)('multiline field shows a scrollbar when content is taller than the box', async () => {
  const { renderer, render, unmount } = createTestRoot({ width: 640, height: 480 })
  const text = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行需要滚动才能看完。`).join('\n')
  try {
    render(
      <ThemeProvider appearance="dark" fontFamily="PingFang SC" fontSize={12}>
        <div style={{ padding: 12 }}>
          <Field label="笔记" value={text} multiline readOnly minRows={4} maxRows={6} />
        </div>
      </ThemeProvider>,
    )
    await waitForTestId(renderer, 'field-scrollbar-笔记')
    const scroller = renderer.findByTestId('field-scroller-笔记')
    const area = renderer.findByType('textarea')[0]
    const view = scroller ? renderer.getElementBounds(scroller.id) : null
    const body = area ? renderer.getElementBounds(area.id) : null
    if (!scroller || !view || !body) throw new Error('输入框不能滚动')
    expect(body.height).toBeGreaterThan(view.height + 20)
    renderer.nativeSimulateScrollWheel(view.x + 24, view.y + 24, 0, -100)
    renderer.flush()
    expect(renderer.getScrollOffset(scroller.id)?.[1] ?? 0).toBeLessThan(-10)
  } finally {
    unmount()
  }
})

function styledText(renderer: TestRenderer, label: string): TestElement {
  const node = exactText(renderer, label)
  const parent = node.parentId == null ? undefined : renderer.getElement(node.parentId)
  return parent?.type === 'text' ? parent : node
}

function containsText(renderer: TestRenderer, id: number, text: string): boolean {
  const element = renderer.getElement(id)
  if (!element) return false
  if (element.text === text) return true
  return element.children.some((child) => containsText(renderer, child, text))
}

async function waitForTestId(renderer: TestRenderer, testId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    if (renderer.findByTestId(testId)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`未出现「${testId}」`)
}

async function waitForGoneTestId(renderer: TestRenderer, testId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    if (!renderer.findByTestId(testId)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${testId}」还在`)
}

async function waitForGone(renderer: TestRenderer, text: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    if (!renderer.findByText(text)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${text}」还在。当前文字：${renderer.getAllText().join(' | ')}`)
}

async function waitFor(renderer: TestRenderer, text: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    if (renderer.findByText(text)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`未出现「${text}」。当前文字：${renderer.getAllText().join(' | ')}`)
}

async function waitForOverflow(renderer: TestRenderer, testId: string, overflowY: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    if (renderer.findByTestId(testId)?.style.overflowY === overflowY) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${testId}」的纵向滚动没有变成 ${overflowY}`)
}

function expectTitleAction(renderer: TestRenderer, title: string, action: string): void {
  const row = firstDiv(renderer, exactText(renderer, title))
  const button = firstDiv(renderer, exactText(renderer, action))
  if (button.parentId !== row.id) throw new Error(`「${action}」不在「${title}」标题栏`)
  const rowBox = renderer.getElementBounds(row.id)
  const buttonBox = renderer.getElementBounds(button.id)
  const titleBox = renderer.getElementBounds(exactText(renderer, title).id)
  if (!rowBox || !buttonBox || !titleBox) throw new Error(`「${title}」没有布局`)
  expect(Math.abs(buttonBox.x + buttonBox.width - (rowBox.x + rowBox.width))).toBeLessThan(2)
  expect(buttonBox.x).toBeGreaterThan(titleBox.x + titleBox.width)
  expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThan(2)
  expect(Math.abs(titleBox.height - rowBox.height)).toBeLessThan(2)
  expect(Math.abs(buttonBox.height + 2 - rowBox.height)).toBeLessThan(2)
}

function firstDiv(renderer: TestRenderer, start: TestElement): TestElement {
  let current: TestElement | undefined = start
  while (current && current.type !== 'div') current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
  if (!current) throw new Error('找不到容器')
  return current
}

function exactText(renderer: TestRenderer, label: string): TestElement {
  renderer.flush()
  const element = renderer.findByType('text').find((item) => item.text === label)
  if (!element) throw new Error(`找不到「${label}」。当前文字：${renderer.getAllText().join(' | ')}`)
  return element
}

function testBox(renderer: TestRenderer, testId: string): { x: number; y: number; height: number } | null {
  renderer.flush()
  const element = renderer.findByTestId(testId)
  return element ? renderer.getElementBounds(element.id) : null
}

function buttonBox(renderer: TestRenderer, label: string): { x: number; y: number; height: number } | null {
  let current: TestElement | undefined = exactText(renderer, label)
  while (current && current.type !== 'div') {
    current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
  }
  return current ? renderer.getElementBounds(current.id) : null
}

function widestAncestor(renderer: TestRenderer, label: string): number {
  let current: TestElement | undefined = exactText(renderer, label)
  let width = 0
  while (current) {
    width = Math.max(width, renderer.getElementBounds(current.id)?.width ?? 0)
    current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
  }
  return width
}

function bringIntoView(renderer: TestRenderer, testId: string): void {
  const scroller = renderer.findByTestId('panel-scroll')
  if (!scroller) throw new Error('面板不能滚动')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    renderer.flush()
    const element = renderer.findByTestId(testId)
    const bounds = element ? renderer.getElementBounds(element.id) : null
    if (bounds && bounds.y > 120 && bounds.y < 600) return
    const current = renderer.getScrollOffset(scroller.id)?.[1] ?? 0
    if (!bounds) break
    renderer.scrollTo(scroller.id, 0, Math.min(0, current - (bounds.y - 320)))
  }
}

function surface(renderer: TestRenderer): { width: number; height: number } {
  renderer.flush()
  let width = 0
  let height = 0
  for (const element of renderer.findByType('div')) {
    const bounds = renderer.getElementBounds(element.id)
    if (!bounds || bounds.x !== 0 || bounds.y !== 0) continue
    width = Math.max(width, bounds.width)
    height = Math.max(height, bounds.height)
  }
  return { width, height }
}

function bottomText(renderer: TestRenderer, label: string, minY: number): { x: number; y: number } {
  renderer.flush()
  const bounds = renderer.findByType('text')
    .filter((item) => item.text === label)
    .map((item) => renderer.getElementBounds(item.id))
    .filter((item): item is NonNullable<typeof item> => item != null && item.y > minY)
  const found = bounds[0]
  if (!found) throw new Error(`底部没有「${label}」`)
  return found
}

function boundsFor(renderer: TestRenderer, label: string): { x: number; y: number } {
  const element = exactText(renderer, label)
  const bounds = renderer.getElementBounds(element.id)
  if (!bounds) throw new Error(`「${label}」没有布局位置`)
  return bounds
}

function clickTestId(renderer: TestRenderer, testId: string): void {
  renderer.flush()
  const element = renderer.findByTestId(testId)
  const bounds = element ? renderer.getElementBounds(element.id) : null
  if (!bounds) throw new Error(`找不到 ${testId}`)
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

function click(renderer: TestRenderer, label: string): void {
  const element = exactText(renderer, label)
  const bounds = renderer.getElementBounds(element.id)
  if (!bounds) throw new Error(`「${label}」没有布局位置`)
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

async function waitForClipboard(needle: string): Promise<void> {
  let latest = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await readClipboard()
    if (latest.includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`剪贴板里没有「${needle}」。当前内容：${latest}`)
}

function readClipboard(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pbpaste', [], { env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
      else reject(new Error('无法读取剪贴板'))
    })
  })
}

async function waitForText(file: string, needle: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (existsSync(file) && (await readFile(file, 'utf8')).includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`文件里没有「${needle}」`)
}

async function waitForFontSize(renderer: TestRenderer, label: string, size: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    let current = renderer.findByType('text').find((item) => item.text === label)
    while (current) {
      if (current.style.fontSize === size) return
      current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${label}」的字号没有变成 ${size}`)
}

async function waitForFont(renderer: TestRenderer, label: string, family: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    let current = renderer.findByType('text').find((item) => item.text === label)
    while (current) {
      if (current.style.fontFamily === family) return
      current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${label}」的字体没有变成 ${family}`)
}

async function waitForBackground(renderer: TestRenderer, label: string, color: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    renderer.flush()
    const element = renderer.findByType('text').find((item) => item.text === label)
    let current = element
    while (current) {
      if (current.style.backgroundColor === color) return
      current = current.parentId == null ? undefined : renderer.getElement(current.parentId)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`「${label}」的背景没有变成 ${color}`)
}
