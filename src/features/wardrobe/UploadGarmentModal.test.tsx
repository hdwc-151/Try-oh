import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UploadGarmentModal } from './UploadGarmentModal'

describe('UploadGarmentModal', () => {
  it('uses the selected wardrobe tab as the category without asking again', () => {
    render(
      <UploadGarmentModal
        open
        defaultCategory="bottoms"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Thêm quần' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên quần')).toHaveAttribute('placeholder', 'Ví dụ: Quần jeans xanh')
    expect(screen.getByRole('button', { name: 'Lưu quần' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tách nền' })).toBeInTheDocument()
    expect(screen.queryByText(/AI & FLUX/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Kiểm tra hình ảnh/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Xem trước & Tái tạo/i)).not.toBeInTheDocument()
    expect(screen.getByText('Trước · Gốc')).toBeInTheDocument()
    expect(screen.getByText('Trước · Đã tách')).toBeInTheDocument()
    expect(screen.getByText('Sau · Gốc')).toBeInTheDocument()
    expect(screen.getByText('Sau · Đã tách')).toBeInTheDocument()
    expect(screen.queryByText('Loại đồ')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Áo' })).not.toBeInTheDocument()
    // Không còn các checkbox tách set thủ công
    expect(screen.queryByLabelText(/Tách cả set/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Tách phụ kiện/i)).not.toBeInTheDocument()
  })

  it('dùng một vùng cuộn trên mobile và tách vùng cuộn trên desktop', () => {
    const { container } = render(
      <UploadGarmentModal
        open
        defaultCategory="tops"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const content = container.querySelector('.lg\\:grid-cols-\\[330px_minmax\\(0\\,1fr\\)\\]')
    expect(content).toHaveClass('overflow-y-auto', 'lg:overflow-hidden')

    // Mobile để nội dung chảy tự nhiên; desktop mới khóa cột form.
    const leftCol = container.querySelector('.lg\\:grid-cols-\\[330px_minmax\\(0\\,1fr\\)\\] > div:first-child')
    expect(leftCol).toHaveClass('overflow-visible', 'lg:overflow-hidden')

    // Mobile dùng vùng cuộn chung; desktop cho phép riêng cột ảnh cuộn.
    const rightCol = container.querySelector('.lg\\:grid-cols-\\[330px_minmax\\(0\\,1fr\\)\\] > div:last-child')
    expect(rightCol).toHaveClass('overflow-visible', 'lg:overflow-y-auto')
  })
})
