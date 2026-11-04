import { deflateSync } from 'node:zlib'

type Section = { va: number; span: number; raw: number; virtualSize: number; rawSize: number; headerOffset: number }

type ExeFile = {
  leaves: ResourceLeaf[]
  checksumOffset: number
  sections: Section[]
  rsrcSection: number
  directorySizeOffset: number
  sizeOfImage: number
}

export type IconImage = { width: number; height: number; bytes: Buffer }

const RT_ICON = 3
const RT_GROUP_ICON = 14
const RT_VERSION = 16

export function readIco(bytes: Buffer): IconImage[] {
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) throw new Error('不是图标文件')
  const count = bytes.readUInt16LE(4)
  const images: IconImage[] = []
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16
    const bytesInRes = bytes.readUInt32LE(at + 8)
    const offset = bytes.readUInt32LE(at + 12)
    images.push({
      width: bytes[at] || 256,
      height: bytes[at + 1] || 256,
      bytes: Buffer.from(bytes.subarray(offset, offset + bytesInRes)),
    })
  }
  return images
}

export function writeIco(images: IconImage[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  const parts: Buffer[] = [header]
  images.forEach((image, index) => {
    const at = 6 + index * 16
    header[at] = image.width >= 256 ? 0 : image.width
    header[at + 1] = image.height >= 256 ? 0 : image.height
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(image.bytes.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += image.bytes.length
    parts.push(image.bytes)
  })
  return Buffer.concat(parts)
}

// Bun's icon writer stores each image size in 16 bits. Larger images are truncated and Windows keeps Bun's default icon.
export function bunSafeIco(bytes: Buffer): Buffer {
  const images = readIco(bytes).filter((image) => image.bytes.length <= 65535)
  if (images.length === 0) throw new Error('图标没有能写入 exe 的尺寸')
  return writeIco(images)
}

export function groupIconResource(images: IconImage[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 14)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  images.forEach((image, index) => {
    const at = 6 + index * 14
    header[at] = image.width >= 256 ? 0 : image.width
    header[at + 1] = image.height >= 256 ? 0 : image.height
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(image.bytes.length, at + 8)
    header.writeUInt16LE(index + 1, at + 12)
  })
  return header
}

const ICON_BYTE_LIMIT = 65535

// Keep Bun's original resource layout. Rebuilding the section makes Windows refuse to start the exe.
export function installWindowsIcon(exe: Buffer, ico: Buffer): Buffer {
  const images = iconsWindowsCanLoad(readIco(ico))
  if (images.length === 0) throw new Error('图标没有能写入 exe 的尺寸')
  return writeIconImages(exe, images)
}

function iconsWindowsCanLoad(images: IconImage[]): IconImage[] {
  const usable = images.flatMap((image) => {
    if (image.bytes.length <= ICON_BYTE_LIMIT) return [image]
    const png = pngIcon(image)
    return png ? [{ width: image.width, height: image.height, bytes: png }] : []
  })
  return usable.sort((left, right) => left.width - right.width || left.bytes.length - right.bytes.length)
}

function pngIcon(image: IconImage): Buffer | null {
  const dib = image.bytes
  if (dib.length < 40 || dib.readUInt32LE(0) !== 40 || dib.readUInt16LE(14) !== 32 || dib.readUInt32LE(16) !== 0) return null
  const width = dib.readInt32LE(4)
  const storedHeight = dib.readInt32LE(8)
  const topDown = storedHeight < 0
  const height = Math.abs(storedHeight) / 2
  if (width !== image.width || height !== image.height || width < 1 || height < 1) return null
  const pixels = dib.subarray(40, 40 + width * height * 4)
  if (pixels.length !== width * height * 4) return null
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y
    const row = y * (1 + width * 4)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 4
      const target = row + 1 + x * 4
      raw[target] = pixels[source + 2] ?? 0
      raw[target + 1] = pixels[source + 1] ?? 0
      raw[target + 2] = pixels[source] ?? 0
      raw[target + 3] = pixels[source + 3] ?? 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return png.length <= ICON_BYTE_LIMIT ? png : null
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngCrc(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function pngCrc(buf: Buffer): number {
  let crc = ~0
  for (let index = 0; index < buf.length; index += 1) {
    crc ^= buf[index] ?? 0
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

// Bun's own icon is the named group IDI_MYICON. Writing icon id 1 adds a second group, and Explorer keeps the named one.
export function patchWindowsExeIcon(exe: Buffer, ico: Buffer): Buffer {
  const images = readIco(ico)
  if (images.length === 0) throw new Error('图标里没有图像')
  return writeIconImages(exe, images)
}

function writeIconImages(exe: Buffer, images: IconImage[]): Buffer {
  const out = Buffer.from(exe)
  const file = readExe(out)
  const groups = file.leaves.filter((leaf) => leaf.type === RT_GROUP_ICON)
  if (groups.length === 0) throw new Error('exe 里没有图标')
  let replaced = 0
  for (const group of groups) {
    const count = out.readUInt16LE(group.dataOffset + 4)
    if (count === 0 || group.dataOffset + 6 + count * 14 > group.dataOffset + group.size) throw new Error('exe 图标组已损坏')
    for (let index = 0; index < count; index += 1) {
      const at = group.dataOffset + 6 + index * 14
      const width = out[at] || 256
      const id = out.readUInt16LE(at + 12)
      const icon = file.leaves.find((leaf) => leaf.type === RT_ICON && leaf.name === id)
      if (!icon) throw new Error('exe 图标图像缺失')
      const image = pickIcon(images, icon.size, width)
      if (!image) throw new Error('图标比 exe 里的空位大')
      image.bytes.copy(out, icon.dataOffset)
      if (image.bytes.length < icon.size) out.fill(0, icon.dataOffset + image.bytes.length, icon.dataOffset + icon.size)
      out.writeUInt32LE(image.bytes.length, icon.entryOffset + 4)
      out[at] = image.width >= 256 ? 0 : image.width
      out[at + 1] = image.height >= 256 ? 0 : image.height
      out[at + 2] = 0
      out[at + 3] = 0
      out.writeUInt16LE(1, at + 4)
      out.writeUInt16LE(32, at + 6)
      out.writeUInt32LE(image.bytes.length, at + 8)
      replaced += 1
    }
  }
  if (replaced === 0) throw new Error('没有写入 exe 图标')
  writeChecksum(out, file.checksumOffset)
  return out
}

function pickIcon(images: IconImage[], slot: number, width: number): IconImage | null {
  const fits = images.filter((image) => image.bytes.length <= slot)
  return fits.find((image) => image.width === width) ?? fits.reduce<IconImage | null>((best, image) => {
    return !best || image.bytes.length > best.bytes.length ? image : best
  }, null)
}

type ResourceLeaf = { type: number; name: number | null; entryOffset: number; dataOffset: number; size: number }

function readExe(exe: Buffer): ExeFile {
  if (exe.length < 0x100 || exe.readUInt16LE(0) !== 0x5a4d) throw new Error('不是 Windows 可执行文件')
  const pe = exe.readUInt32LE(0x3c)
  if (pe + 24 > exe.length || exe.readUInt32LE(pe) !== 0x4550) throw new Error('不是 Windows 可执行文件')
  const coff = pe + 4
  const sections = exe.readUInt16LE(coff + 2)
  const optionalSize = exe.readUInt16LE(coff + 16)
  const optional = coff + 20
  const magic = exe.readUInt16LE(optional)
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('不是 Windows 可执行文件')
  if (optional + optionalSize + sections * 40 > exe.length) throw new Error('不是 Windows 可执行文件')
  const table = sectionTable(exe, optional + optionalSize, sections)
  const directories = magic === 0x20b ? optional + 112 : optional + 96
  const rsrcRva = exe.readUInt32LE(directories + 16)
  const rsrcSize = exe.readUInt32LE(directories + 20)
  if (rsrcRva === 0 || rsrcSize < 16) throw new Error('exe 里没有图标')
  const rsrcOff = rvaToOffset(table, rsrcRva)
  const leaves: ResourceLeaf[] = []
  walkResources(exe, table, rsrcOff, rsrcSize, rsrcOff, 0, 0, null, leaves)
  const rsrcSection = table.findIndex((section) => rsrcRva >= section.va && rsrcRva < section.va + section.span)
  return {
    leaves,
    checksumOffset: optional + 64,
    sections: table,
    rsrcSection,
    directorySizeOffset: directories + 20,
    sizeOfImage: exe.readUInt32LE(optional + 56),
  }
}

function sectionTable(exe: Buffer, at: number, count: number): Section[] {
  const sections: Section[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = at + index * 40
    const virtualSize = exe.readUInt32LE(offset + 8)
    const va = exe.readUInt32LE(offset + 12)
    const rawSize = exe.readUInt32LE(offset + 16)
    sections.push({
      va,
      span: Math.max(virtualSize, rawSize),
      raw: exe.readUInt32LE(offset + 20),
      virtualSize,
      rawSize,
      headerOffset: offset,
    })
  }
  return sections
}

function rvaToOffset(sections: Section[], rva: number): number {
  const section = sections.find((item) => rva >= item.va && rva < item.va + item.span)
  if (!section) throw new Error('exe 图标位置无效')
  return section.raw + (rva - section.va)
}

function walkResources(
  exe: Buffer,
  sections: Section[],
  rsrcOff: number,
  rsrcSize: number,
  dir: number,
  level: number,
  type: number,
  name: number | null,
  leaves: ResourceLeaf[],
) {
  if (dir < rsrcOff || dir + 16 > rsrcOff + rsrcSize) throw new Error('exe 图标位置无效')
  const count = exe.readUInt16LE(dir + 12) + exe.readUInt16LE(dir + 14)
  if (dir + 16 + count * 8 > rsrcOff + rsrcSize) throw new Error('exe 图标位置无效')
  for (let index = 0; index < count; index += 1) {
    const pos = dir + 16 + index * 8
    const nameField = exe.readUInt32LE(pos)
    const dataField = exe.readUInt32LE(pos + 4)
    const isDir = dataField >>> 31 === 1
    const rel = dataField & 0x7fffffff
    const numeric = nameField >>> 31 === 1 ? null : nameField
    if (level < 2) {
      if (!isDir) continue
      if (level === 0 && numeric === null) continue
      walkResources(exe, sections, rsrcOff, rsrcSize, rsrcOff + rel, level + 1, level === 0 ? numeric! : type, level === 0 ? null : numeric, leaves)
      continue
    }
    if (isDir) continue
    const entry = rsrcOff + rel
    if (entry + 16 > exe.length) throw new Error('exe 图标位置无效')
    const size = exe.readUInt32LE(entry + 4)
    const dataOffset = rvaToOffset(sections, exe.readUInt32LE(entry))
    if (size > exe.length || dataOffset + size > exe.length) throw new Error('exe 图标位置无效')
    leaves.push({ type, name, entryOffset: entry, dataOffset, size })
  }
}

const VERSION_NAMES = ['FileDescription', 'ProductName', 'InternalName', 'OriginalFilename', 'CompanyName'] as const

// Task Manager names a process from FileDescription. Bun's compiled exe still says "Bun", so the PromptDeck window looks like its child.
export function stampWindowsIdentity(exe: Buffer, options: { name: string; version: string }): Buffer {
  const out = Buffer.from(exe)
  const file = readExe(out)
  const version = file.leaves.find((leaf) => leaf.type === RT_VERSION)
  if (!version) throw new Error('exe 里没有版本信息')
  const current = out.subarray(version.dataOffset, version.dataOffset + version.size)
  const block = rebuildVersionInfo(current, options)
  const room = versionRoom(out, file, version)
  if (block.length > room) throw new Error('版本信息写不进 exe')
  block.copy(out, version.dataOffset)
  if (block.length < version.size) out.fill(0, version.dataOffset + block.length, version.dataOffset + version.size)
  out.writeUInt32LE(block.length, version.entryOffset + 4)
  const dataRva = out.readUInt32LE(version.entryOffset)
  const section = file.sections[file.rsrcSection]
  if (!section) throw new Error('exe 里没有版本信息')
  const virtualEnd = dataRva - section.va + block.length
  if (virtualEnd > section.virtualSize) {
    const next = file.sections.find((item) => item.va > section.va)
    const limit = next ? next.va - section.va : file.sizeOfImage - section.va
    if (virtualEnd > limit) throw new Error('版本信息写不进 exe')
    out.writeUInt32LE(virtualEnd, section.headerOffset + 8)
    if (virtualEnd > out.readUInt32LE(file.directorySizeOffset)) out.writeUInt32LE(virtualEnd, file.directorySizeOffset)
  }
  writeChecksum(out, file.checksumOffset)
  return out
}

export function windowsVersionStrings(exe: Buffer): Record<string, string> {
  const file = readExe(exe)
  const version = file.leaves.find((leaf) => leaf.type === RT_VERSION)
  if (!version) throw new Error('exe 里没有版本信息')
  return parseVersionInfo(exe.subarray(version.dataOffset, version.dataOffset + version.size)).strings
}

function versionRoom(exe: Buffer, file: ExeFile, version: ResourceLeaf): number {
  const section = file.sections[file.rsrcSection]
  if (!section) return version.size
  const dataRva = exe.readUInt32LE(version.entryOffset)
  const nextData = file.leaves.reduce((nearest, leaf) => leaf.dataOffset > version.dataOffset ? Math.min(nearest, leaf.dataOffset) : nearest, Number.POSITIVE_INFINITY)
  const rawRoom = Math.min(section.raw + section.rawSize, nextData) - version.dataOffset
  const next = file.sections.find((item) => item.va > section.va)
  const virtualLimit = (next ? next.va : file.sizeOfImage) - dataRva
  return Math.min(rawRoom, virtualLimit)
}

function rebuildVersionInfo(block: Buffer, options: { name: string; version: string }): Buffer {
  const parsed = parseVersionInfo(block)
  const fixed = Buffer.from(parsed.fixed)
  writeVersionQuad(fixed, 8, options.version)
  writeVersionQuad(fixed, 16, options.version)
  const values = new Map(Object.entries(parsed.strings))
  for (const key of VERSION_NAMES) {
    if (!values.has(key)) continue
    values.set(key, key === 'OriginalFilename' ? `${options.name}.exe` : options.name)
  }
  if (values.has('FileVersion')) values.set('FileVersion', options.version)
  if (values.has('ProductVersion')) values.set('ProductVersion', options.version)
  const strings = parsed.order.map((key) => versionString(key, values.get(key) ?? ''))
  const table = versionDirectory(parsed.tableKey, Buffer.concat(strings))
  const info = versionDirectory('StringFileInfo', table)
  const root = versionRoot(fixed, Buffer.concat([info, parsed.varFile]))
  return root
}

function parseVersionInfo(block: Buffer): { fixed: Buffer; tableKey: string; order: string[]; strings: Record<string, string>; varFile: Buffer } {
  if (readUtf16z(block, 6).text !== 'VS_VERSION_INFO') throw new Error('exe 版本信息无法识别')
  const valueLength = block.readUInt16LE(2)
  let cursor = alignUp(6 + utf16z('VS_VERSION_INFO').length)
  const fixed = Buffer.from(block.subarray(cursor, cursor + valueLength))
  if (fixed.length < 52 || fixed.readUInt32LE(0) !== 0xfeef04bd) throw new Error('exe 版本信息无法识别')
  cursor = alignUp(cursor + valueLength)
  const rootEnd = block.readUInt16LE(0)
  let tableKey = ''
  let order: string[] = []
  let strings: Record<string, string> = {}
  let varFile = Buffer.alloc(0)
  while (cursor + 6 <= rootEnd && cursor + 6 <= block.length) {
    const childLength = block.readUInt16LE(cursor)
    const childEnd = cursor + childLength
    if (childLength < 6 || childEnd > block.length) break
    const key = readUtf16z(block, cursor + 6).text
    if (key === 'StringFileInfo') {
      const parsed = parseStringFile(block.subarray(cursor, childEnd))
      tableKey = parsed.tableKey
      order = parsed.order
      strings = parsed.strings
    } else if (key === 'VarFileInfo') {
      varFile = Buffer.from(block.subarray(cursor, childEnd))
    }
    cursor = alignUp(childEnd)
  }
  if (!tableKey || order.length === 0) throw new Error('exe 版本信息无法识别')
  return { fixed, tableKey, order, strings, varFile }
}

function parseStringFile(block: Buffer): { tableKey: string; order: string[]; strings: Record<string, string> } {
  let cursor = alignUp(6 + utf16z('StringFileInfo').length)
  const end = block.readUInt16LE(0)
  const tableEnd = cursor + block.readUInt16LE(cursor)
  const tableKey = readUtf16z(block, cursor + 6).text
  cursor = alignUp(cursor + 6 + utf16z(tableKey).length)
  const order: string[] = []
  const strings: Record<string, string> = {}
  while (cursor + 6 <= tableEnd && cursor + 6 <= end && cursor + 6 <= block.length) {
    const childLength = block.readUInt16LE(cursor)
    const childEnd = cursor + childLength
    if (childLength < 6 || childEnd > block.length) break
    const valueLength = block.readUInt16LE(cursor + 2)
    const key = readUtf16z(block, cursor + 6).text
    const valueAt = alignUp(cursor + 6 + utf16z(key).length)
    strings[key] = readUtf16Count(block, valueAt, valueLength).replace(/\0$/, '')
    order.push(key)
    cursor = alignUp(childEnd)
  }
  return { tableKey, order, strings }
}

function versionRoot(fixed: Buffer, children: Buffer): Buffer {
  let body = Buffer.concat([Buffer.alloc(6), utf16z('VS_VERSION_INFO')])
  body = alignBuffer(body)
  body = Buffer.concat([body, fixed, children])
  body = alignBuffer(body)
  body.writeUInt16LE(body.length, 0)
  body.writeUInt16LE(fixed.length, 2)
  body.writeUInt16LE(0, 4)
  return body
}

function versionDirectory(key: string, children: Buffer): Buffer {
  let body = Buffer.concat([Buffer.alloc(6), utf16z(key)])
  body = alignBuffer(body)
  body = Buffer.concat([body, children])
  body = alignBuffer(body)
  body.writeUInt16LE(body.length, 0)
  body.writeUInt16LE(0, 2)
  body.writeUInt16LE(1, 4)
  return body
}

function versionString(key: string, value: string): Buffer {
  const text = utf16z(value)
  let body = Buffer.concat([Buffer.alloc(6), utf16z(key)])
  body = alignBuffer(body)
  body = Buffer.concat([body, text])
  body = alignBuffer(body)
  body.writeUInt16LE(body.length, 0)
  body.writeUInt16LE(text.length / 2, 2)
  body.writeUInt16LE(1, 4)
  return body
}

function writeVersionQuad(fixed: Buffer, at: number, version: string) {
  const parts = version.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new Error(`版本号 ${version} 不能写入 Windows 可执行文件`)
  }
  fixed.writeUInt16LE(parts[1] ?? 0, at)
  fixed.writeUInt16LE(parts[0] ?? 0, at + 2)
  fixed.writeUInt16LE(parts[3] ?? 0, at + 4)
  fixed.writeUInt16LE(parts[2] ?? 0, at + 6)
}

function utf16z(text: string): Buffer {
  return Buffer.from(`${text}\0`, 'utf16le')
}

function readUtf16z(buf: Buffer, offset: number): { text: string; next: number } {
  let cursor = offset
  let text = ''
  while (cursor + 1 < buf.length) {
    const code = buf.readUInt16LE(cursor)
    cursor += 2
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return { text, next: cursor }
}

function readUtf16Count(buf: Buffer, offset: number, count: number): string {
  let text = ''
  for (let index = 0; index < count && offset + 1 < buf.length; index += 1) {
    text += String.fromCharCode(buf.readUInt16LE(offset))
    offset += 2
  }
  return text
}

function alignUp(value: number): number {
  return (value + 3) & ~3
}

function alignBuffer(buf: Buffer): Buffer {
  const extra = (4 - (buf.length % 4)) % 4
  return extra === 0 ? buf : Buffer.concat([buf, Buffer.alloc(extra)])
}

function writeChecksum(exe: Buffer, checksumOffset: number) {
  exe.writeUInt32LE(0, checksumOffset)
  const count = exe.length >>> 1
  const words = exe.byteOffset === 0
    ? new Uint16Array(exe.buffer, exe.byteOffset, count)
    : new Uint16Array(exe.buffer.slice(exe.byteOffset, exe.byteOffset + count * 2))
  let sum = 0
  for (let index = 0; index < words.length; index += 1) {
    sum += words[index] ?? 0
    sum = (sum >>> 16) + (sum & 0xffff)
  }
  if (exe.length & 1) sum += exe[exe.length - 1] ?? 0
  sum = (sum >>> 16) + (sum & 0xffff)
  sum = (sum >>> 16) + (sum & 0xffff)
  sum += exe.length
  exe.writeUInt32LE(sum >>> 0, checksumOffset)
}
