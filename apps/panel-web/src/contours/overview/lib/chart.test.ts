import { describe, expect, it } from 'vitest'
import { chartGeometry } from '@/contours/overview/lib/chart'

const makePoints = (values: (number | null)[], prior: (number | null)[] = []) =>
  values.map((bytes, i) => ({ date: new Date(i * 3600_000).toISOString(), bytes, previousBytes: prior[i] ?? null }))

function coordinates(line: string) {
  return [...line.matchAll(/([MC])([^MC]+)/g)].map(match => ({
    command: match[1], coords: match[2]!.trim().split(/\s+/).map(Number),
  }))
}

describe('traffic chart interpolation', () => {
  it('uses the end secants, harmonic means and horizontal extrema in screen coordinates', () => {
    const g = chartGeometry(makePoints([0, 1, 4, 2, 2]), 1088, true)
    const [, first, second, third, fourth] = coordinates(g.paths('bytes').line)
    const rounded = (v: number) => Math.round(v * 10) / 10
    expect(first!.coords).toEqual([rounded(g.x(1/3)), rounded(g.y(1/3)), rounded(g.x(2/3)), rounded(g.y(0.5)), g.x(1), g.y(1)])
    expect(second!.coords[1]).toBe(rounded(g.y(1.5)))
    expect(second!.coords[3]).toBe(g.y(4))
    expect(third!.coords[1]).toBe(g.y(4))
    expect(third!.coords[3]).toBe(g.y(2))
    expect(fourth!.coords.filter((_, i) => i % 2 === 1)).toEqual([g.y(2), g.y(2), g.y(2)])
  })

  it('keeps each series within its sampled interval across jumps, zero, gaps and plateaus', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 2, 0, 0, null, 3, null, 8, 1]
    const g = chartGeometry(makePoints(values, [...values].reverse()), 1568, true)
    for (const key of ['bytes', 'previousBytes'] as const) {
      const { line, area } = g.paths(key)
      expect(line.match(/M/g)).toHaveLength(3)
      expect(area.match(/Z/g)).toHaveLength(3)
      let startY = 0
      for (const { command, coords } of coordinates(line)) {
        const endY = coords.at(-1)!
        if (command === 'C') {
          // Bézier ordinates in order guarantee an interval-monotone polynomial.
          const ordinates = [startY, coords[1]!, coords[3]!, endY]
          expect(ordinates).toEqual([...ordinates].sort((a, b) => startY < endY ? a - b : b - a))
        }
        startY = endY
      }
    }
  })

  it('preserves the original control points for the remaining periods', () => {
    const g = chartGeometry(makePoints([1, 2, 1]), 1568)
    expect(g.paths('bytes').line).toBe('M52.0 174.0 C171.3 165.3 529.3 122.0 768.0 122.0 C1006.7 122.0 1364.7 165.3 1484.0 174.0')
  })
})
