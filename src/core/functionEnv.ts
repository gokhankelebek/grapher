// ============================================================================
// Functions that use other functions (src/core/functionEnv.ts)
//
//     g(x) = 2f(x − 1) + 3        h(x) = f(g(x))        k(x) = f'(x)
//     p(x) = f(x)·g(x)            q(x) = f(x) − g(x)    f^-1 as a curve
//
// Every curve on the board may carry a NAME (f, g, h …). A typed expression
// can call a named curve like any built-in function; the call is evaluated
// against that curve's CURRENT formula and parameters, so dragging f's
// slider moves g live.
//
// PARSER (src/core/parse/index.ts, additive — the core agent's file):
//   parseExpression(src, env?) — a second, optional argument.
//     Without env, or when env does not define a name, every input parses
//     EXACTLY as before: `a(x + 1)` is still the slider a times (x + 1).
//     With env defining f, `f(u)` is a call: evaluated through env.eval,
//     rendered f\left(u\right). `f'(u)`, `f''(u)` are the first and second
//     derivative of the named curve (numeric, Richardson, from env.eval).
//     A named call inside the curve's OWN definition (f(x) = f(x − 1) + 1)
//     is a positioned error ("f cannot use itself"), and so is a name that
//     is not a function of one variable (a circle).
//   The resulting ModelSpec closes over `env`, not over a snapshot, so a
//   change to f is seen by g on its next evaluation without re-parsing.
//
//   export function referencedNames(src): string[]
//       the curve names a source line calls (f, g in "f(g(x)) + g'(x)"),
//       found WITHOUT an env — every single letter immediately followed by
//       "(" or "'(" that is not a built-in function and not the line's own
//       head — so the App can order and wire curves before parsing them.
//   export function dependencyOrder(defs): DependencyOrder
//       topological order of named definitions; cycles reported with the
//       names on the cycle, in order ("f → g → f").
//   export function inverseRelation(curve, models, range): InverseRelation
//       the inverse of ANY explicit curve as a relation: a parametric curve
//       (x, y) = (f(t), t) over t ∈ range, plus whether f is one-to-one on
//       that range (the horizontal line test) and, when it is not, the
//       widest intervals around 0 on which it is (for "restrict the domain
//       to x ≥ 0" advice), found from the sign changes of f′.
// ============================================================================

import type { FittedCurve, ModelSpec } from './types'

/** What a typed expression may call by name. */
export interface FunctionEnv {
  /** True when `name` is a curve that can be called as a function of x. */
  has(name: string): boolean
  /** f(x) at the curve's current parameters; NaN where undefined. */
  eval(name: string, x: number): number
}

export interface NamedDef {
  name: string
  /** The names it calls (referencedNames of its source). */
  uses: string[]
}

export interface DependencyOrder {
  /** Names in an order where every name comes after the names it uses. */
  order: string[]
  /** Each cycle as the names along it, first repeated last: ["f","g","f"]. */
  cycles: string[][]
}

export interface InverseRelation {
  /** A parametric ModelSpec for (f(t), t), params = [] — register under an id. */
  makeModel(modelId: string): ModelSpec
  tRange: [number, number]
  oneToOne: boolean
  /** Intervals of x on which f is one-to-one (monotone), widest first. */
  monotoneIntervals: [number, number][]
  /** Teacher sentence: "f is one-to-one, so its inverse is a function" /
   *  "f fails the horizontal line test — restrict its domain to x ≥ 0". */
  sentence: string
}

// TODO(core agent): implement.
export function referencedNames(_src: string): string[] {
  return []
}

export function dependencyOrder(defs: readonly NamedDef[]): DependencyOrder {
  return { order: defs.map((d) => d.name), cycles: [] }
}

export function inverseRelation(
  _curve: FittedCurve,
  _models: Record<string, ModelSpec>,
  range: [number, number],
): InverseRelation {
  return {
    makeModel: (id) => ({ id, name: 'Inverse', kind: 'parametric', paramNames: [], latex: () => '' }) as unknown as ModelSpec,
    tRange: range,
    oneToOne: false,
    monotoneIntervals: [],
    sentence: '',
  }
}
