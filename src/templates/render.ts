import { slotPattern } from './parse'

export function renderPrompt(body: string, values: Record<string, string>): string {
  return body.replace(slotPattern(), (_match, name: string) => values[name] ?? '')
}
