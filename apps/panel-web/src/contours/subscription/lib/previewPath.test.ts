import { describe, expect, it } from 'vitest'
import { previewPath } from '@/contours/subscription/lib/previewPath'

describe('previewPath', () => {
  it('drops the host PUBLIC_URL put there, keeps the path and the language', () => {
    expect(previewPath('http://localhost:2515/api/settings/subscription/preview/abc?lang=ru')).toBe('/api/settings/subscription/preview/abc?lang=ru')
    expect(previewPath('https://panel.example.com/api/settings/subscription/preview/abc')).toBe('/api/settings/subscription/preview/abc')
  })

  it('a path stays a path', () => {
    expect(previewPath('/api/settings/subscription/preview/abc')).toBe('/api/settings/subscription/preview/abc')
  })

  it('never lets another host through as a protocol-relative link', () => {
    expect(previewPath('//evil.example/x')).toBe('/x')
  })
})
