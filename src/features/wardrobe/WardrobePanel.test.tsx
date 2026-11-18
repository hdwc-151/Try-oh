import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WardrobePanel } from './WardrobePanel'
import { useFittingRoomStore } from '../../store/useFittingRoomStore'
import type { Garment } from '../../types/fitting-room'

describe('WardrobePanel - Trước / Sau swap', () => {
  const mockGarment2Goc: Garment = {
    id: 'garment-1',
    name: 'Áo phông 2 mặt',
    category: 'tops',
    frontOriginalUrl: '/uploads/front-orig.png',
    frontProcessedUrl: '/uploads/front-proc.png',
    backOriginalUrl: '/uploads/back-orig.png',
    backProcessedUrl: '/uploads/back-proc.png',
    createdAt: '2026-11-01T00:00:00Z',
  }

  const mockGarment1Goc: Garment = {
    id: 'garment-2',
    name: 'Quần jeans 1 mặt',
    category: 'tops',
    frontOriginalUrl: '/uploads/pants-front-orig.png',
    frontProcessedUrl: '/uploads/pants-front-proc.png',
    backOriginalUrl: null,
    backProcessedUrl: null,
    createdAt: '2026-11-01T00:00:00Z',
  }

  beforeEach(() => {
    useFittingRoomStore.setState({
      activeCategory: 'tops',
      garments: [mockGarment2Goc, mockGarment1Goc],
      outfit: { tops: null, outerwear: null, bottoms: null, shoes: null, accessories: [] },
      isLoadingGarments: false,
      wardrobeError: null,
    })
  })

  it('hiển thị nút chuyển Trước / Sau cho món đồ có ảnh mặt sau', () => {
    render(<WardrobePanel onAddGarment={vi.fn()} />)

    // Kiểm tra có cụm nút Trước / Sau
    const btnTruoc = screen.getByRole('button', { name: 'Trước' })
    const btnSau = screen.getByRole('button', { name: 'Sau' })
    expect(btnTruoc).toBeInTheDocument()
    expect(btnSau).toBeInTheDocument()

    // Mặc định hiển thị mặt trước
    const img = screen.getByAltText('Áo phông 2 mặt (mặt trước)') as HTMLImageElement
    expect(img.src).toContain('/uploads/front-proc.png')

    // Bấm nút "Sau" -> đổi sang ảnh mặt sau
    fireEvent.click(btnSau)
    const imgSau = screen.getByAltText('Áo phông 2 mặt (mặt sau)') as HTMLImageElement
    expect(imgSau.src).toContain('/uploads/back-proc.png')

    // Bấm nút "Trước" -> đổi lại về ảnh mặt trước
    fireEvent.click(btnTruoc)
    const imgTruoc = screen.getByAltText('Áo phông 2 mặt (mặt trước)') as HTMLImageElement
    expect(imgTruoc.src).toContain('/uploads/front-proc.png')
  })

  it('hiển thị nhãn "Chỉ có mặt trước" với món đồ chỉ có 1 góc', () => {
    render(<WardrobePanel onAddGarment={vi.fn()} />)

    expect(screen.getByText('Chỉ có mặt trước')).toBeInTheDocument()
    expect(screen.getByText('1 góc')).toBeInTheDocument()
  })

  it('bấm đổi Trước/Sau không kích hoạt chọn món đồ (stopPropagation)', () => {
    render(<WardrobePanel onAddGarment={vi.fn()} />)

    const btnSau = screen.getByRole('button', { name: 'Sau' })
    fireEvent.click(btnSau)

    // Đồ vẫn chưa bị chọn vào outfit
    expect(useFittingRoomStore.getState().outfit.tops).toBeNull()

    // Bấm vào khu vực thẻ áo để chọn
    const cardSelectBtn = screen.getByRole('button', { name: 'Chọn Áo phông 2 mặt' })
    fireEvent.click(cardSelectBtn)
    expect(useFittingRoomStore.getState().outfit.tops).toBe('garment-1')
  })

  it('bấm nút phóng to hiển thị lightbox', () => {
    render(<WardrobePanel onAddGarment={vi.fn()} />)

    const zoomBtn = screen.getByRole('button', { name: 'Phóng to Áo phông 2 mặt' })
    fireEvent.click(zoomBtn)

    expect(screen.getByRole('dialog', { name: 'Xem ảnh phóng to' })).toBeInTheDocument()
    expect(screen.getAllByAltText('Áo phông 2 mặt (mặt trước)')).toHaveLength(2)
  })

  it('bấm nút chỉnh sửa mở modal Chỉnh sửa món đồ', () => {
    render(<WardrobePanel onAddGarment={vi.fn()} />)

    const editBtn = screen.getByRole('button', { name: 'Chỉnh sửa Áo phông 2 mặt' })
    fireEvent.click(editBtn)

    expect(screen.getByRole('dialog', { name: 'Chỉnh sửa món đồ' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Áo phông 2 mặt')).toBeInTheDocument()
  })

  it('vô hiệu hóa thêm món khi tủ đồ đủ 20 món', () => {
    useFittingRoomStore.setState({
      garments: Array.from({ length: 20 }, (_, index) => ({
        ...mockGarment1Goc,
        id: `garment-${index}`,
        name: `Món ${index + 1}`,
      })),
    })
    render(<WardrobePanel onAddGarment={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Thêm áo trong' })).toBeDisabled()
    expect(screen.getByText('Tủ đồ đã đầy')).toBeInTheDocument()
  })
})
