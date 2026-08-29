# Grapher — Sketch to Math

Draw anything on an infinite graph-paper canvas — a wobbly sine, a lumpy circle, a
three-petal rose, a heart — and Grapher instantly turns it into a **perfectly fitted
mathematical curve** with a live equation, editable parameters, and Desmos-style tooling.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

## What it does

- **Sketch recognition** — strokes are resampled, smoothed, and fitted against a
  16-family model library (line, poly²–⁴, sinusoid, Gaussian, exponential, logistic,
  |x|, vertical line, circle, rotated ellipse, polar rose `a·cos(kθ+φ)`, limaçon,
  spiral, truncated-Fourier closed curves) via linear least squares, algebraic conic
  fits, and Levenberg–Marquardt with smart initialization. An AIC-style score picks
  the winner; every candidate stays available under **Interpretations**.
- **Typed equations** — press **+** and type `y = 2sin(3x)+1`, `x² + y² = 9`,
  `r = 1 + cos(theta)`, or `a x^2 + b` (free constants become sliders). Implicit
  multiplication, Unicode `θ π ·`, typo suggestions.
- **Editing** — drag curves on canvas (exact parameter-space translation), parameter
  sliders, arrow-key nudge, duplicate, per-curve width/dash/opacity, undo/redo.
- **Rendering** — adaptive-sampling plotter with asymptote detection, marching-squares
  implicit curves, 1–2–5 infinite grid, crisp at any zoom, PNG export.

## Controls

| Action | Input |
|---|---|
| Draw → fit | drag in Draw mode (pen/touch/mouse) |
| Pan / zoom | Space+drag, right/middle drag, two-finger, wheel |
| Move a curve | Pan mode: drag the selected curve · arrows nudge 0.1 · ⇧arrows 1.0 |
| Undo / redo | ⌘Z / ⇧⌘Z (Ctrl on Windows) |
| Modes | D = draw, P = pan |
| Delete curve | Delete/Backspace |

## Architecture

```
src/core/types.ts      shared contracts (Viewport, ModelSpec, FittedCurve, …)
src/core/stroke.ts     ink preprocessing (resample, smooth, closed/multivalued detection)
src/core/fit/          model library · LM optimizer · conic fits · recognition + scoring
src/core/parse/        Pratt parser → compiled closures + KaTeX (typed expressions)
src/render/            grid + adaptive curve renderer + marching squares
src/ui/                React shell: canvas gestures, sidebar cards, history
```

Built with Vite + React + TypeScript (strict). Zero math/plotting dependencies — every
algorithm is implemented in-repo. KaTeX renders the equations.
