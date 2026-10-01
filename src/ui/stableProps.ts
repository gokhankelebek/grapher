// ============================================================================
// src/ui/stableProps.ts — memoised cards without stale callbacks.
//
// The sidebar renders every card on every App render, and a slider drag is
// two or three App renders a frame: nine cards re-rendered (and their KaTeX
// re-checked) to move one of them. React.memo would skip the eight that did
// not change — except that each card is handed a dozen inline closures
// (`(i, v) => onParamChange(curve.id, i, v)`), new on every render, so a plain
// memo never hits. Comparing props while IGNORING functions would hit, and
// would also keep the closure from the render the card last took — a stale
// handler, the classic way memoisation breaks an app.
//
// So the functions are made stable instead: each function prop becomes a
// proxy that calls whatever that prop is NOW (the latest render's closure).
// The proxy's identity never changes, so React.memo's own shallow comparison
// sees only the data props — and a call always reaches the current handler.
// A prop that is absent (undefined) stays absent: a card that shows a button
// only when its handler exists keeps doing so.
// ============================================================================

import { useRef } from 'react'

type AnyFn = (...args: never[]) => unknown

/** Pure core of useStableHandlers: proxies cached in `cache`, reading `latest`. */
export function stabilise<P extends object>(
  props: P,
  latest: { current: P },
  cache: Map<string, AnyFn>,
): P {
  latest.current = props
  let out: Record<string, unknown> | null = null
  for (const key of Object.keys(props)) {
    const v = (props as Record<string, unknown>)[key]
    if (typeof v !== 'function') continue
    let proxy = cache.get(key)
    if (!proxy) {
      proxy = ((...args: never[]) => {
        const fn = (latest.current as Record<string, unknown>)[key]
        return typeof fn === 'function' ? (fn as AnyFn)(...args) : undefined
      }) as AnyFn
      cache.set(key, proxy)
    }
    if (!out) out = { ...(props as Record<string, unknown>) }
    out[key] = proxy
  }
  return (out ?? props) as P
}

/** `props` with every function prop replaced by a stable proxy to its latest value. */
export function useStableHandlers<P extends object>(props: P): P {
  const latest = useRef(props)
  const cache = useRef<Map<string, AnyFn>>(new Map())
  return stabilise(props, latest, cache.current)
}

/** Which keys differ between two prop objects by identity (a diagnostic, and the tests'). */
export function changedKeys<P extends object>(a: P, b: P): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: string[] = []
  for (const k of keys) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) out.push(k)
  }
  return out
}

// ---------------------------------------------------------------------------
// Data props that are rebuilt with the same contents
//
// What a card is TOLD is rebuilt by the App on every render (its calculus
// rows, its crossings, its "area between" offer) — new objects with the same
// numbers in them, which defeat React.memo exactly as an inline closure does.
// keepStable hands back the PREVIOUS object when the new one has the same
// shape and values, so the card sees an unchanged prop.
// ---------------------------------------------------------------------------

/**
 * Structural equality for plain data: arrays and plain objects by contents,
 * numbers with NaN equal to NaN, functions and class instances by identity.
 * Deep enough for a card's data; past `depth` levels it says "different",
 * which only ever costs a re-render.
 */
export function sameShape(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (depth > 24) return false
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameShape(a[i], b[i], depth + 1)) return false
    return true
  }
  if (Array.isArray(b)) return false
  const pa = Object.getPrototypeOf(a)
  if (pa !== Object.prototype && pa !== null) return false // Map, Set, class: identity only
  if (Object.getPrototypeOf(b) !== pa) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1)) return false
  }
  return true
}

/** `prev` when `next` has the same shape and values, else `next`. */
export function keepStable<T>(prev: T | undefined, next: T): T {
  return prev !== undefined && sameShape(prev, next) ? prev : next
}

/** Every entry of `next` that equals its entry in `prev` replaced by the old object. */
export function keepStableEntries<T>(
  prev: Readonly<Record<string, T>> | null | undefined,
  next: Record<string, T>,
): Record<string, T> {
  if (!prev) return next
  for (const k of Object.keys(next)) {
    const old = prev[k]
    if (old !== undefined && old !== next[k] && sameShape(old, next[k])) next[k] = old
  }
  return next
}
