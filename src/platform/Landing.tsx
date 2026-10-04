// ============================================================================
// The landing page at "/": one screen of story, then a short scroll of proof.
//
// For AP Calculus and AP Precalculus teachers who make their own handouts.
// It shares the app's dark navy and neon look (src/ui/styles.css) but NOT its
// code: this module's import graph is React, src/brand.ts and this folder's
// small helpers, so "/" stays a small download (tests/landing.test.ts checks).
// The app loads only when a button below is pressed (?app=1).
//
// Every product name on this page comes from src/brand.ts.
// ============================================================================

import { Fragment, useEffect, useState } from 'react'
import { BRAND, FEEDBACK_URL, PRIVACY_LINE, REPO_URL, TAGLINE, TRUST_LINE } from '../brand'
import Demo from './Demo'
import { appHref } from './route'
import { browserStorage, savedDocCount } from './returning'
import answersImg from './img/answers.webp'
import teachImg from './img/teach.webp'
import printImg from './img/print.webp'
import './landing.css'

/**
 * TODO(teacher): the photo and one line, in the teacher's own words. Until
 * they exist the page shows a neutral placeholder and no quote. Put the photo
 * in src/platform/img/ and import it here.
 */
const TEACHER_PHOTO: string | null = null
const TEACHER_QUOTE: string | null = null
const TEACHER_LINE = 'Built by an AP Calculus teacher in North Carolina.'

const PANELS = [
  {
    id: 'answers',
    title: 'Answers',
    img: answersImg,
    alt: 'The sign chart’s Conclusions on a curve card: “f has a relative maximum at x = −3 because f′ changes from positive to negative there”, with the increasing and decreasing intervals and a Second Derivative Test line.',
    text: 'Every curve gets a card that states its zeros, extrema and intervals, and its sign chart writes each conclusion with an AP-style justification.',
  },
  {
    id: 'teach',
    title: 'Teach',
    img: teachImg,
    alt: 'Presentation mode with large type: the bar reads “3 of 15 revealed” with a Next button, the revealed zeros are labelled on the curve and the rest are question marks.',
    text: 'Hide the answers with Reveal, then step through them full-screen in Present mode, or send students a view-only link.',
  },
  {
    id: 'print',
    title: 'Print',
    img: printImg,
    alt: 'The worksheet builder: a white Letter page titled “Unit 5 Quiz: Reading the graph of f′” with two figures and their answer key, under buttons for Student PDF, Key PDF, Copy LaTeX, .tex and pgfplots.',
    text: 'Build a worksheet and its answer key, and export any figure as SVG, PDF or LaTeX/TikZ.',
  },
] as const

export default function Landing() {
  const base = import.meta.env.BASE_URL
  // Read-only: how many documents this browser already has. Never writes.
  const [saved] = useState(() => {
    const read = browserStorage()
    return read ? savedDocCount(read) : 0
  })
  const returning = saved > 0

  useEffect(() => {
    document.title = `${BRAND}: ${TAGLINE}`
  }, [])

  const appUrl = appHref(base)
  const galleryUrl = appHref(base, { gallery: '1' })

  return (
    <div className="lp">
      <header className="lp-top">
        <a className="lp-brand" href={base}>
          <img src={`${base}icons/icon.svg`} alt="" width={28} height={28} />
          {BRAND}
        </a>
        <nav aria-label="Site">
          <a className="lp-link" href="#what">
            What it does
          </a>
          <a className="lp-btn lp-btn-quiet" href={appUrl}>
            Open the app
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">For AP Calculus and AP Precalculus teachers</p>
            <h1 id="lp-title">
              {/* One sentence per line where there is room; the second in the canvas's neon. */}
              {(TAGLINE.match(/[^.]+\.?/g) ?? [TAGLINE]).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' '}
                  <span className={i > 0 ? 'lp-h1-accent' : undefined}>{part.trim()}</span>
                </Fragment>
              ))}
            </h1>
            <p className="lp-sub">
              Built by an AP Calculus teacher for teachers who make their own handouts: the AP-style analysis, then a
              print-ready figure, worksheet and answer key, even as LaTeX/TikZ.
            </p>
            <div className="lp-ctas">
              {returning && (
                <a className="lp-btn lp-btn-primary lp-continue" href={appUrl}>
                  Continue where you left off
                  <small>
                    {saved} saved {saved === 1 ? 'graph' : 'graphs'} in this browser
                  </small>
                </a>
              )}
              <a className={`lp-btn ${returning ? 'lp-btn-secondary' : 'lp-btn-primary'}`} href={galleryUrl}>
                Open an AP example
              </a>
              {/* A returning visitor's app opens on their last graph, so "blank" would not be true for them. */}
              {!returning && (
                <a className="lp-btn lp-btn-secondary" href={appUrl}>
                  Open a blank graph
                </a>
              )}
            </div>
            <p className="lp-trust-mini">{TRUST_LINE}</p>
          </div>
          <Demo />
        </section>

        <section id="what" className="lp-panels" aria-labelledby="lp-what">
          <h2 id="lp-what" className="lp-section-title">
            Answers <span aria-hidden="true">·</span> Teach <span aria-hidden="true">·</span> Print
          </h2>
          <div className="lp-panel-grid">
            {PANELS.map((p) => (
              <article className="lp-panel" key={p.id} aria-labelledby={`lp-${p.id}`}>
                <img src={p.img} alt={p.alt} width={720} height={450} loading="lazy" decoding="async" />
                <h3 id={`lp-${p.id}`}>{p.title}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-trust" aria-labelledby="lp-trust">
          <h2 id="lp-trust">{TRUST_LINE}</h2>
          <ul>
            <li>
              <strong>Free for teachers</strong> and their students.
            </li>
            <li>
              <strong>No account.</strong> Open it and start drawing.
            </li>
            <li>
              <strong>Nothing leaves your device.</strong> Your graphs are saved in this browser, and a share link
              carries the graph inside the link itself.
            </li>
          </ul>
        </section>

        <section className="lp-about" aria-labelledby="lp-about">
          <h2 id="lp-about">Who made this</h2>
          <div className="lp-about-row">
            {TEACHER_PHOTO ? (
              <img className="lp-photo" src={TEACHER_PHOTO} alt="" width={96} height={96} />
            ) : (
              <div className="lp-photo lp-photo-empty" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="40" height="40">
                  <circle cx="24" cy="18" r="8" />
                  <path d="M8 42c2-9 9-13 16-13s14 4 16 13" />
                </svg>
              </div>
            )}
            <div>
              <p className="lp-about-line">{TEACHER_LINE}</p>
              {TEACHER_QUOTE && <blockquote className="lp-quote">{TEACHER_QUOTE}</blockquote>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <p>
          <strong>Privacy.</strong> {PRIVACY_LINE}
        </p>
        <ul>
          <li>
            <a href={REPO_URL}>Source on GitHub</a>
          </li>
          {FEEDBACK_URL ? (
            <li>
              <a href={FEEDBACK_URL}>Send feedback</a>
            </li>
          ) : (
            import.meta.env.DEV && (
              <li className="lp-todo">TODO: feedback link (set FEEDBACK_URL in src/brand.ts)</li>
            )
          )}
          <li>
            <a href={appUrl}>Open {BRAND}</a>
          </li>
        </ul>
      </footer>
    </div>
  )
}
