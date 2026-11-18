export type CameraExposure = 'dark' | 'bright' | 'balanced'

export function checkCameraExposure(pixels: Uint8ClampedArray): CameraExposure {
  let dark = 0
  let bright = 0
  for (let channel = 0; channel + 3 < pixels.length; channel += 4) {
    const luma = 0.2126 * pixels[channel] + 0.7152 * pixels[channel + 1] + 0.0722 * pixels[channel + 2]
    if (luma <= 18) dark += 1
    if (luma >= 245) bright += 1
  }
  // Warn only when most of the central crop is nearly black or clipped.
  const threshold = Math.floor(pixels.length / 4) * 0.7
  if (dark > threshold) return 'dark'
  if (bright > threshold) return 'bright'
  return 'balanced'
}
