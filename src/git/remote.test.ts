import { describe, expect, test } from 'bun:test'
import { dataDirFor, parseConfig } from './config'
import { authFor, gitAuthFailureMessage, gitHttpUrl, normalizeRemoteUrl } from './remote'

describe('authFor', () => {
  test('uses a token username on GitHub and oauth2 on GitLab', () => {
    expect(authFor({ provider: 'github', token: ' github-token ' })).toEqual({ username: 'x-access-token', password: 'github-token' })
    expect(authFor({ provider: 'gitlab', auth: 'token', token: 'gitlab-token' })).toEqual({ username: 'oauth2', password: 'gitlab-token' })
  })

  test('uses the given username and password for either host', () => {
    expect(authFor({ provider: 'github', auth: 'password', username: ' octocat ', password: 'secret' })).toEqual({ username: 'octocat', password: 'secret' })
    expect(authFor({ provider: 'gitlab', auth: 'password', username: 'ada', password: 'secret' })).toEqual({ username: 'ada', password: 'secret' })
  })
})

describe('normalizeRemoteUrl', () => {
  test('strips credentials, query, and the .git suffix', () => {
    expect(normalizeRemoteUrl('https://token@github.com/acme/prompts.git?ref=main')).toBe('https://github.com/acme/prompts')
  })

  test('keeps GitLab subgroups', () => {
    expect(normalizeRemoteUrl('https://gitlab.example.com/team/sub/prompts/')).toBe('https://gitlab.example.com/team/sub/prompts')
  })

  test('rejects non-https and incomplete urls', () => {
    expect(() => normalizeRemoteUrl('git@github.com:acme/prompts.git')).toThrow('HTTPS')
    expect(() => normalizeRemoteUrl('https://github.com/acme')).toThrow('所有者和仓库名')
  })
})

describe('dataDirFor', () => {
  test('uses Application Support on macOS and APPDATA on Windows', () => {
    expect(dataDirFor('darwin', '/Users/me')).toBe('/Users/me/Library/Application Support/PromptDeck')
    expect(dataDirFor('win32', 'C:\\Users\\me', 'C:\\Users\\me\\AppData\\Roaming')).toBe('C:\\Users\\me\\AppData\\Roaming\\PromptDeck')
  })
})

describe('parseConfig', () => {
  test('returns null when the token or author is missing', () => {
    expect(parseConfig('{"provider":"github","remoteUrl":"https://github.com/a/b"}')).toBeNull()
  })

  test('keeps an older token config and accepts a username and password', () => {
    expect(parseConfig('{"provider":"github","remoteUrl":"https://github.com/a/b","token":"t","authorName":"Ada","authorEmail":"ada@example.com"}')).toMatchObject({
      auth: 'token',
      token: 't',
      username: '',
      password: '',
    })
    expect(parseConfig('{"provider":"gitlab","remoteUrl":"https://gitlab.com/a/b","auth":"password","username":"ada","password":"secret","authorName":"Ada","authorEmail":"ada@example.com"}')).toMatchObject({
      auth: 'password',
      username: 'ada',
      password: 'secret',
      token: '',
    })
    expect(parseConfig('{"provider":"github","remoteUrl":"https://github.com/a/b","auth":"password","authorName":"Ada","authorEmail":"ada@example.com"}')).toBeNull()
  })
})

describe('gitHttpUrl', () => {
  test('keeps a single .git suffix for the git HTTP endpoint', () => {
    expect(gitHttpUrl('https://gitlab.example.com/team/prompts')).toBe('https://gitlab.example.com/team/prompts.git')
    expect(gitHttpUrl('https://gitlab.example.com/team/prompts.git')).toBe('https://gitlab.example.com/team/prompts.git')
  })
})

describe('gitAuthFailureMessage', () => {
  test('tells GitLab password users to put a token in the password field', () => {
    const detail = 'HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect or you are required to use a token instead of a password.'
    expect(gitAuthFailureMessage('gitlab', 'password', detail)).toContain('个人访问令牌')
    expect(gitAuthFailureMessage('github', 'password', '')).toBe('认证失败。请检查用户名和密码。')
  })
})
