// ============================================================================
// tests/latexCompile.test.ts — every LaTeX export, COMPILED by pdflatex.
//
// The corpus (./latexCorpus.ts) is every feature family in every figure style,
// as TikZ and pgfplots, plus worksheets as student and key in both variants.
// Each export is compiled inside a minimal article using exactly the preamble
// its own header comment declares — the contract the teacher follows — with
// `pdflatex -interaction=nonstopmode -halt-on-error`.
//
// It fails on any TeX error ("! …"), any "Missing character" and any font
// substitution ("Font shape … not available" / "… undefined, using …").
// Overfull boxes and other warnings are reported, not failed.
//
// pdflatex is looked for at TinyTeX's default macOS location and on the PATH;
// on a machine without it (CI) the compile tests are SKIPPED, and only the
// corpus itself is checked (it builds, and every export declares a preamble).
// Set LATEX_OUT=<dir> to keep the files somewhere specific; LATEX_NOHALT=1
// and LATEX_CHUNK=1 (one figure per document) to see every error at once.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CorpusTex } from './latexCorpus'
import { STYLES, bankExports, bankPreamble, corpusDocs, declaredPreamble, figureExports, loadModels, sheetExports } from './latexCorpus'
import { docFigure, recordFigure } from '../src/ui/docScene'
import { keyLineTokens } from '../src/ui/renderBoard'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import type { TextItem } from '../src/render/vectorCtx'

function findPdflatex(): string | null {
  const candidates = [
    join(homedir(), 'Library/TinyTeX/bin/universal-darwin/pdflatex'),
    join(homedir(), '.TinyTeX/bin/x86_64-linux/pdflatex'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  try {
    const p = execFileSync('which', ['pdflatex'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return p !== '' && existsSync(p) ? p : null
  } catch {
    return null
  }
}

const PDFLATEX = findPdflatex()
// Each run gets its own folder unless LATEX_OUT names one: parallel runs
// (several agents, or vitest workers) must not wipe each other's files.
const OUT = process.env.LATEX_OUT ?? mkdtempSync(join(tmpdir(), 'grapher-latex-'))

/** One compiled document: its figures, in order, and what the log said about each. */
interface Finding {
  figure: string
  kind: 'error' | 'missing-char' | 'font' | 'overfull' | 'warning'
  text: string
}

const MARK = 'GRAPHER-FIGURE:'

/** Read a log: every finding, attributed to the figure being typeset when it happened. */
function readLog(log: string, doc: string): Finding[] {
  const out: Finding[] = []
  let figure = doc
  const lines = log.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const at = line.indexOf(MARK)
    if (at >= 0) {
      figure = line.slice(at + MARK.length).trim()
      continue
    }
    if (line.startsWith('!')) {
      // The error and the two lines of context TeX prints after it.
      out.push({ figure, kind: 'error', text: [line, ...lines.slice(i + 1, i + 4)].join(' ⏎ ').slice(0, 600) })
    } else if (/Missing character/.test(line)) {
      out.push({ figure, kind: 'missing-char', text: line.trim() })
    } else if (/Font shape .* (not available|undefined)/.test(line) || /Some font shapes were not available/.test(line)) {
      out.push({ figure, kind: 'font', text: [line, lines[i + 1] ?? ''].join(' ').replace(/\s+/g, ' ').trim() })
    } else if (/^(Overfull|Underfull) \\[hv]box/.test(line)) {
      out.push({ figure, kind: 'overfull', text: line.trim() })
    } else if (/Warning/.test(line)) {
      out.push({ figure, kind: 'warning', text: [line, lines[i + 1] ?? ''].join(' ').replace(/\s+/g, ' ').trim().slice(0, 300) })
    }
  }
  return out
}

function runPdflatex(dir: string, file: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    // LATEX_NOHALT=1 (debugging): carry on past an error, to see every one.
    const halt = process.env.LATEX_NOHALT ? [] : ['-halt-on-error']
    const child = spawn(PDFLATEX!, ['-interaction=nonstopmode', ...halt, file], {
      cwd: dir,
      // Long log lines unwrapped, so a finding is one line.
      env: { ...process.env, max_print_line: '100000', error_line: '254', half_error_line: '238' },
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const logPath = join(dir, file.replace(/\.tex$/, '.log'))
      resolve({ code, log: existsSync(logPath) ? readFileSync(logPath, 'latin1') : '' })
    })
  })
}

/** Run jobs with at most `n` at a time. */
async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  return out
}

interface Job {
  file: string
  figures: string[]
}

/**
 * Single figures that declare the same preamble share a document (one figure
 * per page, each announced in the log) — compiling each alone would use that
 * very preamble. Worksheets get a document each, on the page they were laid
 * out for.
 */
/**
 * Item-bank blocks are compiled the way they will be used: PASTED (not
 * \input) into a record's stem — or, for a key figure, its key — inside a
 * problem with choices, in a document that loads the bank's own package (a
 * stand-in, tests/fixtures/apitem.sty, on the packages the real one requires)
 * and the preamble the block's comment line names. \keybuild, so the key's
 * body is typeset too.
 */
function bankDocument(pre: readonly string[], part: readonly CorpusTex[]): string {
  const body: string[] = []
  for (const t of part) {
    body.push(`\\typeout{${MARK} ${t.name}}`, '\\begin{problem}', '\\begin{stem}', 'The figure is shown below.')
    if (t.format === 'bank-stem') body.push(t.tex.trimEnd(), 'On which interval is $f$ increasing?')
    body.push('\\end{stem}', '\\begin{choices}', '\\choice $(-1, 1)$', '\\choice $(1, \\infty)$', '\\end{choices}')
    body.push('\\begin{key}', 'Read it off the figure.')
    if (t.format === 'bank-key') body.push(t.tex.trimEnd())
    body.push('\\end{key}', '\\end{problem}', '\\clearpage')
  }
  return ['\\documentclass{article}', '\\usepackage{apitem}', ...pre, '\\pagestyle{empty}', '\\begin{document}', '\\keybuild', ...body, '\\end{document}', ''].join('\n')
}

function writeJobs(dir: string, texs: readonly CorpusTex[]): Job[] {
  const groups = new Map<string, CorpusTex[]>()
  const jobs: Job[] = []
  copyFileSync(new URL('./fixtures/apitem.sty', import.meta.url), join(dir, 'apitem.sty'))
  for (const t of texs) {
    if (t.format === 'bank-stem' || t.format === 'bank-key') {
      writeFileSync(join(dir, `${t.name}.tex`), t.tex)
      const key = `bank\n${bankPreamble(t.tex).join('\n')}`
      const g = groups.get(key) ?? []
      g.push(t)
      groups.set(key, g)
      continue
    }
    writeFileSync(join(dir, `${t.name}.tex`), t.tex)
    const pre = declaredPreamble(t.tex)
    if (t.format === 'sheet-tikz' || t.format === 'sheet-pgfplots') {
      const file = `doc-${t.name}.tex`
      writeFileSync(
        join(dir, file),
        [
          '\\documentclass{article}',
          ...pre,
          // The page it was laid out for, as its header says.
          /%\s+(\\usepackage\[[^\]]*\]\{geometry\})/.exec(t.tex)?.[1] ?? '\\usepackage[margin=0.75in]{geometry}',
          '\\begin{document}',
          `\\typeout{${MARK} ${t.name}}`,
          `\\input{${t.name}.tex}`,
          '\\end{document}',
          '',
        ].join('\n'),
      )
      jobs.push({ file, figures: [t.name] })
      continue
    }
    const key = `${t.format}\n${pre.join('\n')}`
    const g = groups.get(key) ?? []
    g.push(t)
    groups.set(key, g)
  }
  let n = 0
  const CHUNK = Number(process.env.LATEX_CHUNK) || 12
  for (const [key, g] of groups) {
    const pre = key.split('\n').slice(1).filter((l) => l !== '')
    for (let i = 0; i < g.length; i += CHUNK) {
      const part = g.slice(i, i + CHUNK)
      if (key.startsWith('bank\n')) {
        const file = `doc-bank-${++n}.tex`
        writeFileSync(join(dir, file), bankDocument(pre, part))
        jobs.push({ file, figures: part.map((t) => t.name) })
        continue
      }
      const file = `doc-${part[0].format}-${++n}.tex`
      const body: string[] = []
      for (const t of part) {
        body.push(`\\typeout{${MARK} ${t.name}}`, '\\noindent', `\\input{${t.name}.tex}`, '\\clearpage')
      }
      writeFileSync(
        join(dir, file),
        ['\\documentclass{article}', ...pre, '\\pagestyle{empty}', '\\begin{document}', ...body, '\\end{document}', ''].join('\n'),
      )
      jobs.push({ file, figures: part.map((t) => t.name) })
    }
  }
  return jobs
}

// ---------------------------------------------------------------------------

const docs = corpusDocs()
const models = loadModels(docs)
const figures = figureExports(models)
const sheets = sheetExports(models)
const banks = bankExports(models)
const all = [...figures, ...sheets, ...banks]

describe('the LaTeX corpus', () => {
  it('covers every feature family in every style, as TikZ and pgfplots, and worksheets', () => {
    expect(docs.length).toBeGreaterThanOrEqual(25)
    for (const s of STYLES) expect(figures.some((f) => f.name.includes(`-${s}-`))).toBe(true)
    expect(figures.filter((f) => f.format === 'pgfplots').length).toBeGreaterThan(50)
    expect(sheets.length).toBe(24)
  })

  it('compiles a key with its ANSWER KEY badge, worked answers, data tables and the continued answers', () => {
    const key = sheets.find((t) => t.name === 'ws5-key-tikz')!.tex
    const student = sheets.find((t) => t.name === 'ws5-student-tikz')!.tex
    expect(key).toContain('\\fbox{\\bfseries ANSWER KEY}')
    expect(student).not.toContain('ANSWER KEY}')
    // the tables print on both copies: tablecalc, tabletrap (on by hand) and
    // longtable (wrapped into groups); data's is switched off
    for (const tex of [key, student]) expect(tex.match(/\\begin\{tabular\}/g)?.length).toBeGreaterThanOrEqual(4)
    expect(key).toContain('\\hangindent')
    expect(student).not.toContain('\\hangindent')
    expect(sheets.find((t) => t.name === 'ws6-key-tikz')!.tex).toContain('Answers, continued')
  })

  it('every export declares its preamble in its header, and it starts with the package it draws with', () => {
    for (const t of [...figures, ...sheets]) {
      const pre = declaredPreamble(t.tex)
      expect(pre.length, t.name).toBeGreaterThan(0)
      expect(pre.some((l) => /\\usepackage\{(tikz|pgfplots)\}/.test(l)), t.name).toBe(true)
    }
  })
})

describe('the item-bank blocks', () => {
  it('cover every bank graph and every stem, student and key, and name their preamble', () => {
    expect(banks.length).toBeGreaterThanOrEqual(60)
    expect(banks.some((b) => b.format === 'bank-key')).toBe(true)
    for (const b of banks) {
      const lines = b.tex.split('\n')
      expect(lines[0], b.name).toBe('%%% figure=tikz')
      expect(lines[1], b.name).toMatch(/^%%% figuredesc="[^"\n]+"$/)
      const pre = bankPreamble(b.tex)
      expect(pre[0], b.name).toBe('\\usepackage{tikz}')
      if (b.name.includes('pgfplots')) expect(pre, b.name).toContain('\\usepackage{pgfplots}')
    }
  })
})

describe('the answer key line', () => {
  it('pgfplots states exactly the items, in the order, the figure’s own key line does', () => {
    let checked = 0
    for (const [id, m] of models) {
      if (m.kind !== 'cartesian') continue
      for (const style of STYLES) {
        const f = docFigure(m, { style, answers: true, widthCm: 8 })
        // The figure's own band: the text after the white band it adds.
        const list = recordFigure(f)
        // (It starts at the bottom of the recorded figure: plot plus margins.)
        const top = f.scene.vp.heightPx + 2 * f.margin
        const bandAt = list.items.findIndex(
          (it) => it.t === 'path' && it.fill?.r === 255 && it.segs[0]?.k === 'M' && it.segs[0].x === 0 && Math.abs(it.segs[0].y - top) < 0.5,
        )
        const appLine = (bandAt < 0 ? [] : list.items.slice(bandAt + 1))
          .filter((it): it is TextItem => it.t === 'text')
          .map((t) => t.text)
          .join(' ')
        const items = keyLineTokens(f.scene.answerKey!.asymptotes ?? [], f.scene.answerKey!.unlabelled)
        expect(items.join(' '), `${id} ${style}`).toBe(appLine)
        const tex = toPgfplots(f.scene, { widthCm: 8, sources: f.sources, extraMarkers: f.context })
        const said = /^% answer key line: (.*)$/m.exec(tex)?.[1]
        if (items.length === 0) {
          expect(said, `${id} ${style}`).toBeUndefined()
          continue
        }
        expect(said?.split(' | '), `${id} ${style}`).toEqual(items)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('the piecewise figure states its asymptotes first, in pgfplots as in the app', () => {
    const f = docFigure(models.get('piecewise')!, { style: 'sat', answers: true, widthCm: 8 })
    recordFigure(f)
    const tex = toPgfplots(f.scene, { widthCm: 8, sources: f.sources, extraMarkers: f.context })
    expect(/^% answer key line: (.*)$/m.exec(tex)?.[1]).toMatch(/^asymptotes: x = 2, \| y = 1 · \| /)
  })
})

describe.skipIf(!PDFLATEX)('pdflatex compiles every export', () => {
  it(
    'with no error, no missing character and no font substitution',
    async () => {
      rmSync(OUT, { recursive: true, force: true })
      mkdirSync(OUT, { recursive: true })
      const jobs = writeJobs(OUT, all)
      const results = await pool(jobs, Math.max(2, Math.min(4, Math.floor(cpus().length / 2))), async (j) => {
        const r = await runPdflatex(OUT, j.file)
        return { job: j, ...r, findings: readLog(r.log, j.file) }
      })
      const failing: string[] = []
      const report: string[] = []
      for (const r of results) {
        const bad = r.findings.filter((f) => f.kind === 'error' || f.kind === 'missing-char' || f.kind === 'font')
        if (r.code !== 0 && bad.length === 0) bad.push({ figure: r.job.file, kind: 'error', text: `pdflatex exited ${r.code}` })
        if (r.log === '') bad.push({ figure: r.job.file, kind: 'error', text: 'no log written' })
        for (const f of bad) failing.push(`${f.figure} [${f.kind}] ${f.text}`)
        for (const f of r.findings) if (f.kind === 'overfull' || f.kind === 'warning') report.push(`${f.figure} [${f.kind}] ${f.text}`)
      }
      writeFileSync(join(OUT, 'findings.txt'), [...failing.map((f) => `FAIL ${f}`), ...report.map((f) => `NOTE ${f}`)].join('\n') + '\n')
      if (report.length > 0) {
        console.log(`LaTeX: ${report.length} note(s) (overfull boxes / warnings), see ${join(OUT, 'findings.txt')}:\n  ${report.slice(0, 30).join('\n  ')}`)
      }
      console.log(`LaTeX: compiled ${all.length} exports (${docs.length} documents × ${STYLES.length} styles, ${sheets.length} worksheets, ${banks.length} item-bank blocks in apitem stems) in ${jobs.length} documents → ${OUT}`)
      expect(failing, failing.slice(0, 40).join('\n')).toEqual([])
    },
    600_000,
  )
})
