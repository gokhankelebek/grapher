// ============================================================================
// The landing page at "/": one screen of story, then a short scroll of proof.
//
// For AP Calculus, AP Precalculus and NC Math 1–3 teachers who make their own
// handouts.
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
import ncMath1Img from './img/nc-math1.webp'
import ncMath2Img from './img/nc-math2.webp'
import ncMath3Img from './img/nc-math3.webp'
import './landing.css'

/**
 * TODO(teacher): the photo and one line, in the teacher's own words. Until
 * they exist the page shows a neutral placeholder and no quote. Put the photo
 * in src/platform/img/ and import it here.
 */
const TEACHER_PHOTO: string | null = null
const TEACHER_QUOTE: string | null = null
const TEACHER_LINE = 'Built by a North Carolina math teacher who teaches AP Calculus, AP Precalculus and NC Math 3.'

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
    alt: 'Presentation mode with large type: the bar reads “3 of 15 revealed” with a Next button, the revealed zeros are labeled on the curve and the rest are question marks.',
    text: 'Hide the answers with Reveal, then step through them full-screen in Present mode, or send students a view-only link.',
  },
  {
    id: 'print',
    title: 'Print',
    img: printImg,
    alt: 'The worksheet builder’s answer key preview: “Unit 6 Quiz: Riemann sums” marked ANSWER KEY, a rate table’s left Riemann sum L₄ = 68.5 with its data table and worked answer, and a graph of f′ with its sign chart and justifications, under buttons for Student PDF, Key PDF, Copy LaTeX, .tex and pgfplots.',
    text: 'Build a worksheet and its answer key, and export any figure as SVG, PDF or LaTeX/TikZ.',
  },
] as const

/**
 * "Also for NC Math": one real board per course, each from the gallery
 * (src/examples/catalog.ts) and its help-sheet section (src/ui/commands.ts
 * HELP_SECTIONS): m1-parallelogram (m1-coord), m2-two-way-table (m2-prob),
 * m2-triangle-centres (m3-centres; a Math 3 example despite its id).
 */
const NC_PANELS = [
  {
    id: 'nc-math1',
    course: 'NC Math 1 · G-GPE.4',
    img: ncMath1Img,
    alt: 'A polygon card for ABCD: perimeter 4√5 + 2√26 ≈ 19.14, area 18 by the shoelace formula, and under Classification “AB ∥ DC (slope 1/5) and AD ∥ BC (slope 2), so ABCD is a parallelogram.”',
    text: 'Type the vertices and the card proves what the figure is with slopes, “so ABCD is a parallelogram”, with its perimeter and area.',
  },
  {
    id: 'nc-math2',
    course: 'NC Math 2 · S-CP',
    img: ncMath2Img,
    alt: 'A two-way table of 100 students, Junior or Senior by Drives or Doesn’t drive, with the Junior-and-Drives cell and the Drives column highlighted; under it “In this sample, A and B are independent”, checked as P(A|B) = 3/5 = P(A) and P(A and B) = 6/25 = P(A)·P(B).',
    text: 'Type the counts of a two-way table: the totals, P(A | B), and whether the events are independent, checked both ways.',
  },
  {
    id: 'nc-math3',
    course: 'NC Math 3 · G-CO.10',
    img: ncMath3Img,
    alt: 'Obtuse triangle ABC with its incenter I ≈ (0.25, 0.93) and inscribed circle, its centroid G (4/3, 2/3), its circumcenter O (2, −2) outside the triangle on a circle of radius 2√5 ≈ 4.47, and the Euler line labeled HG = 2·GO.',
    text: 'A triangle’s centroid, circumcenter, incenter and orthocenter, exact, on the Euler line with HG = 2·GO.',
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
  // The NC door: the gallery opens on NC Math 1, 2 and 3 (src/app/useGalleryLink.ts).
  const ncGalleryUrl = appHref(base, { gallery: '1', course: 'nc' })

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
            <p className="lp-eyebrow">For AP Calculus, AP Precalculus and NC Math 1–3 teachers</p>
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
              Built by a North Carolina math teacher (AP Calculus, AP Precalculus, NC Math 3) for teachers who make
              their own handouts: the AP-style analysis, then a print-ready figure, worksheet and answer key, even as
              LaTeX/TikZ.
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
              <a className="lp-btn lp-btn-secondary" href={ncGalleryUrl}>
                Open an NC Math example
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

        <section className="lp-panels lp-nc" aria-labelledby="lp-nc">
          <h2 id="lp-nc" className="lp-section-title">
            Also for NC Math 1–3
          </h2>
          <p className="lp-nc-lede">
            Ready-to-teach boards for NC Math 1, 2 and 3 in the gallery, and a help-sheet section for each course.
          </p>
          <div className="lp-panel-grid">
            {NC_PANELS.map((p) => (
              <article className="lp-panel" key={p.id} aria-labelledby={`lp-${p.id}`}>
                <img src={p.img} alt={p.alt} width={720} height={450} loading="lazy" decoding="async" />
                <h3 id={`lp-${p.id}`}>{p.course}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
          <p className="lp-nc-cta">
            <a className="lp-btn lp-btn-secondary" href={ncGalleryUrl}>
              Open an NC Math example
            </a>
          </p>
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
