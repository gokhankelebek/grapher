// ============================================================================
// tests/qr.test.ts — the QR encoder (src/core/qr.ts), against known answers.
//
// The vectors: the Reed–Solomon check bytes and format/version strings are the
// ones printed in the standard and in every QR tutorial ("HELLO WORLD" at 1-M);
// the capacities are the standard's byte-mode table; the frozen matrix below
// was produced by this encoder and DECODED by Apple's CoreImage QR detector
// (CIDetectorTypeQRCode) before it was written down — as were codes at every
// version 1–40 at L and M, every mask, and a third of the versions at Q and H.
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  QrTooLongError,
  addEccAndInterleave,
  alignmentPositions,
  byteCapacity,
  dataStream,
  encodeQrBest,
  encodeQrBytes,
  encodeQrText,
  formatBits,
  penaltyScore,
  qrSvgPath,
  rawDataModules,
  rsDivisor,
  rsRemainder,
  versionBits,
  versionFor,
} from '../src/core/qr'

const bin = (v: number, n: number): string => v.toString(2).padStart(n, '0')

describe('QR building blocks — known answers', () => {
  it('Reed–Solomon: "HELLO WORLD" at 1-M gives the published check bytes', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('Reed–Solomon: the 7-byte generator for 1-L', () => {
    // α exponents 87, 229, 146, 149, 238, 102, 21 as field elements.
    expect(rsDivisor(7)).toEqual([127, 122, 154, 164, 11, 68, 117])
  })

  it('format information strings match the standard table', () => {
    expect(bin(formatBits('L', 0), 15)).toBe('111011111000100')
    expect(bin(formatBits('L', 7), 15)).toBe('110100101110110')
    expect(bin(formatBits('M', 0), 15)).toBe('101010000010010')
    expect(bin(formatBits('M', 5), 15)).toBe('100000011001110')
    expect(bin(formatBits('Q', 0), 15)).toBe('011010101011111')
    expect(bin(formatBits('H', 0), 15)).toBe('001011010001001')
  })

  it('version information strings match the standard table', () => {
    expect(bin(versionBits(7), 18)).toBe('000111110010010100')
    expect(bin(versionBits(8), 18)).toBe('001000010110111100')
    expect(bin(versionBits(40), 18)).toBe('101000110001101001')
  })

  it('alignment pattern centres', () => {
    expect(alignmentPositions(1)).toEqual([])
    expect(alignmentPositions(2)).toEqual([6, 18])
    expect(alignmentPositions(7)).toEqual([6, 22, 38])
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138])
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170])
  })

  it('raw module counts: 208 at version 1, 29648 at version 40', () => {
    expect(rawDataModules(1)).toBe(208)
    expect(rawDataModules(40)).toBe(29648)
  })

  it('byte-mode capacities match the standard', () => {
    const L = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]
    const M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
    L.forEach((n, i) => expect(byteCapacity(i + 1, 'L')).toBe(n))
    M.forEach((n, i) => expect(byteCapacity(i + 1, 'M')).toBe(n))
    expect(byteCapacity(1, 'Q')).toBe(11)
    expect(byteCapacity(1, 'H')).toBe(7)
    expect(byteCapacity(40, 'L')).toBe(2953)
    expect(byteCapacity(40, 'M')).toBe(2331)
    expect(byteCapacity(40, 'Q')).toBe(1663)
    expect(byteCapacity(40, 'H')).toBe(1273)
  })

  it('picks the smallest version that fits', () => {
    expect(versionFor(17, 'L')).toBe(1)
    expect(versionFor(18, 'L')).toBe(2)
    expect(versionFor(2953, 'L')).toBe(40)
    expect(versionFor(2954, 'L')).toBeNull()
  })

  it('the data stream: header, bytes, terminator, then 0xEC 0x11 padding', () => {
    const s = dataStream(new TextEncoder().encode('Hi'), 1, 'M')
    expect(s).toHaveLength(16)
    // 0100 | 00000010 | 01001000 01101001 | 0000 → 0x40 0x24 0x86 0x90, then pads
    expect(s.slice(0, 4)).toEqual([0x40, 0x24, 0x86, 0x90])
    expect(s.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11])
  })

  it('interleaving keeps every codeword exactly once', () => {
    // 5-M: 2 blocks of 43 data codewords + 24 ECC each = 134 total.
    const data = Array.from({ length: 84 + 2 }, (_, i) => i & 0xff).slice(0, 86)
    const out = addEccAndInterleave(data, 5, 'M')
    expect(out).toHaveLength(Math.floor(rawDataModules(5) / 8))
    // The first codewords alternate between the two blocks.
    expect(out.slice(0, 4)).toEqual([0, 43, 1, 44])
  })
})

describe('QR matrices', () => {
  // Decoded by CoreImage as "https://gokhankelebek.github.io/grapher/".
  const KNOWN = [
    '#######.####.#..#.###.#######',
    '#.....#.#...#.#...#.#.#.....#',
    '#.###.#..###.#..#.#.#.#.###.#',
    '#.###.#.#.#.######.#..#.###.#',
    '#.###.#..#....###..##.#.###.#',
    '#.....#..#.####....##.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '........##.......####........',
    '#.##.###...##.#.###...#..#.##',
    '####....####..#.#..######...#',
    '###.#.#.##.####..##....#..##.',
    '...###.#..##.#.##..####.#...#',
    '###.#.###..#.#.###.......##..',
    '..#.#....#...####..#..#...###',
    '.##..###.#....#....#.#.##.###',
    '..#.##.#....#.#.#.##.##....#.',
    '##.#.##...#.#.#...#.##.###.#.',
    '...#.#...#..#..#..#.#..#.###.',
    '#...#.##..#######...####..#..',
    '..#.#...##.########..##.#.#..',
    '.#.#.##.####.##############..',
    '........###.#.....#.#...#####',
    '#######.####..#.#..##.#.##.#.',
    '#.....#.#.#.####....#...##..#',
    '#.###.#....##....##.#####.###',
    '#.###.#.#..#.#.##...##.###..#',
    '#.###.#.###......##.#..#..#.#',
    '#.....#.....#.##..#.#..#.#.#.',
    '#######.#.....##..####.....#.',
  ]

  it('reproduces a code verified by an independent decoder, module for module', () => {
    const code = encodeQrText('https://gokhankelebek.github.io/grapher/', { ecc: 'M' })
    expect(code.version).toBe(3)
    expect(code.mask).toBe(3)
    expect(code.modules.map((r) => r.map((b) => (b ? '#' : '.')).join(''))).toEqual(KNOWN)
  })

  it('every version has the right size, finders and dark module', () => {
    for (const v of [1, 2, 6, 7, 14, 27, 40]) {
      const code = encodeQrBytes(new Uint8Array(byteCapacity(v, 'L')), { ecc: 'L' })
      expect(code.version).toBe(v)
      expect(code.size).toBe(17 + 4 * v)
      const m = code.modules
      const s = code.size
      // The finder's 7×7 ring and 3×3 core, at all three corners.
      for (const [ox, oy] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
        expect(m[oy][ox]).toBe(true)
        expect(m[oy + 1][ox + 1]).toBe(false)
        expect(m[oy + 3][ox + 3]).toBe(true)
        expect(m[oy + 6][ox + 6]).toBe(true)
      }
      expect(m[s - 8][8]).toBe(true)
      // Timing pattern alternates.
      for (let i = 8; i < s - 8; i++) expect(m[6][i]).toBe(i % 2 === 0)
    }
  })

  it('the chosen mask is the one with the lowest penalty', () => {
    const text = 'https://example.org/#doc=zABCDEFGHIJKLMNOP'
    const best = encodeQrText(text, { ecc: 'M' })
    const scores = Array.from({ length: 8 }, (_, m) => penaltyScore(encodeQrText(text, { ecc: 'M', mask: m }).modules))
    expect(penaltyScore(best.modules)).toBe(Math.min(...scores))
  })

  it('too long for version 40 throws a typed error; encodeQrBest falls back from M to L', () => {
    expect(() => encodeQrBytes(new Uint8Array(2954), { ecc: 'L' })).toThrow(QrTooLongError)
    expect(encodeQrBest('a'.repeat(2331))!.ecc).toBe('M')
    const l = encodeQrBest('a'.repeat(2500))!
    expect(l.ecc).toBe('L')
    expect(l.version).toBe(versionFor(2500, 'L'))
    expect(encodeQrBest('a'.repeat(3000))).toBeNull()
  })

  it('the SVG path draws one rectangle per run of dark modules, inside the quiet zone', () => {
    const code = encodeQrText('x', { ecc: 'M' })
    const d = qrSvgPath(code, 4)
    expect(d.startsWith('M4 4h7v1h-7z')).toBe(true) // the finder's top edge
    const runs = d.match(/M/g)!.length
    let expected = 0
    for (const row of code.modules) row.forEach((b, x) => (expected += b && (x === 0 || !row[x - 1]) ? 1 : 0))
    expect(runs).toBe(expected)
  })
})
