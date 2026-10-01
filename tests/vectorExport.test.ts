// ============================================================================
// tests/vectorExport.test.ts — the recording context and its three writers.
//
// The recorder is what lets SVG, PDF and TikZ come out of the ONE renderer: it
// is a CanvasRenderingContext2D that writes down what it is asked to draw.
// These tests pin that it writes down the right things (transforms applied,
// arcs kept as arcs, dash/alpha/caps carried, text with its font and
// baseline) and that each writer turns them into the right primitives —
// down to a PDF whose xref offsets are parsed back and checked.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { VectorCtx, arcSweep, newPath2D, parseColor, parseFont, recordDrawing } from '../src/render/vectorCtx'
import type { DisplayList, PathItem, TextItem } from '../src/render/vectorCtx'
import { toSvg } from '../src/render/vectorSvg'
import { pdfTextRuns, toPdf, toPdfString } from '../src/render/vectorPdf'
import { toTikz } from '../src/render/vectorTikz'
import { texLabel } from '../src/render/texText'
import { MockCtx } from './mockCanvas'
import { renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { FIGURE_STYLES, LIGHT_THEME } from '../src/core/types'
import type { FittedCurve, ModelSpec, Viewport } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { physicalViewport, recordScene } from '../src/ui/vectorExport'

// ---------------------------------------------------------------------------
// A simple scene: a dashed line, a translucent disc (an arc), and text.
// ---------------------------------------------------------------------------

function simple(): DisplayList {
  return recordDrawing(200, 100, (ctx) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 200, 100)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 10, 10) // the export margin
    ctx.beginPath()
    ctx.rect(0, 0, 180, 80)
    ctx.clip()

    ctx.strokeStyle = '#1a5fb4'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(0, 40)
    ctx.lineTo(180, 40)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#c01c28'
    ctx.beginPath()
    ctx.arc(90, 40, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('\u2212π/2', 90, 60)
    ctx.restore()
  })
}

describe('recording context', () => {
  it('records paths in device coordinates, with the transform applied', () => {
    const list = simple()
    const line = list.items.find((i): i is PathItem => i.t === 'path' && i.stroke !== null && i.segs.length === 2)
    expect(line).toBeDefined()
    expect(line!.segs[0]).toEqual({ k: 'M', x: 10, y: 50 })
    expect(line!.segs[1]).toEqual({ k: 'L', x: 190, y: 50 })
    expect(line!.stroke!.dash).toEqual([6, 4])
    expect(line!.stroke!.cap).toBe('round')
    expect(line!.stroke!.width).toBe(2)
    expect(line!.clip).toBe(1)
  })

  it('keeps an arc an arc, with alpha folded into the paint', () => {
    const disc = simple().items.find((i): i is PathItem => i.t === 'path' && i.segs.some((s) => s.k === 'A'))
    expect(disc).toBeDefined()
    const arc = disc!.segs.find((s) => s.k === 'A')!
    expect(arc).toMatchObject({ k: 'A', cx: 100, cy: 50, r: 12 })
    expect(arc.k === 'A' && Math.abs(arc.sweep - Math.PI * 2)).toBeLessThan(1e-12)
    expect(disc!.fill!.a).toBeCloseTo(0.5)
    expect(disc!.fill).toMatchObject({ r: 0xc0, g: 0x1c, b: 0x28 })
  })

  it('records text with its font, anchor and alphabetic baseline', () => {
    const t = simple().items.find((i): i is TextItem => i.t === 'text')!
    expect(t.text).toBe('\u2212π/2')
    expect(t.anchor).toBe('middle')
    expect(t.x).toBe(100)
    // 'top' at y = 70 → the baseline sits ~0.8 em lower
    expect(t.y).toBeCloseTo(70 + 0.8 * 11)
    expect(t.font).toMatchObject({ size: 11, generic: 'sans-serif', italic: false })
    expect(t.width).toBeGreaterThan(10)
  })

  it('scales widths, dashes and radii with a uniform transform', () => {
    const list = recordDrawing(100, 100, (ctx) => {
      ctx.setTransform(2, 0, 0, 2, 0, 0)
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 1])
      ctx.beginPath()
      ctx.arc(10, 10, 5, 0, Math.PI / 2)
      ctx.stroke()
    })
    const p = list.items[0] as PathItem
    expect(p.stroke!.width).toBe(3)
    expect(p.stroke!.dash).toEqual([6, 2])
    const arc = p.segs.find((s) => s.k === 'A')!
    expect(arc).toMatchObject({ cx: 20, cy: 20, r: 10 })
  })

  it('flattens an arc to Béziers only under a non-uniform transform', () => {
    const list = recordDrawing(100, 100, (ctx) => {
      ctx.setTransform(2, 0, 0, 1, 0, 0)
      ctx.beginPath()
      ctx.arc(10, 10, 5, 0, Math.PI)
      ctx.stroke()
    })
    const p = list.items[0] as PathItem
    expect(p.segs.some((s) => s.k === 'A')).toBe(false)
    expect(p.segs.filter((s) => s.k === 'C').length).toBe(2)
  })

  it('merges fill-then-stroke of one path into one item', () => {
    const list = recordDrawing(50, 50, (ctx) => {
      ctx.beginPath()
      ctx.arc(25, 25, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#000000'
      ctx.stroke()
    })
    expect(list.items.length).toBe(1)
    const p = list.items[0] as PathItem
    expect(p.fill).not.toBeNull()
    expect(p.stroke).not.toBeNull()
  })

  it('turns arcTo corners into line + arc (a rounded label chip)', () => {
    const list = recordDrawing(100, 100, (ctx) => {
      ctx.beginPath()
      ctx.moveTo(14, 10)
      ctx.arcTo(60, 10, 60, 40, 4)
      ctx.arcTo(60, 40, 10, 40, 4)
      ctx.arcTo(10, 40, 10, 10, 4)
      ctx.arcTo(10, 10, 60, 10, 4)
      ctx.closePath()
      ctx.fill()
    })
    const p = list.items[0] as PathItem
    const arcs = p.segs.filter((s) => s.k === 'A')
    expect(arcs.length).toBe(4)
    for (const a of arcs) if (a.k === 'A') expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI / 2)
    // the first corner ends on the right edge, 4 px down
    const a0 = arcs[0]
    expect(a0.k === 'A' && a0.x).toBeCloseTo(60)
    expect(a0.k === 'A' && a0.y).toBeCloseTo(14)
  })

  it('follows the canvas spec for arc sweeps', () => {
    expect(arcSweep(0, Math.PI, false)).toBeCloseTo(Math.PI)
    expect(arcSweep(0, Math.PI, true)).toBeCloseTo(-Math.PI)
    expect(arcSweep(0, 7, false)).toBeCloseTo(Math.PI * 2)
    expect(arcSweep(Math.PI, 0, false)).toBeCloseTo(Math.PI)
  })

  it('routes Path2D through the factory: recording for the recorder, native elsewhere', () => {
    const rec = new VectorCtx(10, 10)
    const p = newPath2D(rec as unknown as CanvasRenderingContext2D)
    p.moveTo(1, 1)
    p.lineTo(5, 5)
    ;(rec as unknown as CanvasRenderingContext2D).stroke(p)
    expect((rec.list().items[0] as PathItem).segs).toEqual([
      { k: 'M', x: 1, y: 1 },
      { k: 'L', x: 5, y: 5 },
    ])
    // A context without createVectorPath gets `new Path2D()` — here a stub.
    const g = globalThis as unknown as { Path2D?: unknown }
    const prev = g.Path2D
    class Native { native = true }
    g.Path2D = Native
    try {
      expect((newPath2D(new MockCtx() as unknown as CanvasRenderingContext2D) as unknown as Native).native).toBe(true)
    } finally {
      if (prev === undefined) delete g.Path2D
      else g.Path2D = prev
    }
  })

  it('parses the colours and fonts the renderer writes', () => {
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 })
    expect(parseColor('rgba(15, 17, 23, 0.85)')).toEqual({ r: 15, g: 17, b: 23, a: 0.85 })
    expect(parseColor('transparent')!.a).toBe(0)
    const fb = { family: 'x', generic: 'sans-serif' as const, size: 10, italic: false, bold: false }
    expect(parseFont('italic 13px "Times New Roman", Times, Georgia, serif', fb)).toMatchObject({
      size: 13, italic: true, generic: 'serif',
    })
    expect(parseFont('11px "SF Mono", Menlo, Consolas, monospace', fb).generic).toBe('monospace')
    expect(parseFont('600 12px system-ui, sans-serif', fb)).toMatchObject({ bold: true, generic: 'sans-serif' })
  })
})

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

describe('SVG', () => {
  it('writes the primitives: path, arc, dash, opacity, clip, text', () => {
    const svg = toSvg(simple(), { pixelWidth: 400, pixelHeight: 200 })
    expect(svg).toMatch(/^<\?xml/)
    expect(svg).toContain('viewBox="0 0 200 100"')
    expect(svg).toContain('width="400"')
    expect(svg).toContain('<clipPath id="clip1">')
    expect(svg).toContain('clip-path="url(#clip1)"')
    expect(svg).toContain('d="M10 50L190 50"')
    expect(svg).toContain('stroke-dasharray="6 4"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toMatch(/A12 12 0 0 1 /)
    expect(svg).toContain('fill-opacity="0.5"')
    expect(svg).toContain('text-anchor="middle"')
    expect(svg).toContain('>\u2212π/2</text>')
    expect(svg).toMatch(/font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"/)
    // balanced groups
    expect((svg.match(/<g /g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
  })
})

/** Parse the xref table and check every in-use offset lands on "n 0 obj". */
function checkPdf(pdf: string): { objects: number } {
  expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
  expect(pdf.endsWith('%%EOF\n')).toBe(true)
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf)
  expect(sx).not.toBeNull()
  const xrefAt = Number(sx![1])
  expect(pdf.slice(xrefAt, xrefAt + 5)).toBe('xref\n')
  const head = /^xref\n0 (\d+)\n/.exec(pdf.slice(xrefAt))!
  const count = Number(head[1])
  let at = xrefAt + head[0].length
  for (let i = 0; i < count; i++) {
    const entry = pdf.slice(at, at + 20)
    expect(entry).toMatch(/^\d{10} \d{5} [nf] \n$/)
    if (i > 0) {
      const off = Number(entry.slice(0, 10))
      expect(pdf.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
    at += 20
  }
  const trailer = pdf.slice(at)
  expect(trailer).toMatch(new RegExp(`^trailer\\n<< /Size ${count} /Root 1 0 R`))
  // every stream's /Length is its true byte length
  const re = /<< \/Length (\d+) >>\nstream\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pdf)) !== null) {
    const start = m.index + m[0].length
    expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('endstream\n')
  }
  return { objects: count - 1 }
}

describe('PDF', () => {
  it('is a structurally valid PDF 1.4 with correct xref offsets', () => {
    const pdf = toPdfString(simple(), { title: 'Grüße π' })
    const { objects } = checkPdf(pdf)
    expect(objects).toBeGreaterThanOrEqual(6)
    // every char is a byte, and only the binary-marker line is above ASCII
    const lines = pdf.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i === 1) continue
      expect(/[^\x00-\x7e]/.test(lines[i])).toBe(false)
    }
    const bytes = toPdf(simple())
    expect(bytes.length).toBe(toPdfString(simple()).length)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('writes the primitives: page size in pt, colours, dash, caps, alpha, clip, Béziers, text', () => {
    const pdf = toPdfString(simple())
    expect(pdf).toContain('/MediaBox [0 0 150 75]') // 200×100 px at 0.75 pt/px
    expect(pdf).toContain('0.102 0.373 0.706 RG') // #1a5fb4
    expect(pdf).toContain('[4.5 3] 0 d')
    expect(pdf).toContain('1 J')
    expect(pdf).toMatch(/\/GS1 gs/)
    expect(pdf).toContain('/Type /ExtGState /ca 0.5 /CA 1')
    expect(pdf).toMatch(/W n/)
    // the disc: four quarter-circle Béziers, filled
    const disc = pdf.slice(pdf.indexOf('0.753 0.11 0.157 rg'))
    expect((disc.slice(0, disc.indexOf('\nf\n')).match(/ c\n?/g) ?? []).length).toBe(4)
    // the label: the minus as a WinAnsi en dash, π from Symbol, centred
    expect(pdf).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding')
    expect(pdf).toContain('/BaseFont /Symbol')
    expect(pdf).toContain('(\\226) Tj')
    expect(pdf).toContain('(p) Tj')
  })

  it('never lets an unknown glyph into a string; sub/superscripts are scaled digits', () => {
    const f = { family: 'x', generic: 'sans-serif' as const, size: 10, italic: false, bold: false }
    const runs = pdfTextRuns('P₀ x² ∞ √2 ☃', f)
    const all = runs.flatMap((r) => r.codes)
    expect(all.every((c) => c >= 32 && c <= 255)).toBe(true)
    expect(runs.some((r) => r.scale < 1 && r.rise < 0 && r.codes.includes(48))).toBe(true) // ₀
    expect(runs.some((r) => r.scale < 1 && r.rise > 0 && r.codes.includes(50))).toBe(true) // ²
    expect(runs.some((r) => r.font === 'Symbol' && r.codes.includes(0xa5))).toBe(true) // ∞
    expect(runs.some((r) => r.font === 'Symbol' && r.codes.includes(0xd6))).toBe(true) // √
    expect(runs[runs.length - 1].codes).toContain(63) // ☃ → ? (✓ is ZapfDingbats now: hardening-export)
  })
})

describe('TikZ', () => {
  it('writes the primitives: colours, draw/fill options, arc, clip scope, node', () => {
    const tikz = toTikz(simple())
    expect(tikz).toContain('\\begin{tikzpicture}[x=1pt, y=1pt')
    expect(tikz).toContain('\\definecolor{gr')
    expect(tikz).toMatch(/\\definecolor\{gr\d+\}\{HTML\}\{1A5FB4\}/)
    expect(tikz).toMatch(/\\draw\[draw=gr\d+, line width=1\.5pt, line cap=round, dash pattern=on 4\.5pt off 3pt\]/)
    expect(tikz).toMatch(/\\fill\[fill=gr\d+, fill opacity=0\.5\] \(84,37\.5\) arc\[start angle=0, end angle=-360, radius=9\]/)
    expect(tikz).toContain('\\begin{scope}')
    expect(tikz).toContain('\\clip ')
    // 8.25 pt is set at CM's 8 pt (no font substitution), never wider than measured
    expect(tikz).toMatch(/\\node\[anchor=base, text=gr\d+, font=\\fontsize\{8\}\{9\.6\}\\selectfont\\sffamily\] at \([\d.]+,[\d.]+\) \{\\grapherfit\{[\d.]+\}\{\$-\\frac\{\\pi\}\{2\}\$\}\};/)
    expect(tikz.trim().endsWith('\\end{tikzpicture}')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LaTeX safety
// ---------------------------------------------------------------------------

/** Braces balance, ignoring escaped ones and comment lines. */
function balanced(tex: string): boolean {
  let depth = 0
  for (const line of tex.split('\n')) {
    const code = line.replace(/(^|[^\\])%.*$/, '$1')
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '\\') {
        i++
        continue
      }
      if (code[i] === '{') depth++
      else if (code[i] === '}') depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/** No unescaped % # & inside the non-comment part of a line. */
function specialsEscaped(tex: string): boolean {
  for (const line of tex.split('\n')) {
    if (/^\s*%/.test(line)) continue
    // The picture's own macro definition is the one place a # belongs.
    if (/^\s*\\def\\grapherfit#1#2\{/.test(line)) continue
    if (/(^|[^\\])[#&]/.test(line)) return false
    if (/(^|[^\\])%/.test(line)) return false
  }
  return true
}

describe('labels as LaTeX', () => {
  it('sets mathematics in $…$', () => {
    expect(texLabel('\u2212π/2')).toBe('$-\\frac{\\pi}{2}$')
    expect(texLabel('3π/2')).toBe('$\\frac{3\\pi}{2}$')
    expect(texLabel('π')).toBe('$\\pi$')
    expect(texLabel('(2, 4)')).toBe('$(2, 4)$')
    expect(texLabel('3')).toBe('$3$')
    expect(texLabel('\u22123')).toBe('$-3$')
    expect(texLabel('P₀')).toBe('$P_{0}$')
    expect(texLabel('c = 2√3/3')).toBe('$c = \\frac{2\\sqrt{3}}{3}$')
    expect(texLabel('(√2, 2)')).toBe('$(\\sqrt{2}, 2)$')
    expect(texLabel('y = x² − 3')).toBe('$y = x^{2} - 3$')
    expect(texLabel('5×10⁴')).toBe('$5\\times10^{4}$')
    expect(texLabel('x')).toBe('$x$')
  })

  it('keeps prose as text and only the mathematics in math', () => {
    expect(texLabel('Graph of f')).toBe('Graph of $f$')
    expect(texLabel('(2, 0) (touches)')).toBe('$(2, 0)$ (touches)')
    expect(texLabel('Graphs of f, g, and h')).toBe('Graphs of $f, g,$ and $h$')
    expect(texLabel('Figure 1: 50% & #3')).toBe('Figure 1: 50\\% \\& \\#3')
  })

  it('never leaves an unescaped special or an unknown byte', () => {
    for (const s of ['100%', 'a & b', '#1', 'x_1', '{set}', 'ok ✓', 'a\\b', 'x^2 ~ y', '50% of f']) {
      const t = texLabel(s)
      expect(specialsEscaped(t)).toBe(true)
      expect(balanced(t)).toBe(true)
      expect(/[^\x00-\x7e\u00c0-\u00ff]/.test(t)).toBe(false)
    }
  })

  it('a TikZ export of a real board has balanced braces and no unescaped % # &', () => {
    const tikz = toTikz(boardList())
    expect(balanced(tikz)).toBe(true)
    expect(specialsEscaped(tikz)).toBe(true)
    expect(/[^\x00-\x7e]/.test(tikz.split('\n').filter((l) => !l.startsWith('%')).join('\n'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The real renderer through the recorder
// ---------------------------------------------------------------------------

function typed(id: string, src: string, color: string): { curve: FittedCurve; model: ModelSpec } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(r.error)
  const model = r.plot.makeModel(id)
  return {
    model,
    curve: {
      id, modelId: id, params: r.plot.defaultParams, kind: 'explicit', domain: r.plot.domain,
      color, strokeWidth: 2.5, visible: true, error: 0,
    },
  }
}

function boardScene(vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 640, heightPx: 400 }): BoardScene {
  const a = typed('e1', 'y = x^2 - 3', '#4f9cf9')
  const b = typed('e2', 'y = sin(x)', '#f95f62')
  return {
    vp,
    theme: LIGHT_THEME,
    curves: [a.curve, b.curve],
    styles: {},
    models: { e1: a.model, e2: b.model },
    figure: FIGURE_STYLES.sat,
    printColors: true,
    axisUnits: { x: 'pi' },
    overlays: [{ kind: 'area', curveId: 'e1', from: -1, to: 1 }],
    caption: 'Graph of f & g, 100%',
    chrome: null,
  }
}

function boardList(): DisplayList {
  return recordScene(boardScene(), 24)
}

describe('the board through the recorder', () => {
  it('records the same text the canvas draws, and every curve as a stroke', () => {
    const mock = new MockCtx()
    const g = globalThis as unknown as { Path2D?: unknown }
    const prev = g.Path2D
    g.Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    }
    try {
      renderBoard(mock as unknown as CanvasRenderingContext2D, boardScene())
    } finally {
      if (prev === undefined) delete g.Path2D
      else g.Path2D = prev
    }
    const list = boardList()
    const texts = list.items.filter((i): i is TextItem => i.t === 'text').map((t) => t.text)
    expect(texts.sort()).toEqual(mock.texts.map((t) => t.text).sort())
    // two curves, each one long stroke with no arcs
    const strokes = list.items.filter(
      (i): i is PathItem => i.t === 'path' && i.stroke !== null && i.segs.length > 50,
    )
    expect(strokes.length).toBeGreaterThanOrEqual(2)
  })

  it('writes a valid PDF and a balanced SVG for the whole board', () => {
    const list = boardList()
    checkPdf(toPdfString(list))
    const svg = toSvg(list)
    expect((svg.match(/<g /g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
    expect(svg).toContain('>x</text>')
  })

  it('sizes the physical formats by width in cm, keeping the math window', () => {
    const vp: Viewport = { center: { x: 1, y: 2 }, pxPerUnit: 40, widthPx: 640, heightPx: 400 }
    const p = physicalViewport(vp, 8, 24)
    const total = p.widthPx + 48
    expect(total).toBeCloseTo((8 / 2.54) * 96)
    expect(p.widthPx / p.pxPerUnit).toBeCloseTo(vp.widthPx / vp.pxPerUnit)
    expect(p.heightPx / p.pxPerUnit).toBeCloseTo(vp.heightPx / vp.pxPerUnit)
    expect(p.center).toEqual(vp.center)
  })
})
