// ============================================================================
// src/ui/renderBoard.ts — ONE routine that draws the board.
//
// The screen and the exported PNG are the same picture at different sizes, on
// different paper. Before this file they were two independent code paths, and
// they had already drifted: the export drew background + grid + curves and
// nothing else, so every analysis marker and label a teacher had switched on
// was silently dropped on the way out (measured: 1460 label pixels on screen,
// 0 in the file).
//
// So there is exactly one renderer. What separates the two callers is the
// SCENE they hand it, not the code that runs:
//
//   screen  : theme = dark (or the user's canvas choice), chrome = present
//   export  : theme = light/print, chrome = null, colours mapped to print
//
// `chrome` is the whole editing vocabulary — edit handles, hover/selection
// halos, in-progress ink, the fade of a just-recognised stroke. It is the
// scaffolding around the figure, never part of the figure, so the export path
// simply passes null and cannot accidentally inherit any of it.
//
// All drawing units are CSS pixels: the caller sets the DPR/scale transform.
// ============================================================================

import type {
  BoardKind,
  CurveHandle,
  FittedCurve,
  ModelSpec,
  NLItem,
  SpecialPoint,
  Theme,
  Vec2,
  Viewport,
} from '../core/types'
import { LIGHT_THEME, toPrintColor, toScreen } from '../core/types'
import type { StyleMap } from '../core/persist'
import { drawGrid } from '../render/grid'
import { drawCurve, drawInk } from '../render/curves'
import { drawNLItem, drawNumberLineAxis, nlLanes } from '../render/numberline'
import type { NLPart } from '../render/numberline'
import { formatCoord } from './numeric'

const TWO_PI = Math.PI * 2

/**
 * An analysis marker yields its spot to an interactive handle sitting within
 * this radius (a parabola's vertex is both a handle and a minimum). Exported
 * from here because the renderer and CanvasStage's marker hit-test must agree:
 * a marker that isn't drawn must never be clickable.
 */
export const HANDLE_HIT_RADIUS = 10

const LABEL_FONT = '11px "SF Mono", Menlo, Consolas, monospace'
/** Above this many on-screen points, labels would be an unreadable pile. */
const MAX_LABELS = 8
/** Two labels closer than this along the curve collapse to markers only. */
const MIN_LABEL_GAP = 28
/** Label text on a dark ground; on a light one the theme's own label colour. */
const DARK_TEXT = '#e6eaf5'

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Editing scaffolding. Present on screen, ALWAYS null for export. */
export interface BoardChrome {
  /** Selected curve id — draws the soft selection halo under its stroke. */
  selectedId: string | null
  /** Control handles of the selected curve. Also mask analysis markers. */
  handles: readonly CurveHandle[]
  /** Handle being dragged / hovered / edited — drawn slightly larger. */
  activeHandleId: string | null
  /** Analysis index emphasised because the readout row is hovered. */
  highlight: number | null
  /** Analysis index whose editor popover is open. */
  openIdx: number | null
  /** Analysis index under the pointer. */
  hoverIdx: number | null
  /** The just-recognised stroke, fading out. */
  fade?: { pts: readonly Vec2[]; alpha: number; color: string } | null
  /** Ink under the pen right now. */
  ink?: { pts: readonly Vec2[]; color: string } | null
  /** Per-curve fade-in alpha (a curve that has just appeared). */
  curveAlpha?: { id: string; alpha: number } | null
  /**
   * Number line: the endpoint under the pointer or being dragged. Emphasis
   * only — the dot is already drawn, this makes it a little bigger.
   */
  activePart?: { itemId: string; part: NLPart } | null
  /**
   * Number line: the item being dragged into existence right now. It is not in
   * `items` yet, so it exists only as chrome until the pointer comes up.
   */
  pending?: NLItem | null
}

export interface BoardScene {
  vp: Viewport
  theme: Theme
  curves: readonly FittedCurve[]
  styles: StyleMap
  models: Record<string, ModelSpec>
  /**
   * Which kind of board this scene is. Absent means 'cartesian', so every
   * existing caller keeps drawing exactly what it drew before.
   */
  kind?: BoardKind
  /** Number-line boards draw these instead of curves. */
  items?: readonly NLItem[]
  /** Markers + labels for one curve. Null/absent when the toggle is off. */
  analysis?: { curve: FittedCurve; points: readonly SpecialPoint[] } | null
  /** Map curve colours to their print counterparts (export on white). */
  printColors?: boolean
  /** Editing chrome. Null = the figure alone. */
  chrome?: BoardChrome | null
}

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

/**
 * Relative luminance of the ground, so a theme the caller invented still gets
 * readable label text without having to declare a text colour.
 */
function isDarkGround(theme: Theme): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(theme.bg.trim())
  if (!m) return true
  const v = parseInt(m[1], 16)
  const r = (v >> 16) & 255
  const g = (v >> 8) & 255
  const b = v & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

function textColor(theme: Theme): string {
  return isDarkGround(theme) ? DARK_TEXT : theme.label
}

// ---------------------------------------------------------------------------
// Analysis markers and labels
// ---------------------------------------------------------------------------

function labelFor(p: SpecialPoint): string {
  // p.exact says whether this location was solved in closed form or located
  // numerically; the formatter uses it so a numeric result is not printed to
  // more digits than the method can actually support.
  const o = { exact: p.exact }
  if (p.kind === 'zero') {
    return `${formatCoord(p.pos.x, o)}${p.tangent ? ' (touches)' : ''}`
  }
  return `(${formatCoord(p.pos.x, o)}, ${formatCoord(p.pos.y, o)})`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  p: SpecialPoint,
  sx: number,
  sy: number,
  color: string,
  bg: string,
  grow: number,
): void {
  const ring = (r: number, lw: number): void => {
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, TWO_PI)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.lineWidth = lw
    ctx.strokeStyle = color
    ctx.stroke()
  }
  const dot = (r: number, alpha: number): void => {
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, TWO_PI)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = bg
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  switch (p.kind) {
    case 'zero':
      // hollow ring, sitting on the axis
      ring(4 + grow, 1.8)
      break
    case 'maximum':
    case 'minimum':
      dot(3.5 + grow, 1)
      break
    case 'inflection': {
      // diamond — deliberately not a circle, so concavity reads at a glance
      const d = 4.6 + grow
      ctx.beginPath()
      ctx.moveTo(sx, sy - d)
      ctx.lineTo(sx + d, sy)
      ctx.lineTo(sx, sy + d)
      ctx.lineTo(sx - d, sy)
      ctx.closePath()
      ctx.fillStyle = bg
      ctx.fill()
      ctx.lineWidth = 1.7
      ctx.strokeStyle = color
      ctx.stroke()
      break
    }
    case 'y-intercept':
      dot(2.6 + grow, 0.62)
      break
    default:
      dot(3 + grow, 0.74)
      break
  }
}

/**
 * The affordance a marker only shows on approach: dashed while hovered, solid
 * while its editor is open. Deliberately a ring AROUND the glyph rather than a
 * change to the glyph, so the marker's own shape — which encodes what kind of
 * feature it is — stays exactly as it reads at rest.
 *
 * Chrome: it answers the pointer, not the maths, so it never reaches export.
 */
function drawMarkerHalo(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
  open: boolean,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(sx, sy, 10, 0, TWO_PI)
  ctx.strokeStyle = color
  ctx.globalAlpha = open ? 0.92 : 0.5
  ctx.lineWidth = open ? 1.6 : 1.2
  if (!open) ctx.setLineDash([2.5, 3])
  ctx.stroke()
  ctx.restore()
}

interface AnalysisOpts {
  color: string
  theme: Theme
  /** Empty for export: with no handles on the board, nothing masks a marker. */
  handles: readonly CurveHandle[]
  highlight: number | null
  openIdx: number | null
  hoverIdx: number | null
  /** Hover/open rings are chrome; suppressed when chrome is off. */
  halos: boolean
}

export function drawAnalysis(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly SpecialPoint[],
  o: AnalysisOpts,
): void {
  if (points.length === 0) return

  const handlePts = o.handles.map((h) => toScreen(h.pos, vp))
  const shown: { p: SpecialPoint; sx: number; sy: number; i: number }[] = []

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
    const s = toScreen(p.pos, vp)
    if (s.x < -30 || s.y < -30 || s.x > vp.widthPx + 30 || s.y > vp.heightPx + 30) continue
    // Yield the spot to an interactive handle, unless this is the one the user
    // is pointing at in the readout.
    if (i !== o.highlight && i !== o.openIdx) {
      let masked = false
      for (const hp of handlePts) {
        if (Math.hypot(hp.x - s.x, hp.y - s.y) <= HANDLE_HIT_RADIUS) {
          masked = true
          break
        }
      }
      if (masked) continue
    }
    shown.push({ p, sx: s.x, sy: s.y, i })
  }
  if (shown.length === 0) return

  const bg = o.theme.bg
  for (const m of shown) {
    const emphasised = m.i === o.highlight || m.i === o.openIdx
    if (o.halos && (m.i === o.openIdx || m.i === o.hoverIdx)) {
      drawMarkerHalo(ctx, m.sx, m.sy, o.color, m.i === o.openIdx)
    }
    const grow = emphasised ? 2.5 : o.halos && m.i === o.hoverIdx ? 1.2 : 0
    drawMarker(ctx, m.p, m.sx, m.sy, o.color, bg, grow)
  }

  // --- labels, only while they can still be read
  if (shown.length > MAX_LABELS) return
  const ordered = shown.slice().sort((a, b) => a.sx - b.sx)
  ctx.font = LABEL_FONT
  ctx.textBaseline = 'middle'
  const placed: { x: number; y: number; w: number; h: number }[] = []
  let lastX = -Infinity
  const text0 = textColor(o.theme)

  const emph = (i: number): boolean => i === o.highlight || i === o.openIdx

  for (const m of ordered) {
    // crowded neighbours: keep the markers, drop the text
    if (!emph(m.i) && m.sx - lastX < MIN_LABEL_GAP) continue
    const text = labelFor(m.p)
    const w = ctx.measureText(text).width + 10
    const h = 16
    // try above-right first, then a few vertical nudges
    const candidates = [m.sy - 14, m.sy - 30, m.sy + 16, m.sy + 32, m.sy - 46]
    let box: { x: number; y: number; w: number; h: number } | null = null
    for (const cy of candidates) {
      const x = Math.min(Math.max(m.sx + 8, 2), vp.widthPx - w - 2)
      const y = cy - h / 2
      if (y < 2 || y + h > vp.heightPx - 2) continue
      const clash = placed.some(
        (r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y,
      )
      if (!clash) {
        box = { x, y, w, h }
        break
      }
    }
    if (!box) continue

    ctx.globalAlpha = 0.86
    roundRect(ctx, box.x, box.y, box.w, box.h, 4)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = emph(m.i) ? o.color : o.theme.gridMajor
    ctx.stroke()
    ctx.fillStyle = emph(m.i) ? o.color : text0
    ctx.fillText(text, box.x + 5, box.y + h / 2)

    placed.push(box)
    lastX = m.sx
  }
  ctx.textBaseline = 'alphabetic'
}

// ---------------------------------------------------------------------------
// Handles (chrome)
// ---------------------------------------------------------------------------

function drawHandles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  color: string,
  handles: readonly CurveHandle[],
  activeId: string | null,
): void {
  for (const h of handles) {
    const sp = toScreen(h.pos, vp)
    if (
      !Number.isFinite(sp.x) ||
      !Number.isFinite(sp.y) ||
      sp.x < -24 ||
      sp.y < -24 ||
      sp.x > vp.widthPx + 24 ||
      sp.y > vp.heightPx + 24
    ) {
      continue
    }
    const grow = h.id === activeId ? 1.5 : 0
    if (h.kind === 'domain-start' || h.kind === 'domain-end') {
      // slightly larger, ring only
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, 6 + grow, 0, TWO_PI)
      ctx.fillStyle = theme.bg
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.stroke()
    } else if (h.kind === 'center') {
      // crosshair dot
      const arm = 7 + grow
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sp.x - arm, sp.y)
      ctx.lineTo(sp.x + arm, sp.y)
      ctx.moveTo(sp.x, sp.y - arm)
      ctx.lineTo(sp.x, sp.y + arm)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, 2.5 + grow * 0.5, 0, TWO_PI)
      ctx.fillStyle = color
      ctx.fill()
    } else {
      // feature point: filled dot with bg ring
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, 5 + grow, 0, TWO_PI)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = theme.bg
      ctx.stroke()
    }
  }
}

// ---------------------------------------------------------------------------
// The one render routine
// ---------------------------------------------------------------------------

/**
 * Draw the whole board into `ctx`, in CSS pixels, filling vp.widthPx ×
 * vp.heightPx from the current transform origin.
 *
 * Order is deliberate: ground, grid, curves, analysis, handles, ink. Analysis
 * markers go UNDER the handles — handles are interactive and must stay visually
 * dominant wherever the two coincide.
 */
export function renderBoard(ctx: CanvasRenderingContext2D, scene: BoardScene): void {
  const { vp, theme, models } = scene
  const chrome = scene.chrome ?? null
  const print = scene.printColors === true
  const paint = (c: string): string => (print ? toPrintColor(c) : c)

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, Math.max(0, vp.widthPx), Math.max(0, vp.heightPx))

  // A number line is a different KIND of board, not a curve drawn differently:
  // no grid, no y axis, no models. It goes through this same routine — and so
  // through the same export — precisely so it can never grow a second path.
  if (scene.kind === 'number-line') {
    renderNumberLine(ctx, scene, chrome, paint)
    return
  }

  try {
    drawGrid(ctx, vp, theme)
  } catch {
    /* grid module absent or failed — keep going */
  }

  for (const curve of scene.curves) {
    if (!curve.visible) continue
    const style = scene.styles[curve.id]
    let alpha = 1
    const fadeIn = chrome?.curveAlpha
    if (fadeIn && fadeIn.id === curve.id) alpha = Math.max(0, Math.min(1, fadeIn.alpha))
    if (style?.opacity !== undefined) alpha *= style.opacity
    ctx.globalAlpha = alpha
    if (style?.dash) ctx.setLineDash(style.dash)
    try {
      // The selection halo is chrome: it says "this one is selected", not
      // anything about the maths, so it must not reach the exported figure.
      const selected = chrome !== null && curve.id === chrome.selectedId
      const c = print ? { ...curve, color: paint(curve.color) } : curve
      drawCurve(ctx, c, models, vp, selected)
    } catch {
      /* curve render failed — skip */
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const an = scene.analysis ?? null
  if (an && an.points.length > 0 && an.curve.visible) {
    try {
      drawAnalysis(ctx, vp, an.points, {
        color: paint(an.curve.color),
        theme,
        handles: chrome?.handles ?? [],
        highlight: chrome?.highlight ?? null,
        openIdx: chrome?.openIdx ?? null,
        hoverIdx: chrome?.hoverIdx ?? null,
        halos: chrome !== null,
      })
    } catch {
      /* analysis render failed — the board still stands */
    }
  }

  if (chrome) {
    const sel = scene.curves.find((c) => c.id === chrome.selectedId && c.visible)
    if (sel && chrome.handles.length > 0) {
      drawHandles(ctx, vp, theme, sel.color, chrome.handles, chrome.activeHandleId)
    }
    if (chrome.fade) {
      ctx.globalAlpha = Math.max(0, Math.min(1, chrome.fade.alpha))
      try {
        drawInk(ctx, chrome.fade.pts as Vec2[], vp, chrome.fade.color)
      } catch {
        /* ignore */
      }
      ctx.globalAlpha = 1
    }
    if (chrome.ink && chrome.ink.pts.length > 1) {
      try {
        drawInk(ctx, chrome.ink.pts as Vec2[], vp, chrome.ink.color)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * The number-line half of the one render routine.
 *
 * Same contract as the cartesian half: everything in `items` is the figure and
 * reaches the export; everything in `chrome` (selection wash, endpoint
 * emphasis, the interval currently being dragged out) is scaffolding and stops
 * at the screen.
 */
function renderNumberLine(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  chrome: BoardChrome | null,
  paint: (c: string) => string,
): void {
  const { vp, theme } = scene
  const items = scene.items ?? []

  try {
    drawNumberLineAxis(ctx, vp, theme)
  } catch {
    /* axis render failed — items still stand */
  }

  const lanes = nlLanes(items, vp)
  for (const { item, y } of lanes) {
    const style = scene.styles[item.id]
    try {
      drawNLItem(ctx, item, vp, {
        color: paint(item.color),
        theme,
        y,
        barWidth: style?.width,
        ...(style?.dash ? { dash: style.dash } : {}),
        ...(style?.opacity !== undefined ? { opacity: style.opacity } : {}),
        selected: chrome !== null && item.id === chrome.selectedId,
        activePart:
          chrome && chrome.activePart && chrome.activePart.itemId === item.id
            ? chrome.activePart.part
            : null,
      })
    } catch {
      /* one bad item must not take the board down */
    }
  }

  // Chrome: the interval being dragged out right now, drawn on the top lane so
  // it never hides behind what is already there.
  if (chrome?.pending) {
    // Laid out WITH the existing items, so it lands in the lane it will keep
    // when the pointer comes up — the preview doesn't jump on release.
    const withPending = nlLanes([...items, chrome.pending], vp)
    const spot = withPending[withPending.length - 1]
    try {
      drawNLItem(ctx, chrome.pending, vp, {
        color: paint(chrome.pending.color),
        theme,
        y: spot ? spot.y : numberLineTopY(vp),
        // Slightly ghosted: it is a promise, not yet a fact.
        opacity: 0.85,
        selected: false,
        activePart: null,
      })
    } catch {
      /* preview only — never worth a broken frame */
    }
  }
}

/** Where the pending item sits when nothing else is on the board. */
function numberLineTopY(vp: Viewport): number {
  return Math.round(vp.heightPx / 2)
}

// ---------------------------------------------------------------------------
// Export composition — the same scene, on paper of a stated size
// ---------------------------------------------------------------------------

/**
 * How big the PNG is, and how much white sits around the plot. A worksheet
 * wants every figure the same size, so this has to be statable rather than
 * "whatever my window happened to be".
 */
export interface ExportSettings {
  /** Multiplier on the on-screen size. Ignored when `width` is set. */
  scale: number
  /** Exact output width of the whole image in px; null = use `scale`. */
  width: number | null
  /** Quiet margin around the plot, in CSS px before scaling. */
  margin: number
  /** Which ground the figure is drawn on. Default: light, for paper. */
  theme: 'light' | 'dark'
}

export const EXPORT_SCALES = [1, 2, 4] as const

export const DEFAULT_EXPORT: ExportSettings = {
  scale: 2,
  width: null,
  margin: 24,
  theme: 'light',
}

export const MIN_EXPORT_WIDTH = 200
export const MAX_EXPORT_WIDTH = 8000
export const MAX_EXPORT_MARGIN = 200
/** Above this the browser silently hands back a blank canvas on some devices. */
const MAX_EXPORT_PIXELS = 40e6

export function clampExportSettings(s: ExportSettings): ExportSettings {
  const scale = Number.isFinite(s.scale) ? Math.min(8, Math.max(0.25, s.scale)) : 2
  const margin = Number.isFinite(s.margin)
    ? Math.round(Math.min(MAX_EXPORT_MARGIN, Math.max(0, s.margin)))
    : DEFAULT_EXPORT.margin
  const width =
    s.width === null || !Number.isFinite(s.width)
      ? null
      : Math.round(Math.min(MAX_EXPORT_WIDTH, Math.max(MIN_EXPORT_WIDTH, s.width)))
  return { scale, width, margin, theme: s.theme === 'dark' ? 'dark' : 'light' }
}

export interface ExportGeometry {
  /** Output pixel size of the whole image, margins included. */
  w: number
  h: number
  /** Device-pixel multiplier actually used. */
  scale: number
  /** Margin in output pixels. */
  margin: number
}

/**
 * Output geometry for a viewport. `width`, when set, is the width of the whole
 * image including margins — that is the number a teacher can state and reuse
 * across a document.
 */
export function exportGeometry(vp: Viewport, raw: ExportSettings): ExportGeometry {
  const s = clampExportSettings(raw)
  const plotW = Math.max(1, vp.widthPx)
  const plotH = Math.max(1, vp.heightPx)
  const layoutW = plotW + 2 * s.margin
  const layoutH = plotH + 2 * s.margin
  let scale = s.width !== null ? s.width / layoutW : s.scale
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1
  // Keep the image inside what canvas can actually rasterise.
  const px = layoutW * scale * layoutH * scale
  if (px > MAX_EXPORT_PIXELS) scale *= Math.sqrt(MAX_EXPORT_PIXELS / px)
  return {
    w: Math.max(1, Math.round(layoutW * scale)),
    h: Math.max(1, Math.round(layoutH * scale)),
    scale,
    margin: s.margin * scale,
  }
}

/**
 * Render the scene onto its own canvas at the stated output size, with the
 * margin band painted in the theme's ground and the plot clipped to its own
 * rect so nothing bleeds into the quiet edge.
 */
export function renderBoardToCanvas(
  scene: BoardScene,
  settings: ExportSettings,
): { canvas: HTMLCanvasElement; geometry: ExportGeometry } | null {
  const geo = exportGeometry(scene.vp, settings)
  const canvas = document.createElement('canvas')
  canvas.width = geo.w
  canvas.height = geo.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = scene.theme.bg
  ctx.fillRect(0, 0, geo.w, geo.h)

  ctx.save()
  ctx.setTransform(geo.scale, 0, 0, geo.scale, geo.margin, geo.margin)
  ctx.beginPath()
  ctx.rect(0, 0, scene.vp.widthPx, scene.vp.heightPx)
  ctx.clip()
  renderBoard(ctx, scene)
  ctx.restore()

  return { canvas, geometry: geo }
}

/** The theme an export setting names. */
export function exportTheme(settings: ExportSettings, dark: Theme): Theme {
  return settings.theme === 'dark' ? dark : LIGHT_THEME
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png')
    } catch {
      resolve(null)
    }
  })
}
