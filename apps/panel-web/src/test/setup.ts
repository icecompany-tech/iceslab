import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})

// jsdom has no layout, and React Aria measures the overlay trigger through this.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
