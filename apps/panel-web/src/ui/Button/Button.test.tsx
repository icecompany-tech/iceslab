// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/ui/Button/Button'

describe('ui/Button', () => {
  it('does not submit a form by accident', () => {
    render(<Button>Save</Button>)
    expect((screen.getByRole('button') as HTMLButtonElement).type).toBe('button')
  })

  it('a running action does not take a second press', () => {
    const press = vi.fn()
    render(<Button loading onClick={press}>Save</Button>)
    const button = screen.getByRole('button') as HTMLButtonElement
    button.click()
    expect(press).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-busy')).toBe('true')
  })
})
