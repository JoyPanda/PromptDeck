import { afterEach, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configPath, loadConfig, saveConfig, type AppConfig } from './config'

const roots: string[] = []
const previousDataDir = process.env.PROMPTDECK_DATA_DIR
const previousKey = process.env.PROMPTDECK_CONFIG_KEY

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.PROMPTDECK_DATA_DIR
  else process.env.PROMPTDECK_DATA_DIR = previousDataDir
  if (previousKey === undefined) delete process.env.PROMPTDECK_CONFIG_KEY
  else process.env.PROMPTDECK_CONFIG_KEY = previousKey
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function sample(password: string): AppConfig {
  return {
    provider: 'gitlab',
    remoteUrl: 'https://gitlab.com/acme/prompts',
    branch: 'main',
    auth: 'password',
    token: '',
    username: 'ada',
    password,
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
  }
}

test.serial('encrypts sync settings and loads them back', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-config-'))
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  process.env.PROMPTDECK_CONFIG_KEY = randomBytes(32).toString('base64')
  const password = 'plain-password-should-not-appear'
  await saveConfig(sample(password))
  const raw = await readFile(configPath(), 'utf8')
  expect(raw).toContain('aes-256-gcm')
  expect(raw).not.toContain(password)
  expect(raw).not.toContain('ada@example.com')
  expect(await loadConfig()).toMatchObject({ password, username: 'ada', provider: 'gitlab' })
})

test.serial('still reads a plaintext config from an older install', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-config-'))
  roots.push(dir)
  process.env.PROMPTDECK_DATA_DIR = dir
  delete process.env.PROMPTDECK_CONFIG_KEY
  const config = sample('kept-secret')
  await writeFile(configPath(), `${JSON.stringify(config)}\n`)
  expect(await loadConfig()).toMatchObject({ password: 'kept-secret', username: 'ada' })
})
