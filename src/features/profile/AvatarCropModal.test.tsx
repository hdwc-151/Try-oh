import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AvatarCropModal } from './AvatarCropModal'

describe('AvatarCropModal', () => {
  it('không render khi open = false', () => {
    const { container } = render(
      <AvatarCropModal
        open={false}
        file={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('hiển thị đầy đủ thanh công cụ zoom, xoay và các nút hành động khi mở', () => {
    const mockFile = new File(['fake-image'], 'avatar.png', { type: 'image/png' })
    const onClose = vi.fn()
    const onApply = vi.fn()

    render(
      <AvatarCropModal
        open={true}
        file={mockFile}
        onClose={onClose}
        onApply={onApply}
      />,
    )

    // Tiêu đề modal
    expect(screen.getByText('Chỉnh kích thước ảnh đại diện')).toBeInTheDocument()

    // Hướng dẫn
    expect(screen.getByText(/Kéo để di chuyển/i)).toBeInTheDocument()

    // Các nút công cụ
    expect(screen.getByTitle('Thu nhỏ')).toBeInTheDocument()
    expect(screen.getByTitle('Phóng to')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Xoay 90°/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Đặt lại vị trí/i })).toBeInTheDocument()

    // Nút Lưu và Hủy
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lưu ảnh đại diện/i })).toBeInTheDocument()

    // Bấm Hủy
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cho phép thay đổi mức thu phóng thông qua slider', () => {
    const mockFile = new File(['fake-image'], 'avatar.png', { type: 'image/png' })

    render(
      <AvatarCropModal
        open={true}
        file={mockFile}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )

    const slider = screen.getByRole('slider')
    expect(slider).toHaveValue('1')

    fireEvent.change(slider, { target: { value: '1.75' } })
    expect(slider).toHaveValue('1.75')
    expect(screen.getByText('175%')).toBeInTheDocument()
  })
})
