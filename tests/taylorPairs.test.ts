// A Taylor polynomial holds no letter and is never solved against its parent.
import { describe, it, expect } from 'vitest'
import type { CalcLink } from '../src/core/persist'
import type { FittedCurve } from '../src/core/types'
import { intersectionPairs, pairKey, taylorApart } from '../src/ui/intersections'
import { derivedIds } from '../src/ui/nameLinks'
import { curveNames } from '../src/render/curveNames'

const curve = (id: string): FittedCurve => ({
  id, modelId: `m_${id}`, params: [], kind: 'explicit', domain: null,
  color: '#fff', strokeWidth: 2, visible: true, error: 0,
})

const TAY: CalcLink = { kind: 'taylor', id: 'L1', parentId: 'f1', curveId: 'p1', a: 0, n: 3 }

describe('Taylor curves on a board with other curves', () => {
  it('the parent–Taylor pair is not solved; every other pair is', () => {
    const cs = [curve('f1'), curve('p1'), curve('g1')]
    const apart = taylorApart([TAY])
    expect(apart.has(pairKey('p1', 'f1'))).toBe(true)
    const pairs = intersectionPairs(cs, apart).map(([a, b]) => `${a.id}-${b.id}`)
    expect(pairs).toEqual(['f1-g1', 'p1-g1'])
    expect(intersectionPairs(cs).length).toBe(3)
  })

  it('a Taylor polynomial holds no letter: the next curve still gets g', () => {
    expect(derivedIds([TAY]).has('p1')).toBe(true)
    const names = curveNames([curve('f1'), curve('p1'), curve('g1')], {}, [TAY])
    expect(names.f1).toBe('f')
    expect(names.p1).toBeUndefined()
    expect(names.g1).toBe('g')
  })
})
