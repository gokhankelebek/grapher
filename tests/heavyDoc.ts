// ============================================================================
// tests/heavyDoc.ts — the "heavy" classroom document the device pass measures.
//
// Eight typed curves (a sin with two sliders, a rational with poles, a
// piecewise, the folium, a polar rose, a parametric, a cubic, an exponential),
// a Taylor P₉ of the sine, a slope field with three solutions, a shaded area,
// a Riemann sum with n = 100 and a sign chart. Used by tests/heavyScene.ts
// (the benchmark and the cache tests).
// ============================================================================

import { parseExpression } from '../src/core/parse'
import type { FittedCurve } from '../src/core/types'
import type { BoardInput, DocMeta } from '../src/core/persist'
import { docFromBoard, serializeDoc, TAYLOR_MODEL_PREFIX } from '../src/core/persist'

function typed(id: string, src: string, modelId: string, color: string): FittedCurve {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`fixture failed to parse: ${src}: ${o.error}`)
  return {
    id,
    modelId,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
    color,
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  }
}

const SOURCES: Record<string, string> = {
  csin: 'y = a sin(b x)',
  crat: 'y = (x^2 - 1)/(x^2 - 4)',
  cpw: 'f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}',
  cfol: 'x^3 + y^3 = 3x y',
  crose: 'r = 3cos(4theta)',
  cpar: '(x, y) = (2cos(3t), 2sin(2t))',
  ccub: 'y = 0.2x^3 - x',
  cexp: 'y = e^(x/3)',
}

const COLORS = ['#4f9cf9', '#f97316', '#22c55e', '#e879f9', '#facc15', '#38bdf8', '#f43f5e', '#a3e635']

/** The document as stored JSON (what a share link or a backup carries). */
export function heavyJSON(): string {
  const curves = Object.entries(SOURCES).map(([id, s], i) => typed(id, s, `expr_${i + 1}`, COLORS[i]))
  // P₉ is a closure the board rebuilds from its link; the stored curve only names it.
  curves.push({
    id: 'ctay',
    modelId: `${TAYLOR_MODEL_PREFIX}Ltay`,
    params: [],
    kind: 'explicit',
    domain: null,
    color: '#ffffff',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
  })
  const input: BoardInput = {
    curves,
    styles: {},
    candidates: new Map(),
    exprSources: { ...SOURCES },
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 50 },
    selectedId: 'csin',
    mode: 'draw',
    calc: [
      { kind: 'taylor', id: 'Ltay', parentId: 'csin', curveId: 'ctay', a: 0, n: 9 },
      { kind: 'area', id: 'Larea', parentId: 'cexp', from: -2, to: 1, abs: false },
      { kind: 'riemann', id: 'Lrie', parentId: 'ccub', from: -3, to: 3, n: 100, method: 'left' },
      { kind: 'signchart', id: 'Lsign', parentId: 'ccub', rows: ['f', 'f1', 'f2'] },
    ],
    fields: [
      {
        id: 'F1',
        src: 'dy/dx = x - y',
        params: [],
        color: '#94a3b8',
        spacingPx: 32,
        visible: true,
        solutions: [
          { id: 's1', x: 0, y: 1 },
          { id: 's2', x: -2, y: -1 },
          { id: 's3', x: 1, y: 3 },
        ],
      },
    ],
  }
  const meta: DocMeta = { id: 'heavyperf', name: 'Heavy perf doc', createdAt: 1, modifiedAt: 1 }
  return serializeDoc(docFromBoard(meta, input, 2))
}
