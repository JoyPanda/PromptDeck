export type Provider = 'github' | 'gitlab'

export type AuthMode = 'token' | 'password'

export type GitAuth = {
  username: string
  password: string
}

export function authFor(input: {
  provider: Provider
  auth?: AuthMode
  token?: string
  username?: string
  password?: string
}): GitAuth {
  if (input.auth === 'password') {
    return { username: input.username?.trim() ?? '', password: input.password ?? '' }
  }
  const password = input.token?.trim() ?? ''
  if (input.provider === 'gitlab') return { username: 'oauth2', password }
  return { username: 'x-access-token', password }
}

export function normalizeRemoteUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请填写仓库地址')
  if (!/^https:\/\//i.test(trimmed)) throw new Error('仓库地址需要是 HTTPS 链接')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('仓库地址无法解析')
  }

  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''

  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('仓库地址需要包含所有者和仓库名')
  const last = parts[parts.length - 1] ?? ''
  if (last.endsWith('.git')) parts[parts.length - 1] = last.slice(0, -4)
  if (!parts[parts.length - 1]) throw new Error('仓库地址需要包含所有者和仓库名')
  parsed.pathname = `/${parts.join('/')}`
  return parsed.toString().replace(/\/$/, '')
}

export function gitHttpUrl(remoteUrl: string): string {
  return remoteUrl.endsWith('.git') ? remoteUrl : `${remoteUrl}.git`
}

export function gitAuthFailureMessage(provider: Provider, auth: AuthMode = 'token', detail = ''): string {
  const needsToken = /token instead of a password|personal access token|two-factor|\b2FA\b/i.test(detail)
  if (provider === 'gitlab' && auth === 'password') {
    return 'GitLab 没有接受这对用户名和密码。网页登录密码不能用来同步时，请把个人访问令牌填在密码栏，用户名填仓库账号。令牌需要 read_repository 和 write_repository。'
  }
  if (needsToken || (provider === 'gitlab' && auth === 'token')) {
    return '认证失败。请检查个人访问令牌是否有效，并包含 read_repository 和 write_repository。'
  }
  if (auth === 'password') return '认证失败。请检查用户名和密码。'
  return '认证失败。请检查个人访问令牌是否有该仓库的读写权限。'
}
