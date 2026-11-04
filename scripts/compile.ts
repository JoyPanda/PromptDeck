import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { windowsFileVersion } from './names'
import { installWindowsIcon, stampWindowsIdentity } from './win-icon'

const nativeModules: Record<string, string> = {
  'darwin-arm64': path.join('node_modules', '@gpuix', 'native-darwin-arm64', 'gpuix-native.darwin-arm64.node'),
  'win32-x64': path.join('node_modules', '@gpuix', 'native-win32-x64-msvc', 'gpuix-native.win32-x64-msvc.node'),
  'linux-x64': path.join('node_modules', '@gpuix', 'native-linux-x64-gnu', 'gpuix-native.linux-x64-gnu.node'),
}
const compileTargets: Record<string, string> = {
  'darwin-arm64': 'bun-darwin-arm64',
  'win32-x64': 'bun-windows-x64',
  'linux-x64': 'bun-linux-x64',
}
const host = `${process.platform}-${process.arch}`
const targetArg = process.argv.find((arg) => arg.startsWith('--target='))
const target = targetArg ? targetArg.slice('--target='.length) : host
const source = nativeModules[target]
const asset = path.join('dist', 'gpuix-native.node')
const entry = path.join('dist', 'entry.ts')
const outfile = target === 'win32-x64' ? path.join('dist', 'PromptDeck.exe') : path.join('dist', 'PromptDeck')

if (!source || !compileTargets[target]) {
  console.error(`还不支持为 ${target} 打包。GPUIX 0.10 提供 macOS arm64、Windows x64 和 Linux x64。`)
  process.exit(1)
}

if (!existsSync(source)) {
  console.error(`找不到 ${target} 的原生模块 ${source}。请先安装对应的 @gpuix 原生包后再打包。`)
  process.exit(1)
}

mkdirSync('dist', { recursive: true })
copyFileSync(source, asset)
writeEntry(entry)

const args = ['build', '--compile', `--asset=${asset}`, entry, '--outfile', outfile]
if (target !== host) args.push(`--target=${compileTargets[target]}`)
if (target === 'win32-x64') {
  args.push('--windows-hide-console', `--asset=${path.resolve('assets', 'PromptDeck.ico')}`)
  if (process.platform === 'win32') {
    const version = windowsFileVersion(JSON.parse(readFileSync('package.json', 'utf8')).version)
    args.push(
      '--windows-title=PromptDeck',
      '--windows-description=PromptDeck',
      '--windows-publisher=PromptDeck',
      `--windows-version=${version}`,
    )
  }
}

const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
if (result.status === 0) {
  try {
    if (target === 'win32-x64') {
      const exePath = path.resolve(outfile)
      const version = windowsFileVersion(JSON.parse(readFileSync('package.json', 'utf8')).version)
      const stamped = stampWindowsIdentity(installWindowsIcon(readFileSync(exePath), readFileSync(path.resolve('assets', 'PromptDeck.ico'))), {
        name: 'PromptDeck',
        version,
      })
      writeFileSync(exePath, stamped)
    }
  } finally {
    unlinkSync(asset)
    unlinkSync(entry)
  }
}
process.exit(result.status ?? 1)

function writeEntry(file: string) {
  const contents = `import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const embedded = Bun.embeddedFiles.find((file) => file.name?.endsWith('.node'))
if (!embedded) {
  throw new Error('安装包里缺少原生界面模块')
}

const cacheDir =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PromptDeck')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'PromptDeck')
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'PromptDeck')
const bindingPath = path.join(cacheDir, embedded.name || 'gpuix-native.node')
mkdirSync(cacheDir, { recursive: true })

let current = 0
try {
  current = statSync(bindingPath).size
} catch {
  current = 0
}
if (current !== embedded.size) {
  const temporary = bindingPath + '.tmp'
  writeFileSync(temporary, new Uint8Array(await embedded.arrayBuffer()))
  renameSync(temporary, bindingPath)
}

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = bindingPath

const icon = Bun.embeddedFiles.find((file) => file.name?.endsWith('.ico'))
if (icon) {
  const iconPath = path.join(cacheDir, 'PromptDeck.ico')
  let iconSize = 0
  try {
    iconSize = statSync(iconPath).size
  } catch {
    iconSize = 0
  }
  if (iconSize !== icon.size) {
    const temporary = iconPath + '.tmp'
    writeFileSync(temporary, new Uint8Array(await icon.arrayBuffer()))
    renameSync(temporary, iconPath)
  }
  process.env.PROMPTDECK_ICON = iconPath
}

await import('../src/main.tsx')
`
  writeFileSync(file, contents)
}
