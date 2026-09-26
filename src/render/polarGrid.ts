// ============================================================================
// src/render/polarGrid.ts — the board a polar lesson is actually drawn on.
//
// A rose, a limaçon and a spiral are all defined by (r, θ); reading one off a
// square lattice means the class converts every point twice, once out of the
// picture and once back into the equation. A textbook polar grid states the
// coordinate system the curve lives in: concentric circles for r, radial spokes
// for θ.
//
// It is the SAME grid as the cartesian one wherever it can be:
//
//   - the circle radii come off `pickTickStep` / `pickPiTickStep`, so a board
//     switched from cartesian to polar keeps the numbers it already had;
//   - minor / major / axis are the same three-rung ladder of weight AND colour
//     (GRID_*_WIDTH × theme.grid*), so the structure survives a projector;
//   - the labels are the same font, the same colour (theme.label, a step above
//     the axis line) and the same π formatting as the cartesian ticks.
//
// The one thing that has no cartesian counterpart is the POLE. Every spoke
// converges there, so at small radii they are closer together than they are
// wide and the centre fills in solid. Non-axis spokes therefore start outside a
// small inner radius; the two axes still cross at the pole, because θ = 0 and
// θ = π/2 are axes before they are spokes.
//
// All drawing units are CSS pixels (ctx is already DPR-scaled by the caller).
// ============================================================================

import type { Viewport, Theme } from '../core/types'
import { isStretched, ppuX, ppuY } from '../core/types'
import type { AxisUnits, GridStep, GridStyle, PaintScale, PiStep } from './grid'
import {
  ARROW_HALF,
  ARROW_LEN,
  GRID_AXIS_WIDTH,
  GRID_MAJOR_WIDTH,
  GRID_MINOR_WIDTH,
  LABEL_PX,
  PI_LABEL_MIN_PX,
  formatPiTick,
  formatTick,
  labelFont,
  SCREEN_GRID,
  drawGrid,
  isPiStep,
  paintScale,
  pickPiTickStep,
  pickTickStep,
} from './grid'

const TWO_PI = Math.PI * 2

/**
 * The finest spoke spacing the board ever uses is π/24 and the coarsest π/12,
 * so the spoke set is fixed in ANGLE. What changes with the viewport is only
 * whether the π/24 rung is worth drawing.
 */
const SPOKE_BASE_DEN = 12

/**
 * Subdivide to π/24 when adjacent π/12 spokes are further apart than this at
 * the outermost fully visible circle — the same circle the angle labels sit on,
 * so "the spokes look sparse out there" and "the labels look sparse out there"
 * are one judgement rather than two.
 *
 * Measured at the INSCRIBED circle, not at the far corner, on purpose. The tick
 * ladder keeps the grid's pixel density constant under zoom (that is what
 * `pickTickStep` is for), so there is no such thing as "zoomed in far enough"
 * for a spoke fan — only "this board is physically big". A 1200×800 board fans
 * to 105px at its inscribed circle and stays at 24 spokes; a 1920×1080 projector
 * board reaches 141px and earns the π/24 rung.
 */
const SPOKE_SUBDIVIDE_PX = 120

/**
 * How far apart adjacent spokes must be before they are worth drawing at all.
 * Below this they are a black blob, not a coordinate system — so the non-axis
 * spokes begin at the radius where they have already separated by this much.
 */
const SPOKE_MIN_GAP_PX = 8

/**
 * Hard cap on circles. With the origin panned far off-screen the visible
 * annulus can be hundreds of rungs deep, and a hundred near-parallel arcs is
 * not a grid, it is hatching. Past the cap the radius step climbs the 1–2–5
 * ladder (×2, ×5, ×10 …) so the radii that survive are still ladder radii and
 * still carry honest labels.
 */
const MAX_CIRCLES = 60

/** Below this the inscribed circle is too small to hang angle labels on. */
const MIN_ANGLE_LABEL_RADIUS_PX = 40

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * The portion of the ray `O + t·u`, `t ∈ [t0, t1]`, that lies inside the
 * viewport rect — Liang–Barsky. Null when the ray misses the rect entirely,
 * which is how a spoke pointing away from a panned-off-screen board is culled
 * rather than drawn and clipped away by the rasteriser.
 */
function clipRay(
  ox: number,
  oy: number,
  ux: number,
  uy: number,
  t0: number,
  t1: number,
  W: number,
  H: number,
): [number, number] | null {
  let a = t0
  let b = t1
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > b) return false
      if (r > a) a = r
    } else {
      if (r < a) return false
      if (r < b) b = r
    }
    return true
  }
  if (!test(-ux, ox)) return null
  if (!test(ux, W - ox)) return null
  if (!test(-uy, oy)) return null
  if (!test(uy, H - oy)) return null
  return a <= b ? [a, b] : null
}

/** Wrap to (-π, π]. */
function wrapPi(a: number): number {
  let x = a
  while (x <= -Math.PI) x += TWO_PI
  while (x > Math.PI) x -= TWO_PI
  return x
}

interface PolarGeometry {
  /** Screen position of the math origin — routinely off-canvas. */
  ox: number
  oy: number
  /** Distance in px from the origin to the nearest / farthest point of the rect. */
  rMinPx: number
  rMaxPx: number
  /** Radius of the largest circle wholly inside the rect; 0 when the pole is out. */
  rFitPx: number
  inside: boolean
  /** Screen-angle span of the rect seen from the pole; null when it is 360°. */
  span: [number, number] | null
}

/**
 * Where the pole sits and which radii can possibly be seen from it.
 *
 * `rMin`/`rMax` bound the visible annulus exactly: the distance from the pole
 * to a point of the rect is continuous over a connected set, so EVERY radius in
 * [rMin, rMax] meets the viewport and no radius outside it does. That is the
 * whole visibility test for a circle — no per-arc rectangle intersection.
 */
export function polarGeometry(vp: Viewport): PolarGeometry {
  const W = vp.widthPx
  const H = vp.heightPx
  // The pole is a POINT, so it goes through each axis' own scale (identical on
  // the equal-axes board this geometry is ever drawn on).
  const ox = W / 2 - vp.center.x * ppuX(vp)
  const oy = H / 2 + vp.center.y * ppuY(vp)
  const corners: Array<[number, number]> = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]
  let rMaxPx = 0
  for (const [cx, cy] of corners) rMaxPx = Math.max(rMaxPx, Math.hypot(cx - ox, cy - oy))
  const dx = Math.max(0, -ox, ox - W)
  const dy = Math.max(0, -oy, oy - H)
  const rMinPx = Math.hypot(dx, dy)
  const inside = ox >= 0 && ox <= W && oy >= 0 && oy <= H
  const rFitPx = inside ? Math.min(ox, W - ox, oy, H - oy) : 0

  // Outside the rect the pole sees it through an angular window narrower than
  // π (the rect is convex and does not contain the pole), so unwrapping the
  // four corner angles against the first one cannot alias.
  let span: [number, number] | null = null
  if (!inside) {
    const a0 = Math.atan2(corners[0][1] - oy, corners[0][0] - ox)
    let lo = 0
    let hi = 0
    for (const [cx, cy] of corners) {
      const d = wrapPi(Math.atan2(cy - oy, cx - ox) - a0)
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    span = [a0 + lo, a0 + hi]
  }
  return { ox, oy, rMinPx, rMaxPx, rFitPx, inside, span }
}

/**
 * The radius ladder, thinned until it fits the circle budget.
 *
 * `mult` is what the ladder step was multiplied by, and it is carried rather
 * than folded into `step` because a π rung has to be LABELLED as the exact
 * fraction (k·mult·num)/den — deriving "which multiple of π is this" back out
 * of a float is how a board ends up printing 2π/2.
 */
export function polarRadiusStep(
  base: GridStep | PiStep,
  rMin: number,
  rMax: number,
): { major: number; mult: number; from: number; to: number } {
  const FACTORS = [1, 2, 5]
  let mult = 1
  for (let i = 0; i < 40; i++) {
    const major = base.major * mult
    const from = Math.max(1, Math.ceil(rMin / major - 1e-9))
    const to = Math.floor(rMax / major + 1e-9)
    if (to - from + 1 <= MAX_CIRCLES) return { major, mult, from, to }
    mult = FACTORS[(i + 1) % 3] * Math.pow(10, Math.floor((i + 1) / 3))
  }
  const major = base.major * mult
  return { major, mult, from: 1, to: 0 }
}

/** Angle index → the label a teacher writes: `π/6`, `3π/4`, `11π/6`. */
export function angleLabel(k: number, den: number): string {
  return formatPiTick(k, den)
}

/**
 * Draw the polar grid: circles of constant r, spokes of constant θ, radius
 * labels along θ = 0 and angle labels around the outermost fully visible
 * circle. Same signature as `drawGrid`, so `renderBoard` dispatches on one
 * field and nothing else changes.
 */
export function drawPolarGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  theme: Theme,
  opts?: PaintScale | null,
  units?: AxisUnits | null,
  style?: GridStyle | null,
): void {
  // A circle of constant r is only a circle on screen when one pixel is the
  // same length in x and y. On a stretched board every ring would be an
  // ellipse and every spoke would sit at the wrong angle — a ruling that lies
  // about the coordinate system it names. The App refuses polar ruling while
  // stretched; if one ever arrives here anyway, the cartesian grid is drawn.
  if (isStretched(vp)) {
    drawGrid(ctx, vp, theme, opts, units, style)
    return
  }
  const { type, stroke } = paintScale(opts)
  const st = style ?? SCREEN_GRID
  /**
   * Is the board RULED? A figure style that says "no gridlines" means it here
   * too — and it takes the angle labels with it. Measured on the AP preset,
   * whose ruling colour is the ground: the circles and spokes vanished and
   * left "2π/3", "3π/4", "5π/6" floating on blank paper, naming rays that were
   * no longer drawn.
   */
  const ruled = st.grid === 'lines'
  const fpx = LABEL_PX * type
  const W = vp.widthPx
  const H = vp.heightPx
  const ppu = vp.pxPerUnit
  if (W <= 0 || H <= 0 || !(ppu > 0)) {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, Math.max(0, W), Math.max(0, H))
    return
  }

  ctx.save()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)

  const geo = polarGeometry(vp)
  const { ox, oy, rMinPx, rMaxPx, rFitPx, inside, span } = geo

  // ---- the radius ladder ---------------------------------------------------
  // r is a LENGTH measured along θ = 0, so it reads the x ladder: a board whose
  // x axis is in π keeps its π radii when it turns polar.
  const base: GridStep | PiStep =
    units?.x === 'pi'
      ? pickPiTickStep(ppu, PI_LABEL_MIN_PX * type)
      : pickTickStep(ppu)
  const rMin = rMinPx / ppu
  const rMax = rMaxPx / ppu
  const rings = polarRadiusStep(base, rMin, rMax)
  const minorStep = base.major / base.minorDiv

  /** A full circle when the pole is on the board, the visible arc when it is not. */
  const arcAt = (rPx: number): void => {
    const a0 = span ? span[0] : 0
    const a1 = span ? span[1] : TWO_PI
    ctx.moveTo(ox + rPx * Math.cos(a0), oy + rPx * Math.sin(a0))
    ctx.arc(ox, oy, rPx, a0, a1)
  }

  // ---- minor circles -------------------------------------------------------
  // Only while the majors are still the ladder's own rung: once the majors have
  // been thinned to fit the budget the minors are far past it, and a thinned
  // minor is a hairline at a radius nothing labels.
  let minorCount = 0
  const jFrom = Math.max(1, Math.ceil(rMin / minorStep - 1e-9))
  const jTo = Math.floor(rMax / minorStep + 1e-9)
  if (rings.mult === 1) {
    for (let j = jFrom; j <= jTo; j++) {
      if (j % base.minorDiv === 0) continue
      minorCount++
    }
  }
  const majorCount = Math.max(0, rings.to - rings.from + 1)
  const drawMinors = rings.mult === 1 && minorCount > 0 && majorCount + minorCount <= MAX_CIRCLES

  if (drawMinors && ruled) {
    ctx.lineWidth = GRID_MINOR_WIDTH * stroke
    ctx.strokeStyle = theme.gridMinor
    ctx.beginPath()
    for (let j = jFrom; j <= jTo; j++) {
      if (j % base.minorDiv === 0) continue
      arcAt(j * minorStep * ppu)
    }
    ctx.stroke()
  }

  // ---- major circles -------------------------------------------------------
  if (ruled) {
    ctx.lineWidth = GRID_MAJOR_WIDTH * stroke
    ctx.strokeStyle = theme.gridMajor
    ctx.beginPath()
    for (let k = rings.from; k <= rings.to; k++) arcAt(k * rings.major * ppu)
    ctx.stroke()
  }

  // ---- spokes --------------------------------------------------------------
  // π/12 (15°) is the rung a class already names. π/6 and π/4 multiples carry
  // major weight because those are the angles a polar problem is actually posed
  // at; the leftovers (π/12, 5π/12 …) are minors, structure rather than
  // landmarks.
  const subdivide = inside && rFitPx * (Math.PI / SPOKE_BASE_DEN) > SPOKE_SUBDIVIDE_PX
  const den = subdivide ? SPOKE_BASE_DEN * 2 : SPOKE_BASE_DEN
  const n = den * 2
  const dTheta = Math.PI / den
  // Non-axis spokes start where they have already separated by SPOKE_MIN_GAP_PX,
  // which is the whole reason the pole is not a black disc.
  const rInnerPx = Math.min(SPOKE_MIN_GAP_PX / dTheta, rMaxPx)

  // θ = 0, π/2, π, 3π/2 — a quarter turn is den/2 rungs on either ladder.
  const isAxis = (k: number): boolean => k % (den / 2) === 0
  const isMajor = (k: number): boolean =>
    subdivide ? k % 4 === 0 || k % 6 === 0 : k % 2 === 0 || k % 3 === 0

  /** [tIn, tOut] in px along direction k, or null when it misses the board. */
  const segments: Array<[number, number] | null> = []
  for (let k = 0; k < n; k++) {
    const th = k * dTheta
    const ux = Math.cos(th)
    const uy = -Math.sin(th) // screen y grows downward
    const t0 = isAxis(k) ? 0 : rInnerPx
    segments.push(clipRay(ox, oy, ux, uy, Math.min(t0, rMaxPx), rMaxPx, W, H))
  }

  const strokeSpokes = (want: (k: number) => boolean, width: number, color: string): void => {
    let any = false
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let k = 0; k < n; k++) {
      if (!want(k)) continue
      const seg = segments[k]
      if (!seg) continue
      const th = k * dTheta
      const ux = Math.cos(th)
      const uy = -Math.sin(th)
      ctx.moveTo(ox + ux * seg[0], oy + uy * seg[0])
      ctx.lineTo(ox + ux * seg[1], oy + uy * seg[1])
      any = true
    }
    if (any) ctx.stroke()
  }

  if (ruled) {
    strokeSpokes((k) => !isAxis(k) && !isMajor(k), GRID_MINOR_WIDTH * stroke, theme.gridMinor)
    strokeSpokes((k) => !isAxis(k) && isMajor(k), GRID_MAJOR_WIDTH * stroke, theme.gridMajor)
  }

  // ---- axes ----------------------------------------------------------------
  // θ = 0 and θ = π/2 are the x and y axes before they are spokes: axis weight,
  // axis colour, and the same arrowheads the cartesian board draws, so the two
  // grids share one vocabulary for "this is the frame, not the ruling".
  strokeSpokes(isAxis, GRID_AXIS_WIDTH * stroke, theme.axis)

  const yAxisVisible = ox >= 0 && ox <= W
  const xAxisVisible = oy >= 0 && oy <= H
  ctx.fillStyle = theme.axis
  if (yAxisVisible && st.arrows !== 'none') {
    ctx.beginPath()
    ctx.moveTo(ox, 0)
    ctx.lineTo(ox - ARROW_HALF, ARROW_LEN)
    ctx.lineTo(ox + ARROW_HALF, ARROW_LEN)
    ctx.closePath()
    if (st.arrows === 'four') {
      ctx.moveTo(ox, H)
      ctx.lineTo(ox - ARROW_HALF, H - ARROW_LEN)
      ctx.lineTo(ox + ARROW_HALF, H - ARROW_LEN)
      ctx.closePath()
    }
    ctx.fill()
  }
  if (xAxisVisible && st.arrows !== 'none') {
    ctx.beginPath()
    ctx.moveTo(W, oy)
    ctx.lineTo(W - ARROW_LEN, oy - ARROW_HALF)
    ctx.lineTo(W - ARROW_LEN, oy + ARROW_HALF)
    ctx.closePath()
    if (st.arrows === 'four') {
      ctx.moveTo(0, oy)
      ctx.lineTo(ARROW_LEN, oy - ARROW_HALF)
      ctx.lineTo(ARROW_LEN, oy + ARROW_HALF)
      ctx.closePath()
    }
    ctx.fill()
  }

  // ---- radius labels, along θ = 0 -----------------------------------------
  // Exactly the cartesian x-tick treatment: theme.label (a step above the axis
  // line), centred under the point, sliding along the edge when the pole's row
  // is off the board.
  ctx.font = labelFont(st, fpx)
  ctx.fillStyle = theme.label
  {
    const labelY = clamp(oy + 5 * type, 4, H - fpx - 6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const edge = Math.max(14, fpx + 3)
    for (let k = rings.from; k <= rings.to; k++) {
      const px = ox + k * rings.major * ppu
      if (px < edge || px > W - edge) continue
      const text = isPiStep(base)
        ? formatPiTick(k * rings.mult * base.num, base.den)
        : formatTick(k * rings.major)
      ctx.fillText(text, px, labelY)
    }
  }

  // ---- angle labels --------------------------------------------------------
  // On the outermost fully visible circle when the pole is on the board, and at
  // the outer end of each spoke when it is not. θ = 0 is left unlabelled: that
  // ray already carries the radius numbers, and two label runs on one line is
  // the collision the cartesian board spent a rewrite avoiding.
  const canLabelAngles = ruled && (!inside || rFitPx >= MIN_ANGLE_LABEL_RADIUS_PX)
  if (canLabelAngles) {
    const inset = 16 * type
    const pad = 6 * type
    const labelRadius = (k: number): number | null => {
      const seg = segments[k]
      if (!seg) return null
      const outer = inside ? Math.min(rFitPx, seg[1]) : seg[1]
      const rL = outer - inset
      return rL > seg[0] + 2 ? rL : null
    }

    // Which directions get a name, and how many of them.
    //
    // `3π/4` is four glyphs where a cartesian tick is one, and at 2-3x
    // presentation type the ring of them runs into itself. So the angle labels
    // have their own ladder, coarsening the SET rather than shrinking the type:
    // every major angle, then the quarter turns' own π/4 family, then the axes
    // alone. A thinned ring still names the angles a polar problem is posed at;
    // an overlapping one names nothing.
    //
    // Adjacent labelled directions are π/12 apart at the top rung (on both
    // spoke ladders), π/4 at the next and π/2 at the last.
    const TIERS: ReadonlyArray<{ keep: (k: number) => boolean; gap: number }> = [
      { keep: (k) => isAxis(k) || isMajor(k), gap: Math.PI / 12 },
      { keep: (k) => k % (n / 8) === 0, gap: Math.PI / 4 },
      { keep: isAxis, gap: Math.PI / 2 },
    ]
    let widest = 0
    let rRing = 0
    for (let k = 1; k < n; k++) {
      if (!isAxis(k) && !isMajor(k)) continue
      const rL = labelRadius(k)
      if (rL === null) continue
      rRing = Math.max(rRing, rL)
      widest = Math.max(widest, ctx.measureText(angleLabel(k, den)).width)
    }
    const need = widest + 8 * type
    const tier = TIERS.find((t) => rRing * t.gap >= need) ?? null

    if (tier) {
      for (let k = 1; k < n; k++) {
        if (!isAxis(k) && !isMajor(k)) continue
        if (!tier.keep(k)) continue
        const seg = segments[k]
        const rTop = labelRadius(k)
        if (!seg || rTop === null) continue
        const text = angleLabel(k, den)
        const tw = ctx.measureText(text).width
        const th = k * dTheta
        const c = Math.cos(th)
        const s = Math.sin(th)
        // Walk INWARD along the ray until the whole box is on the board.
        //
        // With the pole off-screen a spoke's outer end IS the viewport edge, so
        // the first try is always half off it — and a bounds check alone would
        // simply drop every angle label on a panned board, which is exactly the
        // board where the spokes are hardest to identify by eye.
        for (let attempt = 0; attempt < 5; attempt++) {
          const rL = rTop - attempt * 14 * type
          if (rL <= seg[0] + 2) break
          let px = ox + rL * c
          let py = oy - rL * s
          let align: CanvasTextAlign
          let baseline: CanvasTextBaseline
          // On an axis the text would otherwise straddle the axis line itself,
          // so it steps sideways off it rather than outward along it.
          if (Math.abs(c) < 1e-9) {
            align = 'left'
            baseline = 'middle'
            px += pad
          } else if (Math.abs(s) < 1e-9) {
            align = 'center'
            baseline = 'bottom'
            py -= pad
          } else {
            align = c > 0 ? 'left' : 'right'
            baseline = s > 0 ? 'bottom' : 'top'
            px += c > 0 ? pad : -pad
            py += s > 0 ? -pad : pad
          }
          // The anchor is not the text: a 'bottom' baseline puts the glyphs a
          // whole line ABOVE it, which is how a label ends up half off the top
          // edge. Bound the box, not the point.
          const x0 = align === 'left' ? px : align === 'right' ? px - tw : px - tw / 2
          if (x0 < 2 || x0 + tw > W - 2 || py < fpx + 2 || py > H - fpx - 2) continue
          ctx.textAlign = align
          ctx.textBaseline = baseline
          ctx.fillText(text, px, py)
          break
        }
      }
    }
  }

  // ---- the pole ------------------------------------------------------------
  if (inside) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('0', ox - 5 * type, oy + 5 * type)
  }

  ctx.restore()
}
