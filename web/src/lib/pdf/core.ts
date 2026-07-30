import { PDFDocument, degrees, rgb, StandardFonts, PageSizes } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'

export type OutFile = {
  name: string
  bytes: Uint8Array
  mime?: string
}

export async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function loadPdf(file: File | ArrayBuffer) {
  const data = file instanceof File ? await file.arrayBuffer() : file
  return PDFDocument.load(data.slice(0), { ignoreEncryption: true })
}

export function downloadFiles(files: OutFile[]) {
  for (const f of files) {
    const copy = new Uint8Array(f.bytes)
    const blob = new Blob([copy.buffer], {
      type: f.mime || 'application/pdf',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** Parse "1-3,5,7-9" into 0-based indices. Empty = all pages. */
export function parsePageRange(range: string, pageCount: number): number[] {
  const trimmed = range.trim()
  if (!trimmed) {
    return Array.from({ length: pageCount }, (_, i) => i)
  }
  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const p = part.trim()
    if (!p) continue
    if (p.includes('-')) {
      const [a, b] = p.split('-').map((n) => parseInt(n.trim(), 10))
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const start = Math.max(1, Math.min(a, b))
      const end = Math.min(pageCount, Math.max(a, b))
      for (let i = start; i <= end; i++) pages.add(i - 1)
    } else {
      const n = parseInt(p, 10)
      if (Number.isFinite(n) && n >= 1 && n <= pageCount) pages.add(n - 1)
    }
  }
  return [...pages].sort((x, y) => x - y)
}

export function stem(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'document'
}

export async function copyPagesToNew(
  src: PDFDocument,
  indices: number[],
): Promise<PDFDocument> {
  const out = await PDFDocument.create()
  if (indices.length === 0) return out
  const pages = await out.copyPages(src, indices)
  pages.forEach((p) => out.addPage(p))
  return out
}

export async function renderPageToJpeg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  pageIndex: number,
  scale = 1.5,
  quality = 0.85,
): Promise<Uint8Array> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const bin = atob(dataUrl.split(',')[1]!)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function imagesToPdf(files: File[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const name = file.name.toLowerCase()
    let img
    try {
      if (file.type.includes('png') || name.endsWith('.png')) {
        img = await doc.embedPng(bytes)
      } else {
        img = await doc.embedJpg(bytes)
      }
    } catch {
      continue
    }
    const page = doc.addPage([img.width, img.height])
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: img.width,
      height: img.height,
    })
  }
  if (doc.getPageCount() === 0) {
    throw new Error('No supported images (use JPG or PNG)')
  }
  return doc.save()
}

export async function pdfToImages(
  file: File,
  format: 'jpeg' | 'png' = 'jpeg',
  scale = 1.5,
): Promise<OutFile[]> {
  const pdfjs = await getPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const out: OutFile[] = []
  const base = stem(file.name)
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    const dataUrl = canvas.toDataURL(mime, 0.92)
    const bin = atob(dataUrl.split(',')[1]!)
    const bytes = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
    const ext = format === 'png' ? 'png' : 'jpg'
    out.push({
      name: `${base}-page-${i + 1}.${ext}`,
      bytes,
      mime,
    })
  }
  return out
}

export async function rotatePdf(
  file: File,
  angle: number,
  range: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const indices = parsePageRange(range, doc.getPageCount())
  for (const i of indices) {
    const page = doc.getPage(i)
    const current = page.getRotation().angle
    page.setRotation(degrees((current + angle + 360) % 360))
  }
  return doc.save()
}

export async function deletePages(
  file: File,
  range: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const remove = new Set(parsePageRange(range, doc.getPageCount()))
  if (remove.size === 0) throw new Error('Specify pages to delete (e.g. 2,4-6)')
  const keep = Array.from({ length: doc.getPageCount() }, (_, i) => i).filter(
    (i) => !remove.has(i),
  )
  if (keep.length === 0) throw new Error('Cannot delete every page')
  const out = await copyPagesToNew(doc, keep)
  return out.save()
}

export async function extractPages(
  file: File,
  range: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const indices = parsePageRange(range, doc.getPageCount())
  if (indices.length === 0) throw new Error('No pages matched the range')
  const out = await copyPagesToNew(doc, indices)
  return out.save()
}

export async function reversePages(file: File): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const n = doc.getPageCount()
  const indices = Array.from({ length: n }, (_, i) => n - 1 - i)
  const out = await copyPagesToNew(doc, indices)
  return out.save()
}

export async function addBlankPage(
  file: File,
  afterPage: number,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const count = doc.getPageCount()
  const ref =
    count > 0
      ? doc.getPage(Math.min(Math.max(afterPage, 1), count) - 1)
      : null
  const size = ref
    ? [ref.getWidth(), ref.getHeight()]
    : ([...PageSizes.Letter] as [number, number])
  const insertAt = Math.min(Math.max(afterPage, 0), count)
  // Rebuild with blank inserted
  const out = await PDFDocument.create()
  for (let i = 0; i < count; i++) {
    if (i === insertAt) {
      out.addPage(size as [number, number])
    }
    const [p] = await out.copyPages(doc, [i])
    out.addPage(p)
  }
  if (insertAt >= count) {
    out.addPage(size as [number, number])
  }
  return out.save()
}

export async function mergePdfs(
  files: File[],
  ranges: string[] = [],
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    const src = await loadPdf(files[i]!)
    const indices = parsePageRange(ranges[i] || '', src.getPageCount())
    if (indices.length === 0) continue
    const pages = await out.copyPages(src, indices)
    pages.forEach((p) => out.addPage(p))
  }
  if (out.getPageCount() === 0) throw new Error('No pages to merge')
  return out.save()
}

export async function splitEachPage(file: File): Promise<OutFile[]> {
  const doc = await loadPdf(file)
  const base = stem(file.name)
  const out: OutFile[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const single = await copyPagesToNew(doc, [i])
    out.push({ name: `${base}-page-${i + 1}.pdf`, bytes: await single.save() })
  }
  return out
}

export async function compressPdfRaster(
  file: File,
  quality = 0.65,
  scale = 1.25,
): Promise<Uint8Array> {
  const pdfjs = await getPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const out = await PDFDocument.create()
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const bin = atob(dataUrl.split(',')[1]!)
    const bytes = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
    const img = await out.embedJpg(bytes)
    const p = out.addPage([img.width, img.height])
    p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  return out.save()
}

export async function watermarkPdf(
  file: File,
  text: string,
  opacity = 0.25,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const size = Math.min(width, height) * 0.08
    page.drawText(text || 'WATERMARK', {
      x: width * 0.2,
      y: height * 0.45,
      size,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      rotate: degrees(35),
    })
  }
  return doc.save()
}

export async function pageNumbersPdf(
  file: File,
  format = 'n',
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const total = doc.getPageCount()
  doc.getPages().forEach((page: PDFPage, i: number) => {
    const { width } = page.getSize()
    const label =
      format === 'n/N' ? `${i + 1} / ${total}` : String(i + 1)
    const textWidth = font.widthOfTextAtSize(label, 10)
    page.drawText(label, {
      x: (width - textWidth) / 2,
      y: 24,
      size: 10,
      font,
      color: rgb(0.2, 0.2, 0.2),
    })
  })
  return doc.save()
}

export async function headerFooterPdf(
  file: File,
  header: string,
  footer: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    if (header.trim()) {
      page.drawText(header, {
        x: 40,
        y: height - 28,
        size: 10,
        font,
        color: rgb(0.25, 0.25, 0.25),
      })
    }
    if (footer.trim()) {
      page.drawText(footer, {
        x: 40,
        y: 20,
        size: 10,
        font,
        color: rgb(0.25, 0.25, 0.25),
      })
    }
  }
  return doc.save()
}

export async function flattenForm(file: File): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  const form = doc.getForm()
  try {
    form.flatten()
  } catch {
    // no form fields
  }
  return doc.save()
}

export async function removeMetadata(file: File): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  doc.setTitle('')
  doc.setAuthor('')
  doc.setSubject('')
  doc.setKeywords([])
  doc.setProducer('')
  doc.setCreator('')
  return doc.save()
}

export async function setMetadata(
  file: File,
  meta: { title?: string; author?: string; subject?: string },
): Promise<Uint8Array> {
  const doc = await loadPdf(file)
  if (meta.title != null) doc.setTitle(meta.title)
  if (meta.author != null) doc.setAuthor(meta.author)
  if (meta.subject != null) doc.setSubject(meta.subject)
  return doc.save()
}

export async function textToPdf(text: string, filename = 'text.pdf') {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const margin = 50
  const fontSize = 11
  const lineHeight = 14
  const pageWidth = PageSizes.Letter[0]
  const pageHeight = PageSizes.Letter[1]
  const maxWidth = pageWidth - margin * 2
  const words = text.replace(/\r\n/g, '\n').split(/(\s+)/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if (w === '\n') {
      lines.push(current)
      current = ''
      continue
    }
    const trial = current + w
    if (font.widthOfTextAtSize(trial, fontSize) > maxWidth && current) {
      lines.push(current)
      current = w.trimStart()
    } else {
      current = trial
    }
  }
  if (current) lines.push(current)

  let page = doc.addPage(PageSizes.Letter)
  let y = pageHeight - margin
  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage(PageSizes.Letter)
      y = pageHeight - margin
    }
    page.drawText(line, { x: margin, y, size: fontSize, font })
    y -= lineHeight
  }
  return { name: filename, bytes: await doc.save() } satisfies OutFile
}

export async function invertPdfColors(file: File): Promise<Uint8Array> {
  const pdfjs = await getPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const out = await PDFDocument.create()
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imgData.data
    for (let p = 0; p < d.length; p += 4) {
      d[p] = 255 - d[p]!
      d[p + 1] = 255 - d[p + 1]!
      d[p + 2] = 255 - d[p + 2]!
    }
    ctx.putImageData(imgData, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const bin = atob(dataUrl.split(',')[1]!)
    const bytes = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
    const img = await out.embedJpg(bytes)
    const pg = out.addPage([img.width, img.height])
    pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  return out.save()
}

export async function greyscalePdf(file: File): Promise<Uint8Array> {
  const pdfjs = await getPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const out = await PDFDocument.create()
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imgData.data
    for (let p = 0; p < d.length; p += 4) {
      const g = 0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!
      d[p] = d[p + 1] = d[p + 2] = g
    }
    ctx.putImageData(imgData, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const bin = atob(dataUrl.split(',')[1]!)
    const bytes = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
    const img = await out.embedJpg(bytes)
    const pg = out.addPage([img.width, img.height])
    pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  return out.save()
}

export async function nUpPdf(file: File, n: 2 | 4 = 4): Promise<Uint8Array> {
  const src = await loadPdf(file)
  const count = src.getPageCount()
  const cols = n === 2 ? 2 : 2
  const rows = n === 2 ? 1 : 2
  const cellW = PageSizes.Letter[0] / cols
  const cellH = PageSizes.Letter[1] / rows
  const final = await PDFDocument.create()
  for (let i = 0; i < count; i += n) {
    const sheet = final.addPage(PageSizes.Letter)
    for (let k = 0; k < n && i + k < count; k++) {
      const emb = await final.embedPage(src.getPage(i + k))
      const col = k % cols
      const row = Math.floor(k / cols)
      const scale = Math.min(cellW / emb.width, cellH / emb.height) * 0.92
      const w = emb.width * scale
      const h = emb.height * scale
      const x = col * cellW + (cellW - w) / 2
      const y = (rows - 1 - row) * cellH + (cellH - h) / 2
      sheet.drawPage(emb, { x, y, width: w, height: h })
    }
  }
  return final.save()
}

export async function splitInHalf(file: File): Promise<Uint8Array> {
  const src = await loadPdf(file)
  const out = await PDFDocument.create()
  for (let i = 0; i < src.getPageCount(); i++) {
    const page = src.getPage(i)
    const w = page.getWidth()
    const h = page.getHeight()
    const emb = await out.embedPage(page)
    const left = out.addPage([w / 2, h])
    left.drawPage(emb, { x: 0, y: 0, width: w, height: h })
    const right = out.addPage([w / 2, h])
    right.drawPage(emb, { x: -w / 2, y: 0, width: w, height: h })
  }
  return out.save()
}

export async function alternateMerge(files: File[]): Promise<Uint8Array> {
  if (files.length < 2) throw new Error('Need at least 2 PDFs')
  const docs = await Promise.all(files.map((f) => loadPdf(f)))
  const max = Math.max(...docs.map((d) => d.getPageCount()))
  const out = await PDFDocument.create()
  for (let i = 0; i < max; i++) {
    for (const doc of docs) {
      if (i < doc.getPageCount()) {
        const [p] = await out.copyPages(doc, [i])
        out.addPage(p)
      }
    }
  }
  return out.save()
}
