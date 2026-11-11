/**
 * TheHomez Customer Authentication API Client
 *
 * Interacts directly with backend Milestone 5A.1 authentication endpoints:
 * - POST /api/v1/auth/otp/request
 * - POST /api/v1/auth/otp/verify
 * - POST /api/v1/auth/refresh
 * - POST /api/v1/auth/logout
 * - POST /api/v1/auth/logout-all
 * - GET  /api/v1/auth/me
 *
 * Security invariants:
 * - Uses `credentials: 'include'` so HTTP-only refresh cookies (`thz_refresh_token`)
 *   are stored and transmitted strictly by the browser.
 * - Sends explicit browser transport headers (`X-Auth-Transport: cookie`,
 *   `X-Client-Type: browser`) so the backend suppresses refreshToken from JSON bodies
 *   and satisfies CSRF validation alongside same-origin / CORS allowlist headers.
 * - Holds short-lived JWT access tokens strictly in memory (never localStorage/sessionStorage).
 * - Deduplicates concurrent refresh calls via single-flight promise sharing to prevent
 *   triggering backend refresh-token reuse detection.
 */

import {
  UserType,
  type IApiErrorResponse,
  type IApiResponse,
  type IAuthResponse,
  type IAuthTokens,
  type IAuthUser,
  type ILogoutResponse,
  type IOtpRequestResponse,
  type IRefreshTokenResponse,
  type IUserProfileResponse,
} from '@thehomez/shared-types';
import type {
  IAccessTokenSession,
  IAuthError,
  IVerifyOtpResult,
} from '../types/auth.js';

const DEFAULT_TOKEN_BUFFER_MS = 15_000;

function extractNumericDetail(details: unknown, key: string): number | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class AuthApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly cooldownRemainingSeconds?: number;
  public readonly lockoutRemainingSeconds?: number;

  constructor(
    message: string,
    code = 'AUTH_API_ERROR',
    status = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.cooldownRemainingSeconds = extractNumericDetail(details, 'cooldownRemainingSeconds');
    this.lockoutRemainingSeconds = extractNumericDetail(details, 'lockoutRemainingSeconds');
  }

  public toAuthError(): IAuthError {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.cooldownRemainingSeconds !== undefined
        ? { cooldownRemainingSeconds: this.cooldownRemainingSeconds }
        : {}),
      ...(this.lockoutRemainingSeconds !== undefined
        ? { lockoutRemainingSeconds: this.lockoutRemainingSeconds }
        : {}),
    };
  }
}

export interface AuthClientOptions {
  baseUrl?: string;
  onAccessTokenChange?: (token: string | null, expiresAtMs: number | null) => void;
  onSessionExpired?: (error: AuthApiError) => void;
}

function toBrowserTokenSession(tokens: IAuthTokens): IAccessTokenSession {
  return {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    tokenType: tokens.tokenType,
  };
}

function buildBrowserHeaders(extraHeaders?: HeadersInit, includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Auth-Transport': 'cookie',
    'X-Client-Type': 'browser',
  };

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (extraHeaders) {
    if (extraHeaders instanceof Headers) {
      extraHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extraHeaders)) {
      for (const [key, value] of extraHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, extraHeaders);
    }
  }

  return headers;
}

export class AuthClient {
  private readonly baseUrl: string;
  private onAccessTokenChange?: (token: string | null, expiresAtMs: number | null) => void;
  private onSessionExpired?: (error: AuthApiError) => void;

  private accessToken: string | null = null;
  private tokenExpiresAtMs: number | null = null;
  private refreshInFlight: Promise<IAccessTokenSession> | null = null;
  private sessionEpoch = 0;

  constructor(options: AuthClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/+$/, '');
    this.onAccessTokenChange = options.onAccessTokenChange;
    this.onSessionExpired = options.onSessionExpired;
  }

  /**
   * Registers or updates lifecycle callbacks (used by AuthProvider).
   */
  public setCallbacks(callbacks: {
    onAccessTokenChange?: (token: string | null, expiresAtMs: number | null) => void;
    onSessionExpired?: (error: AuthApiError) => void;
  }): void {
    this.onAccessTokenChange = callbacks.onAccessTokenChange;
    this.onSessionExpired = callbacks.onSessionExpired;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getTokenExpiresAt(): number | null {
    return this.tokenExpiresAtMs;
  }

  /**
   * Returns true if no access token is held in memory or if it is within `bufferMs` of expiry.
   */
  public isAccessTokenExpiringSoon(bufferMs = DEFAULT_TOKEN_BUFFER_MS): boolean {
    if (!this.accessToken) {
      return true;
    }
    if (this.tokenExpiresAtMs === null) {
      return false;
    }
    return Date.now() >= this.tokenExpiresAtMs - bufferMs;
  }

  /**
   * Clears in-memory access token state without making a network request.
   */
  public clearSession(): void {
    this.sessionEpoch += 1;
    this.clearInMemoryToken();
  }

  private setInMemoryToken(token: string, expiresInSeconds: number): void {
    const safeExpiresIn =
      typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds
        : 900;
    this.accessToken = token;
    this.tokenExpiresAtMs = Date.now() + safeExpiresIn * 1000;
    this.onAccessTokenChange?.(this.accessToken, this.tokenExpiresAtMs);
  }

  private clearInMemoryToken(): void {
    const hadToken = this.accessToken !== null || this.tokenExpiresAtMs !== null;
    this.accessToken = null;
    this.tokenExpiresAtMs = null;
    if (hadToken) {
      this.onAccessTokenChange?.(null, null);
    }
  }

  private resolveUrl(endpointOrUrl: string): string {
    if (/^https?:\/\//i.test(endpointOrUrl)) {
      return endpointOrUrl;
    }
    if (endpointOrUrl.startsWith(`${this.baseUrl}/`) || endpointOrUrl === this.baseUrl) {
      return endpointOrUrl;
    }
    const normalizedPath = endpointOrUrl.startsWith('/') ? endpointOrUrl : `/${endpointOrUrl}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  private async executeJsonRequest<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      accessToken?: string | null;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const url = this.resolveUrl(endpoint);
    const hasBody = options.body !== undefined;
    const headers = buildBrowserHeaders(options.headers, hasBody);

    if (options.accessToken) {
      headers['Authorization'] = `Bearer ${options.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        credentials: 'include',
        headers,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (networkError) {
      throw new AuthApiError(
        'Unable to connect to TheHomez authentication service. Please check your network connection.',
        'NETWORK_ERROR',
        0,
        networkError,
      );
    }

    const contentType = response.headers?.get?.('content-type') || '';
    let payload: unknown = null;

    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const errorPayload = payload as IApiErrorResponse | null;
      const errorCode = errorPayload?.error?.code || `HTTP_${response.status}`;
      const errorMessage =
        errorPayload?.error?.message ||
        `Authentication request to ${endpoint} failed with HTTP status ${response.status}`;
      throw new AuthApiError(
        errorMessage,
        errorCode,
        response.status,
        errorPayload?.error?.details,
      );
    }

    const envelope = payload as IApiResponse<T> | null;
    if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
      return envelope.data;
    }

    return payload as T;
  }

  /**
   * Requests a 6-digit OTP challenge for a customer phone number.
   * POST /api/v1/auth/otp/request
   */
  public async requestOtp(
    phone: string,
    userType: UserType = UserType.CUSTOMER,
  ): Promise<IOtpRequestResponse> {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      throw new AuthApiError('Phone number is required', 'VALIDATION_ERROR', 400);
    }

    return this.executeJsonRequest<IOtpRequestResponse>('/auth/otp/request', {
      method: 'POST',
      body: {
        phone: trimmedPhone,
        userType,
      },
    });
  }

  /**
   * Verifies a 6-digit OTP challenge, establishes the HTTP-only refresh cookie,
   * stores the JWT access token strictly in memory, and returns the browser-safe session.
   * POST /api/v1/auth/otp/verify
   */
  public async verifyOtp(
    phone: string,
    otp: string,
    userType: UserType = UserType.CUSTOMER,
  ): Promise<IVerifyOtpResult> {
    const trimmedPhone = phone.trim();
    const trimmedOtp = otp.trim();
    if (!trimmedPhone || !trimmedOtp) {
      throw new AuthApiError('Phone number and 6-digit OTP are required', 'VALIDATION_ERROR', 400);
    }

    const data = await this.executeJsonRequest<IAuthResponse>('/auth/otp/verify', {
      method: 'POST',
      body: {
        phone: trimmedPhone,
        otp: trimmedOtp,
        userType,
      },
    });

    if (!data?.tokens?.accessToken || !data?.user) {
      throw new AuthApiError(
        'Invalid authentication response received from server',
        'INVALID_AUTH_RESPONSE',
        500,
      );
    }

    const sessionTokens = toBrowserTokenSession(data.tokens);
    this.sessionEpoch += 1;
    this.setInMemoryToken(sessionTokens.accessToken, sessionTokens.expiresIn);

    return {
      tokens: sessionTokens,
      user: data.user,
    };
  }

  /**
   * Rotates the session via the HTTP-only `thz_refresh_token` cookie.
   * POST /api/v1/auth/refresh
   *
   * Deduplicates concurrent calls so parallel 401s or React StrictMode double-mounts
   * trigger at most one network request and never cause refresh-token reuse detection.
   */
  public async refreshSession(): Promise<IAccessTokenSession> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const epochAtStart = this.sessionEpoch;

    const refreshTask = (async (): Promise<IAccessTokenSession> => {
      try {
        const data = await this.executeJsonRequest<IRefreshTokenResponse>('/auth/refresh', {
          method: 'POST',
          body: {},
        });

        if (!data?.tokens?.accessToken) {
          throw new AuthApiError(
            'Invalid token refresh response received from server',
            'INVALID_REFRESH_RESPONSE',
            500,
          );
        }

        // Guard against a logout or new sign-in that happened while refresh was in flight
        if (this.sessionEpoch !== epochAtStart) {
          throw new AuthApiError(
            'Session changed while token refresh was in progress',
            'SESSION_TERMINATED',
            401,
          );
        }

        const sessionTokens = toBrowserTokenSession(data.tokens);
        this.setInMemoryToken(sessionTokens.accessToken, sessionTokens.expiresIn);
        return sessionTokens;
      } catch (err) {
        const authError =
          err instanceof AuthApiError
            ? err
            : new AuthApiError(
                err instanceof Error ? err.message : 'Session refresh failed',
                'REFRESH_FAILED',
                401,
              );

        if (this.sessionEpoch === epochAtStart) {
          this.clearInMemoryToken();
          if (
            authError.status === 400 ||
            authError.status === 401 ||
            authError.status === 403 ||
            authError.status === 409
          ) {
            this.onSessionExpired?.(authError);
          }
        }

        throw authError;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    this.refreshInFlight = refreshTask;
    return refreshTask;
  }

  /**
   * Retrieves the authenticated customer profile and fresh RBAC permissions.
   * GET /api/v1/auth/me
   */
  public async getMe(accessTokenOverride?: string): Promise<IAuthUser> {
    const token = accessTokenOverride ?? this.accessToken;
    if (!token) {
      throw new AuthApiError('Authentication token is required', 'UNAUTHORIZED', 401);
    }

    const data = await this.executeJsonRequest<IUserProfileResponse>('/auth/me', {
      method: 'GET',
      accessToken: token,
    });

    if (!data?.user) {
      throw new AuthApiError('User profile not found in response', 'USER_NOT_FOUND', 404);
    }

    return data.user;
  }

  /**
   * Returns a valid in-memory access token if an active session exists,
   * proactively refreshing if the current token is expired or within `bufferMs` of expiry.
   * Returns null for unauthenticated visitors without firing unnecessary /refresh calls.
   */
  public async getValidAccessToken(bufferMs = DEFAULT_TOKEN_BUFFER_MS): Promise<string | null> {
    if (this.accessToken && !this.isAccessTokenExpiringSoon(bufferMs)) {
      return this.accessToken;
    }

    if (this.refreshInFlight) {
      try {
        const refreshed = await this.refreshInFlight;
        return refreshed.accessToken;
      } catch {
        return null;
      }
    }

    if (this.accessToken) {
      try {
        const refreshed = await this.refreshSession();
        return refreshed.accessToken;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Fetch wrapper that attaches the in-memory Bearer access token, sets `credentials: 'include'`,
   * and transparently refreshes + retries once on HTTP 401 using single-flight refresh.
   */
  public async authorizedFetch(endpointOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = this.resolveUrl(endpointOrUrl);
    const epochAtStart = this.sessionEpoch;
    const hadSessionBeforeRequest = Boolean(this.accessToken || this.refreshInFlight);
    const resolvedToken = await this.getValidAccessToken();
    const initialToken =
      this.sessionEpoch === epochAtStart && this.accessToken ? resolvedToken : null;

    const executeFetch = (token: string | null): Promise<Response> => {
      const headers = buildBrowserHeaders(init.headers, false);
      // Remove any pre-existing Authorization header (case-insensitive) so a stale
      // caller-supplied token can never survive after session clearance or logout.
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'authorization') {
          delete headers[key];
        }
      }
      if (token && this.sessionEpoch === epochAtStart && this.accessToken) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return fetch(url, {
        ...init,
        credentials: init.credentials ?? 'include',
        headers,
      });
    };

    const response = await executeFetch(initialToken);

    if (response.status !== 401 || !hadSessionBeforeRequest || this.sessionEpoch !== epochAtStart) {
      return response;
    }

    // Attempt single-flight refresh and retry once with the fresh access token
    try {
      const refreshed = await this.refreshSession();
      if (this.sessionEpoch !== epochAtStart || !this.accessToken) {
        return response;
      }
      return await executeFetch(refreshed.accessToken);
    } catch {
      return response;
    }
  }

  /**
   * Revokes the active refresh session on the backend and clears in-memory credentials.
   * POST /api/v1/auth/logout
   */
  public async logout(): Promise<ILogoutResponse> {
    const candidateToken =
      this.accessToken && !this.isAccessTokenExpiringSoon(0) ? this.accessToken : null;

    this.sessionEpoch += 1;
    this.clearInMemoryToken();

    try {
      return await this.executeJsonRequest<ILogoutResponse>('/auth/logout', {
        method: 'POST',
        body: {},
        accessToken: candidateToken,
      });
    } catch (err) {
      // If an attached Bearer token was rejected as expired due to clock skew,
      // retry once without Authorization so optionalAuthenticate still lets the
      // controller revoke and clear the HTTP-only refresh cookie.
      if (err instanceof AuthApiError && err.status === 401 && candidateToken) {
        return this.executeJsonRequest<ILogoutResponse>('/auth/logout', {
          method: 'POST',
          body: {},
        });
      }
      throw err;
    }
  }

  /**
   * Revokes all active sessions for the authenticated customer across devices.
   * POST /api/v1/auth/logout-all
   */
  public async logoutAll(): Promise<ILogoutResponse> {
    const token = await this.getValidAccessToken();
    if (!token) {
      this.clearSession();
      throw new AuthApiError('Authentication token is required', 'UNAUTHORIZED', 401);
    }

    const response = await this.authorizedFetch('/auth/logout-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const contentType = response.headers?.get?.('content-type') || '';
    let payload: unknown = null;
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const errorPayload = payload as IApiErrorResponse | null;
      throw new AuthApiError(
        errorPayload?.error?.message || `Global logout failed with HTTP status ${response.status}`,
        errorPayload?.error?.code || `HTTP_${response.status}`,
        response.status,
        errorPayload?.error?.details,
      );
    }

    this.sessionEpoch += 1;
    this.clearInMemoryToken();

    const envelope = payload as IApiResponse<ILogoutResponse> | null;
    if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
      return envelope.data;
    }

    return (payload as ILogoutResponse) ?? { message: 'Successfully logged out from all devices' };
  }
}
