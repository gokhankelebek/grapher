// ============================================================================
// src/ui/RevealAnswer.tsx — reveal mode on the cards.
//
// Every computed answer a card states goes through <Answer k="…">. Outside
// reveal mode it renders its children and nothing else — the markup is
// exactly what it was before this existed. In reveal mode, while its key is
// hidden, it renders a "Reveal" pill instead; a click reveals that one answer
// (every pill sharing the key, and the board's "?" for it, together). A just-
// revealed answer fades in.
//
// What a card's TEACHER typed — the equation, a, b, n, the inequality — is
// never wrapped: only what the app computed from it hides.
//
// The state lives in the App (session-only, see src/ui/reveal.ts) and reaches
// the cards through one context, so no card had to grow a prop.
// ============================================================================

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SpecialPoint } from '../core/types'
import { Latex } from './Latex'
import { crossPair, curvePointKeys, splitAnswerTex } from './reveal'

export interface RevealApi {
  /** Reveal mode is on. */
  on: boolean
  /** This answer must not be shown right now. */
  hidden(key: string): boolean
  /** Show this one answer. */
  reveal(key: string): void
  /** The key of a point on a curve — the board's own rule, so card and board agree. */
  pointKey(curveId: string, p: SpecialPoint): string
  /** The key of a crossing of a and b. */
  crossKey(a: string, b: string, p: SpecialPoint): string
}

export const REVEAL_API_OFF: RevealApi = {
  on: false,
  hidden: () => false,
  reveal: () => {},
  pointKey: (id, p) => curvePointKeys(id, [p])[0],
  crossKey: (a, b, p) => {
    const [x, y] = crossPair(a, b)
    return `cross:${x}:${y}:${p.pos.x.toFixed(6)}`
  },
}

export const RevealContext = createContext<RevealApi>(REVEAL_API_OFF)

export function useReveal(): RevealApi {
  return useContext(RevealContext)
}

/** The pill that stands where a hidden answer would be. */
export function RevealPill({ k, what }: { k: string; what?: string }) {
  const r = useReveal()
  return (
    <button
      type="button"
      className="reveal-pill"
      data-reveal-key={k}
      data-testid="reveal-pill"
      title={what ? `Reveal ${what}` : 'Reveal this answer'}
      onClick={(e) => {
        e.stopPropagation()
        r.reveal(k)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      Reveal
    </button>
  )
}

interface AnswerProps {
  /** The answer key (src/ui/reveal.ts). */
  k: string
  children?: ReactNode
  /** The pill and the fade wrapper are blocks (the answer is a block of lines). */
  block?: boolean
  /** Words for the pill's tooltip: "the limit", "the solution set". */
  what?: string
  /** Hidden, render nothing: a pill beside it already stands for this answer. */
  quiet?: boolean
}

/** A computed answer: itself, or — hidden in reveal mode — a Reveal pill. */
export function Answer({ k, children, block, what, quiet }: AnswerProps) {
  const r = useReveal()
  if (!r.on) return <>{children}</>
  if (r.hidden(k)) {
    if (quiet) return null
    return block ? (
      <div className="reveal-pill-row">
        <RevealPill k={k} what={what} />
      </div>
    ) : (
      <RevealPill k={k} what={what} />
    )
  }
  return block ? (
    <div className="reveal-in" data-revealed={k}>
      {children}
    </div>
  ) : (
    <span className="reveal-in" data-revealed={k}>
      {children}
    </span>
  )
}

/**
 * A typeset line whose right-hand side is the answer: "lim f(x) = 6" keeps
 * "lim f(x) =" and puts the pill where the 6 was. A line with no "=" is all
 * answer.
 */
export function AnswerTex({
  k,
  tex,
  className,
  what,
  question,
}: {
  k: string
  tex: string
  className?: string
  what?: string
  /** What still shows while hidden, when it is not simply everything before the first "=". */
  question?: string
}) {
  const r = useReveal()
  if (!r.on) return <Latex tex={tex} className={className} />
  if (!r.hidden(k)) {
    return (
      <span className="reveal-in" data-revealed={k}>
        <Latex tex={tex} className={className} />
      </span>
    )
  }
  const split: [string, string] | null = question !== undefined ? [question, ''] : splitAnswerTex(tex)
  if (!split || split[0] === '') return <RevealPill k={k} what={what} />
  return (
    <span className="reveal-tex">
      <Latex tex={`${split[0]} =`} className={className} />
      <RevealPill k={k} what={what} />
    </span>
  )
}

/** A plain-text line whose answer follows its first "=" (or "≈"). */
export function answerTextParts(text: string): [string, string] | null {
  const m = /^(.*?)\s*(=|≈)\s*(.+)$/.exec(text)
  return m ? [`${m[1]} ${m[2]}`, m[3]] : null
}

/** The same, as an element: "f(2) =" and the pill. */
export function AnswerText({ k, text, what }: { k: string; text: string; what?: string }) {
  const r = useReveal()
  if (!r.on) return <>{text}</>
  if (!r.hidden(k)) {
    return (
      <span className="reveal-in" data-revealed={k}>
        {text}
      </span>
    )
  }
  const parts = answerTextParts(text)
  if (!parts) return <RevealPill k={k} what={what} />
  return (
    <span className="reveal-tex">
      {parts[0]} <RevealPill k={k} what={what} />
    </span>
  )
}

/** A collapsed section's header summary, which states the answer too. */
export function useMaskedSummary(k: string | null | undefined, summary: string | null | undefined): string | null | undefined {
  const r = useReveal()
  if (!k || !r.on || !r.hidden(k) || !summary) return summary
  const parts = answerTextParts(summary)
  return parts ? `${parts[0]} ?` : 'answer hidden'
}
