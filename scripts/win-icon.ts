type Section = { va: number; span: number; raw: number }

export type IconImage = { width: number; height: number; bytes: Buffer }

const RT_ICON = 3
const RT_GROUP_ICON = 14

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

// Bun's own icon is the named group IDI_MYICON. Writing icon id 1 adds a second group, and Explorer keeps the named one.
export function patchWindowsExeIcon(exe: Buffer, ico: Buffer): Buffer {
  const images = readIco(ico)
  if (images.length === 0) throw new Error('图标里没有图像')
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

function readExe(exe: Buffer): { leaves: ResourceLeaf[]; checksumOffset: number } {
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
  return { leaves, checksumOffset: optional + 64 }
}

function sectionTable(exe: Buffer, at: number, count: number): Section[] {
  const sections: Section[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = at + index * 40
    const virtualSize = exe.readUInt32LE(offset + 8)
    const va = exe.readUInt32LE(offset + 12)
    const rawSize = exe.readUInt32LE(offset + 16)
    sections.push({ va, span: Math.max(virtualSize, rawSize), raw: exe.readUInt32LE(offset + 20) })
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
