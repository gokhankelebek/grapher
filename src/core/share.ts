// ============================================================================
// GRAPHER — share links: a whole document in the URL fragment.
//
// A teacher wants a student to open EXACTLY this graph from a link, with no
// account and no server. So the document travels inside the link itself:
//
//   https://…/grapher/#view=1&reveal=1&doc=z<base64url(deflate-raw(json))>
//
// It lives in the FRAGMENT (after '#') because a fragment is never sent to a
// server: it cannot reach a web host's access log, a proxy, or an analytics
// pipeline. The page reads it, opens the document, and wipes it from the
// address bar.
//
// The JSON is exactly what serializeDoc writes — the same bytes a saved
// document has — and the receiving side reads it back through deserializeDoc,
// so a damaged link is reported the way a damaged document is. Nothing here
// knows the document's shape; it only moves bytes.
//
// PAYLOAD FORMAT: one codec character, then base64url (no padding).
//   'z'  deflate-raw (CompressionStream), then base64url — the normal case
//   'p'  the UTF-8 bytes uncompressed — a browser without CompressionStream,
//        or a document so small that deflate would make it longer
// The flags come BEFORE `doc` so that a link truncated by an email client
// loses the end of the document (and is reported as damaged) rather than
// silently dropping "view only". The full set, each optional:
//
//   view=1     read-only            reveal=1   answers hidden behind "?"
//   note=1     show the teacher note in a view-only link (never with reveal)
//   q=<text>   "Question for students", one line, percent-encoded
//
// A view-only link that does not show the note does not CARRY it either
// (shareDocJson). Links made before note / q existed open exactly as before.
//
// Pure apart from the optional Compression/DecompressionStream, which are
// passed in (or picked up from globalThis) so node tests can run both paths.
// ============================================================================

/** The fragment key the document rides under. */
export const SHARE_KEY = 'doc'

/**
 * Past this many characters some learning-management systems, email clients
 * and URL shorteners truncate a link. Above it the dialog warns and suggests
 * exporting a file instead.
 */
export const SHARE_WARN_LENGTH = 8000

/**
 * The most a link may expand to. A real document is well under 200KB (see
 * src/ui/storage.ts); this only stops a hostile link from inflating a
 * "deflate bomb" into gigabytes in a student's tab.
 */
export const MAX_SHARED_BYTES = 4 * 1024 * 1024

/** What the person opening the link gets. */
export interface ShareFlags {
  /** A read-only student view: no editing, sidebar closed, "Make a copy". */
  view: boolean
  /** Open in reveal mode: the answers hidden behind "?" marks. */
  reveal: boolean
  /**
   * A view-only link shows the teacher note only when the teacher asked for
   * it ("Include teacher note"). Absent: not asked. Never shown to a student
   * in reveal mode (studentView), whatever this says — a note holds answers.
   */
  note?: boolean
  /**
   * "Question for students": one line the student view shows as a banner.
   * It lives in the link only — never in the document. Absent: none.
   */
  question?: string
}

export const NO_FLAGS: Readonly<ShareFlags> = { view: false, reveal: false }

/** The longest question a link carries; the dialog's field stops there too. */
export const QUESTION_MAX = 200

/**
 * A question as a link carries it: one line, no control characters, runs of
 * white space as one space, at most QUESTION_MAX characters. '' for nothing.
 */
export function cleanQuestion(text: unknown): string {
  if (typeof text !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const one = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(one).slice(0, QUESTION_MAX).join('').trim()
}

/**
 * The person opening a view-only link in reveal mode is a STUDENT: the
 * teacher note, the teacher's tools and the reveal-everything buttons are
 * not theirs. Old links (view=1&reveal=1) open this way too.
 */
export function isStudentView(flags: Pick<ShareFlags, 'view' | 'reveal'>): boolean {
  return flags.view && flags.reveal
}

/**
 * Whether a link's teacher note is shown. An editable link is a teacher
 * handing a board to a teacher: the note travels. A view-only link is for
 * students: the note is hidden unless the teacher ticked "Include teacher
 * note" — and never in reveal mode.
 */
export function shareShowsNote(flags: ShareFlags): boolean {
  if (!flags.view) return true
  return flags.note === true && !flags.reveal
}

/** How the opened link presents itself: what the App's shared state records. */
export interface ShareView {
  viewOnly: boolean
  /** A student (isStudentView): no teacher tools, no reveal-everything buttons. */
  student?: true
  /** The teacher note stays off the sidebar (shareShowsNote is false). */
  noteHidden?: true
  /** The banner's question. */
  question?: string
}

/** What a link's flags mean for the person who opens it. */
export function shareViewOf(flags: ShareFlags): ShareView {
  const q = cleanQuestion(flags.question)
  return {
    viewOnly: flags.view,
    ...(isStudentView(flags) ? { student: true as const } : {}),
    ...(shareShowsNote(flags) ? {} : { noteHidden: true as const }),
    ...(q ? { question: q } : {}),
  }
}

/**
 * The document as a link carries it: without its teacher note when the link
 * would not show it, so the note is not in the link at all (a student who
 * decodes the fragment finds no answers in it). Anything that is not a
 * document's JSON is passed through untouched — the link reports it as it
 * always did.
 */
export function shareDocJson(json: string, flags: ShareFlags): string {
  if (shareShowsNote(flags)) return json
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return json
  }
  const board = (doc as { board?: unknown } | null)?.board
  if (!board || typeof board !== 'object' || !('note' in board)) return json
  const { note: _gone, ...rest } = board as Record<string, unknown>
  return JSON.stringify({ ...(doc as Record<string, unknown>), board: rest })
}

export type ShareCodec = 'z' | 'p'

// ------------------------------------------------------------------ base64url

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i
  return t
})()

/** RFC 4648 §5 base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63]
  }
  return out
}

/**
 * Decode base64url. Tolerates standard base64 ('+', '/', '=' padding) because
 * a link that went through a careless tool may come back that way. Null on
 * anything else — never throws.
 */
export function fromBase64Url(text: string): Uint8Array | null {
  const s = text.replace(/=+$/, '')
  if (s.length % 4 === 1) return null
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let o = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c === 43) c = 45 // '+' -> '-'
    else if (c === 47) c = 95 // '/' -> '_'
    const v = c < 128 ? LOOKUP[c] : -1
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

// ---------------------------------------------------------------- streams

/** The two stream constructors this file may use; absent = unsupported. */
export interface StreamCodecs {
  Compression?: typeof CompressionStream
  Decompression?: typeof DecompressionStream
}

function defaultCodecs(): StreamCodecs {
  const g = globalThis as {
    CompressionStream?: typeof CompressionStream
    DecompressionStream?: typeof DecompressionStream
  }
  return { Compression: g.CompressionStream, Decompression: g.DecompressionStream }
}

/** Read a byte stream to the end, refusing to hold more than `limit` bytes. */
async function drain(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | 'too-big'> {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      try {
        await reader.cancel()
      } catch {
        /* already errored — nothing to cancel */
      }
      return 'too-big'
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Typed as BufferSource so it pipes into a (De)CompressionStream's writable side. */
function streamOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>)
      controller.close()
    },
  })
}

/** deflate-raw, or null when this browser cannot (no stream, or no 'deflate-raw'). */
export async function deflateRaw(bytes: Uint8Array, codecs: StreamCodecs = defaultCodecs()): Promise<Uint8Array | null> {
  const C = codecs.Compression
  if (!C) return null
  try {
    const out = await drain(streamOf(bytes).pipeThrough(new C('deflate-raw' as CompressionFormat)), Infinity)
    return out === 'too-big' ? null : out
  } catch {
    return null
  }
}

export type InflateResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'unsupported' | 'corrupt' | 'too-big' }

export async function inflateRaw(
  bytes: Uint8Array,
  codecs: StreamCodecs = defaultCodecs(),
  limit = MAX_SHARED_BYTES,
): Promise<InflateResult> {
  const D = codecs.Decompression
  if (!D) return { ok: false, reason: 'unsupported' }
  let ds: DecompressionStream
  try {
    ds = new D('deflate-raw' as CompressionFormat)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  try {
    const out = await drain(streamOf(bytes).pipeThrough(ds), limit)
    return out === 'too-big' ? { ok: false, reason: 'too-big' } : { ok: true, bytes: out }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

// ---------------------------------------------------------------- encode

/** A document's JSON as a payload: the shorter of compressed and plain. */
export async function encodeSharePayload(
  json: string,
  codecs: StreamCodecs = defaultCodecs(),
): Promise<{ payload: string; codec: ShareCodec }> {
  const bytes = new TextEncoder().encode(json)
  const plain = 'p' + toBase64Url(bytes)
  const packed = await deflateRaw(bytes, codecs)
  if (packed) {
    const z = 'z' + toBase64Url(packed)
    if (z.length < plain.length) return { payload: z, codec: 'z' }
  }
  return { payload: plain, codec: 'p' }
}

/** The fragment, '#' included. Flags first, `doc` last (see the header). */
export function shareFragment(payload: string, flags: ShareFlags = NO_FLAGS): string {
  const parts: string[] = []
  if (flags.view) parts.push('view=1')
  if (flags.reveal) parts.push('reveal=1')
  if (flags.note) parts.push('note=1')
  const q = cleanQuestion(flags.question)
  if (q) parts.push(`q=${encodeURIComponent(q)}`)
  parts.push(`${SHARE_KEY}=${payload}`)
  return '#' + parts.join('&')
}

/** `base` with any fragment it had replaced by this one. */
export function shareUrl(base: string, fragment: string): string {
  const i = base.indexOf('#')
  return (i >= 0 ? base.slice(0, i) : base) + fragment
}

/** Encode a document and build its link in one step. */
export async function buildShareLink(
  base: string,
  json: string,
  flags: ShareFlags,
  codecs: StreamCodecs = defaultCodecs(),
): Promise<{ url: string; codec: ShareCodec; length: number }> {
  const { payload, codec } = await encodeSharePayload(shareDocJson(json, flags), codecs)
  const url = shareUrl(base, shareFragment(payload, flags))
  return { url, codec, length: url.length }
}

export interface LengthVerdict {
  length: number
  /** True when the link may be cut short by an LMS or an email client. */
  long: boolean
  /** What the dialog says about the length; null when there is nothing to say. */
  warning: string | null
}

export function shareLengthVerdict(length: number): LengthVerdict {
  const long = length > SHARE_WARN_LENGTH
  return {
    length,
    long,
    warning: long
      ? `This link is ${length.toLocaleString('en-US')} characters. Some learning-management systems and email clients cut links longer than about ${SHARE_WARN_LENGTH.toLocaleString('en-US')}, which would break it. For a big document, use Save a backup… and share the file instead.`
      : null,
  }
}

// ---------------------------------------------------------------- decode

export type ParsedShare =
  /** No share in this fragment: start normally. */
  | { kind: 'none' }
  | { kind: 'share'; payload: string; flags: ShareFlags }

const truthy = (v: string | null): boolean => v !== null && v !== '0' && v.toLowerCase() !== 'false'

/**
 * Read a location.hash. Only a fragment that carries `doc=` is a share; any
 * other fragment (none, or one some other tool put there) is left alone.
 */
export function parseShareHash(hash: string): ParsedShare {
  if (typeof hash !== 'string') return { kind: 'none' }
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  if (!body) return { kind: 'none' }
  let params: URLSearchParams
  try {
    params = new URLSearchParams(body)
  } catch {
    return { kind: 'none' }
  }
  if (!params.has(SHARE_KEY)) return { kind: 'none' }
  // URLSearchParams turns '+' into ' '; base64url never has either, but a
  // standard-base64 link would. Put them back before decoding.
  const payload = (params.get(SHARE_KEY) ?? '').replace(/ /g, '+').trim()
  // An old link has neither `note` nor `q`: its flags are exactly the two it
  // always had.
  const question = cleanQuestion(params.get('q'))
  const flags: ShareFlags = { view: truthy(params.get('view')), reveal: truthy(params.get('reveal')) }
  if (truthy(params.get('note'))) flags.note = true
  if (question) flags.question = question
  return { kind: 'share', payload, flags }
}

export type DecodedShare = { ok: true; json: string } | { ok: false; error: string }

const DAMAGED = 'This share link is damaged or incomplete — it may have been cut short when it was copied.'

/** Payload -> the document's JSON. Never throws; every failure says why. */
export async function decodeSharePayload(
  payload: string,
  codecs: StreamCodecs = defaultCodecs(),
): Promise<DecodedShare> {
  if (typeof payload !== 'string' || payload.length < 2) {
    return { ok: false, error: 'This share link has no document in it.' }
  }
  const codec = payload[0]
  if (codec !== 'z' && codec !== 'p') {
    return { ok: false, error: 'This share link was not made by Grapher, or by a newer version of it.' }
  }
  const raw = fromBase64Url(payload.slice(1))
  if (!raw) return { ok: false, error: DAMAGED }
  let bytes: Uint8Array
  if (codec === 'z') {
    const inflated = await inflateRaw(raw, codecs)
    if (!inflated.ok) {
      return {
        ok: false,
        error:
          inflated.reason === 'unsupported'
            ? 'This browser cannot open compressed share links. Try a current Chrome, Edge, Firefox or Safari.'
            : inflated.reason === 'too-big'
              ? 'This share link is far larger than any Grapher document, so it was not opened.'
              : DAMAGED,
      }
    }
    bytes = inflated.bytes
  } else {
    if (raw.length > MAX_SHARED_BYTES) {
      return { ok: false, error: 'This share link is far larger than any Grapher document, so it was not opened.' }
    }
    bytes = raw
  }
  try {
    return { ok: true, json: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, error: DAMAGED }
  }
}

/** The fragment with the share removed, for history.replaceState. */
export function urlWithoutShare(href: string): string {
  const i = href.indexOf('#')
  return i >= 0 ? href.slice(0, i) : href
}
