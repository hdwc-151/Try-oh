import { describe, expect, it } from 'vitest'
import { buildTryOnPrompt } from './try-on-prompt.js'

const base = { garmentCount: 1, garments: [{ name: 'Áo thun', category: 'tops' }] }

describe('buildTryOnPrompt – background', () => {
  it('mặc định dùng nền studio xám trơn', () => {
    const prompt = buildTryOnPrompt({ ...base, angle: 'front', hasReferenceImage: false })
    expect(prompt).toContain('Plain light-gray studio background')
    expect(prompt).not.toContain('Keep the original background')
  })

  it('giữ nền ảnh gốc khi keepBackground = true (ảnh trước)', () => {
    const prompt = buildTryOnPrompt({ ...base, angle: 'front', hasReferenceImage: false, keepBackground: true })
    expect(prompt).toContain('Keep the original background, environment, and scene from IMAGE 1')
    expect(prompt).not.toContain('Plain light-gray studio background')
  })

  it('ảnh sau giữ cùng nền với ảnh trước khi keepBackground = true', () => {
    const prompt = buildTryOnPrompt({ ...base, angle: 'back', hasReferenceImage: true, keepBackground: true })
    expect(prompt).toContain('Keep the SAME background, environment, and scene as the FINAL INPUT IMAGE')
    expect(prompt).not.toContain('Plain light-gray studio background')
  })

  it('ảnh sau vẫn dùng nền studio khi tắt tuỳ chọn', () => {
    const prompt = buildTryOnPrompt({ ...base, angle: 'back', hasReferenceImage: true })
    expect(prompt).toContain('Plain light-gray studio background')
  })
})

describe('buildTryOnPrompt – footwear', () => {
  it('asks for a matching pair of shoes on both feet', () => {
    const prompt = buildTryOnPrompt({ angle: 'front', hasReferenceImage: false, garmentCount: 1, garments: [{ name: 'Sandal quai mảnh', category: 'shoes' }] })
    expect(prompt).toContain('both feet, worn as one matching left-and-right pair')
    expect(prompt).toContain('Never show a single shoe')
  })
})
