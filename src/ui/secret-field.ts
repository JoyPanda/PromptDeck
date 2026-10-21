const MASK = '*'

export function maskSecret(value: string): string {
  return MASK.repeat(value.length)
}

export function applySecretEdit(secret: string, next: string): string {
  if (next === maskSecret(secret)) return secret
  let prefix = 0
  const limit = Math.min(secret.length, next.length)
  while (prefix < limit && next[prefix] === MASK) prefix += 1
  let secretEnd = secret.length
  let nextEnd = next.length
  while (secretEnd > prefix && nextEnd > prefix && next[nextEnd - 1] === MASK) {
    secretEnd -= 1
    nextEnd -= 1
  }
  const inserted = [...next.slice(prefix, nextEnd)].filter((char) => char !== MASK).join('')
  return secret.slice(0, prefix) + inserted + secret.slice(secretEnd)
}
