// ============================================================================
// src/render/vectorPage.ts — composing several recorded figures onto ONE page.
//
// A worksheet is a page of figures. Each figure is already a display list
// (src/ui/vectorExport.ts recordScene: the export composition of one board),
// so a page is built by PLACING those lists — every coordinate, radius, stroke
// width, dash and font size mapped through one uniform scale and a translation
// — inside a clip rect for the cell, and then adding the page's own text
// (title, name/date line, the (a)(b)(c) labels, the captions) as ordinary text
// items. The result is an ordinary DisplayList, so every writer that already
// exists takes it unchanged: the PDF writer for the file, the SVG writer for
// the on-screen preview, and replayList() below for a PNG.
//
// Units are whatever the page says they are. The worksheet builds its pages in
// POINTS (1/72 in) and hands the PDF writer ptPerPx = 1.
// ============================================================================

import { textWidthEstimate } from './fontMetrics'
import type { ClipNode, DisplayItem, DisplayList, FontSpec, Rgba, Seg } from './vectorCtx'
import { arcToBeziers, clipChain } from './vectorCtx'

/** An empty page of the given size. */
export function emptyPage(width: number, height: number): DisplayList {
  return { width, height, items: [], clips: [] }
}

export interface Placement {
  /** Where the source list's origin lands on the page. */
  x: number
  y: number
  /** Uniform scale from source units to page units. */
  scale: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const rectSegs = (r: Rect): Seg[] => [
  { k: 'M', x: r.x, y: r.y },
  { k: 'L', x: r.x + r.w, y: r.y },
  { k: 'L', x: r.x + r.w, y: r.y + r.h },
  { k: 'L', x: r.x, y: r.y + r.h },
  { k: 'Z' },
]

/** Map one segment through a uniform scale and a translation. */
export function placeSeg(s: Seg, t: Placement): Seg {
  const X = (x: number): number => t.x + x * t.scale
  const Y = (y: number): number => t.y + y * t.scale
  switch (s.k) {
    case 'M':
    case 'L':
      return { k: s.k, x: X(s.x), y: Y(s.y) }
    case 'C':
      return { k: 'C', x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), x: X(s.x), y: Y(s.y) }
    case 'A':
      // A uniform scale keeps a circle a circle, and the angles are unchanged.
      return { k: 'A', cx: X(s.cx), cy: Y(s.cy), r: s.r * t.scale, a0: s.a0, sweep: s.sweep, x: X(s.x), y: Y(s.y) }
    case 'Z':
      return { k: 'Z' }
  }
}

/** Add a clip rect to the page, inside `parent` (0 = none). Returns its id. */
export function addClip(page: DisplayList, rect: Rect, parent = 0): number {
  const id = page.clips.length + 1
  page.clips.push({ id, parent, segs: rectSegs(rect) })
  return id
}

/**
 * Append `src` to `page`, placed by `t`. Every clip of the source is copied
 * under a new id; the source's outermost clips sit inside `within` (a clip
 * already on the page, typically the cell), so nothing a figure draws can
 * spill into its neighbour.
 */
export function placeList(page: DisplayList, src: DisplayList, t: Placement, within = 0): void {
  const offset = page.clips.length
  const mapId = (id: number): number => (id > 0 ? id + offset : within)
  for (const c of src.clips) {
    const node: ClipNode = {
      id: c.id + offset,
      parent: mapId(c.parent),
      segs: c.segs.map((s) => placeSeg(s, t)),
    }
    page.clips.push(node)
  }
  for (const it of src.items) {
    page.items.push(placeItem(it, t, mapId(it.clip)))
  }
}

function placeItem(it: DisplayItem, t: Placement, clip: number): DisplayItem {
  if (it.t === 'path') {
    return {
      t: 'path',
      segs: it.segs.map((s) => placeSeg(s, t)),
      fill: it.fill ? { ...it.fill } : null,
      stroke: it.stroke
        ? {
            ...it.stroke,
            color: { ...it.stroke.color },
            width: it.stroke.width * t.scale,
            dash: it.stroke.dash.map((d) => d * t.scale),
            dashOffset: it.stroke.dashOffset * t.scale,
          }
        : null,
      clip,
    }
  }
  return {
    ...it,
    x: t.x + it.x * t.scale,
    y: t.y + it.y * t.scale,
    font: { ...it.font, size: it.font.size * t.scale },
    color: { ...it.color },
    width: it.width * t.scale,
    clip,
  }
}

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
export const GREY: Rgba = { r: 90, g: 90, b: 90, a: 1 }

export interface TextOpts {
  size: number
  bold?: boolean
  italic?: boolean
  anchor?: 'start' | 'middle' | 'end'
  color?: Rgba
  generic?: FontSpec['generic']
  clip?: number
}

/** The width a label will take, by the standard fonts' own metrics. */
export function measure(text: string, o: TextOpts): number {
  return textWidthEstimate(text, o.generic ?? 'serif', o.bold === true) * o.size
}

/** Append one line of text, baseline at y. */
export function addText(page: DisplayList, text: string, x: number, y: number, o: TextOpts): void {
  const generic = o.generic ?? 'serif'
  const family = generic === 'serif' ? 'Times New Roman, Times, serif' : generic === 'monospace' ? 'monospace' : 'Helvetica, Arial, sans-serif'
  page.items.push({
    t: 'text',
    text,
    x,
    y,
    anchor: o.anchor ?? 'start',
    font: { family, generic, size: o.size, italic: o.italic === true, bold: o.bold === true },
    color: o.color ?? BLACK,
    width: measure(text, o),
    clip: o.clip ?? 0,
  })
}

/** Append a filled rectangle (a page's white ground, a cell's background). */
export function addRect(page: DisplayList, r: Rect, fill: Rgba, clip = 0): void {
  page.items.push({ t: 'path', segs: rectSegs(r), fill, stroke: null, clip })
}

/** Append a straight stroked line. */
export function addLine(
  page: DisplayList,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: Rgba = BLACK,
): void {
  page.items.push({
    t: 'path',
    segs: [
      { k: 'M', x: x0, y: y0 },
      { k: 'L', x: x1, y: y1 },
    ],
    fill: null,
    stroke: { color, width, cap: 'butt', join: 'miter', miter: 10, dash: [], dashOffset: 0 },
    clip: 0,
  })
}

/**
 * Break `text` into lines no wider than `width`, at spaces; at most `maxLines`
 * (the last one ends in "…" when the text did not fit).
 */
export function wrapText(text: string, width: number, o: TextOpts, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && measure(next, o) > width) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = `${kept[maxLines - 1]}…`
  while (last.length > 1 && measure(last, o) > width) last = `${last.slice(0, -2)}…`
  kept[maxLines - 1] = last
  return kept
}

// ---------------------------------------------------------------------------
// Replay onto a real canvas (the PNG of a page)
// ---------------------------------------------------------------------------

const css = (c: Rgba): string => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${c.a})`

function tracePath(ctx: CanvasRenderingContext2D, segs: readonly Seg[]): void {
  ctx.beginPath()
  for (const s of segs) {
    switch (s.k) {
      case 'M': ctx.moveTo(s.x, s.y); break
      case 'L': ctx.lineTo(s.x, s.y); break
      case 'C': ctx.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y); break
      case 'A':
        for (const b of arcToBeziers(s.cx, s.cy, s.r, s.a0, s.sweep)) {
          ctx.bezierCurveTo(b[0], b[1], b[2], b[3], b[4], b[5])
        }
        break
      case 'Z': ctx.closePath(); break
    }
  }
}

/**
 * Draw a display list onto a canvas context at `scale` device pixels per
 * list unit — the inverse of the recorder, so a page composed for the PDF is
 * also the PNG, pixel for pixel the same layout.
 */
export function replayList(ctx: CanvasRenderingContext2D, list: DisplayList, scale: number): void {
  let open: number[] = []
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  for (const it of list.items) {
    const chain = clipChain(list, it.clip)
    let keep = 0
    while (keep < open.length && keep < chain.length && open[keep] === chain[keep]) keep++
    while (open.length > keep) {
      ctx.restore()
      open.pop()
    }
    for (let i = keep; i < chain.length; i++) {
      ctx.save()
      tracePath(ctx, list.clips[chain[i] - 1].segs)
      ctx.clip()
      open.push(chain[i])
    }
    if (it.t === 'path') {
      tracePath(ctx, it.segs)
      if (it.fill) {
        ctx.fillStyle = css(it.fill)
        ctx.fill()
      }
      const s = it.stroke
      if (s) {
        ctx.strokeStyle = css(s.color)
        ctx.lineWidth = s.width
        ctx.lineCap = s.cap
        ctx.lineJoin = s.join
        ctx.miterLimit = s.miter
        ctx.setLineDash(s.dash)
        ctx.lineDashOffset = s.dashOffset
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      const f = it.font
      ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.family}`
      ctx.fillStyle = css(it.color)
      ctx.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(it.text, it.x, it.y)
    }
  }
  while (open.length > 0) {
    ctx.restore()
    open = open.slice(0, -1)
  }
  ctx.restore()
}
