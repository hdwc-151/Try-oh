import { createHash } from 'node:crypto'
import type { GenerateImageInput, ImageProvider } from './image-provider.js'

export class MockImageProvider implements ImageProvider {
  constructor(private readonly delayMs = 2000) {}

  async generate(input: GenerateImageInput): Promise<{ imageUrl: string }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    const seed = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
      .slice(0, 12)
    return { imageUrl: `/api/mock-images/${input.angle}.svg?seed=${seed}` }
  }
}
