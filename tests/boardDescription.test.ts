// ============================================================================
// tests/boardDescription.test.ts — the board in words: what the canvas's
// aria-label / aria-describedby say (src/ui/boardDescription.ts,
// src/app/useGraphDescription.ts), "Describe this graph", alt text and the
// exported SVG's <title> / <desc>.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExampleBoard } from '../src/examples/builder'
import { serializeDoc } from '../src/core/persist'
import { docModelFromJSON } from '../src/ui/docScene'
import type { DocModel } from '../src/ui/docScene'
import { clip, describeBoard } from '../src/ui/boardDescription'
import { DescribeDialog } from '../src/ui/DescribeDialog'
import { BOARD_DESC_ID, DESCRIBE_DEBOUNCE_MS, DESCRIBE_MAX_WAIT_MS } from '../src/app/useGraphDescription'
import { toSvg } from '../src/render/vectorSvg'
import { emptyPage } from '../src/render/vectorPage'
import { COMMAND_BY_ID } from '../src/ui/commands'

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')

function model(build: (b: ExampleBoard) => void, kind: 'cartesian' | 'number-line' = 'cartesian'): DocModel {
  const b = new ExampleBoard(kind)
  build(b)
  const m = docModelFromJSON(serializeDoc(b.toDoc('doc-desc', 'Describe me')))
  if (!m) throw new Error('did not load')
  return m
}

const parabola = (): DocModel =>
  model((b) => {
    b.frame([-5, 5], [-5, 5])
    b.line('f(x) = x^2 - 4')
  })

describe('describeBoard: the board in words', () => {
  it('an empty graph says so, and says how to start', () => {
    const d = describeBoard(model((b) => b.frame([-5, 5], [-5, 5])), { answers: true })
    expect(d.summary).toBe('Empty graph')
    expect(d.long).toMatch(/empty/i)
  })

  it('a parabola: a short name for aria-label, and a long description with its answers', () => {
    const d = describeBoard(parabola(), { answers: true })
    expect(d.summary.length).toBeLessThanOrEqual(160)
    expect(d.summary).toMatch(/^Graph of f\(x\) = x² − 4/)
    expect(d.long).toMatch(/x from −[\d.]+ to [\d.]+ and y from −5 to 5/)
    expect(d.long).toMatch(/crosses the x-axis .*x = −2.*x = 2/)
    expect(d.long).toMatch(/minimum at \(0, −4\)/)
    expect(d.figuredesc).not.toContain('\n')
  })

  it('reveal mode (answers: false) describes only what is shown — the equation, not the answers', () => {
    const d = describeBoard(parabola(), { answers: false })
    expect(d.long).toContain('f(x) = x² − 4')
    expect(d.long).not.toMatch(/crosses the x-axis/)
    expect(d.long).not.toMatch(/minimum/)
  })

  it('the text follows the board: a second curve changes it', () => {
    const one = describeBoard(parabola(), { answers: true })
    const two = describeBoard(
      model((b) => {
        b.frame([-5, 5], [-5, 5])
        b.line('f(x) = x^2 - 4')
        b.line('g(x) = 2x + 1')
      }),
      { answers: true },
    )
    expect(two.long).not.toBe(one.long)
    expect(two.long).toMatch(/2 curves|f \(solid\), and g \(solid\)|f \(solid\) and g \(solid\)/)
    expect(two.long).toContain('g(x) = 2x + 1')
  })

  it('under the colour-blind-safe palette it says which curves are dashed', () => {
    const m = model((b) => {
      b.frame([-5, 5], [-5, 5])
      b.line('f(x) = x^2 - 4')
      b.line('g(x) = 2x + 1')
    })
    expect(describeBoard(m, { answers: true }).long).toContain('g (solid)')
    expect(describeBoard(m, { answers: true, palette: 'safe' }).long).toContain('g (dashed)')
  })

  it('a shaded area and a tangent are stated, the tangent line once', () => {
    const d = describeBoard(
      model((b) => {
        b.frame([-1, 4], [-1, 10])
        const f = b.line('f(x) = x^2')
        b.area(f, 0, 2)
        b.tangent(f, 1)
      }),
      { answers: true },
    )
    expect(d.long).toMatch(/shaded|region/i)
    expect(d.long).toMatch(/tangent line/i)
    expect(d.long).not.toMatch(/It shows 2 curves/)
  })

  it('a number line: its solution set', () => {
    const d = describeBoard(
      model((b) => {
        b.solve('x^2 - 4 > 0')
      }, 'number-line'),
      { answers: true },
    )
    expect(d.summary).toMatch(/^Number line/)
    expect(d.long).toMatch(/−2/)
    expect(d.long).toMatch(/2/)
  })

  it('clip cuts at a word with an ellipsis', () => {
    expect(clip('one two three four', 12)).toBe('one two…')
    expect(clip('short', 12)).toBe('short')
  })
})

describe('the wiring: the canvas is named and described, and the text updates', () => {
  const app = src('App.tsx')
  const hook = src('app/useGraphDescription.ts')

  it('both stages get the summary as their name and point at the long description', () => {
    expect(app.match(/a11yLabel=\{description\.summary\}/g)?.length).toBe(2)
    expect(app.match(/describedBy=\{BOARD_DESC_ID\}/g)?.length).toBe(2)
    expect(app).toMatch(/id=\{BOARD_DESC_ID\} className="sr-only" aria-live="polite"/)
    expect(BOARD_DESC_ID).toBe('board-description')
  })

  it('it is described again a moment after the board changes — never on every frame of a drag', () => {
    expect(DESCRIBE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300)
    expect(DESCRIBE_MAX_WAIT_MS).toBeGreaterThan(DESCRIBE_DEBOUNCE_MS)
    expect(hook).toMatch(/schedule, curves, items, kind, fields, shapes, dataSets, sequences, calcLinks, unitCircles,\s*relatedRates, historyTick, answers, curvePalette/)
    expect(hook).toContain('viewSubsRef.current') // the view (pan, zoom) is a change too
  })

  it('answer mode follows reveal mode', () => {
    expect(hook).toContain('const answers = !reveal.on')
  })

  it('every toast and note reaches a live region that is always mounted', () => {
    expect(app).toMatch(/className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-status"/)
    expect(app).not.toMatch(/className="toast" role="status"/)
  })
})

describe('“Describe this graph”', () => {
  const description = describeBoard(parabola(), { answers: true })

  it('is a labelled modal dialog with the text, the alt text and two copies', () => {
    const html = renderToStaticMarkup(
      createElement(DescribeDialog, { description, studentCopy: false, onCopy: () => {}, onClose: () => {} }),
    )
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="describe-title"/)
    expect(html).toContain('<h2 id="describe-title"')
    expect(html).toContain('Copy description')
    expect(html).toContain('Copy alt text')
    expect(html).toContain('crosses the x-axis')
    expect(html).not.toContain('answers are left out')
  })

  it('says when reveal mode has left the answers out', () => {
    const html = renderToStaticMarkup(
      createElement(DescribeDialog, { description, studentCopy: true, onCopy: () => {}, onClose: () => {} }),
    )
    expect(html).toContain('answers are left out')
  })

  it('is in ⌘K, the help sheet and the toolbar’s ⋯', () => {
    expect(COMMAND_BY_ID.get('view-describe')?.group).toBe('View')
    expect(src('ui/Toolbar.tsx')).toContain('Describe this graph…')
  })
})

describe('exports carry the description', () => {
  it('an SVG is an image titled and described for assistive technology', () => {
    const svg = toSvg(emptyPage(10, 10), { title: 'Cubic & friends', desc: 'A graph <of> f.' })
    expect(svg).toMatch(/<svg [^>]*role="img" aria-labelledby="fig-title" aria-describedby="fig-desc">/)
    expect(svg).toContain('<title id="fig-title">Cubic &amp; friends</title>')
    expect(svg).toContain('<desc id="fig-desc">A graph &lt;of&gt; f.</desc>')
  })

  it('without a title or description the SVG is what it always was', () => {
    const svg = toSvg(emptyPage(10, 10))
    expect(svg).not.toContain('role="img"')
    expect(svg).not.toContain('<desc')
  })

  it('the SVG export passes the board’s description, and PNG offers “Copy alt text”', () => {
    expect(src('app/useExport.ts')).toContain('desc: svgDesc()')
    expect(src('ui/ExportMenu.tsx')).toContain('data-testid="export-copy-alt"')
    expect(app()).toContain('onCopyAltText=')
  })
})

function app(): string {
  return src('App.tsx')
}
