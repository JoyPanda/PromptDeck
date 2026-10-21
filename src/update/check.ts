import { appVersion } from '../version'
import { parseUpdateRepository, releasesPageUrl, updateRepository } from './repo'

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export type ReleaseVersion = { major: number; minor: number; patch: number }

export type ReleaseAsset = { name: string; url: string; size: number }

export type UpdateInfo = {
  latestVersion: string
  releaseNotes: string
  downloadUrl: string
  checksumUrl: string
  assetName: string
  assetSize: number
  pageUrl: string
}

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'

export type UpdateCheckResult =
  | { status: 'empty' }
  | { status: 'current' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'error'; message: string }

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>

export function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(value.trim())
  if (!match?.[1] || !match[2] || !match[3]) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function compareReleaseVersions(left: ReleaseVersion, right: ReleaseVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

export function installerCandidates(version: string, platform: string, arch: string): string[] {
  if (platform === 'darwin') {
    const cpu = arch === 'arm64' ? 'arm64' : 'x64'
    return [
      `PromptDeck-${version}-macOS-${cpu}.dmg`,
      `PromptDeck-${version}-macOS-${cpu}-unsigned.dmg`,
    ]
  }
  if (platform === 'win32' && arch === 'x64') {
    return [
      `PromptDeck-${version}-Windows-Setup.exe`,
      `PromptDeck-${version}-Windows-Setup-unsigned.exe`,
    ]
  }
  return []
}

export function selectReleaseAsset(assets: ReleaseAsset[], version: string, platform: string, arch: string): { asset: ReleaseAsset; checksum: ReleaseAsset } | { error: string } {
  const names = installerCandidates(version, platform, arch)
  if (names.length === 0) return { error: '当前平台不支持自动更新。' }
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  let incomplete = false
  for (const name of names) {
    const asset = byName.get(name)
    if (!asset) continue
    const checksum = byName.get(`${name}.sha256`)
    if (checksum) return { asset, checksum }
    incomplete = true
  }
  return { error: incomplete ? '更新包不可用。' : '当前平台没有安装包。' }
}

export function scheduledUpdateCheckDue(lastCheckAt: string, now = Date.now()): boolean {
  if (!lastCheckAt) return true
  const parsed = Date.parse(lastCheckAt)
  if (Number.isNaN(parsed)) return true
  return now - parsed >= UPDATE_CHECK_INTERVAL_MS
}

export function interpretRelease(body: unknown, currentVersion: string, platform: string, arch: string, repository = updateRepository): UpdateCheckResult {
  if (!body || typeof body !== 'object') return { status: 'error', message: '更新信息异常。' }
  const record = body as { tag_name?: unknown; body?: unknown; html_url?: unknown; assets?: unknown }
  if (typeof record.tag_name !== 'string' || !record.tag_name.trim()) return { status: 'error', message: '更新信息异常。' }
  const stripped = record.tag_name.trim().replace(/^v/i, '')
  if (stripped.includes('-') || stripped.includes('+')) return { status: 'current' }
  const latest = parseReleaseVersion(stripped)
  const current = parseReleaseVersion(currentVersion)
  if (!latest || !current) return { status: 'error', message: '版本信息异常。' }
  if (compareReleaseVersions(latest, current) <= 0) return { status: 'current' }
  const version = `${latest.major}.${latest.minor}.${latest.patch}`
  const selected = selectReleaseAsset(readAssets(record.assets), version, platform, arch)
  if ('error' in selected) return { status: 'error', message: selected.error }
  const notes = typeof record.body === 'string' ? record.body.trim() : ''
  const page = typeof record.html_url === 'string' && record.html_url.startsWith('https://') ? record.html_url : releasesPageUrl(repository) ?? ''
  return {
    status: 'available',
    info: {
      latestVersion: version,
      releaseNotes: notes,
      downloadUrl: selected.asset.url,
      checksumUrl: selected.checksum.url,
      assetName: selected.asset.name,
      assetSize: selected.asset.size,
      pageUrl: page,
    },
  }
}

export async function checkForUpdate(currentVersion = appVersion, repository = updateRepository, fetchImpl: FetchLike = fetch): Promise<UpdateCheckResult> {
  const parsed = parseUpdateRepository(repository)
  if (!parsed) return { status: 'empty' }
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.name}/releases/latest`
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        'User-Agent': `PromptDeck/${currentVersion}`,
        Accept: 'application/vnd.github+json',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    const detail = errorDetail(error)
    return { status: 'error', message: detail ? `网络不可用。（${detail}）` : '网络不可用。' }
  }
  if (response.status === 404) return { status: 'error', message: '还没有已发布的版本。' }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const message = responseMessage(detail)
    return { status: 'error', message: message ? `更新服务器暂不可用。（${message}）` : `更新服务器暂不可用（HTTP ${response.status}）。` }
  }
  try {
    return interpretRelease(await response.json(), currentVersion, process.platform, process.arch, repository)
  } catch {
    return { status: 'error', message: '更新信息异常。' }
  }
}

function readAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) return []
  const assets: ReleaseAsset[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as { name?: unknown; browser_download_url?: unknown; size?: unknown }
    if (typeof record.name !== 'string' || typeof record.browser_download_url !== 'string') continue
    if (!record.browser_download_url.startsWith('https://')) continue
    assets.push({ name: record.name, url: record.browser_download_url, size: typeof record.size === 'number' ? record.size : 0 })
  }
  return assets
}

function responseMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
  } catch {
    // The body is not JSON.
  }
  const text = body.trim()
  return text.length > 0 && text.length < 180 ? text : ''
}

function errorDetail(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && typeof current.code === 'string' && current.code && !parts.includes(current.code)) parts.push(current.code)
    if (current instanceof Error && current.message && current.message !== 'fetch failed' && !parts.includes(current.message)) parts.push(current.message)
    const nested = 'errors' in current && Array.isArray(current.errors) ? current.errors : []
    for (const item of nested) {
      const detail = errorDetail(item)
      if (detail && !parts.includes(detail)) parts.push(detail)
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return parts.join(' ')
}
