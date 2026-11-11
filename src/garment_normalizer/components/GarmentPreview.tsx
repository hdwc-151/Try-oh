import { AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { FLAG_DESCRIPTIONS_VI } from '../core/quality'
import type { NormalizedGarment } from '../types'

export interface GarmentPreviewProps {
  originalBlob: Blob
  result: NormalizedGarment
  onApplyManualRotation?: (deg: number) => void
  onRetakePhoto?: () => void
  isProcessing?: boolean
}

export function GarmentPreview({
  originalBlob,
  result,
  onApplyManualRotation,
  onRetakePhoto,
  isProcessing = false,
}: GarmentPreviewProps) {
  const [sliderAngle, setSliderAngle] = useState(0)

  const originalUrl = useMemo(() => URL.createObjectURL(originalBlob), [originalBlob])
  const itemUrl = useMemo(() => URL.createObjectURL(result.item), [result.item])

  const meta = result.meta
  const bbox = meta.bboxInCanvas // [x, y, w, h] in 1024x1024

  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-black/[0.08] bg-white/95 p-6 shadow-xl backdrop-blur-md">
      {/* Header status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-4">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-9 place-items-center rounded-xl text-sm font-bold ${
              meta.status === 'OK'
                ? 'bg-emerald-100 text-emerald-800'
                : meta.status === 'WARN'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-red-100 text-red-800'
            }`}
          >
            {meta.status === 'OK' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div>
            <h4 className="font-display text-base font-bold text-ink">
              {meta.status === 'OK'
                ? 'Đã chuẩn hoá đạt chuẩn'
                : meta.status === 'WARN'
                  ? 'Cần lưu ý kiểm tra'
                  : 'Ảnh không đạt chuẩn (REJECT)'}
            </h4>
            <p className="text-xs text-ink/45">
              Góc xoay: {meta.rotationApplied.toFixed(1)}° · Tỉ lệ co: {meta.scaleFactor.toFixed(2)}x · Thời gian: {Math.round(meta.timingsMs.total || 0)}ms
            </p>
          </div>
        </div>

        {meta.status === 'REJECT' && onRetakePhoto && (
          <button
            type="button"
            onClick={onRetakePhoto}
            className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-red-700"
          >
            Chụp lại ảnh
          </button>
        )}
      </div>

      {/* Quality flags list */}
      {meta.flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {meta.flags.map((flag) => (
            <span
              key={flag}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                flag === 'cropped' || flag === 'tiny_or_huge'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <AlertTriangle size={13} />
              <span>{FLAG_DESCRIPTIONS_VI[flag] ?? flag}</span>
            </span>
          ))}
        </div>
      )}

      {/* Side-by-side comparison on checkerboard */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Original Background-Removed */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45">
            01 · Ảnh gốc đã tách nền
          </span>
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-black/[0.08] bg-[linear-gradient(45deg,#f0eee9_25%,transparent_25%),linear-gradient(-45deg,#f0eee9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0eee9_75%),linear-gradient(-45deg,transparent_75%,#f0eee9_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
            <img src={originalUrl} alt="Ảnh gốc" className="h-full w-full object-contain p-3" />
          </div>
        </div>

        {/* Normalized Image with Guidelines */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45">
            02 · Đã chuẩn hoá (1024x1024)
          </span>
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-black/[0.08] bg-[linear-gradient(45deg,#f0eee9_25%,transparent_25%),linear-gradient(-45deg,#f0eee9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0eee9_75%),linear-gradient(-45deg,transparent_75%,#f0eee9_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
            <img
              src={itemUrl}
              alt="Ảnh đã chuẩn hoá"
              style={{ transform: `rotate(${sliderAngle}deg)` }}
              className="h-full w-full object-contain transition-transform duration-75"
            />

            {/* Guideline: Center crosshair */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-red-500/40" />
            <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 border-l border-dashed border-red-500/40" />

            {/* Guideline: Bounding box in canvas overlay */}
            {bbox && bbox[2] > 0 && (
              <div
                className="pointer-events-none absolute border border-blue-500/50 bg-blue-500/5"
                style={{
                  left: `${(bbox[0] / 1024) * 100}%`,
                  top: `${(bbox[1] / 1024) * 100}%`,
                  width: `${(bbox[2] / 1024) * 100}%`,
                  height: `${(bbox[3] / 1024) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Manual rotation controls when needsReview or requested */}
      {meta.needsReview && onApplyManualRotation && (
        <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-[#faf9f6] p-4">
          <div className="flex items-center justify-between">
            <label htmlFor="manual-rotation-slider" className="flex items-center gap-2 text-xs font-bold text-ink">
              <RotateCw size={14} />
              <span>Chỉnh góc thủ công (xem trước tức thì)</span>
            </label>
            <span className="font-mono text-xs font-bold text-ink">{sliderAngle > 0 ? `+${sliderAngle}` : sliderAngle}°</span>
          </div>

          <div className="flex items-center gap-4">
            <input
              id="manual-rotation-slider"
              type="range"
              min="-10"
              max="10"
              step="0.5"
              value={sliderAngle}
              onChange={(e) => setSliderAngle(parseFloat(e.target.value))}
              className="w-full accent-ink"
            />
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => onApplyManualRotation(sliderAngle)}
              className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-sage-800 disabled:opacity-40"
            >
              {isProcessing ? 'Đang áp dụng…' : 'Áp dụng'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
