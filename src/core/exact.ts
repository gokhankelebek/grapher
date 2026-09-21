// ============================================================================
// Exact forms for the numbers a graph produces (src/core/exact.ts)
//
//   export function exactForm(v: number, opts?): ExactForm | null
//   export function verifiedExact(v, check, opts?): ExactForm | null
//
// A zero at 1.7320508075688772 IS √3, and a teacher wants to read √3. This
// module recognises the closed forms that occur in high-school mathematics
// and nothing else:
//     integers and small fractions      p/q            q ≤ 64
//     square roots and their multiples  a√n/b          n square-free ≤ 400, b ≤ 32
//     rational multiples of π           pπ/q           q ≤ 24
//     quadratic surds                   (a ± b√n)/c    c ≤ 12 — the roots of ax²+bx+c
//
// Two rules keep it honest:
//   * `exactForm` accepts only a match within `tol` (default 1e-11 relative),
//     which is what a bisected root or a closed-form vertex carries;
//   * `verifiedExact` is for values located less precisely (an extremum from
//     a golden-section search is good to ~1e-8): it proposes candidates at a
//     looser tolerance and returns the first whose exact value passes the
//     caller's `check` — |f(c)| ≈ 0 for a zero, |f′(c)| ≈ 0 for an extremum,
//     |f″(c)| ≈ 0 for an inflection — evaluated at the candidate itself.
//     A form that fails the check is a coincidence, and is never shown.
//
// `text` is plain Unicode for the card and the board chip ("2√3/9",
// "−π/4", "(1+√5)/2"); `tex` is KaTeX for anything typeset ("\frac{2\sqrt{3}}{9}").
// `value` is the form evaluated in double precision, so callers can polish
// the point onto it.
//
// analyzeCurve attaches the results as SpecialPoint.exactX / exactY.
//
// ---------------------------------------------------------------------------
// HOW A CANDIDATE IS PROPOSED — and why it is never a search over forms.
//
// Each family is inverted rather than enumerated, so a proposal costs tens of
// operations, not millions:
//
//   p/q      for q = 2…64, p = round(v·q) — one candidate per denominator.
//   pπ/q     for q = 1…24, p = round(v·q/π).
//   a√n/b    for b = 1…32, (v·b)² = a²n must be an INTEGER m; the split of m
//            into a² · (square-free n) is unique, so a and n are read off m
//            by dividing out the largest square ≤ 64², never searched for.
//            n square-free is what keeps √12 from ever being printed instead
//            of 2√3 — and what makes "never emit √1 or √4" automatic.
//   (a±b√n)/c   for c = 1…12 and a = −60…60, (v·c − a)² = b²n must be an
//            integer, split the same way. Two nested loops of 12 × 121, and
//            b and n fall out of the integer.
//
// Every proposal is then RE-EVALUATED in double precision and compared with
// the input at `tol`: the integer rounding above only suggests, it never
// decides. Simpler families are tried first and, inside a family, the smallest
// denominator first, so 3/2 wins over any surd equal to it.
//
// A COMPLICATED FORM HAS TO FIT BETTER THAN A SIMPLE ONE.
//
// Counting says so. There is ONE integer near any value and 63 fractions, but
// the quadratic surds offer ~1450 candidates and the single-radical surds
// ~500k values crowded into the small numbers, so at any fixed tolerance the
// complicated families propose something roughly a thousand times more often
// — and every one of those proposals is a coincidence. A sweep of 400 random
// sketched curves had 2.3% of their points "recognised", every one of them
// junk of the shape (−26+7√91)/7.
//
// So each candidate carries a cost — q for p/q, |p|·q for pπ/q, a·b·n for
// a√n/b, |a|·b·n·c for (a±b√n)/c — and anything costing more than TRUST is
// matched at a PROPORTIONALLY tighter tolerance. A form ten times as
// complicated has to fit ten times as well to be believed, which is the
// ordinary rule that an explanation must be paid for in evidence. (1+√5)/2
// and 2√3/9 are cheap and keep essentially the full tolerance; 7√13/26 is
// charged 300× and stops appearing on curves that were never anything but a
// sketch.
//
// π IS TRIED BEFORE THE SURDS, one step earlier than the table above reads,
// and the reason is density. {pπ/q : q ≤ 24} has a few thousand members
// spread over the whole line; {a√n/b} has half a million crowded into the
// small numbers, so at the loose PROPOSAL tolerance a surd is nearly always
// available within 1e-6 of anything — 2π = 6.283185307 has 13√146/25 sitting
// 3e-9 away. Sparse families first is what makes sin(x)'s crest read π/2 and
// not a coincidence; at `exactForm`'s 1e-11 the order almost never matters.
//
// NOT recognised, deliberately: e, ln 2, ln 3, φ as "φ", cube roots, e^x-type
// constants, and any surd of a non-square-free radicand. ln 2 = 0.693147…
// must come back null, and does: no fraction with q ≤ 64, no a√n/b, no
// rational multiple of π and no quadratic surd sits within 1e-11 of it.
// ============================================================================

export interface ExactForm {
  text: string
  tex: string
  value: number
}

export interface ExactOpts {
  /** relative tolerance for a direct match; default 1e-11 */
  tol?: number
}

// ---------------------------------------------------------------------------
// Tuning — the tables above, as numbers
// ---------------------------------------------------------------------------

const DEFAULT_TOL = 1e-11
/** `verifiedExact` proposes at this tolerance; the caller's check decides. */
const PROPOSE_TOL = 1e-6

/** p/q */
const MAX_Q = 64
/** a√n/b */
const SURD_MAX_A = 64
const SURD_MAX_B = 32
/** the radicand, in every family that has one */
const MAX_N = 400
/** pπ/q */
const PI_MAX_Q = 24
/** a rational multiple of π past this is not an answer anybody wants to read */
const PI_MAX_P = 64
/**
 * A form costing this much or less is matched at the full tolerance; beyond
 * it the tolerance is divided by the cost. 8 keeps every shape a lesson
 * actually produces — √3, π/2, 3/2, (1+√5)/2 — at (near) full width.
 */
const TRUST = 8

/** (a ± b√n)/c */
const QS_MAX_A = 60
const QS_MAX_B = 60
const QS_MAX_C = 12

/** True minus, U+2212 — not the hyphen, which reads as a dash next to a digit. */
const MINUS = '−'

// ---------------------------------------------------------------------------
// Number theory, all of it tiny
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** The tolerance a candidate of this cost has to fit within. */
const epsFor = (eps: number, cost: number): number =>
  cost <= TRUST ? eps : (eps * TRUST) / cost

/** squareFree[n] for 2 ≤ n ≤ MAX_N — a 401-byte table built once. */
const SQUARE_FREE: Uint8Array = (() => {
  const t = new Uint8Array(MAX_N + 1)
  for (let n = 2; n <= MAX_N; n++) {
    let ok = 1
    for (let p = 2; p * p <= n; p++) {
      if (n % (p * p) === 0) { ok = 0; break }
    }
    t[n] = ok
  }
  return t
})()

/**
 * Write the integer m as k²·n with n square-free and 2 ≤ n ≤ MAX_N, k ≤ maxK.
 * The decomposition is unique, so this reads m rather than searching it.
 * Returns null when m has no such shape (m a perfect square, n too big, …).
 */
function splitSquare(m: number, maxK: number): { k: number; n: number } | null {
  if (!Number.isSafeInteger(m) || m < 2) return null
  for (let k = maxK; k >= 1; k--) {
    const kk = k * k
    if (m % kk !== 0) continue
    const n = m / kk
    if (n < 2 || n > MAX_N || !SQUARE_FREE[n]) continue
    return { k, n }
  }
  return null
}

// ---------------------------------------------------------------------------
// Builders — one per family, each carrying its own text, tex and value
// ---------------------------------------------------------------------------

const intText = (v: number): string => (v < 0 ? MINUS + String(-v) : String(v))

function makeInt(p: number): ExactForm {
  return { text: intText(p), tex: String(p), value: p }
}

/** p/q in lowest terms, q ≥ 2; the sign rides on p. */
function makeRat(p: number, q: number): ExactForm {
  const s = p < 0
  const a = Math.abs(p)
  return {
    text: (s ? MINUS : '') + a + '/' + q,
    tex: (s ? '-' : '') + `\\frac{${a}}{${q}}`,
    value: p / q,
  }
}

/** sign · a√n / b, gcd(a, b) = 1, n square-free. */
function makeSurd(sign: number, a: number, b: number, n: number): ExactForm {
  const head = (a === 1 ? '' : String(a)) + '√' + n
  const texHead = (a === 1 ? '' : String(a)) + `\\sqrt{${n}}`
  return {
    text: (sign < 0 ? MINUS : '') + head + (b === 1 ? '' : '/' + b),
    tex: (sign < 0 ? '-' : '') + (b === 1 ? texHead : `\\frac{${texHead}}{${b}}`),
    value: (sign * a * Math.sqrt(n)) / b,
  }
}

/** pπ/q in lowest terms, q ≥ 1. */
function makePi(p: number, q: number): ExactForm {
  const s = p < 0
  const a = Math.abs(p)
  const head = (a === 1 ? '' : String(a)) + 'π'
  const texHead = (a === 1 ? '' : String(a)) + '\\pi'
  return {
    text: (s ? MINUS : '') + head + (q === 1 ? '' : '/' + q),
    tex: (s ? '-' : '') + (q === 1 ? texHead : `\\frac{${texHead}}{${q}}`),
    value: (p * Math.PI) / q,
  }
}

/** (a ± b√n)/c — a may be negative, b ≥ 1, c ≥ 1, n square-free. */
function makeQuad(a: number, sign: number, b: number, n: number, c: number): ExactForm {
  const bn = (b === 1 ? '' : String(b)) + '√' + n
  const texBn = (b === 1 ? '' : String(b)) + `\\sqrt{${n}}`
  const inner = intText(a) + (sign > 0 ? '+' : MINUS) + bn
  const texInner = String(a) + (sign > 0 ? '+' : '-') + texBn
  return {
    text: c === 1 ? inner : `(${inner})/${c}`,
    tex: c === 1 ? texInner : `\\frac{${texInner}}{${c}}`,
    value: (a + sign * b * Math.sqrt(n)) / c,
  }
}

// ---------------------------------------------------------------------------
// The candidate generator
//
// `visit` returns true to stop. Families are visited simplest first, and each
// family visits its smallest denominator first, so the FIRST candidate a
// caller accepts is always the simplest one that fits.
// ---------------------------------------------------------------------------

type Visit = (form: ExactForm) => boolean

function candidates(v: number, eps: number, visit: Visit): void {
  const av = Math.abs(v)
  const sign = v < 0 ? -1 : 1

  // ---- 1. integer -------------------------------------------------------
  const k = Math.round(v)
  if (Number.isSafeInteger(k) && Math.abs(v - k) <= eps) {
    if (visit(makeInt(k))) return
  }

  // ---- 2. p/q, q ≤ 64 ---------------------------------------------------
  for (let q = 2; q <= MAX_Q; q++) {
    const p = Math.round(v * q)
    if (p === 0) continue
    if (gcd(p, q) !== 1) continue // already offered at a smaller denominator
    if (!Number.isSafeInteger(p)) continue
    if (Math.abs(v - p / q) <= epsFor(eps, q)) {
      if (visit(makeRat(p, q))) return
    }
  }

  // ---- 3. pπ/q ----------------------------------------------------------
  for (let q = 1; q <= PI_MAX_Q; q++) {
    const p = Math.round((v * q) / Math.PI)
    if (p === 0 || Math.abs(p) > PI_MAX_P) continue
    if (gcd(p, q) !== 1) continue
    const form = makePi(p, q)
    if (Math.abs(form.value - v) <= epsFor(eps, Math.abs(p) * q)) {
      if (visit(form)) return
    }
  }

  // ---- 4. a√n/b ---------------------------------------------------------
  // (|v|·b)² = a²·n has to be an integer; the split of that integer into a
  // square times a square-free part is unique, so a and n are read off it.
  if (av > 0) {
    for (let b = 1; b <= SURD_MAX_B; b++) {
      const w = av * b
      const m = Math.round(w * w)
      if (m < 2 || m > SURD_MAX_A * SURD_MAX_A * MAX_N) continue
      // the rounding only proposes: |w² − m| has to be within the slack that
      // an error of b·eps in w implies, or m is not this value's integer
      if (Math.abs(w * w - m) > 2 * w * b * eps + 1e-9) continue
      const sp = splitSquare(m, SURD_MAX_A)
      if (!sp) continue
      if (gcd(sp.k, b) !== 1) continue // reduces to a smaller b, already tried
      const form = makeSurd(sign, sp.k, b, sp.n)
      if (Math.abs(form.value - v) <= epsFor(eps, sp.k * b * sp.n)) {
        if (visit(form)) return
      }
    }
  }

  // ---- 5. (a ± b√n)/c ---------------------------------------------------
  // v·c − a = ±b√n, so (v·c − a)² is an integer split exactly as above.
  // a = 0 is skipped: that value is a√n/b and was offered in family 3.
  for (let c = 1; c <= QS_MAX_C; c++) {
    const V = v * c
    const aLo = Math.max(-QS_MAX_A, Math.ceil(V - QS_MAX_B * Math.sqrt(MAX_N)) - 1)
    const aHi = Math.min(QS_MAX_A, Math.floor(V + QS_MAX_B * Math.sqrt(MAX_N)) + 1)
    for (let a = aLo; a <= aHi; a++) {
      if (a === 0) continue
      const w = V - a
      const aw = Math.abs(w)
      if (aw < 1e-12) continue
      const m = Math.round(w * w)
      if (m < 2 || m > QS_MAX_B * QS_MAX_B * MAX_N) continue
      if (Math.abs(w * w - m) > 2 * aw * c * eps + 1e-9) continue
      const sp = splitSquare(m, QS_MAX_B)
      if (!sp) continue
      if (gcd(gcd(Math.abs(a), sp.k), c) !== 1) continue // not in lowest terms
      const form = makeQuad(a, w < 0 ? -1 : 1, sp.k, sp.n, c)
      if (Math.abs(form.value - v) <= epsFor(eps, Math.abs(a) * sp.k * sp.n * c)) {
        if (visit(form)) return
      }
    }
  }
}

/** The tolerance a value of this size is matched within. */
function epsOf(v: number, opts: ExactOpts | undefined, fallback: number): number {
  const tol = opts?.tol
  const t = typeof tol === 'number' && Number.isFinite(tol) && tol > 0 ? tol : fallback
  return t * Math.max(1, Math.abs(v))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The simplest closed form equal to `v` within `tol`, or null when `v` is
 * just a decimal. Only for values that carry full precision: a root that was
 * bisected to the last bit, a vertex from the quadratic formula, a limit that
 * converged. For anything located by a search, use `verifiedExact`.
 */
export function exactForm(v: number, opts?: ExactOpts): ExactForm | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const eps = epsOf(v, opts, DEFAULT_TOL)
  let found: ExactForm | null = null
  candidates(v, eps, form => { found = form; return true })
  return found
}

/**
 * The simplest closed form NEAR `v` that the curve itself agrees with.
 *
 * `v` is a number that was searched for rather than solved for, so it is only
 * good to a few digits; candidates are proposed at `opts.tol` (default 1e-6)
 * and the first one whose exact value passes `check` is the answer. `check`
 * is the curve's own test — |f(c)| ≈ 0 at a zero, |f′(c)| ≈ 0 at an extremum
 * — so a form that is merely close is rejected by the curve, not by a
 * tolerance guess.
 */
export function verifiedExact(
  v: number,
  check: (candidate: number) => boolean,
  opts?: ExactOpts,
): ExactForm | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (typeof check !== 'function') return null
  const eps = epsOf(v, opts, PROPOSE_TOL)
  let found: ExactForm | null = null
  candidates(v, eps, form => {
    let ok = false
    try { ok = check(form.value) === true } catch { ok = false }
    if (ok) { found = form; return true }
    return false
  })
  return found
}
