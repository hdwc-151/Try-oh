const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_EDGE = 1024

export type ProcessedPersonImage = {
  file: File
  width: number
  height: number
  warnings: string[]
}

export const validatePersonImage = (file: File): string | null => {
  if (!ALLOWED_TYPES.has(file.type)) return 'Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'
  if (file.size > MAX_FILE_SIZE) return 'Ảnh phải nhỏ hơn hoặc bằng 10MB.'
  return null
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new window.Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không thể đọc ảnh.'))
    }
    image.src = url
  })

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Không thể resize ảnh.')),
      'image/jpeg',
      0.92,
    )
  })

export const analyzePersonImageDimensions = (width: number, height: number): string[] => {
  const warnings: string[] = []
  const ratio = height / width
  if (height <= width) {
    warnings.push('Ảnh đang nằm ngang. Nên dùng ảnh dọc, toàn thân từ đầu đến chân.')
  } else if (ratio < 1.35) {
    warnings.push('Ảnh khá vuông; hãy kiểm tra đầu và bàn chân đều nằm trọn trong khung.')
  } else if (ratio > 2.4) {
    warnings.push('Ảnh rất hẹp; cơ thể có thể bị cắt mất hai bên.')
  }
  if (width < 480 || height < 720) {
    warnings.push('Độ phân giải thấp có thể làm giảm chất lượng ảnh AI.')
  }
  return warnings
}

export async function processPersonImage(file: File): Promise<ProcessedPersonImage> {
  const image = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  // JPEG không có alpha. Nền trắng chỉ được dùng cho vùng vốn trong suốt;
  // nền thực tế trong ảnh tải lên được giữ nguyên hoàn toàn.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const blob = await canvasToBlob(canvas)
  return {
    file: new File([blob], 'person-1024.jpg', { type: 'image/jpeg' }),
    width,
    height,
    warnings: analyzePersonImageDimensions(image.naturalWidth, image.naturalHeight),
  }
}
