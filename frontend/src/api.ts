export const API = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, credentials: 'include' })
}
