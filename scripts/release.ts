import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { assertReleaseVersion } from './names'

const noBuild = process.argv.includes('--no-build')
const version = readVersion()
const tag = assertReleaseVersion(version)
const fromEnv = process.env.GITHUB_REF_NAME
if (fromEnv && fromEnv !== tag) {
  console.error(`当前标签 ${fromEnv} 和 package.json 的 ${tag} 不一致。`)
  process.exit(1)
}

if (!noBuild) {
  const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  if (dirty.status !== 0) process.exit(dirty.status ?? 1)
  if (dirty.stdout.trim()) {
    console.error('工作区还有未提交的修改，先提交再发布。')
    process.exit(1)
  }
  const packaged = spawnSync(process.execPath, ['scripts/package.ts'], { stdio: 'inherit' })
  if (packaged.status !== 0) process.exit(packaged.status ?? 1)
}

const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
const tagged = spawnSync('git', ['rev-parse', '--verify', `${tag}^{}`], { encoding: 'utf8' })
if (head.status !== 0 || tagged.status !== 0 || head.stdout.trim() !== tagged.stdout.trim()) {
  console.error(`请先把标签 ${tag} 指到当前提交并推送到远端，再发布。这个流程不会创建或推送标签。`)
  process.exit(tagged.status || head.status || 1)
}

const installers = readdirSync('dist')
  .filter((name) => /^PromptDeck-.+\.(dmg|exe|AppImage)$/.test(name))
  .map((name) => localArtifact(path.join('dist', name)))
const checksums = installers.map((file) => `${file}.sha256`).filter((file) => existsSync(file))
const artifacts = [...installers, ...checksums]
if (artifacts.length === 0) {
  console.error('dist 里没有安装包，先运行 bun run package。')
  process.exit(1)
}

if (!commandOk('gh', ['release', 'view', tag])) {
  run('gh', ['release', 'create', tag, '--draft', '--generate-notes', '--title', `PromptDeck ${tag}`])
}

const existing = spawnSync('gh', ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' })
if (existing.status !== 0) process.exit(existing.status ?? 1)
const present = new Set(existing.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))
const missing = artifacts.filter((file) => !present.has(path.basename(file)))
if (missing.length === 0) {
  console.log(`${tag} 的安装包已经在 Release 里`)
} else {
  run('gh', ['release', 'upload', tag, ...missing])
}
console.log(`已发布 ${tag}`)

function localArtifact(file: string): string {
  if (process.platform !== 'win32' || process.env.PROMPTDECK_SIGNED === '1') return file
  if (!file.endsWith('.exe') || file.endsWith('-unsigned.exe')) return file
  const renamed = file.replace(/\.exe$/, '-unsigned.exe')
  renameSync(file, renamed)
  const checksum = `${file}.sha256`
  if (existsSync(checksum)) {
    const body = readFileSync(checksum, 'utf8').replaceAll(path.basename(file), path.basename(renamed))
    writeFileSync(`${renamed}.sha256`, body)
    rmSync(checksum)
  }
  return renamed
}

function readVersion(): string {
  const parsed = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    console.error('package.json 里没有版本号')
    process.exit(1)
  }
  return parsed.version.trim()
}

function commandOk(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
