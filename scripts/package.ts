import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { installerName } from './names'
import { formatChecksum } from '../src/update/checksum'

if (import.meta.main) packageCurrentPlatform()

function packageCurrentPlatform(): void {
  const version = readVersion()
  const binary = process.platform === 'win32' ? path.join('dist', 'PromptDeck.exe') : path.join('dist', 'PromptDeck')
  const signed = process.env.PROMPTDECK_SIGNED === '1'
  const archive = path.join('dist', installerName(version, process.platform, process.arch, process.platform === 'darwin' && !signed))

  const compiled = spawnSync(process.execPath, ['scripts/compile.ts'], { stdio: 'inherit' })
  if (compiled.status !== 0) process.exit(compiled.status ?? 1)

  try {
    rmSync(archive, { force: true })
    if (process.platform === 'darwin') packageMac(binary, archive, signed, version)
    else if (process.platform === 'win32') packageWindows(binary, archive, version)
    else if (process.platform === 'linux') packageLinux(binary, archive)
    else throw new Error(`还不支持在 ${process.platform} 上打包。`)
    writeFileSync(`${archive}.sha256`, formatChecksum(createHash('sha256').update(readFileSync(archive)).digest('hex'), path.basename(archive)))
    console.log(`已打包 ${archive}`)
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 1
    if (!(error instanceof Error && 'status' in error)) console.error(error instanceof Error ? error.message : error)
    process.exit(status || 1)
  }
}

function readVersion(): string {
  const parsed = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    console.error('package.json 里没有版本号')
    process.exit(1)
  }
  return parsed.version.trim()
}

function packageMac(source: string, diskImage: string, notarize: boolean, version: string): void {
  const app = path.join('dist', 'PromptDeck.app')
  const macos = path.join(app, 'Contents', 'MacOS')
  rmSync(app, { recursive: true, force: true })
  mkdirSync(macos, { recursive: true })
  const executable = path.join(macos, 'PromptDeck')
  cpSync(source, executable)
  chmodSync(executable, 0o755)
  writeFileSync(path.join(app, 'Contents', 'Info.plist'), infoPlist(version))
  writeFileSync(path.join(app, 'Contents', 'PkgInfo'), 'APPL????')
  installMacIcon(app)
  run('xattr', ['-cr', app])

  const stage = path.join('dist', 'dmg-stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage)
  const stagedApp = path.join(stage, 'PromptDeck.app')
  cpSync(app, stagedApp, { recursive: true })
  run('ln', ['-sfn', '/Applications', path.join(stage, 'Applications')])

  const seal = (target: string) => {
    if (notarize) return
    run('codesign', ['--force', '--deep', '--sign', '-', target])
  }
  seal(app)
  seal(stagedApp)
  if (notarize) {
    withDeveloperId((identity, keychain) => {
      const args = ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, '--keychain', keychain]
      run('codesign', [...args, app])
      run('codesign', [...args, stagedApp])
      run('hdiutil', ['create', '-volname', 'PromptDeck', '-srcfolder', stage, '-ov', '-format', 'UDZO', path.resolve(diskImage)])
      run('codesign', ['--force', '--timestamp', '--sign', identity, '--keychain', keychain, diskImage])
    })
    notarizeDiskImage(diskImage)
  } else {
    run('hdiutil', ['create', '-volname', 'PromptDeck', '-srcfolder', stage, '-ov', '-format', 'UDZO', path.resolve(diskImage)])
  }
  rmSync(stage, { recursive: true, force: true })
}

function packageWindows(source: string, setup: string, version: string): void {
  const script = path.join('dist', 'PromptDeck.iss')
  const numeric = version.split(/[-+]/)[0] ?? version
  writeFileSync(script, innoScript(path.resolve(source).replaceAll('\\', '/'), path.resolve('dist').replaceAll('\\', '/'), path.basename(setup, '.exe'), version, numeric))
  const compiler = findInnoCompiler()
  run(compiler, [script])
  const emitted = path.join('dist', `${path.basename(setup, '.exe')}.exe`)
  if (path.resolve(emitted) !== path.resolve(setup) && existsSync(emitted)) {
    rmSync(setup, { force: true })
    cpSync(emitted, setup)
  }
}

function packageLinux(source: string, image: string): void {
  const appDir = path.join('dist', 'PromptDeck.AppDir')
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(path.join(appDir, 'usr', 'bin'), { recursive: true })
  const executable = path.join(appDir, 'usr', 'bin', 'PromptDeck')
  cpSync(source, executable)
  chmodSync(executable, 0o755)
  writeFileSync(path.join(appDir, 'AppRun'), `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/PromptDeck" "$@"
`)
  chmodSync(path.join(appDir, 'AppRun'), 0o755)
  writeFileSync(path.join(appDir, 'PromptDeck.desktop'), `[Desktop Entry]
Name=PromptDeck
Exec=PromptDeck
Icon=PromptDeck
Type=Application
Categories=Utility;
`)
  writeAppIcon(path.join(appDir, 'PromptDeck.png'))
  const tool = ensureAppImageTool()
  run(tool, [appDir, path.resolve(image)], { APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64' })
  chmodSync(image, 0o755)
}

function withDeveloperId(sign: (identity: string, keychain: string) => void): void {
  const link = requiredEnv('MAC_CSC_LINK')
  const password = requiredEnv('MAC_CSC_KEY_PASSWORD')
  const previous = keychainSearchList()
  const certificate = path.join(os.tmpdir(), `promptdeck-${process.pid}.p12`)
  const keychain = path.join(os.tmpdir(), `promptdeck-${process.pid}.keychain-db`)
  const keychainPassword = randomBytes(18).toString('base64url')
  writeFileSync(certificate, Buffer.from(link, 'base64'))
  try {
    run('security', ['create-keychain', '-p', keychainPassword, keychain])
    run('security', ['set-keychain-settings', '-lut', '21600', keychain])
    run('security', ['unlock-keychain', '-p', keychainPassword, keychain])
    run('security', ['import', certificate, '-P', password, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychain])
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychain])
    run('security', ['list-keychains', '-d', 'user', '-s', keychain])
    sign(developerIdentity(keychain), keychain)
  } finally {
    spawnSync('security', ['delete-keychain', keychain], { stdio: 'ignore' })
    if (previous.length > 0) spawnSync('security', ['list-keychains', '-d', 'user', '-s', ...previous], { stdio: 'ignore' })
    rmSync(certificate, { force: true })
  }
}

function keychainSearchList(): string[] {
  const listed = spawnSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' })
  return listed.stdout.split(/\r?\n/).map((line) => line.trim().replaceAll('"', '')).filter(Boolean)
}

function notarizeDiskImage(diskImage: string): void {
  run('xcrun', [
    'notarytool', 'submit', diskImage,
    '--apple-id', requiredEnv('APPLE_ID'),
    '--password', requiredEnv('APPLE_APP_SPECIFIC_PASSWORD'),
    '--team-id', requiredEnv('APPLE_TEAM_ID'),
    '--wait',
  ])
  run('xcrun', ['stapler', 'staple', diskImage])
}

function developerIdentity(keychain?: string): string {
  const args = ['find-identity', '-v', '-p', 'codesigning']
  if (keychain) args.push(keychain)
  const listed = spawnSync('security', args, { encoding: 'utf8' })
  const match = listed.stdout.match(/"Developer ID Application:[^"]+"/)
  if (listed.status !== 0 || !match) {
    const error = new Error('钥匙串里没有 Developer ID Application 证书。') as Error & { status?: number }
    error.status = listed.status || 1
    throw error
  }
  return match[0].slice(1, -1)
}

function findInnoCompiler(): string {
  const candidates = [
    'ISCC.exe',
    'ISCC',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ]
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], { encoding: 'utf8' })
    const located = found.stdout.split(/\r?\n/).find((line) => line.trim())
    if (found.status === 0 && located) return located.trim()
  }
  console.error('找不到 Inno Setup 的 ISCC。Windows 安装包需要先安装 Inno Setup 6。')
  process.exit(1)
}

function ensureAppImageTool(): string {
  const tool = path.join(os.tmpdir(), 'promptdeck-appimagetool-x86_64.AppImage')
  if (!existsSync(tool)) {
    run('curl', ['-fsSL', '-o', tool, 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage'])
    chmodSync(tool, 0o755)
  }
  return tool
}

export function innoScript(source: string, outputDir: string, baseName: string, appVersion: string, numericVersion: string): string {
  return `; PromptDeck Windows installer
[Setup]
AppId={{7C4E9A2B-1F6D-4E8A-9C3B-5D2F8A1E6B40}
AppName=PromptDeck
AppVersion=${appVersion}
AppPublisher=PromptDeck
DefaultDirName={localappdata}\\Programs\\PromptDeck
DefaultGroupName=PromptDeck
OutputDir=${outputDir}
OutputBaseFilename=${baseName}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
WizardStyle=modern
SetupIconFile=${path.resolve('assets', 'PromptDeck.ico').replaceAll('\\', '/')}
UninstallDisplayIcon={app}\\PromptDeck.exe
VersionInfoVersion=${numericVersion}
CloseApplications=force
RestartApplications=no

[Files]
Source: "${source}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\PromptDeck"; Filename: "{app}\\PromptDeck.exe"
Name: "{autodesktop}\\PromptDeck"; Filename: "{app}\\PromptDeck.exe"

[Code]
function ShouldRestartPromptDeck: Boolean;
begin
  Result := ExpandConstant('{param:PROMPTDECKRESTART|0}') = '1';
end;

[Run]
Filename: "{app}\\PromptDeck.exe"; Description: "启动 PromptDeck"; Flags: nowait postinstall skipifsilent
Filename: "{app}\\PromptDeck.exe"; Flags: nowait skipifnotsilent; Check: ShouldRestartPromptDeck
`
}

function infoPlist(appVersion: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>PromptDeck</string>
  <key>CFBundleDisplayName</key>
  <string>PromptDeck</string>
  <key>CFBundleIdentifier</key>
  <string>app.promptdeck.desktop</string>
  <key>CFBundleVersion</key>
  <string>${appVersion}</string>
  <key>CFBundleShortVersionString</key>
  <string>${appVersion}</string>
  <key>CFBundleExecutable</key>
  <string>PromptDeck</string>
  <key>CFBundleIconFile</key>
  <string>PromptDeck</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
</dict>
</plist>
`
}

export function writeAppIcon(file: string): void {
  cpSync(appIconPath(), file)
}

function appIconPath(): string {
  return path.join('assets', 'PromptDeck.png')
}

function installMacIcon(app: string): void {
  const resources = path.join(app, 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  const iconset = path.join(os.tmpdir(), `promptdeck-icon-${process.pid}.iconset`)
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset)
  const source = appIconPath()
  for (const size of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, `icon_${size}x${size}.png`)])
    run('sips', ['-z', String(size * 2), String(size * 2), source, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)])
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'PromptDeck.icns')])
  rmSync(iconset, { recursive: true, force: true })
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`缺少签名环境变量 ${name}`)
    process.exit(1)
  }
  return value
}

function run(command: string, args: string[], extraEnv: Record<string, string> = {}): void {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1', ...extraEnv } })
  if (result.status !== 0) {
    const error = new Error(`${command} 失败`) as Error & { status?: number }
    error.status = result.status ?? 1
    throw error
  }
}
