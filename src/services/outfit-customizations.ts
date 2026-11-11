import type { SavedOutfit } from '../types/fitting-room'

export type OutfitCustomization = {
  title?: string | null
  frontImageUrl?: string
  backImageUrl?: string | null
}

const STORAGE_KEY = 'fitting-room:outfit-customizations'
const OLD_TITLES_KEY = 'fitting-room:outfit-titles'

export function getOutfitCustomizations(): Record<string, OutfitCustomization> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const data: Record<string, OutfitCustomization> = raw ? JSON.parse(raw) : {}
    const oldTitlesRaw = window.localStorage.getItem(OLD_TITLES_KEY)
    if (oldTitlesRaw) {
      const oldTitles: Record<string, string> = JSON.parse(oldTitlesRaw)
      for (const [id, title] of Object.entries(oldTitles)) {
        if (!data[id]) data[id] = {}
        if (!data[id].title) data[id].title = title
      }
    }
    return data
  } catch {
    return {}
  }
}

export function saveOutfitCustomization(id: string, updates: Partial<OutfitCustomization>) {
  if (typeof window === 'undefined') return
  try {
    const all = getOutfitCustomizations()
    all[id] = { ...all[id], ...updates }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    if (updates.title !== undefined) {
      const oldTitlesRaw = window.localStorage.getItem(OLD_TITLES_KEY)
      const oldTitles: Record<string, string> = oldTitlesRaw ? JSON.parse(oldTitlesRaw) : {}
      if (updates.title) oldTitles[id] = updates.title
      else delete oldTitles[id]
      window.localStorage.setItem(OLD_TITLES_KEY, JSON.stringify(oldTitles))
    }
  } catch {
    // Ignore errors
  }
}

export function removeOutfitCustomization(id: string) {
  if (typeof window === 'undefined') return
  try {
    const all = getOutfitCustomizations()
    delete all[id]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    const oldTitlesRaw = window.localStorage.getItem(OLD_TITLES_KEY)
    if (oldTitlesRaw) {
      const oldTitles: Record<string, string> = JSON.parse(oldTitlesRaw)
      delete oldTitles[id]
      window.localStorage.setItem(OLD_TITLES_KEY, JSON.stringify(oldTitles))
    }
  } catch {
    // Ignore errors
  }
}

export function applyOutfitCustomizations(outfits: SavedOutfit[]): SavedOutfit[] {
  const custom = getOutfitCustomizations()
  return outfits.map((outfit) => {
    const override = custom[outfit.id]
    if (!override) return outfit
    return {
      ...outfit,
      frontImageUrl: override.frontImageUrl ?? outfit.frontImageUrl,
      backImageUrl: override.backImageUrl !== undefined ? override.backImageUrl : outfit.backImageUrl,
    }
  })
}
