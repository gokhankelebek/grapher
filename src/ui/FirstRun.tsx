// ============================================================================
// src/ui/FirstRun.tsx — "What do you teach?"
//
// FIRST RUN (mode 'first'): a brand-new teacher's first screen, in place of
// an empty board. Step one: the courses, as chips (pick any). Step two: where
// to start — sketch a curve, open an example, make a worksheet. Skippable at
// every step (Esc, or "Skip"); skipping still records that the question was
// asked, so it is never asked again.
//
// SETTINGS (mode 'settings'): the same chips, from Settings → Your courses or
// the help sheet — Save or Cancel, nothing else.
//
// A modal dialog: focus moves in, Tab stays in, Escape leaves, focus goes
// back (src/ui/useDialogFocus.ts). Big touch targets for an iPad; one column
// of choices on a narrow screen.
// ============================================================================

import { useRef, useState } from 'react'
import { BRAND } from '../brand'
import { COURSES } from './courses'
import type { CourseId } from './courses'
import { useDialogFocus } from './useDialogFocus'

export type FirstRunStart = 'sketch' | 'examples' | 'worksheet'

interface Props {
  mode: 'first' | 'settings'
  /** The courses already chosen (settings mode), or none. */
  initial?: readonly CourseId[]
  /** First run: the courses picked (maybe none) and where to start (null: skipped). */
  onFinish?(courses: CourseId[], start: FirstRunStart | null): void
  /** Settings: Save. */
  onSave?(courses: CourseId[]): void
  /** Settings: Cancel (or Escape). */
  onCancel?(): void
  /** Start on step two (tests). */
  startStep?: 1 | 2
}

const START_CHOICES: { id: FirstRunStart; title: string; text: string; icon: JSX.Element }[] = [
  {
    id: 'sketch',
    title: 'Sketch a curve',
    text: 'Draw with a finger, pen or mouse — it becomes an equation you can edit.',
    icon: (
      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M4 24c4 0 5-15 11-15s6 9 13 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="9.6" cy="17.5" r="2.2" fill="currentColor" />
        <circle cx="22" cy="15.5" r="2.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'examples',
    title: 'Open an example',
    text: 'Ready-to-teach boards for your units, each with a teacher note. Opens as your own copy.',
    icon: (
      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="4" y="6" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="18" y="6" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="4" y="19" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="18" y="19" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    id: 'worksheet',
    title: 'Make a worksheet',
    text: 'Put figures on a printable page — a student version and an answer key.',
    icon: (
      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M8 3.5h11l6 6V28.5H8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M19 3.5v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M11.5 22c2 0 2.5-6 5-6s3 3 4.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
]

export function FirstRun({ mode, initial = [], onFinish, onSave, onCancel, startStep = 1 }: Props) {
  const [picked, setPicked] = useState<CourseId[]>(() => initial.slice())
  const [step, setStep] = useState<1 | 2>(mode === 'first' ? startStep : 1)
  const rootRef = useRef<HTMLDivElement>(null)
  const ordered = (): CourseId[] => COURSES.map((c) => c.id).filter((id) => picked.includes(id))

  const leave = (): void => {
    if (mode === 'first') onFinish?.(ordered(), null)
    else onCancel?.()
  }
  useDialogFocus(rootRef, leave, { fallback: '#board-canvas' })

  const toggle = (id: CourseId): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const first = mode === 'first'
  const titleId = 'first-run-title'

  return (
    <div className="fr-scrim" data-testid="first-run" data-mode={mode}>
      <div
        ref={rootRef}
        className="fr"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // The board's single-key shortcuts must not fire behind the dialog.
        onKeyDown={(e) => {
          if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation()
        }}
      >
        {first && (
          <div className="fr-brand" aria-hidden="true">
            Welcome to <span className="fr-brand-name">{BRAND}</span>
          </div>
        )}
        {step === 1 ? (
          <>
            <h2 id={titleId} className="fr-title">
              {first ? 'What do you teach?' : 'Your courses'}
            </h2>
            <p className="fr-lede">
              Pick any. {BRAND} puts their tools and examples first — everything else stays one click away, and
              ⌘K / Ctrl+K always finds anything.
            </p>
            <div className="fr-chips" role="group" aria-label="Courses">
              {COURSES.map((c) => {
                const on = picked.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`fr-chip${on ? ' fr-chip-on' : ''}${c.id === 'other' ? ' fr-chip-other' : ''}`}
                    aria-pressed={on}
                    data-course={c.id}
                    onClick={() => toggle(c.id)}
                  >
                    <span className="fr-chip-tick" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    {c.name}
                  </button>
                )
              })}
            </div>
            <div className="fr-foot">
              {first ? (
                <>
                  <button type="button" className="fr-link" data-testid="first-run-skip" onClick={leave}>
                    Skip for now
                  </button>
                  <button
                    type="button"
                    className="fr-primary"
                    data-testid="first-run-next"
                    onClick={() => {
                      setStep(2)
                      window.setTimeout(() => rootRef.current?.querySelector<HTMLElement>('.fr-start')?.focus(), 0)
                    }}
                  >
                    {picked.length === 0 ? 'Next' : 'Next →'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="fr-link" onClick={leave}>
                    Cancel
                  </button>
                  <button type="button" className="fr-primary" data-testid="courses-save" onClick={() => onSave?.(ordered())}>
                    Save
                  </button>
                </>
              )}
            </div>
            {first && <p className="fr-note">You can change this any time: Settings → Your courses.</p>}
          </>
        ) : (
          <>
            <h2 id={titleId} className="fr-title">
              Where would you like to start?
            </h2>
            <div className="fr-starts">
              {START_CHOICES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="fr-start"
                  data-start={s.id}
                  onClick={() => onFinish?.(ordered(), s.id)}
                >
                  <span className="fr-start-icon">{s.icon}</span>
                  <span className="fr-start-title">{s.title}</span>
                  <span className="fr-start-text">{s.text}</span>
                </button>
              ))}
            </div>
            <div className="fr-foot">
              <button type="button" className="fr-link" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="button" className="fr-link" data-testid="first-run-skip" onClick={leave}>
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
