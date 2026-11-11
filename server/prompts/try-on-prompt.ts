import type { GarmentPromptInfo, TryOnAngle } from '../providers/image-provider.js'

const angleDescriptions: Record<TryOnAngle, string> = {
  front: 'front view facing the camera',
  back: 'direct back view, seen from behind, facing away from the camera',
}

/**
 * Category is intentionally used ONLY as a coarse anatomical placement hint.
 * The reference image + item name remain the source of truth for what the item is
 * and what it looks like.
 */
function getPlacementHint(name: string, category: string): string {
  const lower = name.toLowerCase()

  // Name-specific placement is useful for accessories because many of them may
  // share one broad "accessories" category.
  if (
    lower.includes('nịt đùi') ||
    lower.includes('đai đùi') ||
    lower.includes('thigh garter') ||
    lower.includes('thigh strap') ||
    lower.includes('leg garter')
  ) {
    return 'upper thigh; keep the exact left/right side shown or implied by the reference'
  }

  if (
    lower.includes('thắt lưng') ||
    lower.includes('dây lưng') ||
    lower.includes('waist belt') ||
    lower === 'belt'
  ) {
    return 'waist / waistband'
  }

  if (
    lower.includes('đồng hồ') ||
    lower.includes('watch') ||
    lower.includes('vòng tay') ||
    lower.includes('bracelet')
  ) {
    return 'wrist / arm'
  }

  if (
    lower.includes('kính') ||
    lower.includes('glasses') ||
    lower.includes('sunglasses')
  ) {
    return 'face / eyes'
  }

  if (
    lower.includes('mũ') ||
    lower.includes('nón') ||
    lower.includes('hat') ||
    lower.includes('cap') ||
    lower.includes('beanie') ||
    lower.includes('beret')
  ) {
    return 'head'
  }

  if (
    lower.includes('vòng cổ') ||
    lower.includes('dây chuyền') ||
    lower.includes('necklace')
  ) {
    return 'neck / collarbone'
  }

  if (
    lower.includes('hoa tai') ||
    lower.includes('khuyên tai') ||
    lower.includes('earring')
  ) {
    return 'ears'
  }

  if (lower.includes('nhẫn') || lower.includes('ring')) {
    return 'fingers'
  }

  if (
    lower.includes('túi') ||
    lower.includes('bag') ||
    lower.includes('purse') ||
    lower.includes('tote') ||
    lower.includes('clutch') ||
    lower.includes('balo') ||
    lower.includes('backpack')
  ) {
    if (lower.includes('balo') || lower.includes('backpack')) {
      return 'back / shoulders'
    }

    if (lower.includes('chéo') || lower.includes('crossbody')) {
      return 'across the torso'
    }

    if (
      lower.includes('cầm tay') ||
      lower.includes('clutch') ||
      lower.includes('xách')
    ) {
      return 'hand / forearm'
    }

    return 'hand, forearm, shoulder, or torso according to the item reference and item name'
  }

  if (
    lower.includes('khăn') ||
    lower.includes('scarf') ||
    lower.includes('bandana') ||
    lower.includes('cà vạt') ||
    lower.includes('tie')
  ) {
    return 'neck / collar area'
  }

  if (
    lower.includes('tất') ||
    lower.includes('vớ') ||
    lower.includes('socks')
  ) {
    return 'feet / ankles'
  }

  // Coarse category fallback. This does NOT define the item's visual identity.
  if (category === 'tops') {
    return 'upper body / torso'
  }

  if (category === 'outerwear') {
    return 'over the upper body'
  }

  if (category === 'bottoms') {
    return 'lower body'
  }

  if (category === 'shoes') {
    // "shoes" here only means foot placement. It must NOT force sandals,
    // slippers, boots, heels, sneakers, etc. to become generic shoes.
    return 'feet'
  }

  return 'infer the natural anatomical position from the reference image and item name'
}

type TryOnPromptInput = {
  angle: TryOnAngle
  garmentCount: number
  hasReferenceImage: boolean
  garments?: GarmentPromptInfo[]
  preservePose?: boolean
}

function buildGarmentDetails(garments?: GarmentPromptInfo[]): string {
  if (!garments || garments.length === 0) {
    return ''
  }

  return `ITEM REFERENCES:
${garments
  .map(
    (g, idx) =>
      `- Garment Reference ${idx + 1}
  Name: "${g.name}"
  Placement hint: ${getPlacementHint(g.name, g.category)}`,
  )
  .join('\n')}

HOW TO INTERPRET EACH ITEM:
- The REFERENCE IMAGE is the visual source of truth for the item's appearance.
- The ITEM NAME is the semantic hint for understanding what the item is.
- The PLACEMENT HINT only indicates where the item belongs on the body. It must NOT redefine the item type or override visible details.
- If a broad internal category conflicts with the reference image or item name, follow the reference image + item name.
- If the item name and image differ slightly, preserve the actual visible design from the image rather than redesigning it to fit the wording.
- Keep every supplied item separate, recognizable, and physically plausible.
- Do not merge, duplicate, replace, or invent items.`
}

export function buildTryOnPrompt({
  angle,
  garmentCount,
  hasReferenceImage,
  garments,
  preservePose = true,
}: TryOnPromptInput): string {
  const garmentDetails = buildGarmentDetails(garments)

  const sourcePriority = `SOURCE PRIORITY:
1. IMAGE 1 = PERSON SOURCE OF TRUTH.
   Use it for identity, face, hair, skin tone, body shape, height, and body proportions.
2. EACH GARMENT REFERENCE IMAGE = ITEM VISUAL SOURCE OF TRUTH.
   Use it for shape, silhouette, color, material, texture, pattern, logos, straps, closures, sole, seams, and visible construction.
3. EACH ITEM NAME = SEMANTIC HINT.
   Use it to understand what the pictured object is, especially when its shape is ambiguous.
4. PLACEMENT HINT = LOCATION ONLY.
   Use it only to determine where the item belongs anatomically. Never let it transform the item into another clothing/accessory type.
5. ${
    hasReferenceImage
      ? 'The FINAL INPUT IMAGE is the previously generated FRONT view. Use it only for continuity of pose, outfit fit, lighting, and studio appearance. If it conflicts with an original garment reference, the original garment reference wins for item appearance.'
      : 'There is no previously generated front-view reference image.'
  }`

  const layeringInstruction = `LAYERING & WEARING LOGIC:
- Infer the intended wearing method from each reference image + item name.
- Apply normal physical layering: inner garments underneath outer garments, bottoms on the lower body, footwear on the feet, and accessories in their natural anatomical position.
- Keep separate items as separate physical objects.
- Preserve visible closure/opening state when the reference clearly shows it.
- Do not force an outer garment open or closed unless the reference or physical plausibility requires it.
- Respect realistic occlusion: an outer layer may cover part of an inner layer naturally.`

  if (angle === 'back' && hasReferenceImage) {
    const rearPoseInstruction = preservePose
      ? `POSE CONSISTENCY:
- Use the FINAL INPUT IMAGE (the generated front view) as the pose-continuity reference.
- Preserve the same body configuration: stance, leg positions, hip angle, shoulder angle, head tilt, and arm positions.
- Rotate the viewpoint/person relationship by 180 degrees into a true rear view. Do NOT horizontally mirror the person.
- Preserve left/right anatomical sides correctly.
- If the hands or a held object are in front of the torso, they may become partially or fully occluded from the rear camera. Do not relocate them behind the head, neck, or back.`
      : `POSE:
- Generate a natural fashion pose seen directly from behind.
- Keep the same person's identity, body proportions, and outfit.`

    return `TASK:
Generate exactly one photorealistic full-body BACK VIEW of the same person wearing the supplied items.

${sourcePriority}

BACK-VIEW REQUIREMENTS:
- Show a direct 180-degree rear view, facing away from the camera.
- Keep the same person: identity, hair, skin tone, body shape, height, and proportions.
- Keep exactly the same ${garmentCount} supplied item(s).
- Do not add, remove, merge, duplicate, substitute, recolor, or redesign any item.
- For rear details visible in an item reference, reproduce those details faithfully.
- If a rear detail is not visible in any reference, infer only physically necessary construction. Do not invent new logos, text, graphics, pockets, straps, or decorative elements.
- Preserve asymmetrical item placement on the correct anatomical side.
- Keep hair and accessories in physically natural positions; do not move them merely to expose clothing.
- Plain light-gray studio background, even studio lighting, realistic shadows, full body visible from head to feet.

${rearPoseInstruction}

${layeringInstruction}

${garmentDetails}

QUALITY / FAILURE AVOIDANCE:
- No extra limbs, duplicated hands, duplicated items, floating accessories, or fused clothing layers.
- No unintended text, logos, patterns, hats, bags, or accessories.
- Do not convert sandals into shoes, shoes into sandals, a thigh garter into a waist belt, or one accessory type into another merely because of a broad category hint.
- Keep anatomy, fit, occlusion, perspective, and item placement physically coherent.

Return exactly one image and no explanatory text.`
  }

  const poseInstruction = preservePose
    ? angle === 'front'
      ? `POSE:
- Preserve the exact body pose, stance, posture, head tilt, leg position, and arm/hand placement from IMAGE 1.
- Do not replace the person's natural pose with a generic standing pose.`
      : `POSE:
- Preserve the same body configuration from IMAGE 1 while showing the person from behind.
- Rotate the viewpoint/person relationship by 180 degrees; do not horizontally mirror the person.
- Keep left/right anatomical sides correct.`
    : `POSE:
- Use a natural, stylish fashion pose that showcases the outfit while preserving the person's identity and body proportions.`

  const rearSpecificInstruction =
    angle === 'back'
      ? `BACK-SPECIFIC RULES:
- If an item reference shows the back of an item, use it as the authority for rear colors, logos, patterns, seams, pockets, straps, and cut.
- If an unseen rear detail is necessary, infer conservatively and do not invent decorative details.`
      : ''

  return `TASK:
Virtual try-on. Using the person in IMAGE 1, generate exactly one photorealistic full-body image of the SAME person wearing exactly the ${garmentCount} supplied item(s).

VIEW:
- ${angleDescriptions[angle]}.

${sourcePriority}

IDENTITY & BODY:
- Preserve the person's face, hair, skin tone, body shape, height, and proportions.
- Do not beautify, reshape, slim, enlarge, age, or otherwise alter the person's identity or body.

ITEM FIDELITY:
- Reproduce each supplied item from its own reference image.
- Use the item name to understand its identity, not to redesign its visible appearance.
- Preserve the visible shape, silhouette, color, material, texture, pattern, logo, cut, length, straps, closures, sole, seams, and recognizable construction.
- Do not add, remove, merge, duplicate, substitute, recolor, or redesign any supplied item.
- Do not invent text, logos, prints, straps, pockets, or accessories that are absent from the references.
- A broad category/placement hint must never convert one item type into another.

${poseInstruction}

${layeringInstruction}

${garmentDetails}

${rearSpecificInstruction}

SCENE:
- Plain light-gray studio background.
- Even studio lighting and realistic shadows.
- Full body visible from head to feet.
- Natural fit, realistic folds, correct occlusion, and coherent anatomy.

QUALITY / FAILURE AVOIDANCE:
- No extra limbs, duplicated hands, duplicated items, floating accessories, or fused clothing layers.
- Keep every accessory attached to its natural anatomical location.
- Keep left/right anatomical placement consistent.
- Do not convert sandals into shoes, shoes into sandals, a thigh garter into a waist belt, or one accessory type into another because of a broad category hint.

Return exactly one image and no explanatory text.`
}

export { angleDescriptions }
