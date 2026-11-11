import { useEffect, useState } from 'react'

export function useObjectUrl(source: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!source) {
      setUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(source)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [source])

  return url
}
