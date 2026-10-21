import { describe, expect, test } from 'bun:test'
import { checkForUpdate, compareReleaseVersions, installerCandidates, interpretRelease, parseReleaseVersion, scheduledUpdateCheckDue, selectReleaseAsset, UPDATE_CHECK_INTERVAL_MS } from './check'
import { releasesPageUrl } from './repo'
import { formatChecksum, parseChecksum } from './checksum'
import { appBundleFromExecutable, isSafeAssetName, windowsInstallerArgs } from './install'

const asset = (name: string) => ({ name, url: `https://example.invalid/${name}`, size: 10 })

describe('release versions', () => {
  test('compares stable versions and ignores prereleases', () => {
    const older = parseReleaseVersion('0.1.0')
    const newer = parseReleaseVersion('v0.2.0')
    expect(older && newer && compareReleaseVersions(newer, older)).toBeGreaterThan(0)
    expect(parseReleaseVersion('0.1.0-beta.1')).toBeNull()
    expect(interpretRelease({ tag_name: 'v0.2.0-rc.1', assets: [] }, '0.1.0', 'darwin', 'arm64').status).toBe('current')
    expect(interpretRelease({ tag_name: 'v0.1.0', assets: [] }, '0.1.0', 'darwin', 'arm64').status).toBe('current')
  })

  test('picks the signed installer and requires its checksum', () => {
    expect(installerCandidates('0.2.0', 'darwin', 'arm64')).toEqual([
      'PromptDeck-0.2.0-macOS-arm64.dmg',
      'PromptDeck-0.2.0-macOS-arm64-unsigned.dmg',
    ])
    const signed = asset('PromptDeck-0.2.0-macOS-arm64.dmg')
    const signedSum = asset('PromptDeck-0.2.0-macOS-arm64.dmg.sha256')
    const unsigned = asset('PromptDeck-0.2.0-macOS-arm64-unsigned.dmg')
    const unsignedSum = asset('PromptDeck-0.2.0-macOS-arm64-unsigned.dmg.sha256')
    expect(selectReleaseAsset([unsigned, unsignedSum, signed, signedSum], '0.2.0', 'darwin', 'arm64')).toEqual({ asset: signed, checksum: signedSum })
    expect(selectReleaseAsset([unsigned, unsignedSum], '0.2.0', 'darwin', 'arm64')).toEqual({ asset: unsigned, checksum: unsignedSum })
    expect(selectReleaseAsset([signed], '0.2.0', 'darwin', 'arm64')).toEqual({ error: '更新包不可用。' })
    expect(selectReleaseAsset([], '0.2.0', 'darwin', 'arm64')).toEqual({ error: '当前平台没有安装包。' })
    expect(selectReleaseAsset([], '0.2.0', 'linux', 'x64')).toEqual({ error: '当前平台不支持自动更新。' })
    const windows = asset('PromptDeck-0.2.0-Windows-Setup-unsigned.exe')
    const windowsSum = asset('PromptDeck-0.2.0-Windows-Setup-unsigned.exe.sha256')
    expect(selectReleaseAsset([windows, windowsSum], '0.2.0', 'win32', 'x64')).toEqual({ asset: windows, checksum: windowsSum })
  })

  test('reads the release notes and download from a GitHub release', () => {
    const result = interpretRelease({
      tag_name: 'v0.2.0',
      body: '修复同步。',
      html_url: 'https://github.com/acme/PromptDeck/releases/tag/v0.2.0',
      assets: [
        { name: 'PromptDeck-0.2.0-macOS-arm64-unsigned.dmg', browser_download_url: 'https://example.invalid/app.dmg', size: 4 },
        { name: 'PromptDeck-0.2.0-macOS-arm64-unsigned.dmg.sha256', browser_download_url: 'https://example.invalid/app.dmg.sha256', size: 80 },
      ],
    }, '0.1.0', 'darwin', 'arm64', 'acme/PromptDeck')
    expect(result).toMatchObject({
      status: 'available',
      info: {
        latestVersion: '0.2.0',
        releaseNotes: '修复同步。',
        assetName: 'PromptDeck-0.2.0-macOS-arm64-unsigned.dmg',
        downloadUrl: 'https://example.invalid/app.dmg',
      },
    })
    expect(interpretRelease({ tag_name: '' }, '0.1.0', 'darwin', 'arm64').status).toBe('error')
  })

  test('does not contact GitHub when the repository is blank', async () => {
    const calls: string[] = []
    const result = await checkForUpdate('0.1.0', '  ', async (url) => {
      calls.push(url)
      throw new Error('should not fetch')
    })
    expect(result).toEqual({ status: 'empty' })
    expect(calls).toEqual([])
    expect(releasesPageUrl()).toBe('https://github.com/JoyPanda/PromptDeck/releases')
  })

  test('names a network failure', async () => {
    const result = await checkForUpdate('0.1.0', 'acme/PromptDeck', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) })
    })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('ECONNRESET')
  })

  test('checks again after a day', () => {
    const now = Date.parse('2026-10-21T00:00:00.000Z')
    expect(scheduledUpdateCheckDue('', now)).toBe(true)
    expect(scheduledUpdateCheckDue('not-a-date', now)).toBe(true)
    expect(scheduledUpdateCheckDue(new Date(now - UPDATE_CHECK_INTERVAL_MS + 1000).toISOString(), now)).toBe(false)
    expect(scheduledUpdateCheckDue(new Date(now - UPDATE_CHECK_INTERVAL_MS).toISOString(), now)).toBe(true)
  })
})

describe('update package', () => {
  test('reads a checksum and only accepts a plain file name', () => {
    const hash = 'a'.repeat(64)
    expect(parseChecksum(formatChecksum(hash, 'PromptDeck.dmg'))).toBe(hash)
    expect(parseChecksum('nope')).toBeNull()
    expect(isSafeAssetName('PromptDeck-0.2.0-macOS-arm64.dmg')).toBe(true)
    expect(isSafeAssetName('../PromptDeck.dmg')).toBe(false)
    expect(isSafeAssetName('dir/PromptDeck.dmg')).toBe(false)
    expect(windowsInstallerArgs()).toEqual(['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/PROMPTDECKRESTART=1'])
  })

  test('updates only an installed application bundle', () => {
    expect(appBundleFromExecutable('/Applications/PromptDeck.app/Contents/MacOS/PromptDeck')).toBe('/Applications/PromptDeck.app')
    expect(appBundleFromExecutable('/Volumes/PromptDeck/PromptDeck.app/Contents/MacOS/PromptDeck')).toBeNull()
    expect(appBundleFromExecutable('/private/var/folders/x/AppTranslocation/y/d/PromptDeck.app/Contents/MacOS/PromptDeck')).toBeNull()
    expect(appBundleFromExecutable('/Users/me/PromptDeck/dist/PromptDeck')).toBeNull()
  })
})
