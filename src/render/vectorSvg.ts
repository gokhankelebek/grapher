// ============================================================================
// src/render/vectorSvg.ts — a recorded board as an SVG document.
//
// The viewBox is the figure in CSS px (the renderer's own units), so every
// coordinate is the one the canvas was given; width/height say how big it is
// shown, which is where the export's size setting lands. Text is real <text>
// in the same font stack the canvas used, arcs are SVG `A` commands, a dash is
// stroke-dasharray, alpha is fill-/stroke-opacity, and clips are <clipPath>s
// applied through nested groups.
// ============================================================================

import type { DisplayList, PathItem, Rgba, Seg, TextItem } from './vectorCtx'
import { clipChain } from './vectorCtx'

/** A number, short: 2 decimals, no trailing zeros, never "-0". */
export function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '0'
  const s = v.toFixed(digits)
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s
  return t === '-0' ? '0' : t
}

const hex2 = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
export const cssHex = (c: Rgba): string => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

export function escapeXml(s: string): string {
  return s
    // XML 1.0 forbids most C0 controls outright (a form feed makes the file
    // unparseable); tab / CR / LF in a label would only collapse to a space.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** SVG path data for recorded segments (device coords are SVG user units). */
export function svgPathData(segs: readonly Seg[]): string {
  const out: string[] = []
  for (const s of segs) {
    switch (s.k) {
      case 'M': out.push(`M${num(s.x)} ${num(s.y)}`); break
      case 'L': out.push(`L${num(s.x)} ${num(s.y)}`); break
      case 'C':
        out.push(`C${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)}`)
        break
      case 'A': {
        // An SVG arc cannot be a full turn (start = end draws nothing), so
        // anything past a half turn is written as two halves.
        const r = num(s.r, 3)
        const flag = s.sweep > 0 ? 1 : 0
        if (Math.abs(s.sweep) > Math.PI) {
          const mid = s.a0 + s.sweep / 2
          const mx = s.cx + s.r * Math.cos(mid)
          const my = s.cy + s.r * Math.sin(mid)
          out.push(`A${r} ${r} 0 0 ${flag} ${num(mx)} ${num(my)}`)
        }
        out.push(`A${r} ${r} 0 0 ${flag} ${num(s.x)} ${num(s.y)}`)
        break
      }
      case 'Z': out.push('Z'); break
    }
  }
  return out.join('')
}

function pathEl(it: PathItem): string {
  const a: string[] = [`d="${svgPathData(it.segs)}"`]
  if (it.fill) {
    a.push(`fill="${cssHex(it.fill)}"`)
    if (it.fill.a < 1) a.push(`fill-opacity="${num(it.fill.a, 3)}"`)
  } else {
    a.push('fill="none"')
  }
  const s = it.stroke
  if (s) {
    a.push(`stroke="${cssHex(s.color)}"`, `stroke-width="${num(s.width, 3)}"`)
    if (s.color.a < 1) a.push(`stroke-opacity="${num(s.color.a, 3)}"`)
    if (s.cap !== 'butt') a.push(`stroke-linecap="${s.cap}"`)
    if (s.join !== 'miter') a.push(`stroke-linejoin="${s.join}"`)
    else a.push(`stroke-miterlimit="${num(s.miter)}"`)
    if (s.dash.length > 0) {
      a.push(`stroke-dasharray="${s.dash.map((d) => num(d, 3)).join(' ')}"`)
      if (s.dashOffset) a.push(`stroke-dashoffset="${num(s.dashOffset, 3)}"`)
    }
  }
  return `<path ${a.join(' ')}/>`
}

function textEl(it: TextItem): string {
  const f = it.font
  const a: string[] = [
    `x="${num(it.x)}"`,
    `y="${num(it.y)}"`,
    `font-family="${escapeXml(f.family.replace(/"/g, "'"))}"`,
    `font-size="${num(f.size, 3)}"`,
  ]
  if (f.italic) a.push('font-style="italic"')
  if (f.bold) a.push('font-weight="bold"')
  if (it.anchor !== 'start') a.push(`text-anchor="${it.anchor}"`)
  a.push(`fill="${cssHex(it.color)}"`)
  if (it.color.a < 1) a.push(`fill-opacity="${num(it.color.a, 3)}"`)
  return `<text ${a.join(' ')}>${escapeXml(it.text)}</text>`
}

export interface SvgOptions {
  /** Displayed size; defaults to the figure's own size in px. */
  pixelWidth?: number
  pixelHeight?: number
  title?: string
  /** The figure in words (a screen reader's description): written as <desc>. */
  desc?: string
}

/** The whole figure as a standalone SVG document. */
export function toSvg(list: DisplayList, opts: SvgOptions = {}): string {
  const W = list.width
  const H = list.height
  const pw = opts.pixelWidth ?? W
  const ph = opts.pixelHeight ?? H
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  // Named for assistive technology: role="img", labelled by <title> and
  // described by <desc> — an SVG pasted into a page or an LMS carries both.
  const a11y = opts.title || opts.desc
    ? ` role="img"${opts.title ? ' aria-labelledby="fig-title"' : ''}${opts.desc ? ' aria-describedby="fig-desc"' : ''}`
    : ''
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(pw)}" height="${num(ph)}" viewBox="0 0 ${num(W)} ${num(H)}"${a11y}>`,
  )
  if (opts.title) out.push(`<title id="fig-title">${escapeXml(opts.title)}</title>`)
  if (opts.desc) out.push(`<desc id="fig-desc">${escapeXml(opts.desc)}</desc>`)
  if (list.clips.length > 0) {
    out.push('<defs>')
    for (const c of list.clips) {
      out.push(`<clipPath id="clip${c.id}"><path d="${svgPathData(c.segs)}"/></clipPath>`)
    }
    out.push('</defs>')
  }
  // Nested groups follow each item's clip chain: a group is opened for every
  // clip entered and closed when an item no longer sits inside it.
  let open: number[] = []
  for (const it of list.items) {
    const chain = clipChain(list, it.clip)
    let keep = 0
    while (keep < open.length && keep < chain.length && open[keep] === chain[keep]) keep++
    while (open.length > keep) {
      out.push('</g>')
      open.pop()
    }
    for (let i = keep; i < chain.length; i++) {
      out.push(`<g clip-path="url(#clip${chain[i]})">`)
      open.push(chain[i])
    }
    out.push(it.t === 'path' ? pathEl(it) : textEl(it))
  }
  while (open.length > 0) {
    out.push('</g>')
    open.pop()
  }
  out.push('</svg>')
  return out.join('\n') + '\n'
}
