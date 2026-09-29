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

/** Coordinates per output line: keeps every TeX input line short. */
const COORDS_PER_LINE = 6

export function toTikz(list: DisplayList, opts: TikzOptions = {}): string {
  const k = opts.ptPerPx ?? PT_PER_PX
  const Hpt = list.height * k
  const P = (x: number, y: number): string => `(${num(x * k)},${num(Hpt - y * k)})`

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
    return `${cmd}[${o.join(', ')}] ${pathText(it.segs)};`
  }

  const nodeCmd = (it: TextItem): string => {
    const body = texLabel(it.text)
    if (body === '') return ''
    const f = it.font
    const size = f.size * k
    const face = f.generic === 'serif' ? '\\rmfamily' : f.generic === 'monospace' ? '\\ttfamily' : '\\sffamily'
    const font =
      `\\fontsize{${num(size, 1)}}{${num(size * 1.2, 1)}}\\selectfont${face}` +
      (f.italic ? '\\itshape' : '') +
      (f.bold ? '\\bfseries' : '')
    const anchor = it.anchor === 'middle' ? 'base' : it.anchor === 'end' ? 'base east' : 'base west'
    const o = [`anchor=${anchor}`, `text=${colour(it.color)}`, `font=${font}`]
    if (it.color.a < 1) o.push(`text opacity=${num(it.color.a, 3)}`)
    return `\\node[${o.join(', ')}] at ${P(it.x, it.y)} {${body}};`
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
      body.push(`${indent()}\\clip ${pathText(list.clips[chain[i] - 1].segs)};`)
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
    `% Grapher figure${opts.title ? ` "${opts.title.replace(/[\r\n]+/g, ' ')}"` : ''} as TikZ, ` +
      `${cm(list.width * k)} cm x ${cm(Hpt)} cm.`,
    '% Needs only \\usepackage{tikz} (it loads xcolor). Compiles with plain pdflatex.',
    '% Use it with \\input{<this file>}, or paste it inside a figure environment.',
    '\\begin{tikzpicture}[x=1pt, y=1pt, inner sep=0pt, outer sep=0pt]',
  ]
  for (const [hex, name] of colours) head.push(`  \\definecolor{${name}}{HTML}{${hex}}`)
  return [...head, ...body, '\\end{tikzpicture}', ''].join('\n')
}
