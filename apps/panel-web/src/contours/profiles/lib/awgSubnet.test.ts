import { describe, expect, it } from 'vitest'
import { subnetCapacity } from '@/contours/profiles/lib/awgSubnet'

describe('what a subnet holds', () => {
  it('counts by the prefix, three addresses reserved', () => {
    expect(subnetCapacity('10.66.66.0/24')).toBe(253)
    expect(subnetCapacity('10.66.0.0/16')).toBe(65533)
    expect(subnetCapacity('10.66.66.0/30')).toBe(1)
  })

  it('says nothing about what it cannot read or the server refuses', () => {
    for (const bad of ['', 'x', '10.66.66.0', '10.66.66.0/31', '10.66.66.0/7', '300.1.1.1/24']) expect(subnetCapacity(bad)).toBeNull()
  })
})
