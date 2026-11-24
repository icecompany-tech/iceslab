export interface ChartPoint {
  date: string
  bytes: number | null
  previousBytes?: number
}

export const isNight = (date: string) => new Date(date).getHours() < 7
export const isWeekend = (date: string) => [0, 6].includes(new Date(date).getUTCDay())

export function chartGeometry(points: readonly ChartPoint[], width: number) {
  const left = 52, right = width - 84, top = 18, bottom = 226
  const dx = (right - left) / Math.max(1, points.length - 1)
  const max = Math.max(1, ...points.map(p => Math.max(p.bytes ?? 0, p.previousBytes ?? 0)))
  const unit = 1024 ** Math.floor(Math.log(max) / Math.log(1024))
  const rough = max / unit / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const ceiling = Math.max(4, Math.ceil(rough / power) * power * 4 * unit)
  const x = (i: number) => left + i * dx
  const y = (v: number) => bottom - (bottom - top) * v / ceiling
  const coord = (i: number, value: number) => x(i).toFixed(1) + ' ' + y(value).toFixed(1)

  // Paper uses Catmull-Rom tangents converted to cubic Béziers. Each run of
  // measurements owns its area, so missing hours remain empty down to the baseline.
  function paths(key: 'bytes' | 'previousBytes') {
    let run = '', line = '', area = '', start = 0
    for (const [i, point] of points.entries()) {
      const value = point[key]
      if (value == null) continue
      const prev = points[i - 1]?.[key]
      const next = points[i + 1]?.[key]
      if (prev == null) {
        start = i
        run = 'M' + coord(i, value)
      } else {
        const prior = points[i - 2]?.[key]
        const a = Math.max(0, prev + (value - (prior ?? prev)) / 6)
        const b = Math.max(0, value - ((next ?? value) - prev) / 6)
        run += ' C' + coord(i - 1 + (prior == null ? 1 : 2) / 6, a)
          + ' ' + coord(i - (next == null ? 1 : 2) / 6, b) + ' ' + coord(i, value)
      }
      if (next == null) {
        line += run
        area += run + ' L' + x(i) + ' ' + bottom + ' L' + x(start) + ' ' + bottom + ' Z'
      }
    }
    return { line, area }
  }
  return { left, right, top, bottom, dx, unit, ceiling, x, y, paths }
}
