// ============================================================================
// A minimal, dependency-free stand-in for CanvasRenderingContext2D / Path2D.
//
// src/render never reads pixels back — it only issues path and text commands —
// so a recording spy is enough to assert the geometry and the label text that
// the renderer produces, with no DOM and no real canvas.
// ============================================================================

export type Cmd =
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'quadraticCurveTo'; cx: number; cy: number; x: number; y: number }
  | { op: 'arc'; x: number; y: number; r: number }
  | { op: 'closePath' }

/** Records the path commands issued against it. */
export class MockPath2D {
  cmds: Cmd[] = []
  moveTo(x: number, y: number): void { this.cmds.push({ op: 'moveTo', x, y }) }
  lineTo(x: number, y: number): void { this.cmds.push({ op: 'lineTo', x, y }) }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.cmds.push({ op: 'quadraticCurveTo', cx, cy, x, y })
  }
  arc(x: number, y: number, r: number): void { this.cmds.push({ op: 'arc', x, y, r }) }
  closePath(): void { this.cmds.push({ op: 'closePath' }) }

  /** The path split into subpaths, one per moveTo. */
  subpaths(): Array<Array<{ x: number; y: number }>> {
    const out: Array<Array<{ x: number; y: number }>> = []
    let cur: Array<{ x: number; y: number }> | null = null
    for (const c of this.cmds) {
      if (c.op === 'moveTo') { cur = [{ x: c.x, y: c.y }]; out.push(cur) }
      else if (c.op === 'lineTo' && cur) cur.push({ x: c.x, y: c.y })
      else if (c.op === 'quadraticCurveTo' && cur) cur.push({ x: c.x, y: c.y })
    }
    return out
  }

  moveToCount(): number {
    return this.cmds.filter(c => c.op === 'moveTo').length
  }

  points(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = []
    for (const c of this.cmds) {
      if (c.op === 'moveTo' || c.op === 'lineTo') out.push({ x: c.x, y: c.y })
      else if (c.op === 'quadraticCurveTo') out.push({ x: c.x, y: c.y })
    }
    return out
  }
}

export interface TextDraw {
  text: string
  x: number
  y: number
  align: string
  baseline: string
  /** The font in force when it was drawn — the only place italics show up. */
  font: string
}

export interface FillRect { x: number; y: number; w: number; h: number; style: string }

/**
 * Recording 2D context. `own` collects commands issued directly on the ctx
 * (drawGrid / drawInk); `strokedPaths` collects the Path2D objects handed to
 * stroke() (drawCurve).
 */
export class MockCtx {
  own = new MockPath2D()
  strokedPaths: MockPath2D[] = []
  texts: TextDraw[] = []
  fills: FillRect[] = []
  strokeCount = 0
  fillCount = 0
  saveCount = 0
  restoreCount = 0

  fillStyle = ''
  strokeStyle = ''
  lineWidth = 1
  lineCap = ''
  lineJoin = ''
  globalAlpha = 1
  font = ''
  textAlign = 'start'
  textBaseline = 'alphabetic'

  /** Every style assigned to strokeStyle across the render, in order. */
  strokeStyles: string[] = []
  /** Every style assigned to fillStyle across the render, in order. */
  fillStyles: string[] = []
  /** fillText calls. */
  textCount = 0
  /** arc calls (markers, handles, dots). */
  get arcCount(): number {
    return this.own.cmds.filter(c => c.op === 'arc').length + this._pathArcs
  }
  _pathArcs = 0
  lineDash: number[] = []
  setLineDash(d: number[]): void { this.lineDash = d.slice() }
  getLineDash(): number[] { return this.lineDash.slice() }
  clip(): void { /* export clips to the plot rect; geometry is asserted elsewhere */ }
  translate(): void { /* export offsets by the margin */ }
  scale(): void { /* DPR / export scale */ }
  setTransform(): void { /* DPR reset */ }
  rect(): void { /* clip rects */ }
  strokeRect(): void { /* not used by the figure itself */ }
  createLinearGradient(): { addColorStop(): void } { return { addColorStop() {} } }

  save(): void { this.saveCount++ }
  restore(): void { this.restoreCount++ }
  beginPath(): void { /* subpath boundaries are tracked via moveTo */ }
  moveTo(x: number, y: number): void { this.own.moveTo(x, y) }
  lineTo(x: number, y: number): void { this.own.lineTo(x, y) }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.own.quadraticCurveTo(cx, cy, x, y)
  }
  arc(x: number, y: number, r: number): void { this.own.arc(x, y, r) }
  /** Label chips are rounded rects; without this they throw and are silently skipped. */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.own.lineTo(x1, y1)
    void x2; void y2; void r
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number): void {
    this.own.lineTo(x, y)
  }
  closePath(): void { this.own.closePath() }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ x, y, w, h, style: this.fillStyle })
  }
  /** Record a style the moment it is used, which is what assertions care about. */
  private _note(): void {
    if (this.strokeStyle) this.strokeStyles.push(this.strokeStyle)
    if (this.fillStyle) this.fillStyles.push(this.fillStyle)
  }

  stroke(path?: MockPath2D): void {
    this._note()
    this.strokeCount++
    if (path) this.strokedPaths.push(path)
  }
  fill(): void { this.fillCount++ }
  fillText(text: string, x: number, y: number): void {
    this.textCount++
    this._note()
    this.texts.push({
      text,
      x,
      y,
      align: this.textAlign,
      baseline: this.textBaseline,
      font: this.font,
    })
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 6 } // 11px system font, close enough for layout
  }
}

/**
 * Install MockPath2D as the global Path2D for the duration of `fn`.
 * src/render/curves.ts does `new Path2D()` at draw time only.
 */
export function withMockPath2D<T>(fn: () => T): T {
  const g = globalThis as unknown as { Path2D?: unknown }
  const prev = g.Path2D
  g.Path2D = MockPath2D
  try {
    return fn()
  } finally {
    if (prev === undefined) delete g.Path2D
    else g.Path2D = prev
  }
}
