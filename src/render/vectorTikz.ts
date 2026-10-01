// ============================================================================
// src/render/vectorTikz.ts — a recorded board as a TikZ picture.
//
// A literal translation of the display list — every rule, tick, curve, dot and
// label the canvas drew — so it is the PNG, as editable vector commands, at
// the physical size the teacher asked for. It needs nothing beyond
// \usepackage{tikz} (which loads xcolor) and compiles under plain pdflatex:
// no TikZ libraries, colours as \definecolor{…}{HTML}{…}, coordinates in pt
// with the picture's own units set to 1pt.
//
//   \fill / \draw / \filldraw  with fill=, draw=, line width=, dash pattern=,
//                              line cap=, line join=, fill/draw opacity=
//   arcs                       arc[start angle=…, end angle=…, radius=…]
//   clips                      \begin{scope} \clip …; … \end{scope}
//   labels                     \node[anchor=base west|base|base east] at (x,y)
//                              {…}; at the renderer's own size and face, with
//                              mathematics in $…$ (see ./texText.ts)
//
// NO DIMENSION TOO LARGE. TeX cannot hold a length past 16383.99998pt, and a
// single far-off coordinate (a guide line to tan⁻¹(1000), a near-vertical
// branch) stops pdflatex with "Dimension too large". So the picture's bounding
// box is pinned to the figure, and every path is first cut to a padded box
// around it (lines and polygons exactly — Liang–Barsky for strokes,
// Sutherland–Hodgman for fills; curves and arcs, which the renderer only
// draws near the view, are clamped as a last resort), and a label placed far
// outside it is dropped. What is visible is unchanged.
// ============================================================================

import type { DisplayList, PathItem, Rgba, Seg, TextItem } from './vectorCtx'
import { clipChain } from './vectorCtx'
import { cssHex, num } from './vectorSvg'
import { texLabel } from './texText'
import { PT_PER_PX } from './vectorPdf'

export interface TikzOptions {
  /** Points per device unit; default 0.75 (CSS px → pt). */
  ptPerPx?: number
  /** A line for the header comment (the document or figure name). */
  title?: string
}

const CAP = { butt: 'butt', round: 'round', square: 'rect' } as const

/** The largest |coordinate| written, in pt — safely inside TeX's 16383.99998pt. */
export const TIKZ_MAX_PT = 16000

/** A box in device units. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const inBox = (b: Box, x: number, y: number): boolean => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1

/** The part of segment a→b inside the box (Liang–Barsky), or null. */
export function clipSegment(
  b: Box,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number, number, number] | null {
  if (![ax, ay, bx, by].every(Number.isFinite)) return null
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, ax - b.x0],
    [dx, b.x1 - ax],
    [-dy, ay - b.y0],
    [dy, b.y1 - ay],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy]
}

/** A closed polygon cut to the box (Sutherland–Hodgman). */
export function clipPolygon(b: Box, pts: readonly [number, number][]): [number, number][] {
  let out = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  const sides: Array<[(p: [number, number]) => boolean, (p: [number, number], q: [number, number]) => [number, number]]> = [
    [(p) => p[0] >= b.x0, (p, q) => [b.x0, p[1] + ((q[1] - p[1]) * (b.x0 - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= b.x1, (p, q) => [b.x1, p[1] + ((q[1] - p[1]) * (b.x1 - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= b.y0, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y0 - p[1])) / (q[1] - p[1]), b.y0]],
    [(p) => p[1] <= b.y1, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y1 - p[1])) / (q[1] - p[1]), b.y1]],
  ]
  for (const [inside, cross] of sides) {
    if (out.length === 0) break
    const next: [number, number][] = []
    for (let i = 0; i < out.length; i++) {
      const cur = out[i]
      const prev = out[(i + out.length - 1) % out.length]
      if (inside(cur)) {
        if (!inside(prev)) next.push(cross(prev, cur))
        next.push(cur)
      } else if (inside(prev)) {
        next.push(cross(prev, cur))
      }
    }
    out = next
  }
  return out
}

/**
 * Segments that stay inside the box, drawing the same thing inside it. A path
 * already inside comes back as it was (the same array).
 */
export function fitSegs(segs: readonly Seg[], box: Box, filled: boolean): readonly Seg[] {
  let inside = true
  let curvy = false
  for (const s of segs) {
    if (s.k === 'Z') continue
    if (s.k === 'C') {
      curvy = true
      if (!inBox(box, s.x1, s.y1) || !inBox(box, s.x2, s.y2)) inside = false
    }
    if (s.k === 'A') {
      curvy = true
      if (!inBox(box, s.cx - s.r, s.cy - s.r) || !inBox(box, s.cx + s.r, s.cy + s.r)) inside = false
    }
    if (!inBox(box, s.x, s.y)) inside = false
  }
  if (inside) return segs
  const cx = (v: number): number => (Number.isFinite(v) ? Math.max(box.x0, Math.min(box.x1, v)) : box.x0)
  const cy = (v: number): number => (Number.isFinite(v) ? Math.max(box.y0, Math.min(box.y1, v)) : box.y0)
  if (curvy) {
    // Last resort: pin every point to the box (the renderer only draws
    // curves and arcs near the view, so this changes nothing visible).
    const rMax = Math.max(box.x1 - box.x0, box.y1 - box.y0)
    return segs.map((s): Seg => {
      switch (s.k) {
        case 'M': case 'L': return { k: s.k, x: cx(s.x), y: cy(s.y) }
        case 'C': return { k: 'C', x1: cx(s.x1), y1: cy(s.y1), x2: cx(s.x2), y2: cy(s.y2), x: cx(s.x), y: cy(s.y) }
        case 'A': return { ...s, cx: cx(s.cx), cy: cy(s.cy), r: Math.min(s.r, rMax), x: cx(s.x), y: cy(s.y) }
        default: return s
      }
    })
  }
  // Lines only: split into subpaths.
  const subs: { pts: [number, number][]; closed: boolean }[] = []
  for (const s of segs) {
    if (s.k === 'M') subs.push({ pts: [[s.x, s.y]], closed: false })
    else if (s.k === 'L') {
      if (subs.length === 0) subs.push({ pts: [], closed: false })
      subs[subs.length - 1].pts.push([s.x, s.y])
    } else if (s.k === 'Z' && subs.length > 0) {
      const last = subs[subs.length - 1]
      last.closed = true
      // A path may carry on from the closed subpath's start.
      subs.push({ pts: [last.pts[0]], closed: false })
    }
  }
  const out: Seg[] = []
  for (const sub of subs) {
    if (sub.pts.length === 0) continue
    if (sub.pts.every(([x, y]) => inBox(box, x, y))) {
      if (sub.pts.length < 2 && !sub.closed) continue
      sub.pts.forEach(([x, y], i) => out.push({ k: i === 0 ? 'M' : 'L', x, y }))
      if (sub.closed) out.push({ k: 'Z' })
      continue
    }
    if (filled) {
      const poly = clipPolygon(box, sub.pts)
      if (poly.length < 3) continue
      poly.forEach(([x, y], i) => out.push({ k: i === 0 ? 'M' : 'L', x, y }))
      out.push({ k: 'Z' })
      continue
    }
    const pts = sub.closed ? [...sub.pts, sub.pts[0]] : sub.pts
    let pen: [number, number] | null = null
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = clipSegment(box, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
      if (!c) {
        pen = null
        continue
      }
      if (!pen || pen[0] !== c[0] || pen[1] !== c[1]) out.push({ k: 'M', x: c[0], y: c[1] })
      out.push({ k: 'L', x: c[2], y: c[3] })
      pen = [c[2], c[3]]
    }
  }
  return out
}

/**
 * The point sizes Computer Modern — LaTeX's default fonts, text AND math —
 * comes in. A label set at any other size (the renderer's 11 px is 8.25 pt)
 * makes pdflatex substitute the nearest design size, with a "Font shape …
 * not available" warning for the text and for each math size derived from it
 * (8.25 pt text asks for 4.1 pt script-script). So a label is set at the
 * nearest of these, never below 6 pt: no substitution in a plain document,
 * and nothing smaller than a footnote's superscript on paper. A document
 * that loads scalable fonts (lmodern, newtx …) is equally happy.
 */
export const TEX_FONT_SIZES: readonly number[] = [6, 7, 8, 9, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88]

/** The CM size nearest to `pt` (ties go up: the larger is the legible one). */
export function texFontSize(pt: number): number {
  if (!Number.isFinite(pt)) return 8
  let best = TEX_FONT_SIZES[0]
  for (const s of TEX_FONT_SIZES) if (Math.abs(s - pt) <= Math.abs(best - pt)) best = s
  return best
}

/** Coordinates per output line: keeps every TeX input line short. */
const COORDS_PER_LINE = 6

export function toTikz(list: DisplayList, opts: TikzOptions = {}): string {
  const k = opts.ptPerPx ?? PT_PER_PX
  const Hpt = list.height * k
  const P = (x: number, y: number): string => `(${num(x * k)},${num(Hpt - y * k)})`
  // The padded box every path is cut to, in device units — never past
  // TIKZ_MAX_PT once converted to pt.
  const pad = Math.max(list.width, list.height) / 2 + 50
  const lim = TIKZ_MAX_PT / k
  const box: Box = {
    x0: Math.max(-pad, -lim),
    x1: Math.min(list.width + pad, lim),
    y0: Math.max(-pad, (Hpt - TIKZ_MAX_PT) / k),
    y1: Math.min(list.height + pad, (Hpt + TIKZ_MAX_PT) / k),
  }

  // Colours, named in order of first use.
  const colours = new Map<string, string>()
  const colour = (c: Rgba): string => {
    const hex = cssHex(c).slice(1).toUpperCase()
    let name = colours.get(hex)
    if (!name) {
      name = `gr${colours.size + 1}`
      colours.set(hex, name)
    }
    return name
  }

  const pathText = (segs: readonly Seg[]): string => {
    const parts: string[] = []
    let start: [number, number] | null = null
    let closed = false
    for (const s of segs) {
      if (closed && s.k !== 'M' && start) {
        parts.push(P(start[0], start[1]))
      }
      closed = false
      switch (s.k) {
        case 'M':
          parts.push(P(s.x, s.y))
          start = [s.x, s.y]
          break
        case 'L':
          parts.push(`-- ${P(s.x, s.y)}`)
          break
        case 'C':
          parts.push(`.. controls ${P(s.x1, s.y1)} and ${P(s.x2, s.y2)} .. ${P(s.x, s.y)}`)
          break
        case 'A': {
          // y is flipped (TikZ is y-up), so every canvas angle changes sign.
          const a0 = (-s.a0 * 180) / Math.PI
          const a1 = (-(s.a0 + s.sweep) * 180) / Math.PI
          parts.push(`arc[start angle=${num(a0, 3)}, end angle=${num(a1, 3)}, radius=${num(s.r * k, 3)}]`)
          break
        }
        case 'Z':
          parts.push('-- cycle')
          closed = true
          break
      }
    }
    const lines: string[] = []
    for (let i = 0; i < parts.length; i += COORDS_PER_LINE) {
      lines.push(parts.slice(i, i + COORDS_PER_LINE).join(' '))
    }
    return lines.join('\n  ')
  }

  const pathCmd = (it: PathItem): string => {
    const o: string[] = []
    const s = it.stroke
    if (it.fill) {
      o.push(`fill=${colour(it.fill)}`)
      if (it.fill.a < 1) o.push(`fill opacity=${num(it.fill.a, 3)}`)
    }
    if (s) {
      o.push(`draw=${colour(s.color)}`, `line width=${num(s.width * k, 3)}pt`)
      if (s.color.a < 1) o.push(`draw opacity=${num(s.color.a, 3)}`)
      if (s.cap !== 'butt') o.push(`line cap=${CAP[s.cap]}`)
      if (s.join !== 'miter') o.push(`line join=${s.join}`)
      if (s.dash.length > 0) {
        const pat: string[] = []
        for (let i = 0; i + 1 < s.dash.length; i += 2) {
          pat.push(`on ${num(s.dash[i] * k, 3)}pt off ${num(s.dash[i + 1] * k, 3)}pt`)
        }
        o.push(`dash pattern=${pat.join(' ')}`)
        if (s.dashOffset) o.push(`dash phase=${num(s.dashOffset * k, 3)}pt`)
      }
    }
    const cmd = it.fill && s ? '\\filldraw' : it.fill ? '\\fill' : '\\draw'
    const segs = fitSegs(it.segs, box, it.fill !== null)
    if (!segs.some((g) => g.k !== 'M' && g.k !== 'Z')) return ''
    return `${cmd}[${o.join(', ')}] ${pathText(segs)};`
  }

  const nodeCmd = (it: TextItem): string => {
    const body = texLabel(it.text)
    if (body === '' || !inBox(box, it.x, it.y)) return ''
    const f = it.font
    const size = texFontSize(f.size * k)
    const mono = f.generic === 'monospace'
    const sans = f.generic !== 'serif' && !mono
    const face = f.generic === 'serif' ? '\\rmfamily' : mono ? '\\ttfamily' : '\\sffamily'
    // Computer Modern has no italic sans (it is the slanted one) and no bold
    // typewriter: ask for what exists, so no substitution is ever made.
    const font =
      `\\fontsize{${num(size, 2)}}{${num(size * 1.2, 1)}}\\selectfont${face}` +
      (f.italic ? (sans ? '\\slshape' : '\\itshape') : '') +
      (f.bold && !mono ? '\\bfseries' : '')
    const anchor = it.anchor === 'middle' ? 'base' : it.anchor === 'end' ? 'base east' : 'base west'
    const o = [`anchor=${anchor}`, `text=${colour(it.color)}`, `font=${font}`]
    if (it.color.a < 1) o.push(`text opacity=${num(it.color.a, 3)}`)
    // Never wider than the renderer measured it: its chip, its gap between
    // ticks, its place beside a curve were laid out for that width, and TeX's
    // fonts (Computer Modern, or whatever the document loads) set the same
    // words a little wider than the screen's Helvetica.
    // (A letter or two — a curve's name, a tick's digit — is left as it is:
    // it has room around it, and a math italic f is twice a sans one.)
    const fit = Number.isFinite(it.width) && it.width > 0 && [...it.text.trim()].length > 2 ? `\\grapherfit{${num(it.width * k, 2)}}{${body}}` : body
    return `\\node[${o.join(', ')}] at ${P(it.x, it.y)} {${fit}};`
  }

  // ---- body, along each item's clip chain -----------------------------------
  const body: string[] = []
  let open: number[] = []
  const indent = (): string => '  '.repeat(open.length + 1)
  for (const it of list.items) {
    const chain = clipChain(list, it.clip)
    let keep = 0
    while (keep < open.length && keep < chain.length && open[keep] === chain[keep]) keep++
    while (open.length > keep) {
      open.pop()
      body.push(`${indent()}\\end{scope}`)
    }
    for (let i = keep; i < chain.length; i++) {
      body.push(`${indent()}\\begin{scope}`)
      open.push(chain[i])
      body.push(`${indent()}\\clip ${pathText(fitSegs(list.clips[chain[i] - 1].segs, box, true))};`)
    }
    const line = it.t === 'path' ? pathCmd(it) : nodeCmd(it)
    if (line) body.push(indent() + line)
  }
  while (open.length > 0) {
    open.pop()
    body.push(`${indent()}\\end{scope}`)
  }

  const cm = (pt: number): string => num((pt / 72.27) * 2.54, 2)
  const head: string[] = [
    // eslint-disable-next-line no-control-regex
    `% Grapher figure${opts.title ? ` "${opts.title.replace(/[\u0000-\u001f\u007f]+/g, ' ')}"` : ''} as TikZ, ` +
      `${cm(list.width * k)} cm x ${cm(Hpt)} cm.`,
    '% Preamble:',
    '%   \\usepackage{tikz}   % it loads xcolor',
    '% Compiles with plain pdflatex.',
    '% Use it with \\input{<this file>}, or paste it inside a figure environment.',
    '\\begin{tikzpicture}[x=1pt, y=1pt, inner sep=0pt, outer sep=0pt]',
    // The figure is the page: nothing drawn past its edge grows the picture.
    `  \\useasboundingbox (0,0) rectangle (${num(list.width * k)},${num(Hpt)});`,
    // \grapherfit{w}{text}: the text, shrunk to w pt if it comes out wider
    // (\resizebox is graphicx's, which TikZ loads). Local to this picture.
    '  \\def\\grapherfit#1#2{\\setbox0=\\hbox{#2}\\ifdim\\wd0>\\dimexpr#1pt+0.5pt\\relax' +
      '\\dimen0=\\dimexpr\\wd0*85/100\\relax\\ifdim\\dimen0<#1pt\\dimen0=#1pt\\fi' +
      '\\resizebox{\\dimen0}{!}{#2}\\else\\box0\\fi}',
  ]
  for (const [hex, name] of colours) head.push(`  \\definecolor{${name}}{HTML}{${hex}}`)
  return [...head, ...body, '\\end{tikzpicture}', ''].join('\n')
}
