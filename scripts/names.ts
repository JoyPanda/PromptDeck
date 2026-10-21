export function releaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

export function assertReleaseVersion(version: string): string {
  const tag = releaseTag(version)
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.+-]+)?$/.test(tag)) {
    throw new Error(`版本号 ${tag} 不符合 v1.2.3`)
  }
  return tag
}

export function installerName(version: string, platform = process.platform, arch = process.arch, unsigned = platform !== 'linux'): string {
  const suffix = unsigned ? '-unsigned' : ''
  if (platform === 'darwin') {
    const cpu = arch === 'arm64' ? 'arm64' : 'x64'
    return `PromptDeck-${version}-macOS-${cpu}${suffix}.dmg`
  }
  if (platform === 'win32') return `PromptDeck-${version}-Windows-Setup${suffix}.exe`
  if (platform === 'linux') return `PromptDeck-${version}-linux.AppImage`
  throw new Error(`不支持的系统 ${platform}`)
}
