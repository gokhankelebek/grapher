import { useEffect, useRef } from 'react'
import type KaTeX from 'katex'
import { lazyModule } from './lazyLoad'

/**
 * KaTeX (≈270 KB) is not on the board's critical path: the canvas draws its
 * own labels. It is fetched when the first formula mounts (or in the idle
 * prefetch, whichever is first); a formula that mounts before it arrives is
 * drawn as soon as it does. Once loaded, render is synchronous as before.
 */
const katexLib = lazyModule<typeof KaTeX>(() => import('katex').then((m) => m.default))

interface Props {
  tex: string
  className?: string
}

/** Renders a KaTeX formula into a span (never throws on bad input). */
export function Latex({ tex, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = (katex: typeof KaTeX): void => {
      try {
        katex.render(tex, el, { throwOnError: false, displayMode: false })
      } catch {
        el.textContent = tex
      }
    }
    const loaded = katexLib.get()
    if (loaded) {
      draw(loaded)
      return
    }
    let live = true
    katexLib.load().then(
      (katex) => {
        if (live) draw(katex)
      },
      () => {
        if (live) el.textContent = tex
      },
    )
    return () => {
      live = false
    }
  }, [tex])

  return <span ref={ref} className={className} />
}
