import { Router } from 'express'
import { TRY_ON_ANGLES, type TryOnAngle } from './image-provider.js'

const angleLabels: Record<TryOnAngle, string> = {
  front: 'TRƯỚC',
  back: 'SAU',
}

const silhouette = (angle: TryOnAngle, color: string) => {
  const back = angle === 'back'
  const bodyWidth = 142
  const x = (360 - bodyWidth) / 2
  return `
    <circle cx="180" cy="150" r="55" fill="#d8c7b8"/>
    ${back ? '' : '<path d="M160 146 Q180 158 200 146" fill="none" stroke="#806d62" stroke-width="4" stroke-linecap="round"/>'}
    <rect x="${x}" y="205" width="${bodyWidth}" height="210" rx="42" fill="${color}"/>
    <rect x="${x - 34}" y="225" width="32" height="190" rx="16" fill="${color}"/>
    <rect x="${x + bodyWidth + 2}" y="225" width="32" height="190" rx="16" fill="${color}"/>
    <rect x="121" y="400" width="52" height="250" rx="25" fill="#34443b"/>
    <rect x="187" y="400" width="52" height="250" rx="25" fill="#34443b"/>
    <ellipse cx="142" cy="664" rx="45" ry="18" fill="#f5f3ed"/>
    <ellipse cx="218" cy="664" rx="45" ry="18" fill="#f5f3ed"/>
  `
}

export function createMockImageRouter() {
  const router = Router()
  router.get('/:angle.svg', (request, response) => {
    const angle = request.params.angle?.replace('.svg', '') as TryOnAngle
    const seed = typeof request.query.seed === 'string' ? request.query.seed : ''
    if (!TRY_ON_ANGLES.includes(angle) || !/^[a-f0-9]{12}$/.test(seed)) {
      response.status(400).send('Invalid mock image request')
      return
    }
    const color = `#${seed.slice(0, 6)}`
    response
      .type('image/svg+xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 360 720">
        <rect width="360" height="720" fill="#e9e8e5"/>
        <text x="24" y="38" fill="#26302b" font-family="Arial, sans-serif" font-size="14" font-weight="700">MOCK · ${angleLabels[angle]}</text>
        <text x="336" y="38" text-anchor="end" fill="#777f7a" font-family="Arial, sans-serif" font-size="10">NOT AI OUTPUT</text>
        ${silhouette(angle, color)}
        <text x="180" y="704" text-anchor="middle" fill="#777f7a" font-family="Arial, sans-serif" font-size="10">Ảnh giả để kiểm thử giao diện</text>
      </svg>`)
  })
  return router
}
