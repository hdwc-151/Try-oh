type AvatarProps = {
  name: string
  src?: string | null
  className?: string
  imageClassName?: string
}

const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] ?? ''}` : words[0]?.slice(0, 2) || 'TY').toUpperCase()
}

const isStoredAvatar = (value?: string | null): value is string => Boolean(value?.startsWith('/uploads/') || value?.startsWith('blob:'))

export function Avatar({ name, src, className = '', imageClassName = '' }: AvatarProps) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-sage-100 to-sage-200 font-bold text-sage-900 ${className}`}>
      {isStoredAvatar(src)
        ? <img src={src} alt={`Ảnh đại diện của ${name}`} decoding="async" className={`h-full w-full object-cover ${imageClassName}`} />
        : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  )
}
