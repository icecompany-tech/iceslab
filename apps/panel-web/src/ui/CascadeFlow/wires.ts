import type { FlowColumn, FlowLink } from './CascadeFlow'
import styles from './CascadeFlow.module.css'

type Point = { x: number; y: number; failed?: boolean }

function middle(points: readonly { y: number }[]) {
  return points.length ? (points[0]!.y + points[points.length - 1]!.y) / 2 : 0
}

/** Measure the HTML labels, then paint a single set of rails behind them. */
export function drawWires(track: HTMLElement, columns: readonly FlowColumn[], links: readonly FlowLink[]) {
  const root = track.getBoundingClientRect()
  const svg = track.querySelector('.' + styles.wires)!
  const hops = [...track.querySelectorAll<HTMLElement>('.' + styles.hop)].map(hop => {
    const box = hop.getBoundingClientRect()
    const groups = [...hop.querySelectorAll<HTMLElement>('.' + styles.group)].map(group => {
      const points = [...group.querySelectorAll<HTMLElement>('.' + styles.dot)].map(dot => {
        const { left, top, width, height } = dot.getBoundingClientRect()
        return { x: left - root.left + width / 2, y: top - box.top + height / 2, failed: dot.parentElement?.dataset.failed === 'true' }
      })
      return { points, y: middle(points), label: group.querySelector<HTMLElement>('.' + styles.groupLabel) }
    })
    return { hop, box, groups, y: middle(groups) }
  })
  const labels = [...track.querySelectorAll<HTMLElement>('.' + styles.link)].map(element => ({
    element,
    y: element.firstElementChild!.getBoundingClientRect().height,
  }))
  const axis = Math.max(0, ...hops.map(hop => hop.y), ...labels.map(label => label.y))
  for (const { hop, y } of hops) hop.style.marginTop = (axis - y) + 'px'
  for (const { element, y } of labels) element.style.marginTop = (axis - y) + 'px'

  const d = { normal: '', failed: '', pending: '', danger: '', diamond: '' }
  const diamond = (x: number, y: number) => { d.diamond += `M${x - 6} ${y}l6 -6 6 6 -6 6Z` }
  const arrow = (x: number, y: number) => { d.normal += `M${x - 4} ${y - 4}l4 4 -4 4` }

  function fork(x: number, y: number, spine: number, points: readonly Point[]) {
    if (!points.length) return
    let top = y
    let bottom = y
    for (const point of points) {
      const dy = Math.sign(point.y - y)
      const dx = Math.sign(point.x - spine)
      const radius = Math.min(6, Math.abs(point.y - y), Math.abs(point.x - spine))
      const bend = point.y - dy * radius
      top = Math.min(top, bend)
      bottom = Math.max(bottom, bend)
      d[point.failed ? 'failed' : 'normal'] += dy
        ? `M${spine} ${bend}Q${spine} ${point.y} ${spine + dx * radius} ${point.y}H${point.x}`
        : `M${spine} ${y}H${point.x}`
    }
    d.normal += `M${x} ${y}H${spine}M${spine} ${top}V${bottom}`
  }

  hops.forEach(({ hop, box, groups, y }, index) => {
    const column = columns[index]!
    const left = box.left - root.left
    const right = box.right - root.left
    const previous = hops[index - 1]
    const link = links[index - 1]
    const shift = axis - y
    const hopTop = hop.getBoundingClientRect().top
    const inputs: Point[] = []
    const hasArrows = previous && link?.tone !== 'pending'
    for (const [groupIndex, group] of groups.entries()) {
      const center = group.y + shift
      const points = group.points.map(point => {
        const x = point.x - (hasArrows && !point.failed ? 8 : 0)
        const y = point.y + shift
        if (hasArrows && !point.failed) arrow(x, y)
        return { ...point, x, y }
      })
      const title = group.label?.querySelector('.' + styles.groupTitle)
      if (group.label && title) {
        const titleBox = title.getBoundingClientRect()
        const offset = parseFloat(group.label.style.top) || 0
        group.label.style.top = (group.y - (titleBox.top + titleBox.height / 2 - hopTop) + offset) + 'px'
        inputs.push({ x: titleBox.left - root.left - 4, y: center })
        const near = Math.min(...points.map(point => point.x))
        const tail = Math.min(titleBox.right - root.left + 4, near - 4)
        const spine = Math.max(tail, near - 36)
        fork(tail, center, spine, points)
        if (column.groups[groupIndex]?.balancer) {
          diamond(spine, center)
          const label = group.label.querySelector<HTMLElement>('.' + styles.balancer)
          if (label) label.style.right = (group.label.getBoundingClientRect().right - root.left - spine + 6) + 'px'
        }
      } else {
        inputs.push(...points)
        if (previous && column.groups[groupIndex]?.balancer) diamond(left + 6, center)
      }
    }
    if (previous && link) {
      const start = previous.box.right - root.left
      const junction = left + 6
      d[link.tone ?? 'normal'] += `M${start} ${axis}H${left}`
      fork(left, axis, junction, inputs)
      if (column.diamond) diamond(junction, axis)
    }
    if (links[index]) {
      const outputs = groups.flatMap(group => group.points.map(point => ({ x: right - 12, y: point.y + shift })))
      fork(right, axis, right - 6, outputs)
    }
  })

  Object.values(d).forEach((path, i) => svg.children[i]?.setAttribute('d', path))
}
