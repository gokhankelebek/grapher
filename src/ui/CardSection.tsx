// ============================================================================
// src/ui/CardSection.tsx — the one frame every section of a card sits in.
//
//   ▸ TAYLOR  P₃ about 0                                   ×
//
// A header that is a real button (aria-expanded, visible focus), a caret that
// turns, the section's name in the card's eyebrow voice, and — only while it
// is collapsed — a one-line summary of what is inside, so a folded Taylor
// still says which polynomial it is. Anything that must stay reachable while
// folded (a remove ×, the logistic's AP/Precalc switch) sits beside the
// button, never inside it: a button inside a button is not a button.
//
// Open or closed is remembered per KIND of section ('analysis', 'taylor',
// 'transform:secondary'), in the person's preferences (src/ui/storage.ts),
// not per curve: collapse Analysis once and it stays collapsed on every card
// in every document. A kind nobody has toggled opens by the default the card
// passes in. The choice is read when the section mounts (a card's body mounts
// when the card is selected) and written when the header is clicked; two
// Taylor polynomials on one card do not fold each other.
// ============================================================================

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readPrefs, updatePrefs } from './storage'
import { useMaskedSummary } from './RevealAnswer'

/** The remembered choices, read once per page and kept in step with every write. */
let remembered: Record<string, boolean> | null = null

function rememberedChoices(): Record<string, boolean> {
  if (remembered === null) {
    try {
      remembered = { ...readPrefs().sections }
    } catch {
      remembered = {}
    }
  }
  return remembered
}

/** Whether a section of this kind opens, given the card's own default. */
export function sectionOpen(kind: string, defaultOpen: boolean): boolean {
  const own = rememberedChoices()[kind]
  return typeof own === 'boolean' ? own : defaultOpen
}

/** Remember a choice for every section of this kind from now on. */
export function rememberSection(kind: string, open: boolean): void {
  remembered = { ...rememberedChoices(), [kind]: open }
  try {
    updatePrefs({ sections: remembered })
  } catch {
    /* a preference that fails to save is not the user's work */
  }
}

/**
 * Window event that opens every mounted section of one kind (detail: the kind)
 * and scrolls it into view — the command palette's "open the Transform tool".
 */
export const OPEN_SECTION_EVENT = 'grapher:open-section'

/** Tests only: forget what this page has read, so the next read is fresh. */
export function resetSectionMemory(): void {
  remembered = null
}

interface Props {
  /** What KIND of section this is — the key its open/closed choice is kept under. */
  kind: string
  /** The name in the header. A string, or a node for a title with a quieter tail. */
  title: ReactNode
  /** The header's tooltip: the whole sentence the title abbreviates. */
  titleHint?: string
  /** What the header says while the section is collapsed ("P₃ about 0"). */
  summary?: string | null
  /** Open when nobody has chosen otherwise. */
  defaultOpen?: boolean
  /** Controls kept beside the header, reachable open or closed. */
  actions?: ReactNode
  /** Controls beside the header that only make sense while it is open. */
  openActions?: ReactNode
  className?: string
  testId?: string
  /** Extra attributes a test or a stylesheet reads (data-kind, data-link …). */
  data?: Record<string, string | undefined>
  /**
   * The reveal-mode answer key this section states (src/ui/reveal.ts). While it
   * is hidden the collapsed header's summary keeps its question and says "?"
   * for the answer. The body's own values are wrapped where they are printed.
   */
  answerKey?: string
  children?: ReactNode
}

export function CardSection({
  kind,
  title,
  titleHint,
  summary,
  defaultOpen = true,
  actions,
  openActions,
  className,
  testId,
  data,
  answerKey,
  children,
}: Props) {
  const [open, setOpen] = useState(() => sectionOpen(kind, defaultOpen))
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onOpen = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== kind) return
      setOpen(true)
      // after the body has rendered, so the whole section comes into view
      window.requestAnimationFrame(() => {
        try {
          rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        } catch {
          /* a scroll that fails is not the user's work */
        }
      })
    }
    window.addEventListener(OPEN_SECTION_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen)
  }, [kind])
  const shownSummary = useMaskedSummary(answerKey, summary)
  const bodyId = useId()
  const dataAttrs: Record<string, string> = {}
  if (data) for (const [k, v] of Object.entries(data)) if (v !== undefined) dataAttrs[`data-${k}`] = v

  return (
    <div
      ref={rootRef}
      className={`cs${open ? ' cs-open' : ' cs-closed'}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-section={kind}
      {...dataAttrs}
    >
      <div className="cs-head">
        <button
          type="button"
          className="cs-toggle"
          title={answerKey && shownSummary !== summary ? undefined : titleHint}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={(e) => {
            e.stopPropagation()
            const next = !open
            setOpen(next)
            rememberSection(kind, next)
          }}
        >
          <svg className="cs-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M3.5 1.5 7 5 3.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="cs-title">{title}</span>
          {!open && shownSummary ? <span className="cs-summary">{shownSummary}</span> : null}
        </button>
        {open && openActions ? <div className="cs-actions">{openActions}</div> : null}
        {actions ? <div className="cs-actions">{actions}</div> : null}
      </div>
      {open && (
        <div className="cs-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  )
}

/** The × that removes an attached object, in a section's header. */
export function SectionDrop({ what, onRemove }: { what: string; onRemove(): void }) {
  return (
    <button
      type="button"
      className="calc-drop"
      title={`Remove this ${what}`}
      aria-label={`Remove this ${what}`}
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    >
      ×
    </button>
  )
}

/**
 * A family section's fact lines without the ones that say the domain or the
 * range — used when the card's Analysis already states both as rows of their
 * own (src/ui/DomainSection.tsx), so a card never says "range: y ≥ 0" twice.
 * The Build previews, which have no Analysis beside them, keep every line.
 */
export function withoutDomainRange(lines: readonly string[]): string[] {
  return lines.filter((t) => !/^\s*(domain|range)\b/i.test(t))
}
