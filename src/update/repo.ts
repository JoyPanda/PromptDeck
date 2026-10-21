/** GitHub Releases 仓库。留空则不检查更新。 */
export const updateRepository = 'JoyPanda/PromptDeck'

export function parseUpdateRepository(value: string): { owner: string; name: string } | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  return { owner: match[1], name: match[2] }
}

export function releasesPageUrl(repository = updateRepository): string | null {
  const parsed = parseUpdateRepository(repository)
  if (!parsed) return null
  return `https://github.com/${parsed.owner}/${parsed.name}/releases`
}
