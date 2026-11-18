import type { GarmentCategory } from '../garments/garment.js'

// Decart's VTON guide recommends "substitute" for replacing what the person wears
// and "add" for layering items. `enhance` stays on, so these are kept generic and
// the model expands them from the reference image.
export const LIVE_PREVIEW_PROMPTS: Readonly<Record<GarmentCategory, string>> = {
  tops: 'Substitute the current top with the top shown in the reference image',
  outerwear: "Add the jacket or coat shown in the reference image over the person's current outfit",
  bottoms: 'Substitute the current pants, shorts or skirt with the garment shown in the reference image',
  shoes: 'Substitute the current shoes with the shoes shown in the reference image',
  accessories: 'Add the accessory shown in the reference image to the person',
}
