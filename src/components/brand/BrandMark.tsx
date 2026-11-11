import type { HTMLAttributes } from 'react'

type BrandMarkProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string
}

export function BrandMark({ className = '', label, ...props }: BrandMarkProps) {
  return (
    <span
      {...props}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[30%] bg-[#141A3C] shadow-[0_10px_24px_rgba(20,26,60,0.22)] ring-1 ring-white/10 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 64 64" className="size-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g fill="#FFFFFF"><rect x="15" y="23.625" width="6.5" height="26.5" /><rect x="15" y="23.625" width="19.5" height="6" /><rect x="21.5" y="35.625" width="10" height="6" /><circle cx="34.5" cy="26.625" r="3" /><circle cx="31.5" cy="38.625" r="3" /><circle cx="18.25" cy="50.125" r="3.25" /></g>
        <polygon points="42.5,10.625 44.4,15.225 49,17.125 44.4,19.025 42.5,23.625 40.6,19.025 36,17.125 40.6,15.225" fill="#FF5A6E" />
      </svg>
    </span>
  )
}

type BrandLogoProps = {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
  inverse?: boolean
}

export function BrandLogo({
  className = '',
  markClassName = 'size-10',
  wordmarkClassName = '',
  inverse = false,
}: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="Fitsy">
      <BrandMark className={markClassName} />
      <span
        className={`font-display text-xl font-extrabold tracking-[-0.04em] ${inverse ? 'text-white' : 'text-ink'} ${wordmarkClassName}`}
      >
        Fitsy<span aria-hidden="true" className="ml-0.5 align-super text-[0.55em] text-[#FF5A6E]">✦</span>
      </span>
    </span>
  )
}
