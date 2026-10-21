import { describe, expect, test } from 'bun:test'
import { applySecretEdit, maskSecret } from './secret-field'

describe('applySecretEdit', () => {
  test('appends, inserts, and removes without revealing the stored value', () => {
    expect(maskSecret('abc')).toBe('***')
    expect(applySecretEdit('abc', '***d')).toBe('abcd')
    expect(applySecretEdit('abcd', '**X**')).toBe('abXcd')
    expect(applySecretEdit('abcd', '***')).toBe('abc')
    expect(applySecretEdit('abcd', 'hello')).toBe('hello')
    expect(applySecretEdit('a', '')).toBe('')
    expect(applySecretEdit('', 'p')).toBe('p')
  })
})