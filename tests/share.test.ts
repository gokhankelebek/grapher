// ============================================================================
// tests/share.test.ts — share links (src/core/share.ts) and the open path
// (src/ui/shareOpen.ts).
//
// The promise of a share link is "the student sees EXACTLY the teacher's
// graph", so the central assertion is byte-identity: a document with every
// kind of object on it goes into a link and comes back out as the very same
// serializeDoc bytes, through the same deserializeDoc a saved document takes.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { UC_SHOW_DEFAULT, deserializeDoc, docFromBoard, serializeDoc } from '../src/core/persist'
import type { BoardInput, DocMeta, HydratedBoard } from '../src/core/persist'
import {
  MAX_SHARED_BYTES,
  SHARE_WARN_LENGTH,
  buildShareLink,
  decodeSharePayload,
  encodeSharePayload,
  fromBase64Url,
  parseShareHash,
  shareFragment,
  shareLengthVerdict,
  shareUrl,
  toBase64Url,
  urlWithoutShare,
} from '../src/core/share'
import type { StreamCodecs } from '../src/core/share'
import { openShare, sharedDocName } from '../src/ui/shareOpen'

// ---------------------------------------------------------------------------
// fixtures: one document per object kind, and one with everything at once
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'teacher-doc-1', name: 'Unit 3 · Day 2', createdAt: 1000, modifiedAt: 2000 }

function curve(over: Partial<FittedCurve> & Pick<FittedCurve, 'id' | 'modelId'>): FittedCurve {
  return {
    params: [1, 2],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  } as FittedCurve
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0.5, y: -1.25 }, pxPerUnit: 48 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

function typed(id: string, src: string, n: number): { c: FittedCurve; src: Record<string, string> } {
  const o = parseExpression(src)
  if (!o.ok) throw new Error(`fixture failed to parse: ${src}`)
  const c = curve({
    id,
    modelId: `expr_${n}`,
    params: o.plot.defaultParams.slice(),
    kind: o.plot.kind,
    domain: o.plot.domain,
  })
  return { c, src: { [id]: src } }
}

const f = typed('f', 'y = x^3 - 3x', 1)
const g = typed('g', 'y = sin(x)', 2)
const polar = typed('r', 'r = 1 + cos(theta)', 3)
const sketched = curve({
  id: 's',
  modelId: 'poly2',
  params: [0.5, -1, 2],
  domain: [-2, 3],
  stroke: [
    { x: -2, y: 6 },
    { x: 0, y: 2 },
    { x: 3, y: 3.5 },
  ],
} as Partial<FittedCurve> & Pick<FittedCurve, 'id' | 'modelId'>)

const KINDS: Record<string, BoardInput> = {
  'sketched curve': board({ curves: [sketched] }),
  'typed curves (explicit + polar)': board({
    curves: [f.c, polar.c],
    exprSources: { ...f.src, ...polar.src },
    names: { f: 'f', r: 'r' },
  }),
  'calculus links': board({
    curves: [f.c, g.c],
    exprSources: { ...f.src, ...g.src },
    names: { f: 'f', g: 'g' },
    calc: [
      { kind: 'area', id: 'A1', parentId: 'f', from: 0, to: 1.5, abs: false },
      { kind: 'riemann', id: 'R1', parentId: 'g', from: 0, to: 3, n: 6, method: 'mid' },
    ],
  }),
  'slope field': board({
    fields: [
      {
        id: 'F1',
        src: 'dy/dx = x - y',
        params: [],
        color: '#22c55e',
        spacingPx: 28,
        visible: true,
        solutions: [{ id: 'S1', x: 0, y: 1 }],
      },
    ],
  }),
  shapes: board({
    shapes: [{ id: 'P1', src: 'polygon (0,0) (3,0) (0,4)', params: [], color: '#f59e0b', fill: true, visible: true }],
  }),
  'data table': board({
    data: [
      {
        id: 'T1',
        name: 'Table 1',
        xLabel: 'x',
        yLabel: 'y',
        rows: [
          { x: '1', y: '2' },
          { x: '2', y: '4.1' },
          { x: '3', y: '5.9' },
        ],
        color: '#a855f7',
        visible: true,
        regressions: [],
      },
    ],
  }),
  sequence: board({
    sequences: [
      {
        id: 'Q1',
        src: 'a_n = 2n + 1',
        color: '#ef4444',
        visible: true,
        n0: 1,
        count: 10,
        showPartner: false,
        showSums: false,
        params: [],
      },
    ],
  }),
  'unit circle': board({
    unitCircles: [{ id: 'U1', cx: 0, cy: 0, theta: Math.PI / 3, show: { ...UC_SHOW_DEFAULT }, color: '#2dd4bf' }],
  }),
  'related rates': board({
    relatedRates: [{ id: 'RR1', scenario: 'ladder', params: {}, t: 1, color: '#38bdf8' }],
  }),
  'number line': board({
    kind: 'number-line',
    items: [
      { kind: 'point', id: 'p1', x: 2, closed: true, color: '#4f9cf9' },
      { kind: 'solve', id: 'q1', src: 'x^2 - 4 > 0', color: '#f95f62', show: { signs: true } },
    ],
  }),
  'figure style, caption, axes and polar grid': board({
    curves: [polar.c],
    exprSources: polar.src,
    grid: 'polar',
    figure: 'ap',
    caption: 'Figure 1',
    captionAuto: false,
  }),
}

/** A document as the app would write it after loading it once: the canonical bytes. */
function canonical(input: BoardInput): string {
  const first = serializeDoc(docFromBoard(META, input, META.modifiedAt))
  const res = deserializeDoc(first)
  if (!res.board || !res.meta || res.problems.length > 0) {
    throw new Error(`fixture did not load cleanly: ${res.problems.join('; ')}`)
  }
  return reserialize(res.meta, res.board)
}

function reserialize(meta: DocMeta, b: HydratedBoard): string {
  return serializeDoc(docFromBoard(meta, b as unknown as BoardInput, meta.modifiedAt))
}

const NO_STREAMS: StreamCodecs = {}

// ---------------------------------------------------------------------------

describe('base64url', () => {
  it('round-trips every byte value and every tail length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff)
      const s = toBase64Url(bytes)
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(Array.from(fromBase64Url(s)!)).toEqual(Array.from(bytes))
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(Array.from(fromBase64Url(toBase64Url(all))!)).toEqual(Array.from(all))
  })

  it('matches the RFC 4648 vectors (without padding)', () => {
    const enc = (s: string) => toBase64Url(new TextEncoder().encode(s))
    expect(enc('')).toBe('')
    expect(enc('f')).toBe('Zg')
    expect(enc('fo')).toBe('Zm8')
    expect(enc('foo')).toBe('Zm9v')
    expect(enc('foobar')).toBe('Zm9vYmFy')
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8')
  })

  it('accepts standard base64 a careless tool may have produced, and rejects junk', () => {
    expect(Array.from(fromBase64Url('+/8=')!)).toEqual([0xfb, 0xff])
    expect(fromBase64Url('abc!')).toBeNull()
    expect(fromBase64Url('a')).toBeNull()
    expect(fromBase64Url('é')).toBeNull()
  })
})

describe('share links — byte-identical round trip for every object kind', () => {
  for (const [name, input] of Object.entries(KINDS)) {
    it(name, async () => {
      const json = canonical(input)
      const link = await buildShareLink('https://example.org/grapher/', json, { view: false, reveal: false })
      const parsed = parseShareHash(new URL(link.url).hash)
      expect(parsed.kind).toBe('share')
      if (parsed.kind !== 'share') return
      const decoded = await decodeSharePayload(parsed.payload)
      expect(decoded).toEqual({ ok: true, json })
      // …and through the normal load path, back to the same bytes.
      const res = deserializeDoc(decoded.ok ? decoded.json : '')
      expect(res.problems).toEqual([])
      expect(reserialize(res.meta!, res.board!)).toBe(json)
    })
  }

  it('everything on one board at once', async () => {
    const all = board({
      curves: [sketched, f.c, g.c, polar.c],
      exprSources: { ...f.src, ...g.src, ...polar.src },
      names: { f: 'f', g: 'g', r: 'r' },
      calc: KINDS['calculus links'].calc,
      fields: KINDS['slope field'].fields,
      shapes: KINDS.shapes.shapes,
      data: KINDS['data table'].data,
      sequences: KINDS.sequence.sequences,
      unitCircles: KINDS['unit circle'].unitCircles,
      relatedRates: KINDS['related rates'].relatedRates,
      items: KINDS['number line'].items,
    })
    const json = canonical(all)
    const res0 = deserializeDoc(json)
    const b = res0.board!
    for (const k of ['curves', 'calc', 'fields', 'shapes', 'data', 'sequences', 'unitCircles', 'relatedRates', 'items'] as const) {
      expect((b[k] as unknown[]).length, k).toBeGreaterThan(0)
    }
    for (const streams of [undefined, NO_STREAMS]) {
      const { payload } = await encodeSharePayload(json, streams)
      const decoded = await decodeSharePayload(payload, streams)
      expect(decoded).toEqual({ ok: true, json })
    }
  })

  it('compresses with deflate-raw when the browser can, and the result is shorter', async () => {
    const json = canonical(KINDS['calculus links'])
    const z = await encodeSharePayload(json)
    const p = await encodeSharePayload(json, NO_STREAMS)
    expect(z.codec).toBe('z')
    expect(p.codec).toBe('p')
    expect(z.payload.length).toBeLessThan(p.payload.length)
  })

  it('a browser without CompressionStream still makes (and reads) a plain link', async () => {
    const json = canonical(KINDS.sequence)
    const { payload, codec } = await encodeSharePayload(json, NO_STREAMS)
    expect(codec).toBe('p')
    expect(payload[0]).toBe('p')
    expect(await decodeSharePayload(payload, NO_STREAMS)).toEqual({ ok: true, json })
  })

  it('a compressed link opened where DecompressionStream is missing says so', async () => {
    const { payload } = await encodeSharePayload(canonical(KINDS.shapes))
    const res = await decodeSharePayload(payload, NO_STREAMS)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cannot open compressed/)
  })
})

describe('fragment parsing and garbage', () => {
  it('builds #view=1&reveal=1&doc=… with the flags before the document', () => {
    expect(shareFragment('zAAA', { view: true, reveal: true })).toBe('#view=1&reveal=1&doc=zAAA')
    expect(shareFragment('zAAA', { view: false, reveal: true })).toBe('#reveal=1&doc=zAAA')
    expect(shareFragment('zAAA', { view: false, reveal: false })).toBe('#doc=zAAA')
  })

  it('replaces any fragment the page already had, and keeps the path and query', () => {
    expect(shareUrl('https://a.b/grapher/?x=1#old', '#doc=p')).toBe('https://a.b/grapher/?x=1#doc=p')
    expect(urlWithoutShare('https://a.b/grapher/?x=1#doc=pAAA')).toBe('https://a.b/grapher/?x=1')
  })

  it('reads the flags', () => {
    expect(parseShareHash('#doc=zAA')).toEqual({ kind: 'share', payload: 'zAA', flags: { view: false, reveal: false } })
    expect(parseShareHash('#view=1&doc=zAA')).toMatchObject({ flags: { view: true, reveal: false } })
    expect(parseShareHash('#reveal=1&doc=zAA')).toMatchObject({ flags: { view: false, reveal: true } })
    expect(parseShareHash('#view=0&reveal=false&doc=zAA')).toMatchObject({ flags: { view: false, reveal: false } })
    expect(parseShareHash('doc=zAA&view')).toMatchObject({ kind: 'share', flags: { view: true } })
  })

  it('a fragment without doc= is not a share', () => {
    for (const h of ['', '#', '#section-2', '#view=1', '#docs=zAA', '#%E0%A4%A']) {
      expect(parseShareHash(h)).toEqual({ kind: 'none' })
    }
  })

  it('every kind of garbage payload is refused with a reason, never a throw', async () => {
    const garbage = [
      '',
      'z',
      'q' + 'A'.repeat(20), // unknown codec
      'z!!!!', // not base64
      'zAAAA', // base64, but not deflate data
      'z' + toBase64Url(new TextEncoder().encode('hello world')), // not deflate either
      'p' + toBase64Url(Uint8Array.from([0xff, 0xfe, 0xfd])), // not UTF-8
    ]
    for (const p of garbage) {
      const res = await decodeSharePayload(p)
      expect(res.ok, p).toBe(false)
      if (!res.ok) expect(res.error.length).toBeGreaterThan(10)
    }
  })

  it('a truncated link is reported as damaged', async () => {
    const json = canonical(KINDS['calculus links'])
    const { payload } = await encodeSharePayload(json)
    const cut = await decodeSharePayload(payload.slice(0, Math.floor(payload.length * 0.6)))
    if (cut.ok) {
      // deflate may emit a prefix that inflates; the JSON is then cut short.
      expect(deserializeDoc(cut.json).board).toBeNull()
    } else {
      expect(cut.error).toMatch(/damaged|incomplete/)
    }
  })

  it('valid base64 of something that is not a document reads as a damaged document', async () => {
    const res = await decodeSharePayload('p' + toBase64Url(new TextEncoder().encode('{"hello":1}')))
    expect(res.ok).toBe(true)
    // The same verdict a damaged saved document gets: an empty board, reported.
    const load = deserializeDoc(res.ok ? res.json : '')
    expect(load.degraded).toBe(true)
    expect(load.problems.length).toBeGreaterThan(0)
    const notJson = await decodeSharePayload('p' + toBase64Url(new TextEncoder().encode('[1,2')))
    expect(deserializeDoc(notJson.ok ? notJson.json : '').board).toBeNull()
  })

  it('refuses a deflate bomb', async () => {
    const huge = 'x'.repeat(MAX_SHARED_BYTES + 1024)
    const { payload, codec } = await encodeSharePayload(huge)
    expect(codec).toBe('z')
    expect(payload.length).toBeLessThan(20_000)
    const res = await decodeSharePayload(payload)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/far larger/)
  })
})

describe('the length warning', () => {
  it('is silent at and under the limit, and warns over it', () => {
    expect(shareLengthVerdict(1200)).toEqual({ length: 1200, long: false, warning: null })
    expect(shareLengthVerdict(SHARE_WARN_LENGTH).long).toBe(false)
    const v = shareLengthVerdict(SHARE_WARN_LENGTH + 1)
    expect(v.long).toBe(true)
    expect(v.warning).toMatch(/8,001 characters/)
    expect(v.warning).toMatch(/Save a backup/)
  })

  it('the link builder reports the length of the whole URL', async () => {
    const link = await buildShareLink('https://example.org/grapher/', canonical(KINDS.shapes), { view: true, reveal: false })
    expect(link.length).toBe(link.url.length)
    expect(link.url.startsWith('https://example.org/grapher/#view=1&doc=')).toBe(true)
  })
})

describe('opening a share (src/ui/shareOpen.ts)', () => {
  it('a good link opens as a NEW document with a fresh id, flags carried', async () => {
    const json = canonical(KINDS['calculus links'])
    const link = await buildShareLink('https://x/', json, { view: true, reveal: true })
    let n = 0
    const out = await openShare(new URL(link.url).hash, { load: deserializeDoc, newId: () => `fresh-${++n}`, now: () => 5000 })
    expect(out.kind).toBe('open')
    if (out.kind !== 'open') return
    expect(out.meta.id).toBe('fresh-1')
    expect(out.meta.id).not.toBe(META.id)
    expect(out.meta.name).toBe('Unit 3 · Day 2')
    expect(out.flags).toEqual({ view: true, reveal: true })
    expect(out.problems).toEqual([])
    // The board is the teacher's, untouched.
    expect(reserialize({ ...META }, out.board)).toBe(json)
  })

  it('no share in the fragment: nothing to do', async () => {
    const out = await openShare('#something', { load: deserializeDoc, newId: () => 'x', now: () => 0 })
    expect(out).toEqual({ kind: 'none' })
  })

  it('a garbage link fails with a message, never a throw', async () => {
    for (const h of ['#doc=', '#doc=zzzz', '#view=1&doc=p' + toBase64Url(new TextEncoder().encode('not json'))]) {
      const out = await openShare(h, { load: deserializeDoc, newId: () => 'x', now: () => 0 })
      expect(out.kind, h).toBe('error')
      if (out.kind === 'error') expect(out.message.length).toBeGreaterThan(10)
    }
  })

  it('a link whose document is partly damaged still opens, and says what was repaired', async () => {
    const doc = JSON.parse(canonical(KINDS['calculus links']))
    doc.board.calc.push({ kind: 'tangent', id: 'T9', parentId: 'nobody', curveId: 'nothing', x: 1 })
    const link = await buildShareLink('https://x/', JSON.stringify(doc), { view: false, reveal: false })
    const out = await openShare(new URL(link.url).hash, { load: deserializeDoc, newId: () => 'n', now: () => 0 })
    expect(out.kind).toBe('open')
    if (out.kind === 'open') expect(out.problems.length).toBeGreaterThan(0)
  })

  it('names a nameless shared document', () => {
    expect(sharedDocName('  ')).toBe('Shared graph')
    expect(sharedDocName('Quiz review')).toBe('Quiz review')
  })
})
