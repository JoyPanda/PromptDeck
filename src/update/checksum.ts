export function formatChecksum(hash: string, fileName: string): string {
  return `${hash}  ${fileName}\n`
}

export function parseChecksum(text: string): string | null {
  const hash = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(hash)) return null
  return hash
}
