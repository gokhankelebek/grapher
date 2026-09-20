// ============================================================================
// tests/figureStyle.app.test.ts — the App's half of the figure styles: what a
// document remembers about the look it is in, and what the picker offers.
//
// The drawing is tested beside the renderer. What is tested HERE is the wiring:
// that a board nobody has restyled is byte-for-byte the document it was before
// figure styles existed; that a style and its caption survive a save and a
// load; that a style name this build does not have is REPORTED rather than
// silently swapped for another look; and that the thumbnails in the picker are
// real scenes the renderer accepts, one per style, since a picker whose
// pictures were icons would be a promise nothing checks.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  MAX_CAPTION_CHARS,
  boardToStored,
  deserializeDoc,
  docFromBoard,
  isFigureStyleId,
  serializeDoc,
  storedCaption,
  storedFigureStyle,
} from '../src/core/persist'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { FIGURE_STYLES } from '../src/core/types'
import type { FigureStyleId, FittedCurve } from '../src/core/types'
import {
  DEFAULT_CAPTION,
  FIGURE_BLURB,
  FIGURE_CHOICES,
  backgroundLockedNote,
  figureFor,
  figureTheme,
  fixesBackground,
  sampleScene,
} from '../src/ui/figureStyle'
import { captionHeight, renderBoard } from '../src/ui/renderBoard'
import { exportViewport } from '../src/ui/exportFit'
import { DEFAULT_EXPORT } from '../src/ui/renderBoard'
import type { FitExportSettings } from '../src/ui/exportFit'
import type { Viewport } from '../src/core/types'
import { MockCtx, withMockPath2D } from './mockCanvas'
import { DARK_THEME, LIGHT_THEME } from '../src/core/types'

const META: DocMeta = { id: 'doc1', name: 'Figure', createdAt: 1000, modifiedAt: 1000 }

function curve(over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId: 'poly2',
    params: [-1, 0, 0.5],
    kind: 'explicit',
    domain: [-3, 3],
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.01,
    ...over,
  }
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------

describe('the figure style in a document', () => {
  it('writes nothing at all for the screen look', () => {
    const plain = board({ curves: [curve()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const said = serializeDoc(
      docFromBoard(META, { ...plain, figure: 'screen', caption: '' }, 2000),
    )
    // Saying 'screen' out loud is the same document as not mentioning it.
    expect(said).toBe(a)
    expect(a).not.toContain('"figure"')
    expect(a).not.toContain('"caption"')
  })

  it('a blank caption is no caption, whatever it is made of', () => {
    const plain = board({ curves: [curve()] })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    for (const blank of ['', '   ', '\n\t']) {
      expect(serializeDoc(docFromBoard(META, { ...plain, caption: blank }, 2000))).toBe(a)
    }
  })

  it('writes and reads back a style and its caption', () => {
    const input = board({ curves: [curve()], figure: 'ap', caption: 'Graph of f' })
    const stored = boardToStored(input)
    expect(stored.figure).toBe('ap')
    expect(stored.caption).toBe('Graph of f')
    const back = deserializeDoc(serializeDoc(docFromBoard(META, input, 2000)))
    expect(back.board?.figure).toBe('ap')
    expect(back.board?.caption).toBe('Graph of f')
    expect(back.degraded).toBe(false)
    expect(back.problems).toEqual([])
  })

  it('carries a caption on any style, not only the AP one', () => {
    const back = deserializeDoc(
      serializeDoc(docFromBoard(META, board({ figure: 'sat', caption: 'Figure 3' }), 2000)),
    )
    expect(back.board?.figure).toBe('sat')
    expect(back.board?.caption).toBe('Figure 3')
  })

  it('a board with no style at all loads as the screen look, silently', () => {
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ curves: [curve()] }), 2000)))
    expect(back.board?.figure).toBe('screen')
    expect(back.board?.caption).toBe('')
    expect(back.degraded).toBe(false)
  })

  it('a style this build does not have falls back to screen AND says so', () => {
    const doc = JSON.parse(serializeDoc(docFromBoard(META, board({ figure: 'sat' }), 2000)))
    doc.board.figure = 'blackboard'
    const back = deserializeDoc(JSON.stringify(doc))
    expect(back.board?.figure).toBe('screen')
    expect(back.degraded).toBe(true)
    expect(back.problems.join(' ')).toContain('blackboard')
  })

  it('an unreadable style is reported too, without pretending to name it', () => {
    const doc = JSON.parse(serializeDoc(docFromBoard(META, board({}), 2000)))
    doc.board.figure = 7
    const back = deserializeDoc(JSON.stringify(doc))
    expect(back.board?.figure).toBe('screen')
    expect(back.degraded).toBe(true)
    expect(back.problems).toHaveLength(1)
  })

  it('a caption is one line, not a paragraph', () => {
    const long = 'x'.repeat(MAX_CAPTION_CHARS + 50)
    const back = deserializeDoc(
      serializeDoc(docFromBoard(META, board({ figure: 'ap', caption: long }), 2000)),
    )
    expect(back.board?.caption).toHaveLength(MAX_CAPTION_CHARS)
    expect(back.degraded).toBe(false)
  })

  it('reads a stored id the way the loader does', () => {
    expect(storedFigureStyle(undefined)).toBe('screen')
    expect(storedFigureStyle('nonsense')).toBe('screen')
    expect(storedFigureStyle(7)).toBe('screen')
    expect(storedFigureStyle('toString')).toBe('screen')
    for (const id of Object.keys(FIGURE_STYLES) as FigureStyleId[]) {
      expect(storedFigureStyle(id)).toBe(id)
      expect(isFigureStyleId(id)).toBe(true)
    }
    expect(isFigureStyleId('toString')).toBe(false)
  })

  it('reads a stored caption the way the loader does', () => {
    expect(storedCaption(undefined)).toBe('')
    expect(storedCaption(12)).toBe('')
    expect(storedCaption('  ')).toBe('')
    expect(storedCaption('Graph of f')).toBe('Graph of f')
  })
})

// ---------------------------------------------------------------------------
// the picker
// ---------------------------------------------------------------------------

describe('the figure style picker', () => {
  it('offers every style the renderer knows, screen first', () => {
    expect(FIGURE_CHOICES).toEqual(['screen', 'textbook', 'sat', 'ap'])
    expect([...FIGURE_CHOICES].sort()).toEqual(Object.keys(FIGURE_STYLES).sort())
  })

  it('says what each style does, in a line', () => {
    for (const id of FIGURE_CHOICES) {
      expect(FIGURE_BLURB[id].length).toBeGreaterThan(20)
      // The line names the style it is about, so it can be read on its own.
      expect(FIGURE_BLURB[id]).toContain(FIGURE_STYLES[id].name)
    }
  })

  it('the screen look is the ABSENCE of a style, so the old path is kept', () => {
    expect(figureFor('screen')).toBeUndefined()
    expect(figureFor('sat')).toBe(FIGURE_STYLES.sat)
    expect(figureTheme('screen', DARK_THEME)).toBe(DARK_THEME)
    expect(figureTheme('screen', LIGHT_THEME)).toBe(LIGHT_THEME)
    expect(figureTheme('sat', DARK_THEME).bg).toBe('#ffffff')
  })

  it('every style but screen owns the ground, and says why', () => {
    expect(fixesBackground('screen')).toBe(false)
    for (const id of ['textbook', 'sat', 'ap'] as FigureStyleId[]) {
      expect(fixesBackground(id)).toBe(true)
      expect(FIGURE_STYLES[id].theme.bg).toBe('#ffffff')
      expect(backgroundLockedNote(id)).toContain(FIGURE_STYLES[id].name)
    }
  })

  it('only the AP figure arrives with a caption', () => {
    expect(DEFAULT_CAPTION.ap).toBe('Graph of f')
    expect(DEFAULT_CAPTION.screen).toBe('')
    expect(DEFAULT_CAPTION.textbook).toBe('')
    expect(DEFAULT_CAPTION.sat).toBe('')
  })
})

// ---------------------------------------------------------------------------
// the thumbnails
// ---------------------------------------------------------------------------

describe('the thumbnails are real boards', () => {
  const W = 98
  const H = 64

  it('each one is the sample scene with its own style on it', () => {
    for (const id of FIGURE_CHOICES) {
      const scene = sampleScene(id, DARK_THEME, W, H)
      expect(scene.vp.widthPx).toBe(W)
      expect(scene.vp.heightPx).toBe(H)
      // Something to look at: a curve, and a window a few units across.
      expect(scene.curves).toHaveLength(1)
      expect(scene.vp.widthPx / scene.vp.pxPerUnit).toBeGreaterThan(4)
      // No chrome — a thumbnail is a figure, not a board being edited.
      expect(scene.chrome).toBeNull()
      expect(scene.figure).toBe(figureFor(id))
      expect(scene.theme.bg).toBe(figureTheme(id, DARK_THEME).bg)
    }
  })

  it('the screen thumbnail follows the theme toggle, the others do not', () => {
    expect(sampleScene('screen', LIGHT_THEME, W, H).theme).toBe(LIGHT_THEME)
    expect(sampleScene('screen', DARK_THEME, W, H).theme).toBe(DARK_THEME)
    expect(sampleScene('ap', DARK_THEME, W, H).theme.bg).toBe('#ffffff')
  })

  it('renders through renderBoard itself — all four, with something drawn', () => {
    for (const id of FIGURE_CHOICES) {
      const ctx = new MockCtx()
      withMockPath2D(() =>
        renderBoard(
          ctx as unknown as CanvasRenderingContext2D,
          sampleScene(id, DARK_THEME, W, H),
        ),
      )
      // The ground, and a curve on it.
      expect(ctx.fills[0]?.style).toBe(figureTheme(id, DARK_THEME).bg)
      expect(ctx.strokeCount).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// framing a captioned figure
// ---------------------------------------------------------------------------

describe('a caption gets room in the exported frame', () => {
  const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 60, widthPx: 800, heightPx: 600 }
  const BOX = { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } }
  const FIT: FitExportSettings = { ...DEFAULT_EXPORT, fit: true, aspect: 'auto' }

  /** Screen px between the lowest thing on the board and the bottom edge. */
  const roomBelow = (vp: Viewport): number =>
    vp.heightPx - ((vp.center.y - BOX.min.y) * vp.pxPerUnit + vp.heightPx / 2)

  it('reserves the caption band without changing the output size', () => {
    const bare = exportViewport(VP, FIT, BOX, 'cartesian', [], 0)
    const capped = exportViewport(VP, FIT, BOX, 'cartesian', [], captionHeight())
    expect(capped.widthPx).toBe(bare.widthPx)
    expect(capped.heightPx).toBe(bare.heightPx)
    expect(capped.pxPerUnit).toBeLessThan(bare.pxPerUnit)
    // Room for the line itself, and strictly more of it than an uncaptioned
    // frame gives — the band comes out of the scale, so the figure moves up.
    expect(roomBelow(capped)).toBeGreaterThanOrEqual(captionHeight())
    expect(roomBelow(capped)).toBeGreaterThan(roomBelow(bare))
  })

  it('an uncaptioned export is framed exactly as it was before', () => {
    expect(exportViewport(VP, FIT, BOX, 'cartesian', [], 0)).toEqual(
      exportViewport(VP, FIT, BOX, 'cartesian', []),
    )
  })

  it('leaves a window-framed export alone — the caption is already inside it', () => {
    const win: FitExportSettings = { ...FIT, fit: false }
    expect(exportViewport(VP, win, BOX, 'cartesian', [], captionHeight())).toEqual(
      exportViewport(VP, win, BOX, 'cartesian', []),
    )
  })
})
