export const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('X-Fitting-Room-Request', '1')
  return fetch(input, { ...init, headers })
}
