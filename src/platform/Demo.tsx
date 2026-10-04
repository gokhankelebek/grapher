// ============================================================================
// The hero demo: four REAL frames from the running app, cross-faded.
//
// Captured from the app itself (scripted in a headless browser): a wobbly
// stroke drawn with the mouse, the parabola it snapped to with its zeros
// labelled, the card after typing exact coefficients, and the PNG the app's
// Download button wrote in the Textbook figure style (shown on a backdrop).
// Nothing here is a mock-up.
//
// Motion: auto-advances, with a pause button (WCAG 2.2.2). Under
// prefers-reduced-motion it never moves on its own and opens on the card
// frame; the step buttons still show every frame. Images load one ahead of
// the frame on screen, so a reader who never watches pays for one or two.
// ============================================================================

import { useEffect, useState } from 'react'
import sketch from './img/demo-1.webp'
import snap from './img/demo-2.webp'
import card from './img/demo-3.webp'
import figure from './img/demo-4.webp'

interface Frame {
  src: string
  step: string
  caption: string
  alt: string
  ms: number
}

const FRAMES: readonly Frame[] = [
  {
    src: sketch,
    step: 'Sketch',
    caption: 'Draw a rough parabola with a mouse, pen or finger.',
    alt: 'The app’s dark graphing board with a wobbly hand-drawn U-shaped stroke crossing the x-axis near −2 and 2.',
    ms: 2200,
  },
  {
    src: snap,
    step: 'Snap',
    caption: 'It snaps to a parabola and labels the zeros.',
    alt: 'The stroke has become a smooth parabola. Its zeros are labeled −1.997 and 1.995 on the axis, and a card shows y = 0.99626x² + 0.00268x − 3.9693.',
    ms: 2800,
  },
  {
    src: card,
    step: 'Analyze',
    caption: 'Type exact values. The card gives zeros, minimum, domain and range.',
    alt: 'After typing a = 1, b = 0, c = −4 the card reads y = x² − 4, with zeros −2 and 2, minimum (0, −4), range and a one-to-one check.',
    ms: 3400,
  },
  {
    src: figure,
    step: 'Print',
    caption: 'Download it as a white Textbook figure for your handout.',
    alt: 'The PNG the app downloaded: y = x² − 4 on white, with a unit grid, black axes, the zeros −2 and 2 and the vertex (0, −4) labeled.',
    ms: 3000,
  },
]

/** The frame a reduced-motion reader sees first: the card, the most telling still. */
const STILL = 2

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function Demo() {
  const [reduced] = useState(prefersReducedMotion)
  const [active, setActive] = useState(reduced ? STILL : 0)
  const [playing, setPlaying] = useState(!reduced)
  // Frames whose image may load: the one on screen and the next one.
  const [loadable, setLoadable] = useState<ReadonlySet<number>>(() => new Set([reduced ? STILL : 0]))

  useEffect(() => {
    setLoadable((prev) => {
      const next = (active + 1) % FRAMES.length
      if (prev.has(active) && prev.has(next)) return prev
      return new Set([...prev, active, next])
    })
  }, [active])

  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => setActive((i) => (i + 1) % FRAMES.length), FRAMES[active].ms)
    return () => window.clearTimeout(t)
  }, [active, playing])

  const pick = (i: number): void => {
    setPlaying(false)
    setActive(i)
  }

  return (
    <figure className="lp-demo" aria-label="Demo: from a sketch to a print-ready figure in four steps">
      <div className="lp-demo-stage">
        {FRAMES.map((f, i) =>
          loadable.has(i) ? (
            <img
              key={f.src}
              src={f.src}
              alt={i === active ? f.alt : ''}
              aria-hidden={i === active ? undefined : true}
              width={1530}
              height={893}
              decoding="async"
              className={i === active ? 'on' : undefined}
            />
          ) : null,
        )}
      </div>
      <figcaption className="lp-demo-bar">
        <ol className="lp-steps">
          {FRAMES.map((f, i) => (
            <li key={f.step}>
              <button
                type="button"
                aria-current={i === active ? 'step' : undefined}
                onClick={() => pick(i)}
              >
                <span className="lp-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                {f.step}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="lp-demo-play"
          aria-label={playing ? 'Pause the demo' : 'Play the demo'}
          title={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((p) => !p)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M5 3l8 5-8 5z" />}
          </svg>
        </button>
        <p className="lp-demo-caption" aria-live={playing ? 'off' : 'polite'}>
          {FRAMES[active].caption}
        </p>
      </figcaption>
    </figure>
  )
}
