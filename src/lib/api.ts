/**
 * Central API client.
 *
 * The frontend must never assume the backend shares its origin. On Vercel the
 * app is served from *.vercel.app while the API/WebSocket server runs on
 * Render, so both base URLs come from build-time environment variables:
 *
 *   VITE_API_URL  e.g. https://bhabhi-api.onrender.com
 *   VITE_WS_URL   e.g. https://bhabhi-api.onrender.com
 *
 * When unset (unified single-server deployment or local dev) we fall back to
 * the current origin, which preserves the existing behaviour.
 */

const rawApiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
const rawWsUrl = (import.meta as any).env?.VITE_WS_URL as string | undefined;

function normalise(url?: string): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

export const API_BASE_URL = normalise(rawApiUrl);

export const WS_URL =
  normalise(rawWsUrl) ||
  API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

/** Builds an absolute API URL from a root-relative path such as "/api/friends". */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

const TOKEN_KEY = 'bhabhi_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Attach the stored bearer token. Defaults to true. */
  auth?: boolean;
  /** Explicit token, overriding the stored one. */
  token?: string | null;
}

/**
 * Thin fetch wrapper that resolves the correct base URL, attaches the bearer
 * token, and returns parsed JSON along with the response status.
 */
export async function apiFetch<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const { body, auth = true, token, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };

  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const bearer = token !== undefined ? token : auth ? getStoredToken() : null;
  if (bearer) {
    finalHeaders.Authorization = `Bearer ${bearer}`;
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'Could not reach the server. Please check your connection.' } as T,
    };
  }

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'Unexpected server response.' };
    }
  }

  return { ok: res.ok, status: res.status, data: (data ?? {}) as T };
}
