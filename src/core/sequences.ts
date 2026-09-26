// ============================================================================
// Sequences and series, AP Precalculus 2.1–2.2 and AP Calculus BC
// (src/core/sequences.ts)
//
// A sequence is DISCRETE: the points (n, aₙ) for n = n₀, n₀ + 1, …, drawn as
// dots (BoardScene.scatter), with an optional continuous partner — the
// linear function behind an arithmetic sequence, the exponential behind a
// geometric one — dashed, so the class sees the sequence as the function
// sampled at the integers. Series are the partial sums Sₙ as their own
// sequence.
//
// Sequences are NOT curves and do not go through parseExpression as a
// curve: the App routes lines that look like a sequence here first.
//
//   export function parseSequence(src): SequenceParse
//     explicit      a_n = 3 + 2(n - 1)      a(n) = 5(0.8)^(n-1)     b_n = n^2
//     recursive     a_1 = 3, a_(n+1) = a_n + 4        (also a_n = a_(n-1) + 4,
//                   a_0 = 1, a_(n+1) = 2a_n + 1, Fibonacci a_1 = a_2 = 1,
//                   a_(n+2) = a_(n+1) + a_n — up to two previous terms)
//     a list        3, 7, 11, 15, …        (terms; "…" optional)
//     with an optional index range {1 <= n <= 20} / for n = 1 to 20;
//     free single letters other than n become sliders (a_n = a + d(n-1)).
//   export function terms(seq, params, n0, count): number[]
//   export function classify(values: number[]): SeqClass
//     from the terms: arithmetic (common difference d), geometric (common
//     ratio r), quadratic (constant second differences), or none — each
//     with exact text and the explicit AND recursive formulas
//     ("aₙ = 3 + 4(n − 1)" and "a₁ = 3, aₙ₊₁ = aₙ + 4").
//   export function partialSums(values): number[]
//   export function seriesInfo(seq, params): SeriesInfo
//     Sₙ in closed form for arithmetic (n/2·(a₁ + aₙ)) and geometric
//     (a₁(1 − rⁿ)/(1 − r)); the infinite geometric sum a₁/(1 − r) when
//     |r| < 1, "diverges" when |r| ≥ 1 (with the reason); for other
//     sequences numeric partial sums and a cautious sentence (the terms
//     do not go to 0 → diverges by the nth-term test; otherwise no claim).
//   export function partnerSource(cls): string | null
//     the continuous partner as a typed explicit source in x:
//     arithmetic → "y = 4x - 1", geometric → "y = 5(0.8)^(x - 1)" (the
//     exponential module's canonical form), quadratic → its parabola.
//   export function sequenceSource(spec): string
//     canonical sources for the builder (both explicit and recursive).
// ============================================================================

export type SeqKind = 'explicit' | 'recursive' | 'list'

export interface SequenceDef {
  /** The letter: a, b, u … */
  name: string
  kind: SeqKind
  /** Evaluate term n at the given slider values (explicit/recursive/list). */
  term(params: number[], n: number): number
  /** The first index the definition gives (1 for a_1 = …, 0 for a_0 = …). */
  start: number
  /** Index range if the line gives one; else null (the App picks 1…10). */
  range: [number, number] | null
  paramNames: string[]
  defaultParams: number[]
  /** KaTeX of the definition as typed. */
  latex: string
}

export type SequenceParse =
  | { ok: true; seq: SequenceDef }
  | { ok: false; error: string; pos?: number }

export type SeqClass =
  | { kind: 'arithmetic'; a1: number; d: number; a1Text: string; dText: string; explicit: string; recursive: string }
  | { kind: 'geometric'; a1: number; r: number; a1Text: string; rText: string; explicit: string; recursive: string }
  | { kind: 'quadratic'; coef: [number, number, number]; explicit: string; recursive: string }
  | { kind: 'none' }

export interface SeriesInfo {
  /** Closed form of Sₙ as text, when known. */
  closedForm: string | null
  /** Infinite sum when it converges and is known. */
  sum: { value: number; text: string } | null
  converges: boolean | null
  sentence: string
}

// TODO(core agent): implement.
export function parseSequence(_src: string): SequenceParse {
  return { ok: false, error: 'not implemented' }
}

export function terms(seq: SequenceDef, params: number[], n0: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => seq.term(params, n0 + i))
}

export function classify(_values: number[]): SeqClass {
  return { kind: 'none' }
}

export function partialSums(values: number[]): number[] {
  const out: number[] = []
  let s = 0
  for (const v of values) {
    s += v
    out.push(s)
  }
  return out
}

export function seriesInfo(_seq: SequenceDef, _params: number[]): SeriesInfo {
  return { closedForm: null, sum: null, converges: null, sentence: '' }
}

export function partnerSource(_cls: SeqClass): string | null {
  return null
}

export function sequenceSource(_spec: { name: string; kind: 'arithmetic' | 'geometric'; a1: string; step: string; form: 'explicit' | 'recursive' }): string {
  return ''
}
