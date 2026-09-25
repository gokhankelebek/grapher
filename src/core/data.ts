// ============================================================================
// Data tables and regression (src/core/data.ts)
//
// A teacher pastes or types (x, y) data — from a Google Sheet, Excel, a
// DeltaMath item, a lab — plots it as a scatter plot and fits the models an
// AP Precalculus / Statistics course names. A regression becomes an ORDINARY
// TYPED CURVE (its source is a typed expression), linked to its table so it
// re-fits whenever the data changes, and so every analysis feature applies.
//
// Answers must MATCH A TI-84 / Desmos, because students check against their
// calculators: linear, quadratic, cubic, quartic are ordinary least squares;
// exponential (y = a·b^x), power (y = a·x^b) and logarithmic (y = a + b·ln x)
// are fitted the calculator way — least squares on the LINEARISED data
// (ln y vs x, ln y vs ln x, y vs ln x) — and say so; logistic and sinusoidal
// are nonlinear least squares, as the calculator's are.
//
//   export function parseDataText(text): DataParse
//       tab / comma / semicolon / whitespace separated columns, optional
//       header row (names become the column labels), CRLF, a trailing empty
//       line, a thousands comma inside quotes, a decimal comma when the
//       separator is ';' — the shapes a spreadsheet paste produces. Two
//       columns → x, y; one column → y with x = 1, 2, 3 …; more → the first
//       two, with a note naming the ignored ones.
//   export function fitRegression(kind, xs, ys): RegressionResult
//   export function regressionSource(result, digits = 4): string
//       the typed expression for the curve, coefficients rounded the way
//       the card prints them (TI-style 4 decimals by default):
//       "y = 1.2345x + 0.5", "y = 3.1(1.0512)^x", "y = 2.3x^1.5",
//       "y = 1.1 + 2.04ln(x)", "y = 10/(1 + 4.5e^(-0.8x))",
//       "y = 2.5sin(1.2x + 0.7) + 4" (the TI's a·sin(bx + c) + d, so the
//       printed a, b, c, d are the coefficients) — each parseable by
//       parseExpression. Never fewer than `digits` significant figures
//       (0.0001235x, not 0.0001x); no exponent notation. '' for a result
//       that is not ok — check result.ok first.
//   export function suggestModels(xs, ys): RegressionKind[]
//       the kinds that CAN be fitted to this data (exponential needs every
//       y > 0 — a TI refuses otherwise — power needs x, y > 0, log x > 0,
//       polynomial degree n needs n + 1 distinct x, logistic ≥ 4 points and
//       y > 0, sinusoidal ≥ 5 points): linear, quadratic, exponential,
//       power, logarithmic first, ranked by ADJUSTED r² (plain r² always
//       prefers the quadratic to the line it barely improves), then cubic,
//       quartic, logistic, sinusoidal unranked — a hint, never an automatic
//       choice.
// ============================================================================

import { levenbergMarquardt, linearLeastSquares } from './fit/optimize'

export type RegressionKind =
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'quartic'
  | 'exponential'
  | 'power'
  | 'logarithmic'
  | 'logistic'
  | 'sinusoidal'

export interface DataParse {
  ok: boolean
  xs: number[]
  ys: number[]
  /** Column labels from a header row, else "x" / "y". */
  xLabel: string
  yLabel: string
  /** Rows that could not be read, 1-based, with the reason. */
  skipped: { row: number; reason: string }[]
  /** Anything worth telling the teacher ("ignored columns C, D"). */
  notes: string[]
  error?: string
}

export interface RegressionResult {
  ok: boolean
  kind: RegressionKind
  /**
   * Coefficients by name, full precision: linear {a, b} for y = ax + b;
   * polynomial {a, b, c, …} highest power first; exponential {a, b};
   * power {a, b}; logarithmic {a, b} for y = a + b ln x; logistic {c, a, b}
   * for y = c/(1 + a e^(−bx)); sinusoidal {a, b, c, d} for y = a sin(bx + c) + d.
   */
  coef: Record<string, number>
  /** Coefficient of determination on the ORIGINAL data (what the card shows). */
  r2: number
  /** Correlation coefficient r — linear and the linearised fits only, as a TI. */
  r?: number
  /** For the linearised fits, r² on the transformed data (the TI's number). */
  r2Linearised?: number
  residuals: number[]
  /** Why a fit is not possible: "exponential needs every y positive". */
  error?: string
  /** "fitted like a TI-84: least squares on ln y" and similar. */
  notes: string[]
}

// ============================================================================
// Implementation
//
// Reading pasted data (parseDataText)
//   separator   tab if any line has one (Sheets / Excel), else ';' (the
//               European export, where ',' is the decimal point), else ','
//               outside quotes (CSV), else runs of whitespace — two or more
//               spaces when a line has them (so "Time (s)  Distance (m)" is
//               two cells), else single spaces.
//   cells       CSV quotes ("1,234", "say ""hi""") are honoured in every
//               mode; trailing empty cells (Excel's trailing tab) are
//               dropped; U+2212 minus, non-breaking/thin-space grouping, a
//               leading $ and a trailing % are accepted (the note says so).
//   commas      with ';' a comma is the decimal point ("1.234,5" = 1234.5);
//               otherwise 1–3 digits then ",ddd" groups is a thousands comma
//               ("1,234" = 1234, the US reading), and any other "d,d" is a
//               decimal comma ("2,25" = 2.25).
//   header      the first non-blank line is a header when either of its
//               first two cells is text; its cells name x and y.
//   rows        numbered as the teacher sees them: 1-based LINE numbers of
//               the pasted text, header and blank lines included, so they
//               match the spreadsheet's row numbers when pasted from row 1.
//               Blank lines are ignored silently; any other unreadable row
//               is skipped with its number and the reason.
//
// Fitting (fitRegression)
//   Pairs where x or y is not a finite number are left out (with a note);
//   residuals stay aligned with the INPUT arrays, NaN at those positions.
//   Polynomials: Householder QR on u = (x − mean)/max|x − mean| — never the
//   normal equations — then expanded back to raw-x coefficients. ŷ, the
//   residuals and r² come from the u-form (the exact least-squares values).
//   Exponential / power / logarithmic: the same QR line fit on the
//   linearised data, exactly what ExpReg / PwrReg / LnReg compute.
//   Logistic / sinusoidal: Levenberg–Marquardt (./fit/optimize) on centred,
//   scaled x from several seeds; the best sum of squares wins.
// ============================================================================

const KIND_ORDER: RegressionKind[] = [
  'linear', 'quadratic', 'cubic', 'quartic',
  'exponential', 'power', 'logarithmic', 'logistic', 'sinusoidal',
]

const DEGREE: Partial<Record<RegressionKind, number>> = {
  linear: 1, quadratic: 2, cubic: 3, quartic: 4,
}

/** The name a teacher uses, for error sentences. */
const NAME: Record<RegressionKind, string> = {
  linear: 'A linear fit',
  quadratic: 'A quadratic',
  cubic: 'A cubic',
  quartic: 'A quartic',
  exponential: 'Exponential regression',
  power: 'Power regression',
  logarithmic: 'Logarithmic regression',
  logistic: 'Logistic regression',
  sinusoidal: 'Sinusoidal regression',
}

/** The TI-84 command each kind matches. */
const TI: Record<RegressionKind, string> = {
  linear: 'LinReg(ax+b)',
  quadratic: 'QuadReg',
  cubic: 'CubicReg',
  quartic: 'QuartReg',
  exponential: 'ExpReg',
  power: 'PwrReg',
  logarithmic: 'LnReg',
  logistic: 'Logistic',
  sinusoidal: 'SinReg',
}

const MINUS = '−'

/** Short number for sentences: ≤ 6 significant digits, true minus. */
function show(v: number): string {
  return String(Number(v.toPrecision(6))).replace('-', MINUS)
}

// ----------------------------------------------------------------------------
// parseDataText
// ----------------------------------------------------------------------------

type Sep = '\t' | ';' | ',' | 'ws'

interface ReadCtx { decimalComma: boolean; percent: boolean }

function hasOutsideQuotes(line: string, ch: string): boolean {
  let q = false
  for (const c of line) {
    if (c === '"') q = !q
    else if (!q && c === ch) return true
  }
  return false
}

function detectSep(lines: string[]): Sep {
  if (lines.some((l) => l.includes('\t'))) return '\t'
  if (lines.some((l) => hasOutsideQuotes(l, ';'))) return ';'
  if (lines.some((l) => hasOutsideQuotes(l, ','))) return ','
  return 'ws'
}

/** Split on one separator character, honouring CSV double quotes. */
function splitQuoted(line: string, sep: string): string[] {
  const out: string[] = []
  const n = line.length
  let i = 0
  for (;;) {
    let j = i
    while (j < n && line[j] === ' ') j++
    let k: number
    if (j < n && line[j] === '"') {
      let text = ''
      k = j + 1
      while (k < n) {
        if (line[k] === '"') {
          if (line[k + 1] === '"') { text += '"'; k += 2; continue }
          k++
          break
        }
        text += line[k++]
      }
      let rest = ''
      while (k < n && line[k] !== sep) rest += line[k++]
      out.push(text + rest.trim())
    } else {
      k = i
      while (k < n && line[k] !== sep) k++
      out.push(line.slice(i, k))
    }
    if (k >= n) break
    i = k + 1
  }
  return out
}

function stripQuotes(s: string): string {
  const t = s.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t
}

function splitLine(line: string, sep: Sep): string[] {
  let cells: string[]
  if (sep === 'ws') {
    const t = line.trim()
    cells = t.split(/\s{2,}/)
    if (cells.length < 2) cells = t.split(/\s+/)
    cells = cells.map(stripQuotes)
  } else {
    cells = splitQuoted(line, sep).map((c) => c.trim())
  }
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

/** One cell → a number, or null when it is not one. */
function readNumber(raw: string, sep: Sep, ctx: ReadCtx): number | null {
  let s = raw.trim().replace(/[    ]/g, '').replace(/[−–]/g, '-')
  if (s === '') return null
  let pct = false
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim() }
  s = s.replace(/^([+-]?)\$/, '$1')
  let decimalComma = false
  if (s.includes(',')) {
    if (sep === ';') {
      if (!/^[+-]?(\d{1,3}(\.\d{3})+|\d*),\d*$/.test(s)) return null
      s = s.replace(/\./g, '').replace(',', '.')
      decimalComma = true
    } else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '') // 1,234 — the US thousands comma
    } else if (/^[+-]?(\d{1,3}(\.\d{3})+|\d*),\d+$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.') // 2,25 — a decimal comma
      decimalComma = true
    } else return null
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  if (pct) ctx.percent = true
  if (decimalComma) ctx.decimalComma = true
  return v
}

function columnLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** A cell quoted back to the teacher, trimmed to a readable length. */
function quoteCell(c: string): string {
  const t = c.length > 24 ? `${c.slice(0, 22)}…` : c
  return `“${t}”`
}

export function parseDataText(text: string): DataParse {
  const res: DataParse = { ok: false, xs: [], ys: [], xLabel: 'x', yLabel: 'y', skipped: [], notes: [] }
  try {
    const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    const lines = src
      .split('\n')
      .map((t, i) => ({ row: i + 1, t }))
      .filter((l) => l.t.trim() !== '')
    if (lines.length === 0) {
      res.error = 'Paste or type some data: two columns, x then y (a header row is fine).'
      return res
    }
    const sep = detectSep(lines.map((l) => l.t))
    const rows = lines.map((l) => ({ row: l.row, cells: splitLine(l.t, sep) }))
    const ctx: ReadCtx = { decimalComma: false, percent: false }
    const probeCtx: ReadCtx = { decimalComma: false, percent: false }

    // ---- header: the first line, when either of its first two cells is text
    let header: string[] | null = null
    const probe = rows[0].cells.slice(0, 2)
    if (probe.some((c) => c !== '' && readNumber(c, sep, probeCtx) === null)) {
      header = rows[0].cells
      rows.shift()
    }

    const oneColumn = rows.length > 0 && rows.every((r) => r.cells.length <= 1)
    if (oneColumn) {
      if (header && header[0]) res.yLabel = header[0]
      for (const r of rows) {
        const c = r.cells[0] ?? ''
        const v = readNumber(c, sep, ctx)
        if (v === null) res.skipped.push({ row: r.row, reason: `${quoteCell(c)} is not a number` })
        else {
          res.ys.push(v)
          res.xs.push(res.ys.length)
        }
      }
      res.notes.push('One column: read as y, with x = 1, 2, 3, … (the position in the list).')
    } else {
      if (header) {
        if (header[0]) res.xLabel = header[0]
        if (header[1]) res.yLabel = header[1]
      }
      const extra = new Set<number>()
      for (const r of rows) {
        for (let j = 2; j < r.cells.length; j++) if (r.cells[j] !== '') extra.add(j)
        const xc = r.cells[0] ?? ''
        const yc = r.cells[1] ?? ''
        if (xc === '' && yc === '') { res.skipped.push({ row: r.row, reason: 'no x or y value' }); continue }
        if (xc === '') { res.skipped.push({ row: r.row, reason: 'missing x value' }); continue }
        if (yc === '') { res.skipped.push({ row: r.row, reason: 'missing y value' }); continue }
        const x = readNumber(xc, sep, ctx)
        const y = readNumber(yc, sep, ctx)
        if (x === null) { res.skipped.push({ row: r.row, reason: `x ${quoteCell(xc)} is not a number` }); continue }
        if (y === null) { res.skipped.push({ row: r.row, reason: `y ${quoteCell(yc)} is not a number` }); continue }
        res.xs.push(x)
        res.ys.push(y)
      }
      if (extra.size > 0) {
        const cols = [...extra].sort((a, b) => a - b).map((j) => {
          const label = header && header[j] ? ` (${header[j]})` : ''
          return `${columnLetter(j)}${label}`
        })
        res.notes.push(
          `Used the first two columns as x and y; ignored column${cols.length > 1 ? 's' : ''} ${cols.join(', ')}.`,
        )
      }
    }
    if (ctx.decimalComma) res.notes.push('Read commas as decimal points (1,5 = 1.5).')
    if (ctx.percent) res.notes.push('Dropped % signs (12.5% is read as 12.5).')

    if (res.xs.length < 2) {
      const found = res.xs.length === 0 ? 'none' : 'only one'
      res.error = `Need at least two rows of numbers to plot — found ${found}.`
      return res
    }
    res.ok = true
    return res
  } catch {
    res.ok = false
    res.error = 'Could not read that data.'
    return res
  }
}

// ----------------------------------------------------------------------------
// Linear algebra: Householder QR least squares
// ----------------------------------------------------------------------------

/** Minimise ||A c − b|| by Householder QR; null when A is rank deficient. */
function lstsqQR(A: number[][], b: number[]): number[] | null {
  const n = A.length
  const m = n > 0 ? A[0].length : 0
  if (m === 0 || n < m) return null
  const R = A.map((r) => r.slice())
  const y = b.slice()
  const v = new Array<number>(n)
  for (let k = 0; k < m; k++) {
    let scale = 0
    for (let i = k; i < n; i++) scale = Math.max(scale, Math.abs(R[i][k]))
    if (!(scale > 0) || !Number.isFinite(scale)) return null
    let norm = 0
    for (let i = k; i < n; i++) norm += (R[i][k] / scale) ** 2
    norm = Math.sqrt(norm) * scale
    const alpha = R[k][k] > 0 ? -norm : norm
    let vv = 0
    for (let i = k; i < n; i++) {
      v[i] = R[i][k] - (i === k ? alpha : 0)
      vv += v[i] * v[i]
    }
    if (vv === 0) continue
    for (let j = k; j < m; j++) {
      let s = 0
      for (let i = k; i < n; i++) s += v[i] * R[i][j]
      const f = (2 * s) / vv
      for (let i = k; i < n; i++) R[i][j] -= f * v[i]
    }
    let s = 0
    for (let i = k; i < n; i++) s += v[i] * y[i]
    const f = (2 * s) / vv
    for (let i = k; i < n; i++) y[i] -= f * v[i]
  }
  let maxDiag = 0
  for (let k = 0; k < m; k++) maxDiag = Math.max(maxDiag, Math.abs(R[k][k]))
  for (let k = 0; k < m; k++) if (!(Math.abs(R[k][k]) > 1e-11 * maxDiag)) return null
  const c = new Array<number>(m)
  for (let k = m - 1; k >= 0; k--) {
    let s = y[k]
    for (let j = k + 1; j < m; j++) s -= R[k][j] * c[j]
    c[k] = s / R[k][k]
  }
  return c.every(Number.isFinite) ? c : null
}

function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  return out
}

interface PolyFit {
  /** Ascending coefficients in raw x. */
  asc: number[]
  /** ŷ at each data point, from the well-conditioned centred form. */
  fitted: number[]
  mx: number
  sx: number
}

/** Least-squares polynomial of the given degree via QR on centred/scaled x. */
function polyFitQR(xs: number[], ys: number[], degree: number): PolyFit | null {
  const n = xs.length
  if (n < degree + 1) return null
  let mx = 0
  for (const x of xs) mx += x
  mx /= n
  let sx = 0
  for (const x of xs) sx = Math.max(sx, Math.abs(x - mx))
  if (!(sx > 0)) return null
  const us = xs.map((x) => (x - mx) / sx)
  const A = us.map((u) => {
    const row = new Array<number>(degree + 1)
    let p = 1
    for (let j = 0; j <= degree; j++) { row[j] = p; p *= u }
    return row
  })
  const cU = lstsqQR(A, ys)
  if (!cU) return null
  const fitted = us.map((u) => {
    let v = 0
    for (let j = degree; j >= 0; j--) v = v * u + cU[j]
    return v
  })
  const asc = new Array<number>(degree + 1).fill(0)
  const base = [-mx / sx, 1 / sx]
  let acc: number[] = [1]
  for (let j = 0; j <= degree; j++) {
    for (let i = 0; i < acc.length; i++) asc[i] += cU[j] * acc[i]
    if (j < degree) acc = polyMul(acc, base)
  }
  if (!asc.every(Number.isFinite)) return null
  return { asc, fitted, mx, sx }
}

// ----------------------------------------------------------------------------
// Statistics helpers
// ----------------------------------------------------------------------------

function mean(v: number[]): number {
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

/** Pearson correlation (two-pass); NaN when either variable is constant. */
function pearson(t: number[], z: number[]): number {
  const mt = mean(t)
  const mz = mean(z)
  let stt = 0, szz = 0, stz = 0
  for (let i = 0; i < t.length; i++) {
    const a = t[i] - mt
    const b = z[i] - mz
    stt += a * a
    szz += b * b
    stz += a * b
  }
  if (!(stt > 0) || !(szz > 0)) return NaN
  return Math.max(-1, Math.min(1, stz / Math.sqrt(stt * szz)))
}

/** 1 − SSE/SST; NaN when every y is the same. */
function rSquared(ys: number[], fitted: number[]): number {
  const m = mean(ys)
  let sse = 0, sst = 0
  for (let i = 0; i < ys.length; i++) {
    sse += (ys[i] - fitted[i]) ** 2
    sst += (ys[i] - m) ** 2
  }
  if (!(sst > 0)) return NaN
  return 1 - sse / sst
}

function distinctCount(xs: number[]): number {
  return new Set(xs).size
}

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

// ----------------------------------------------------------------------------
// Nonlinear fits
// ----------------------------------------------------------------------------

/** Centre and half-range of x, so t = (x − m)/s lies in [−1, 1]. */
function centreScale(xs: number[]): { m: number; s: number } {
  let lo = Infinity, hi = -Infinity
  for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x }
  return { m: (lo + hi) / 2, s: (hi - lo) / 2 }
}

/** LM from p0, then once more from where it stopped (cheap polish). */
function lm(res: (p: number[]) => number[], p0: number[]): { params: number[]; rss: number } | null {
  const first = levenbergMarquardt(res, p0, 300)
  if (!first) return null
  const again = levenbergMarquardt(res, first.params, 300)
  return again && again.rss <= first.rss ? again : first
}

/**
 * y = c/(1 + a·e^(−bx)). Internally y/ymax = C/(1 + e^(L − B·t)) with
 * t = (x − m)/s: well scaled at any x (years included), a > 0 by
 * construction. Seeds: c = f·max y for several f, (L, B) from the line
 * ln(c/y − 1) = L − B·t.
 */
function fitLogistic(X: number[], Y: number[]): { c: number; a: number; b: number; fitted: number[] } | 'far' | null {
  const { m, s } = centreScale(X)
  if (!(s > 0)) return null
  const T = X.map((x) => (x - m) / s)
  const ymax = Math.max(...Y)
  const Ys = Y.map((y) => y / ymax)
  const model = (p: number[], t: number) => p[0] / (1 + Math.exp(p[2] - p[1] * t))
  const res = (p: number[]) => Ys.map((y, i) => y - model(p, T[i]))
  let best: { params: number[]; rss: number } | null = null
  for (const f of [1.02, 1.05, 1.1, 1.25, 1.5, 2, 3, 5]) {
    const z = Ys.map((y) => Math.log(f / y - 1))
    if (!z.every(Number.isFinite)) continue
    const line = polyFitQR(T, z, 1)
    if (!line) continue
    const p0 = [f, -line.asc[1], line.asc[0]]
    const r = lm(res, p0)
    if (r && r.params.every(Number.isFinite) && r.params[0] > 0 && (!best || r.rss < best.rss)) best = r
  }
  if (!best) return null
  const [C, B, L] = best.params
  const b = B / s
  const lnA = L + (B * m) / s
  const a = Math.exp(lnA)
  const c = C * ymax
  if (!Number.isFinite(a) || a === 0 || !Number.isFinite(b) || !Number.isFinite(c)) return 'far'
  const fitted = T.map((t) => model(best!.params, t) * ymax)
  return { c, a, b, fitted }
}

/** c into (−π, π]. */
function wrapPhase(c: number): number {
  const TAU = 2 * Math.PI
  return Math.PI - ((((Math.PI - c) % TAU) + TAU) % TAU)
}

/**
 * y = a·sin(bx + c) + d. Internally a·sin(B·t + C) + d with t = (x − m)/s.
 * Seeds: a periodogram over B from a quarter period across the data's span
 * up to the Nyquist frequency of the median spacing (each candidate solved
 * exactly for d, amplitude and phase — y ≈ d + p·sin Bt + q·cos Bt is linear
 * in d, p, q, as the sketch fitter's fitSine does), plus the zero-crossing
 * estimate; the best local minima are refined by LM and the lowest sum of
 * squares wins.
 */
function fitSinusoid(X: number[], Y: number[]): { a: number; b: number; c: number; d: number; fitted: number[] } | null {
  const { m, s } = centreScale(X)
  if (!(s > 0)) return null
  const T = X.map((x) => (x - m) / s)
  const n = T.length
  const span = 2
  const sorted = [...new Set(T)].sort((u, w) => u - w)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1])
  if (gaps.length === 0) return null
  const dt = median(gaps)
  const bMin = Math.PI / (2 * span)
  let bMax = Math.PI / dt
  if (!(bMax > 1.5 * bMin)) bMax = 8 * bMin
  let step = Math.PI / (8 * span)
  if ((bMax - bMin) / step > 4000) step = (bMax - bMin) / 4000

  const linearAt = (B: number): { d: number; p: number; q: number; rss: number } | null => {
    const rows = T.map((t) => [1, Math.sin(B * t), Math.cos(B * t)])
    const sol = linearLeastSquares(rows, Y)
    if (!sol) return null
    let rss = 0
    for (let i = 0; i < n; i++) {
      const r = Y[i] - (sol[0] + sol[1] * Math.sin(B * T[i]) + sol[2] * Math.cos(B * T[i]))
      rss += r * r
    }
    return { d: sol[0], p: sol[1], q: sol[2], rss }
  }

  const grid: { B: number; rss: number }[] = []
  for (let B = bMin; B <= bMax + 1e-12; B += step) {
    const l = linearAt(B)
    grid.push({ B, rss: l ? l.rss : Infinity })
  }
  const minima = grid.filter((g, i) =>
    Number.isFinite(g.rss) &&
    (i === 0 || g.rss <= grid[i - 1].rss) &&
    (i === grid.length - 1 || g.rss <= grid[i + 1].rss),
  )
  minima.sort((u, w) => u.rss - w.rss)
  const seeds = minima.slice(0, 5).map((g) => g.B)

  // zero crossings of the mean-removed data, in x order
  const order = T.map((t, i) => i).sort((i, j) => T[i] - T[j])
  const my = mean(Y)
  let amp = 0
  for (const y of Y) amp = Math.max(amp, Math.abs(y - my))
  let last = 0, crossings = 0
  for (const i of order) {
    const v = Y[i] - my
    if (Math.abs(v) < 0.15 * amp) continue
    const sg = v > 0 ? 1 : -1
    if (last !== 0 && sg !== last) crossings++
    last = sg
  }
  if (crossings > 0) seeds.push((Math.PI * crossings) / span)

  const model = (p: number[], t: number) => p[0] * Math.sin(p[1] * t + p[2]) + p[3]
  const res = (p: number[]) => Y.map((y, i) => y - model(p, T[i]))
  let best: { params: number[]; rss: number } | null = null
  for (const B of seeds) {
    const l = linearAt(B)
    if (!l) continue
    const p0 = [Math.hypot(l.p, l.q), B, Math.atan2(l.q, l.p), l.d]
    const r = lm(res, p0)
    const cand = r && r.params.every(Number.isFinite) && r.rss <= l.rss ? r : { params: p0, rss: l.rss }
    if (!best || cand.rss < best.rss) best = cand
  }
  if (!best) return null
  let [a, B, C] = best.params
  const d = best.params[3]
  let b = B / s
  let c = C - b * m
  if (b < 0) { b = -b; c = -c; a = -a }
  if (a < 0) { a = -a; c += Math.PI }
  c = wrapPhase(c)
  if (![a, b, c, d].every(Number.isFinite)) return null
  const params = best.params
  const fitted = T.map((t) => model(params, t))
  return { a, b, c, d, fitted }
}

// ----------------------------------------------------------------------------
// fitRegression
// ----------------------------------------------------------------------------

/**
 * Round-off is not a coefficient. Exact data (y = x) comes back with an
 * intercept of 2e−16, which regressionSource would faithfully print with its
 * significant figures ("y = x + 0.000000000000000222"). A coefficient whose
 * whole contribution over the data (|c|·max|x|^power) is below 1e−11 of the
 * data's y scale is set to exactly 0. Genuinely small coefficients — 1e−9 on
 * x⁴ with x in the hundreds — contribute plenty and are left alone.
 */
function snapNoise(kind: RegressionKind, coef: Record<string, number>, X: number[], Y: number[]): void {
  let yScale = 0
  for (const y of Y) yScale = Math.max(yScale, Math.abs(y))
  if (!(yScale > 0)) return
  const tiny = 1e-11 * yScale
  const degree = DEGREE[kind]
  if (degree !== undefined) {
    let xMax = 0
    for (const x of X) xMax = Math.max(xMax, Math.abs(x))
    const names = ['a', 'b', 'c', 'd', 'e']
    for (let j = 0; j <= degree; j++) {
      const name = names[j]
      if (Math.abs(coef[name]) * xMax ** (degree - j) <= tiny) coef[name] = 0
    }
  } else if (kind === 'logarithmic') {
    let lnMax = 0
    for (const x of X) lnMax = Math.max(lnMax, Math.abs(Math.log(x)))
    if (Math.abs(coef.a) <= tiny) coef.a = 0
    if (Math.abs(coef.b) * lnMax <= tiny) coef.b = 0
  } else if (kind === 'sinusoidal') {
    if (Math.abs(coef.c) <= 1e-11) coef.c = 0
    if (Math.abs(coef.d) <= tiny) coef.d = 0
  }
}

export function fitRegression(kind: RegressionKind, xs: number[], ys: number[]): RegressionResult {
  const notes: string[] = []
  const fail = (error: string): RegressionResult => ({
    ok: false, kind, coef: {}, r2: NaN, residuals: [], error, notes,
  })
  try {
    if (!KIND_ORDER.includes(kind)) return fail(`Unknown regression "${String(kind)}".`)
    if (!Array.isArray(xs) || !Array.isArray(ys)) return fail('No data to fit.')
    const n0 = Math.min(xs.length, ys.length)
    if (xs.length !== ys.length) {
      notes.push(`The x and y lists have different lengths; fitted the first ${n0} pairs.`)
    }
    const idx: number[] = []
    for (let i = 0; i < n0; i++) {
      if (typeof xs[i] === 'number' && typeof ys[i] === 'number' && Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        idx.push(i)
      }
    }
    if (idx.length < n0) {
      const k = n0 - idx.length
      notes.push(`Left out ${k} row${k === 1 ? '' : 's'} with a missing value.`)
    }
    const X = idx.map((i) => xs[i])
    const Y = idx.map((i) => ys[i])
    const n = X.length
    const distinct = distinctCount(X)
    const pts = (k: number) => (k === 1 ? 'there is 1' : `there are ${k}`)

    const finish = (coef: Record<string, number>, fitted: number[], extra: Partial<RegressionResult> = {}): RegressionResult => {
      if (!Object.values(coef).every(Number.isFinite) || !fitted.every(Number.isFinite)) {
        return fail(`${NAME[kind]} could not be computed for this data.`)
      }
      snapNoise(kind, coef, X, Y)
      const residuals = new Array<number>(n0).fill(NaN)
      idx.forEach((i, j) => { residuals[i] = Y[j] - fitted[j] })
      const r2 = rSquared(Y, fitted)
      if (Number.isNaN(r2)) notes.push('Every y is the same, so r² is not defined.')
      return { ok: true, kind, coef, r2, residuals, notes, ...extra }
    }

    // ---- polynomials --------------------------------------------------------
    const degree = DEGREE[kind]
    if (degree !== undefined) {
      if (distinct < degree + 1) {
        return fail(`${NAME[kind]} needs at least ${degree + 1} points with different x values — ${pts(distinct)}.`)
      }
      const fit = polyFitQR(X, Y, degree)
      if (!fit) return fail(`${NAME[kind]} could not be computed for this data.`)
      const names = ['a', 'b', 'c', 'd', 'e']
      const coef: Record<string, number> = {}
      for (let j = 0; j <= degree; j++) coef[names[j]] = fit.asc[degree - j]
      notes.push(`Least squares, the same as the TI-84's ${TI[kind]}.`)
      if (degree >= 2 && Math.abs(fit.mx) > 20 * fit.sx) {
        notes.push(
          'The x values sit far from 0 (years?), so rounding the coefficients moves the curve; ' +
          'using x = years since the first one keeps the equation readable.',
        )
      }
      if (degree === 1) {
        const r = pearson(X, Y)
        return finish(coef, fit.fitted, Number.isNaN(r) ? {} : { r })
      }
      return finish(coef, fit.fitted)
    }

    // ---- linearised fits (ExpReg, PwrReg, LnReg) ---------------------------
    if (kind === 'exponential' || kind === 'power' || kind === 'logarithmic') {
      if (kind !== 'exponential') {
        const bad = X.findIndex((x) => !(x > 0))
        if (bad >= 0) {
          return fail(
            `${NAME[kind]} needs every x to be positive — it takes ln x, and (${show(X[bad])}, ${show(Y[bad])}) has x ≤ 0.`,
          )
        }
      }
      if (kind !== 'logarithmic') {
        const bad = Y.findIndex((y) => !(y > 0))
        if (bad >= 0) {
          const allNeg = Y.every((y) => y < 0)
          return fail(
            `${NAME[kind]} needs every y to be positive — it takes ln y, and (${show(X[bad])}, ${show(Y[bad])}) has y ≤ 0. ` +
            (allNeg ? 'Every y is negative: fit −y instead and flip the sign of a.' : 'A TI-84 refuses this data too.'),
          )
        }
      }
      if (distinct < 2) return fail(`${NAME[kind]} needs at least 2 points with different x values — ${pts(distinct)}.`)
      const t = kind === 'exponential' ? X : X.map(Math.log)
      const z = kind === 'logarithmic' ? Y : Y.map(Math.log)
      const line = polyFitQR(t, z, 1)
      if (!line) return fail(`${NAME[kind]} could not be computed for this data.`)
      const slope = line.asc[1]
      const intercept = line.asc[0]
      const r = pearson(t, z)
      const extra: Partial<RegressionResult> = Number.isNaN(r) ? {} : { r, r2Linearised: r * r }
      if (kind === 'exponential') {
        notes.push("Fitted like a TI-84 (ExpReg): least squares on ln y, so r and r² there are for ln y against x.")
        return finish({ a: Math.exp(intercept), b: Math.exp(slope) }, line.fitted.map(Math.exp), extra)
      }
      if (kind === 'power') {
        notes.push("Fitted like a TI-84 (PwrReg): least squares on ln y against ln x.")
        return finish({ a: Math.exp(intercept), b: slope }, line.fitted.map(Math.exp), extra)
      }
      notes.push("Fitted like a TI-84 (LnReg): least squares on y against ln x.")
      return finish({ a: intercept, b: slope }, line.fitted, extra)
    }

    // ---- logistic -------------------------------------------------------------
    if (kind === 'logistic') {
      if (n < 4) return fail(`${NAME[kind]} needs at least 4 points — ${pts(n)}.`)
      const bad = Y.findIndex((y) => !(y > 0))
      if (bad >= 0) {
        return fail(
          `${NAME[kind]} needs every y to be positive — a logistic curve stays between 0 and its limit c, and (${show(X[bad])}, ${show(Y[bad])}) has y ≤ 0.`,
        )
      }
      if (distinct < 3) return fail(`${NAME[kind]} needs at least 3 different x values — ${pts(distinct)}.`)
      const fit = fitLogistic(X, Y)
      if (fit === 'far') {
        return fail(
          `${NAME[kind]}: the x values are too far from 0 for y = c/(1 + a·e^(−bx)) — a overflows. Use x = years since the first one.`,
        )
      }
      if (!fit) return fail(`${NAME[kind]} could not be computed for this data.`)
      notes.push("Nonlinear least squares, like the TI-84's Logistic; a calculator's iteration can stop a few digits away on noisy data.")
      return finish({ c: fit.c, a: fit.a, b: fit.b }, fit.fitted)
    }

    // ---- sinusoidal -------------------------------------------------------------
    if (n < 5) return fail(`${NAME[kind]} needs at least 5 points — ${pts(n)}.`)
    if (distinct < 4) return fail(`${NAME[kind]} needs at least 4 different x values — ${pts(distinct)}.`)
    const fit = fitSinusoid(X, Y)
    if (!fit) return fail(`${NAME[kind]} could not be computed for this data.`)
    notes.push(
      "Nonlinear least squares, like the TI-84's SinReg (radians); the period is estimated from the data, " +
      'so noisy data with few points per cycle can settle on another period.',
    )
    return finish({ a: fit.a, b: fit.b, c: fit.c, d: fit.d }, fit.fitted)
  } catch {
    return fail(`${NAME[kind] ?? 'The fit'} could not be computed for this data.`)
  }
}

// ----------------------------------------------------------------------------
// regressionSource
// ----------------------------------------------------------------------------

/**
 * A coefficient as typed text: `digits` decimals, but never fewer than
 * `digits` significant figures (0.00012345 must not print as 0.0001), no
 * trailing zeros, no exponent notation (the parser would read 1e-5 as 1·e−5).
 */
function fmt(v: number, digits: number, minDecimals = 0): string {
  if (!Number.isFinite(v)) return 'NaN'
  if (v === 0) return '0'
  const sig = Math.max(digits, 1)
  const mag = Math.floor(Math.log10(Math.abs(v)))
  const dec = Math.min(20, Math.max(digits, sig - 1 - mag, minDecimals))
  let s: string
  if (Math.abs(v) >= 1e21) s = BigInt(Math.round(v)).toString()
  else s = v.toFixed(dec)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (/^-0(\.0*)?$/.test(s)) s = '0'
  return s
}

interface Term { v: number; body: string }

/** Signed sum with minus signs folded; coefficient ±1 written as the bare body. */
function termSum(terms: Term[], digits: number): string {
  let out = ''
  for (const t of terms) {
    const s = fmt(t.v, digits)
    if (s === '0') continue
    const neg = s.startsWith('-')
    const mag = neg ? s.slice(1) : s
    const piece = t.body === '' ? mag : mag === '1' ? t.body : `${mag}${t.body}`
    if (out === '') out = neg ? `-${piece}` : piece
    else out += neg ? ` - ${piece}` : ` + ${piece}`
  }
  return out === '' ? '0' : out
}

/** "3.1", "" for 1, "-" for −1 — a leading multiplier. */
function multiplier(v: number, digits: number): string {
  const s = fmt(v, digits)
  return s === '1' ? '' : s === '-1' ? '-' : s
}

export function regressionSource(result: RegressionResult, digits = 4): string {
  try {
    if (!result || !result.ok) return ''
    const d = Math.max(0, Math.min(12, Math.round(Number.isFinite(digits) ? digits : 4)))
    const k = result.coef
    const deg = DEGREE[result.kind]
    if (deg !== undefined) {
      const names = ['a', 'b', 'c', 'd', 'e']
      const terms: Term[] = []
      for (let j = 0; j <= deg; j++) {
        const p = deg - j
        terms.push({ v: k[names[j]], body: p === 0 ? '' : p === 1 ? 'x' : `x^${p}` })
      }
      return `y = ${termSum(terms, d)}`
    }
    switch (result.kind) {
      case 'exponential': {
        // a(b)^x — the shape readExponential reads back as a = a, b = b
        const a = fmt(k.a, d)
        if (a === '0') return 'y = 0'
        let b = fmt(k.b, d)
        for (let extra = d + 1; (b === '1' || b === '0') && extra <= 20; extra++) b = fmt(k.b, d, extra)
        return `y = ${multiplier(k.a, d)}(${b})^x`
      }
      case 'power': {
        const a = fmt(k.a, d)
        if (a === '0') return 'y = 0'
        const p = fmt(k.b, d)
        if (p === '0') return `y = ${a}`
        const pow = p === '1' ? 'x' : p.startsWith('-') ? `x^(${p})` : `x^${p}`
        return `y = ${multiplier(k.a, d)}${pow}`
      }
      case 'logarithmic':
        return `y = ${termSum([{ v: k.a, body: '' }, { v: k.b, body: 'ln(x)' }], d)}`
      case 'logistic': {
        const c = fmt(k.c, d)
        const rate = termSum([{ v: -k.b, body: 'x' }], d)
        const a = fmt(k.a, d)
        if (a === '0') return `y = ${c}`
        if (rate === '0') return `y = ${c}/(1 + ${a})`
        return `y = ${c}/(1 + ${multiplier(k.a, d)}e^(${rate}))`
      }
      case 'sinusoidal': {
        const inner = termSum([{ v: k.b, body: 'x' }, { v: k.c, body: '' }], d)
        return `y = ${termSum([{ v: k.a, body: `sin(${inner})` }, { v: k.d, body: '' }], d)}`
      }
      default:
        return ''
    }
  } catch {
    return ''
  }
}

// ----------------------------------------------------------------------------
// suggestModels
// ----------------------------------------------------------------------------

/** Parameters beyond the constant, for adjusted r². */
const PREDICTORS: Partial<Record<RegressionKind, number>> = {
  linear: 1, quadratic: 2, exponential: 1, power: 1, logarithmic: 1,
}

export function suggestModels(xs: number[], ys: number[]): RegressionKind[] {
  try {
    if (!Array.isArray(xs) || !Array.isArray(ys)) return []
    const X: number[] = []
    const Y: number[] = []
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { X.push(xs[i]); Y.push(ys[i]) }
    }
    const n = X.length
    const distinct = distinctCount(X)
    const xPos = X.every((x) => x > 0)
    const yPos = Y.every((y) => y > 0)
    const admissible: Record<RegressionKind, boolean> = {
      linear: distinct >= 2,
      quadratic: distinct >= 3,
      cubic: distinct >= 4,
      quartic: distinct >= 5,
      exponential: distinct >= 2 && yPos,
      power: distinct >= 2 && xPos && yPos,
      logarithmic: distinct >= 2 && xPos,
      logistic: n >= 4 && distinct >= 3 && yPos,
      sinusoidal: n >= 5 && distinct >= 4,
    }
    // the cheap ones, fitted and ranked by adjusted r² (plain r² would always
    // rank the quadratic above the line it barely improves on)
    const ranked: { kind: RegressionKind; score: number; order: number }[] = []
    KIND_ORDER.forEach((kind, order) => {
      const p = PREDICTORS[kind]
      if (p === undefined || !admissible[kind]) return
      const fit = fitRegression(kind, X, Y)
      if (!fit.ok) return
      let score = fit.r2
      if (n > p + 1 && Number.isFinite(score)) score = 1 - ((1 - score) * (n - 1)) / (n - p - 1)
      ranked.push({ kind, score: Number.isFinite(score) ? score : -Infinity, order })
    })
    ranked.sort((u, w) => (Math.abs(u.score - w.score) > 1e-12 ? w.score - u.score : u.order - w.order))
    const out = ranked.map((r) => r.kind)
    for (const kind of ['cubic', 'quartic', 'logistic', 'sinusoidal'] as RegressionKind[]) {
      if (admissible[kind]) out.push(kind)
    }
    return out
  } catch {
    return []
  }
}
