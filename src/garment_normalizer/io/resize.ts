import { createCanvas, type CanvasWrapper } from './canvas'

/**
 * High-quality canvas scaling.
 * When downscaling by more than 2x, Canvas 2D drawImage lacks INTER_AREA filtering,
 * so we downscale step-by-step (halving dimensions each step) before the final draw.
 */
export function multiStepResize(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): CanvasWrapper {
  let currW = srcW
  let currH = srcH
  let currentSource: CanvasImageSource = source

  // Successively halve until we are within 2x of target
  while (currW / 2 >= targetW && currH / 2 >= targetH) {
    const nextW = Math.round(currW / 2)
    const nextH = Math.round(currH / 2)
    const stepCanvas = createCanvas(nextW, nextH)

    stepCanvas.ctx.imageSmoothingEnabled = true
    stepCanvas.ctx.imageSmoothingQuality = 'high'
    stepCanvas.ctx.drawImage(currentSource, 0, 0, currW, currH, 0, 0, nextW, nextH)

    currentSource = stepCanvas.canvas
    currW = nextW
    currH = nextH
  }

  // Final draw to target dimensions
  const finalCanvas = createCanvas(targetW, targetH)
  finalCanvas.ctx.imageSmoothingEnabled = true
  finalCanvas.ctx.imageSmoothingQuality = 'high'
  finalCanvas.ctx.drawImage(currentSource, 0, 0, currW, currH, 0, 0, targetW, targetH)

  return finalCanvas
}
