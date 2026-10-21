import { describe, expect, test } from 'bun:test'
import { blankTemplate, type Template } from './parse'
import { reconcileLibrary, overlayLocalTemplates, type LibrarySnapshot } from './library'

function template(id: string, updatedAt: number, body: string): Template {
  return { ...blankTemplate([]), id, title: id, body, updatedAt }
}

function library(templates: Template[] = [], tombstones: LibrarySnapshot['tombstones'] = []): LibrarySnapshot {
  return { templates, tombstones }
}

describe('reconcileLibrary', () => {
  test('removes a template the other device deleted when this device has not edited it', () => {
    const note = template('note', 100, '原文')
    const result = reconcileLibrary(library([note]), library([], [{ id: 'note', deletedAt: 200 }]))
    expect(result.templates).toEqual([])
    expect(result.tombstones).toEqual([{ id: 'note', deletedAt: 200 }])
  })

  test('keeps a newer local edit over a remote deletion', () => {
    const note = template('note', 300, '后来改的')
    const result = reconcileLibrary(library([note]), library([], [{ id: 'note', deletedAt: 200 }]))
    expect(result.templates.map((item) => item.body)).toEqual(['后来改的'])
    expect(result.tombstones).toEqual([])
  })

  test('takes the newer edit from either device', () => {
    const older = template('note', 100, '旧')
    const newer = template('note', 250, '新')
    expect(reconcileLibrary(library([older]), library([newer])).templates[0]?.body).toBe('新')
    expect(reconcileLibrary(library([newer]), library([older])).templates[0]?.body).toBe('新')
  })

  test('prefers a deletion when the timestamps are equal', () => {
    const note = template('note', 100, '原文')
    const result = reconcileLibrary(library([note]), library([], [{ id: 'note', deletedAt: 100 }]))
    expect(result.templates).toEqual([])
    expect(result.tombstones).toEqual([{ id: 'note', deletedAt: 100 }])
  })

  test('keeps an unversioned local template when nothing deleted it', () => {
    const note = template('note', 0, '原文')
    const result = overlayLocalTemplates(library([note]), [])
    expect(result.templates.map((item) => item.id)).toEqual(['note'])
  })
})
