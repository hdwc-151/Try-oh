import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { livePreviewApi } from '../../services/live-preview-api'
import { useFittingRoomStore } from '../../store/useFittingRoomStore'
import { checkCameraExposure } from './camera-exposure'
import { LivePreviewModal } from './LivePreviewModal'

vi.mock('@decartai/sdk', () => ({}))

const getUserMedia = vi.fn<() => Promise<MediaStream>>()
const stopTrack = vi.fn()
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const noop = () => undefined

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  getUserMedia.mockReset().mockResolvedValue(stream)
  stopTrack.mockClear()
  vi.spyOn(livePreviewApi, 'status').mockResolvedValue({
    enabled: true, included: true, unlimited: false, sessionSeconds: 10,
    fastModeIncluded: false, fastCost: 2, limit: 3, used: 0, remaining: 3, windowDays: 30, nextResetAt: null,
  })
  vi.spyOn(livePreviewApi, 'start').mockRejectedValue(new Error('Kết thúc kiểm thử'))
  useFittingRoomStore.getState().setGarments([{
    id: 'garment', name: 'Áo mẫu', category: 'tops', frontOriginalUrl: '/uploads/garment.webp',
    frontProcessedUrl: '/uploads/garment.webp', backOriginalUrl: null, backProcessedUrl: null, createdAt: '2026-11-18',
  }])
})
afterEach(() => {
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  vi.restoreAllMocks()
  useFittingRoomStore.getState().resetWorkspace()
})

const openCamera = async () => {
  const button = screen.getByRole('button', { name: 'Căn khung camera' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}
const confirmButton = () => screen.findByRole('button', { name: 'Bắt đầu 10 giây (dùng 1 lượt)' })

it('keeps framing local and releases the camera when the user cancels', async () => {
  render(<LivePreviewModal open onClose={noop} onOpenPlans={noop} />)
  await openCamera()
  await confirmButton()
  expect(livePreviewApi.start).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Quay lại chọn đồ' }))
  expect(stopTrack).toHaveBeenCalledTimes(1)
  expect(livePreviewApi.start).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Căn khung camera' })).toBeEnabled()
})

it('uses one paid session when confirmation is clicked twice', async () => {
  render(<LivePreviewModal open onClose={noop} onOpenPlans={noop} />)
  await openCamera()
  const button = await confirmButton()
  act(() => {
    fireEvent.click(button)
    fireEvent.click(button)
  })
  await screen.findByText('Kết thúc kiểm thử')
  expect(livePreviewApi.start).toHaveBeenCalledTimes(1)
  expect(livePreviewApi.start).toHaveBeenCalledWith({ source: 'wardrobe', garmentId: 'garment', speed: 'standard' })
})

it('stops a stream granted after the dialog was closed', async () => {
  let grant!: (camera: MediaStream) => void
  getUserMedia.mockReturnValueOnce(new Promise(resolve => { grant = resolve }))
  const { rerender } = render(<LivePreviewModal open onClose={noop} onOpenPlans={noop} />)
  await openCamera()
  rerender(<LivePreviewModal open={false} onClose={noop} onOpenPlans={noop} />)
  await act(async () => { grant(stream) })
  expect(stopTrack).toHaveBeenCalledTimes(1)
  expect(livePreviewApi.start).not.toHaveBeenCalled()
})

it('flags severe exposure without warning about a normally mixed frame', () => {
  const frame = (lumas: number[]) => new Uint8ClampedArray(lumas.flatMap(n => [n, n, n, 255]))
  expect(checkCameraExposure(frame([0, 0, 0, 120]))).toBe('dark')
  expect(checkCameraExposure(frame([255, 255, 255, 120]))).toBe('bright')
  expect(checkCameraExposure(frame([0, 0, 120, 255]))).toBe('balanced')
})
