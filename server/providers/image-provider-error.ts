export type ImageProviderErrorCode =
  | 'invalid_input'
  | 'content_rejected'
  | 'quota_exceeded'
  | 'timeout'
  | 'provider_unavailable'

export class ImageProviderError extends Error {
  constructor(
    public readonly code: ImageProviderErrorCode,
    public readonly statusCode: number,
    public readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options)
    this.name = 'ImageProviderError'
  }
}
