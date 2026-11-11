import { fetch as expoFetch } from 'expo/fetch';

import { AuthSessionTimeoutError, getSessionWithTimeout, supabase } from './supabase';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
if (!configuredApiUrl) {
  throw new Error('Thiếu EXPO_PUBLIC_API_URL. Hãy cấu hình URL backend cho bản build này.');
}
export const apiBaseUrl = configuredApiUrl.replace(/\/$/, '');
/** Địa chỉ trang web Fitsy (dùng cho liên kết chia sẻ); mặc định trùng máy chủ API. */
export const webBaseUrl = (process.env.EXPO_PUBLIC_WEB_URL?.trim() || configuredApiUrl).replace(/\/$/, '');
// Store builds (Google Play / App Store) must not reach external payment gateways;
// the backend enforces this from the channel header.
const clientChannel = process.env.EXPO_PUBLIC_BILLING_MODE === 'external' ? 'direct' : 'store';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
};

const readTimeoutMs = 30_000;
const writeTimeoutMs = 150_000;

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs: configuredTimeoutMs, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  const isReadRequest = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const timeoutMs = configuredTimeoutMs ?? (isReadRequest ? readTimeoutMs : writeTimeoutMs);
  const isMultipartUpload = requestInit.body instanceof FormData;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (requestInit.signal?.aborted) controller.abort();
  else requestInit.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    const { data } = await getSessionWithTimeout(Math.min(timeoutMs, 10_000));
    const headers = new Headers(requestInit.headers);
    if (data.session?.access_token) {
      headers.set('Authorization', 'Bearer ' + data.session.access_token);
    }
    if (!isReadRequest) headers.set('X-Fitting-Room-Request', '1');
    headers.set('X-Client-Channel', clientChannel);
    const request = () => expoFetch(apiBaseUrl + path, {
      ...requestInit,
      headers,
      signal: controller.signal,
    });
    response = await request();
    if (response.status === 401 && data.session?.refresh_token) {
      const refreshed = await supabase.auth.refreshSession({
        refresh_token: data.session.refresh_token,
      });
      const accessToken = refreshed.data.session?.access_token;
      if (!refreshed.error && accessToken && accessToken !== data.session.access_token) {
        headers.set('Authorization', 'Bearer ' + accessToken);
        response = await request();
      }
    }
  } catch (error) {
    if (__DEV__) console.warn('API request failed:', method, path, error);
    const timedOut = error instanceof AuthSessionTimeoutError
      || (controller.signal.aborted && !requestInit.signal?.aborted);
    throw new ApiError(
      timedOut
        ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại sau ít phút.'
        : isMultipartUpload
        ? 'Không thể tải ảnh lên máy chủ. Vui lòng thử lại với ảnh khác.'
        : 'Kết nối tới máy chủ bị gián đoạn. Vui lòng thử lại.',
      0,
      timedOut ? 'request_timeout' : isMultipartUpload ? 'upload_failed' : 'network_error',
    );
  } finally {
    clearTimeout(timeout);
    requestInit.signal?.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; code?: string };
    throw new ApiError(body.message ?? 'Không thể kết nối máy chủ.', response.status, body.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function protectedImageSource(path: string | null | undefined, accessToken?: string) {
  if (!path) return undefined;
  return {
    uri: path.startsWith('http') ? path : apiBaseUrl + path,
    headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined,
  };
}
