import type { PersonImage } from '../types/fitting-room'
import { apiFetch } from './api-client'

type PersonImageResponse = { item: PersonImage | null }

const parseError = async (response: Response) => {
  try {
    const data = await response.json() as { message?: string }
    return data.message ?? 'Yêu cầu không thành công.'
  } catch {
    return 'Yêu cầu không thành công.'
  }
}

export type UploadPersonImageInput = {
  file: File
  width: number
  height: number
  warnings: string[]
}

export const personApi = {
  async get(): Promise<PersonImage | null> {
    const response = await fetch('/api/person-image')
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as PersonImageResponse).item
  },

  async upload(input: UploadPersonImageInput): Promise<PersonImage> {
    const form = new FormData()
    form.set('personImage', input.file)
    form.set('width', String(input.width))
    form.set('height', String(input.height))
    form.set('warnings', JSON.stringify(input.warnings))
    const response = await apiFetch('/api/person-image', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await parseError(response))
    return response.json() as Promise<PersonImage>
  },

  async deletePersonImage(): Promise<void> {
    const response = await apiFetch('/api/person-image', { method: 'DELETE' })
    if (!response.ok) throw new Error(await parseError(response))
  },

  async deleteAllUserData(): Promise<void> {
    const response = await apiFetch('/api/user-data', { method: 'DELETE' })
    if (!response.ok) throw new Error(await parseError(response))
  },
}
