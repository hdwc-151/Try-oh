import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageLightbox } from './ImageLightbox'

describe('ImageLightbox', () => {
  it('renders through a top-level portal and closes with Escape', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <ImageLightbox open src="/outfit.png" alt="Outfit" onClose={onClose} />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Xem ảnh phóng to' })
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(dialog.parentElement).toHaveClass('z-[200]')
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
