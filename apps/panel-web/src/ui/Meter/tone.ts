export type MeterTone = 'accent' | 'amber' | 'danger'

/** The thresholds of the node card (h:213): above 60 amber, above 85 red. */
export function meterTone(percent: number): MeterTone {
  if (percent > 85) return 'danger'
  return percent > 60 ? 'amber' : 'accent'
}
