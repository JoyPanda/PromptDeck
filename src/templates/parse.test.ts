import { describe, expect, test } from 'bun:test'
import { blankTemplate, ensureSlots, filterTemplates, isTemplateDirty, introducedSlotNames, parseTemplate, reconcileSlots, removeSlotFromBody, renameSlotInBody, serializeTemplate, slugify, uniqueId, validateTemplate, type Template } from './parse'
import { renderPrompt } from './render'
import { listTemplates, saveTemplate } from './store'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const sample = `---
title: 代码审查
description: 审查一段代码并指出问题
slots:
  - name: language
    label: 编程语言
    placeholder: TypeScript
  - name: code
    label: 代码
    multiline: true
---

请用 {{language}} 审查下面的代码：

{{code}}
`

describe('parseTemplate', () => {
  test('reads frontmatter slots and body', () => {
    const template = parseTemplate('code-review', sample)
    expect(template).toEqual({
      id: 'code-review',
      title: '代码审查',
      description: '审查一段代码并指出问题',
      slots: [
        { name: 'language', label: '编程语言', kind: 'text', placeholder: 'TypeScript' },
        { name: 'code', label: '代码', kind: 'textarea' },
      ],
      body: '请用 {{language}} 审查下面的代码：\n\n{{code}}',
      favorite: false,
      tags: [],
      category: '',
      updatedAt: 0,
    })
  })

  test('reads an old multiline flag as a textarea', () => {
    const template = parseTemplate('code-review', sample)
    expect(template.slots[1]?.kind).toBe('textarea')
    expect(serializeTemplate(template)).not.toContain('multiline')
    expect(serializeTemplate(template)).toContain('kind: textarea')
  })

  test('treats a file without frontmatter as a body', () => {
    expect(parseTemplate('note', '只要这一段')).toEqual({
      id: 'note',
      title: 'note',
      description: '',
      slots: [],
      body: '只要这一段',
      favorite: false,
      tags: [],
      category: '',
      updatedAt: 0,
    })
  })

  test('ignores invalid frontmatter and keeps the body', () => {
    const template = parseTemplate('note', '---\n: [\n---\n正文')
    expect(template.title).toBe('note')
    expect(template.body).toBe('正文')
  })

  test('round-trips an updatedAt version', () => {
    const parsed = parseTemplate('code-review', sample)
    const stamped = { ...parsed, updatedAt: 1234 }
    expect(parseTemplate(stamped.id, serializeTemplate(stamped)).updatedAt).toBe(1234)
  })
})

describe('removeSlotFromBody', () => {
  test('drops the placeholder line and inline tokens', () => {
    expect(removeSlotFromBody('请用 {{language}} 审查下面的代码：\n\n{{code}}', 'code')).toBe('请用 {{language}} 审查下面的代码：')
    expect(removeSlotFromBody('请用 {{ language }} 审查下面的代码：\n\n{{code}}', 'language')).toBe('请用 审查下面的代码：\n\n{{code}}')
  })
})

describe('ensureSlots', () => {
  test('adds slots that appear only in the body', () => {
    const template = ensureSlots({
      id: 'draft',
      title: '草稿',
      description: '',
      slots: [{ name: 'language', label: '语言', kind: 'text' }],
      body: '{{language}} 和 {{audience}}',
      favorite: false,
      tags: [],
      category: '',
      updatedAt: 0,
    })
    expect(template.slots.map((slot) => slot.name)).toEqual(['language', 'audience'])
    expect(serializeTemplate(template)).toContain('name: audience')
  })
})

describe('renderPrompt', () => {
  test('replaces every occurrence and leaves unknown slots empty', () => {
    expect(renderPrompt('A {{name}} B {{ name }} C {{missing}}', { name: '林' })).toBe('A 林 B 林 C ')
  })
})

describe('ids', () => {
  test('slugifies ascii titles and falls back for chinese titles', () => {
    expect(slugify(' Code Review! ')).toBe('code-review')
    expect(slugify('代码审查')).toMatch(/^prompt-/)
  })

  test('avoids ids that already exist', () => {
    expect(uniqueId('Code Review', ['code-review', 'code-review-2'])).toBe('code-review-3')
  })

  test('blank templates get a stable slot', () => {
    const template = blankTemplate([])
    expect(template.slots[0]?.name).toBe('content')
    expect(validateTemplate(template)).toBeNull()
  })

  test('rejects duplicate slot names', () => {
    const template = blankTemplate([])
    template.slots.push({ name: 'content', label: '又一个', kind: 'text' })
    expect(validateTemplate(template)).toBe('槽位名重复：content')
  })
})

describe('isTemplateDirty', () => {
  test('ignores empty placeholder and implicit required text', () => {
    const saved = blankTemplate([])
    const draft: Template = { ...saved, slots: [{ ...saved.slots[0]!, placeholder: '', kind: 'textarea', required: true }] }
    expect(isTemplateDirty(saved, draft)).toBe(false)
    expect(isTemplateDirty(saved, { ...saved, title: '改过的标题' })).toBe(true)
    expect(isTemplateDirty(saved, { ...saved, favorite: true, tags: ['审查'], category: '工作' })).toBe(true)
  })
})

describe('library fields', () => {
  test('round-trips favorite, tags, category, and select options', () => {
    const markdown = `---
title: 周报
description: 写一份周报
favorite: true
category: 工作
tags:
  - 周报
  - 总结
slots:
  - name: tone
    label: 语气
    kind: select
    options:
      - 正式
      - 轻松
    defaultValue: 正式
    required: false
---

用{{tone}}来写。
`
    const parsed = parseTemplate('weekly', markdown)
    expect(parsed.favorite).toBe(true)
    expect(parsed.category).toBe('工作')
    expect(parsed.tags).toEqual(['周报', '总结'])
    expect(parsed.slots[0]).toEqual({
      name: 'tone',
      label: '语气',
      kind: 'select',
      options: ['正式', '轻松'],
      defaultValue: '正式',
      required: false,
    })
    expect(parseTemplate(parsed.id, serializeTemplate(parsed))).toEqual(parsed)
  })
})

describe('reconcileSlots', () => {
  test('appends new placeholders and keeps unused slots', () => {
    const template = base({
      slots: [{ name: 'language', label: '语言', kind: 'select', options: ['TypeScript'] }],
      body: '{{audience}}',
    })
    const next = reconcileSlots(template)
    expect(next.slots.map((slot) => slot.name)).toEqual(['language', 'audience'])
    expect(next.slots[0]?.options).toEqual(['TypeScript'])
    expect(next.slots[1]).toEqual({ name: 'audience', label: 'audience', kind: 'text' })
  })

  test('renames every placeholder in the body', () => {
    expect(renameSlotInBody('{{language}} 和 {{ language }}', 'language', 'lang')).toBe('{{lang}} 和 {{lang}}')
  })

  test('adds one slot when the same placeholder is pasted twice', () => {
    const next = reconcileSlots(base({ slots: [], body: '{{model}}{{model}}' }))
    expect(next.slots.map((slot) => slot.name)).toEqual(['model'])
  })

  test('typing a placeholder only adds it when the closing braces land', () => {
    let template = base({ slots: [], body: '' })
    for (const body of ['{', '{{', '{{m', '{{mo', '{{mod', '{{mode', '{{model', '{{model}', '{{model}}']) {
      template = reconcileSlots({ ...template, body }, template.body)
    }
    expect(template.slots.map((slot) => slot.name)).toEqual(['model'])
  })

  test('editing inside braces does not add a slot for each intermediate name', () => {
    let template = base({ slots: [{ name: 'model', label: '模型', kind: 'text' }], body: '{{model}}' })
    for (const body of ['{{mode}}', '{{mod}}', '{{mo}}', '{{m}}', '{{t}}', '{{to}}', '{{ton}}', '{{tone}}']) {
      template = reconcileSlots({ ...template, body }, template.body)
    }
    expect(template.slots.map((slot) => slot.name)).toEqual(['model'])
    expect(introducedSlotNames('{{model}}{{model}}', '{{model}}{{model}}{{tone}}')).toEqual(['tone'])
  })

  test('replacing an untouched placeholder keeps a single slot', () => {
    let template = reconcileSlots(base({ slots: [], body: '{{p}}' }), '')
    expect(template.slots.map((slot) => slot.name)).toEqual(['p'])
    template = reconcileSlots({ ...template, body: '{{}}' }, '{{p}}')
    expect(template.slots).toEqual([])
    template = reconcileSlots({ ...template, body: '{{u}}' }, '{{}}')
    expect(template.slots.map((slot) => slot.name)).toEqual(['u'])
    const replaced = reconcileSlots(base({ slots: [{ name: 'p', label: 'p', kind: 'text' }], body: '{{u}}' }), '{{p}}')
    expect(replaced.slots.map((slot) => slot.name)).toEqual(['u'])
  })

  test('an untouched slot follows the name being edited', () => {
    let template = base({ slots: [{ name: 'model', label: 'model', kind: 'text' }], body: '{{model}}' })
    for (const body of ['{{mode}}', '{{mod}}', '{{mo}}', '{{m}}', '{{t}}', '{{to}}', '{{ton}}', '{{tone}}']) {
      template = reconcileSlots({ ...template, body }, template.body)
      expect(template.slots).toHaveLength(1)
    }
    expect(template.slots.map((slot) => slot.name)).toEqual(['tone'])
  })
})

describe('filterTemplates', () => {
  test('keeps favorites and matches tags', () => {
    const favorite = base({ id: 'fav', title: '收藏的', favorite: true, tags: ['审查'], category: '工作', updatedAt: 2 })
    const other = base({ id: 'other', title: '普通', tags: ['笔记'], category: '生活', updatedAt: 5 })
    const visible = filterTemplates([other, favorite], { text: '审查', favoriteOnly: true, category: '', sort: 'updated', useCounts: {} })
    expect(visible.map((item) => item.id)).toEqual(['fav'])
  })
})

function base(patch: Partial<Template>): Template {
  return {
    id: 'draft',
    title: '草稿',
    description: '',
    slots: [],
    body: '',
    favorite: false,
    tags: [],
    category: '',
    updatedAt: 0,
    ...patch,
  }
}

describe('store', () => {
  test('writes and lists markdown templates', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'promptdeck-store-'))
    try {
      const template = parseTemplate('code-review', sample)
      await saveTemplate(dir, template)
      expect(await listTemplates(dir)).toEqual([template])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
