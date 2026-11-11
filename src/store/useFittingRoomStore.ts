import { create } from 'zustand'
import { MAX_SELECTED_GARMENTS, type Garment, type GarmentCategory, type OutfitSelection, type PersonImage } from '../types/fitting-room'

const emptyOutfit: OutfitSelection = {
  tops: null,
  outerwear: null,
  bottoms: null,
  shoes: null,
  accessories: [],
}

const selectedGarmentCount = (outfit: OutfitSelection) =>
  [outfit.tops, outfit.outerwear, outfit.bottoms, outfit.shoes].filter(Boolean).length + outfit.accessories.length

type FittingRoomState = {
  activeCategory: GarmentCategory
  garments: Garment[]
  outfit: OutfitSelection
  isLoadingGarments: boolean
  wardrobeError: string | null
  personImage: PersonImage | null
  privacyConsent: boolean
  preservePoseFront: boolean
  preservePoseBack: boolean
  setActiveCategory: (category: GarmentCategory) => void
  setGarments: (garments: Garment[]) => void
  addGarment: (garment: Garment) => void
  updateGarment: (garment: Garment) => void
  removeGarment: (garmentId: string) => void
  selectGarment: (category: GarmentCategory, garmentId: string) => void
  clearSelection: (category: GarmentCategory) => void
  loadOutfitGarments: (garmentIds: string[]) => void
  setLoadingGarments: (isLoading: boolean) => void
  setWardrobeError: (error: string | null) => void
  setPersonImage: (personImage: PersonImage | null) => void
  setPrivacyConsent: (consent: boolean) => void
  setPreservePoseFront: (preserve: boolean) => void
  setPreservePoseBack: (preserve: boolean) => void
  clearUserData: () => void
  resetWorkspace: () => void
}

export const useFittingRoomStore = create<FittingRoomState>((set) => ({
  activeCategory: 'tops',
  garments: [],
  outfit: emptyOutfit,
  isLoadingGarments: true,
  wardrobeError: null,
  personImage: null,
  privacyConsent: false,
  preservePoseFront: true,
  preservePoseBack: true,
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setGarments: (garments) => set({ garments }),
  addGarment: (garment) =>
    set((state) => ({ garments: [garment, ...state.garments] })),
  updateGarment: (updated) =>
    set((state) => {
      const old = state.garments.find((g) => g.id === updated.id)
      let nextOutfit = state.outfit
      if (old && old.category !== updated.category) {
        nextOutfit = {
          tops: state.outfit.tops === updated.id ? null : state.outfit.tops,
          outerwear: state.outfit.outerwear === updated.id ? null : state.outfit.outerwear,
          bottoms: state.outfit.bottoms === updated.id ? null : state.outfit.bottoms,
          shoes: state.outfit.shoes === updated.id ? null : state.outfit.shoes,
          accessories: state.outfit.accessories.filter((id) => id !== updated.id),
        }
      }
      return {
        garments: state.garments.map((g) => (g.id === updated.id ? updated : g)),
        outfit: nextOutfit,
      }
    }),
  removeGarment: (garmentId) =>
    set((state) => ({
      garments: state.garments.filter((garment) => garment.id !== garmentId),
      outfit: {
        tops: state.outfit.tops === garmentId ? null : state.outfit.tops,
        outerwear: state.outfit.outerwear === garmentId ? null : state.outfit.outerwear,
        bottoms: state.outfit.bottoms === garmentId ? null : state.outfit.bottoms,
        shoes: state.outfit.shoes === garmentId ? null : state.outfit.shoes,
        accessories: state.outfit.accessories.filter((id) => id !== garmentId),
      },
    })),
  selectGarment: (category, garmentId) =>
    set((state) => {
      if (category === 'accessories') {
        const isSelected = state.outfit.accessories.includes(garmentId)
        if (!isSelected && selectedGarmentCount(state.outfit) >= MAX_SELECTED_GARMENTS) return state
        return {
          outfit: {
            ...state.outfit,
            accessories: isSelected
              ? state.outfit.accessories.filter((id) => id !== garmentId)
              : [...state.outfit.accessories, garmentId],
          },
        }
      }
      const current = state.outfit[category]
      if (current !== garmentId && !current && selectedGarmentCount(state.outfit) >= MAX_SELECTED_GARMENTS) return state
      return {
        outfit: {
          ...state.outfit,
          [category]: current === garmentId ? null : garmentId,
        },
      }
    }),
  clearSelection: (category) =>
    set((state) => ({
      outfit: {
        ...state.outfit,
        ...(category === 'accessories'
          ? { accessories: [] }
          : { [category]: null }),
      },
    })),
  loadOutfitGarments: (garmentIds) =>
    set((state) => {
      const nextOutfit: OutfitSelection = {
        tops: null,
        outerwear: null,
        bottoms: null,
        shoes: null,
        accessories: [],
      }
      const garmentMap = new Map(state.garments.map((g) => [g.id, g]))
      for (const id of garmentIds) {
        const garment = garmentMap.get(id)
        if (!garment) continue
        if (garment.category === 'accessories') {
          if (!nextOutfit.accessories.includes(id)) {
            nextOutfit.accessories.push(id)
          }
        } else {
          nextOutfit[garment.category] = id
        }
      }
      return { outfit: nextOutfit }
    }),
  setLoadingGarments: (isLoadingGarments) => set({ isLoadingGarments }),
  setWardrobeError: (wardrobeError) => set({ wardrobeError }),
  setPersonImage: (personImage) => set({ personImage, privacyConsent: false }),
  setPrivacyConsent: (privacyConsent) => set({ privacyConsent }),
  setPreservePoseFront: (preservePoseFront) => set({ preservePoseFront }),
  setPreservePoseBack: (preservePoseBack) => set({ preservePoseBack }),
  clearUserData: () => set({ personImage: null, privacyConsent: false }),
  resetWorkspace: () => set({
    activeCategory: 'tops',
    garments: [],
    outfit: emptyOutfit,
    isLoadingGarments: true,
    wardrobeError: null,
    personImage: null,
    privacyConsent: false,
    preservePoseFront: true,
    preservePoseBack: true,
  }),
}))
