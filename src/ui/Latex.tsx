import { useEffect, useRef } from 'react'
import katex from 'katex'

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
    try {
      katex.render(tex, el, { throwOnError: false, displayMode: false })
    } catch {
      el.textContent = tex
    }
  }, [tex])

  return <span ref={ref} className={className} />
}
