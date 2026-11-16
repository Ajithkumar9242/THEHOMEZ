import type {
  IApiErrorResponse,
  IApiResponse,
  IAuthResponse,
  IAuthUser,
  ILogoutResponse,
  IRefreshTokenResponse,
} from '@thehomez/shared-types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshTask: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(handler?: () => void): void {
  onUnauthorized = handler;
}

export function clearAccessToken(): void {
  accessToken = null;
}

function headers(json = false, token = accessToken): Headers {
  const result = new Headers({
    Accept: 'application/json',
    'X-Auth-Transport': 'cookie',
    'X-Client-Type': 'browser',
  });
  if (json) result.set('Content-Type', 'application/json');
  if (token) result.set('Authorization', `Bearer ${token}`);
  return result;
}

async function request<T>(path: string, init: RequestInit = {}, token = accessToken): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: headers(init.body !== undefined, token),
    });
  } catch {
    if (init.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    throw new ApiError(
      'Unable to reach the API. Check that the backend is running.',
      0,
      'NETWORK_ERROR',
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const detail = payload as IApiErrorResponse | null;
    const error = new ApiError(
      detail?.error?.message || `Request failed (${response.status}).`,
      response.status,
      detail?.error?.code || `HTTP_${response.status}`,
    );
    if (response.status === 401) onUnauthorized?.();
    throw error;
  }

  const envelope = payload as IApiResponse<T> | null;
  if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
    return envelope.data;
  }
  return payload as T;
}

export const authApi = {
  async loginWithPassword(email: string, password: string): Promise<IAuthUser> {
    const response = await request<IAuthResponse>(
      '/auth/admin/password',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      null,
    );
    if (!response?.tokens?.accessToken)
      throw new ApiError('Invalid authentication response.', 500, 'INVALID_AUTH_RESPONSE');
    accessToken = response.tokens.accessToken;
    return response.user;
  },
  async refresh(): Promise<string | null> {
    if (refreshTask) return refreshTask;
    refreshTask = request<IRefreshTokenResponse>(
      '/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      null,
    )
      .then((data) => {
        accessToken = data?.tokens?.accessToken || null;
        return accessToken;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        refreshTask = null;
      });
    return refreshTask;
  },
  async me(): Promise<IAuthUser> {
    const user = await request<{ user: IAuthUser }>('/auth/me');
    return user.user;
  },
  async logout(): Promise<ILogoutResponse> {
    const token = accessToken;
    accessToken = null;
    const init = {
      method: 'POST',
      body: JSON.stringify({}),
    } as const;
    try {
      return await request('/auth/logout', init, token);
    } catch (error) {
      // The backend logout route permits cookie revocation without a valid bearer token.
      // Match the established Customer client behavior for an expired access token.
      if (error instanceof ApiError && error.status === 401 && token)
        return request('/auth/logout', init, null);
      throw error;
    }
  },
};

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const execute = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: headers(init.body !== undefined, token),
    });
  let response: Response;
  try {
    response = await execute(accessToken);
  } catch {
    if (init.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    throw new ApiError(
      'Unable to reach the API. Check that the backend is running.',
      0,
      'NETWORK_ERROR',
    );
  }
  if (response.status === 401 && accessToken) {
    const refreshed = await authApi.refresh();
    if (refreshed) {
      try {
        response = await execute(refreshed);
      } catch {
        if (init.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        throw new ApiError(
          'Unable to reach the API. Check that the backend is running.',
          0,
          'NETWORK_ERROR',
        );
      }
    }
  }
  if (response.status === 401) onUnauthorized?.();
  return response;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const contentType = response.headers.get('content-type') || '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const detail = payload as IApiErrorResponse | null;
    throw new ApiError(
      detail?.error?.message || `Request failed (${response.status}).`,
      response.status,
      detail?.error?.code || `HTTP_${response.status}`,
    );
  }
  const envelope = payload as IApiResponse<T> | null;
  if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success)
    return envelope.data;
  return payload as T;
}
