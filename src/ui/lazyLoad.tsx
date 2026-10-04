// ============================================================================
// src/ui/lazyLoad.tsx — code the first board does not need, loaded later.
//
// The workspace chunk used to be the whole app (≈3 MB), and a school
// Chromebook on slow Wi-Fi parsed every dialog, export back-end and card
// before the board could take a stroke. What the first render does not draw
// now sits behind a dynamic import():
//
//   lazyModule(() => import('…'))   a module loaded on first use. get() is
//                                   the module once it is here (null before),
//                                   so a caller that finds it loaded runs
//                                   exactly the synchronous code it always
//                                   ran — a clipboard write stays inside the
//                                   click that asked for it.
//   lazyComponent(mod, pick)        a component from such a module. Once the
//                                   module is loaded it renders the component
//                                   directly, in the same commit — no
//                                   Suspense, no thrown promise, no fallback
//                                   frame. Before, it renders `fallback` and
//                                   starts the load.
//   prefetchLazyModules()           after the first paint, in idle time, load
//                                   every module registered here, one after
//                                   another, so a later click is instant (and
//                                   an open tab no longer needs the server
//                                   once that is done — a deploy that replaces
//                                   the hashed chunks cannot strand it).
//
// Render code (renderBoard and what it draws) is NOT behind this: a document
// or a view-only share link must draw completely on its first frame.
// ============================================================================

import { useEffect, useReducer } from 'react'
import type { ComponentType, ReactNode } from 'react'

export interface LazyModule<T> {
  /** The module once it has loaded; null until then. */
  get(): T | null
  /** Start the load, or join the one in flight. A failed load can be retried. */
  load(): Promise<T>
}

/** Every lazy module, in the order they were declared: what prefetch walks. */
const registry: LazyModule<unknown>[] = []

export function lazyModule<T>(importer: () => Promise<T>): LazyModule<T> {
  let mod: T | null = null
  let pending: Promise<T> | null = null
  const handle: LazyModule<T> = {
    get: () => mod,
    load: () => {
      if (mod !== null) return Promise.resolve(mod)
      if (pending === null) {
        pending = importer().then(
          (m) => {
            mod = m
            return m
          },
          (err: unknown) => {
            pending = null // offline before the worker cached it, or a stale deploy: try again next time
            throw err
          },
        )
      }
      return pending
    },
  }
  registry.push(handle as LazyModule<unknown>)
  return handle
}

/** The module, re-rendering the caller once when it arrives. */
export function useLazyModule<T>(m: LazyModule<T>): T | null {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const mod = m.get()
  useEffect(() => {
    if (mod !== null) return
    let live = true
    m.load().then(
      () => {
        if (live) bump()
      },
      () => {
        // Stay on the fallback; the next mount tries again.
      },
    )
    return () => {
      live = false
    }
  }, [m, mod])
  return mod
}

/** A component that lives in a lazy module. */
export function lazyComponent<M, P extends object>(
  mod: LazyModule<M>,
  pick: (m: M) => ComponentType<P>,
  fallback: ReactNode = null,
): ComponentType<P> {
  function Lazy(props: P) {
    const m = useLazyModule(mod)
    if (m === null) return <>{fallback}</>
    const C = pick(m) as ComponentType<object>
    return <C {...props} />
  }
  return Lazy
}

/** What a dialog shows for the moment its code is still on the way. */
export function LazyWait() {
  return (
    <div className="lazy-wait" role="status" aria-live="polite">
      Loading…
    </div>
  )
}

let prefetchStarted = false

/**
 * Load every registered lazy module in idle time, one at a time, so the
 * download never competes with the board. Called once, after the first paint.
 */
export function prefetchLazyModules(): void {
  if (prefetchStarted || typeof window === 'undefined') return
  prefetchStarted = true
  const idle = (fn: () => void): void => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 })
    else window.setTimeout(fn, 200)
  }
  let i = 0
  const next = (): void => {
    const m = registry[i++]
    if (!m) return
    const go = (): void => idle(next)
    m.load().then(go, go)
  }
  idle(next)
}
