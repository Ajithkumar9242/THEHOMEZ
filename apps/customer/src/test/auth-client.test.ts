// @vitest-environment jsdom
/**
 * Unit tests for AuthClient (apps/customer/src/api/auth-client.ts)
 *
 * Verifies:
 * - HTTP-only cookie transport (`credentials: 'include'`) and browser CSRF headers
 * - In-memory access token storage with zero localStorage/sessionStorage persistence
 * - Refresh token exclusion from returned objects
 * - Single-flight deduplication of concurrent refreshSession() and 401 retries
 * - Structured error parsing (cooldownRemainingSeconds, lockoutRemainingSeconds)
 * - Logout and logoutAll token clearance & stale-Bearer fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserStatus, UserType, type IAuthUser } from '@thehomez/shared-types';
import { AuthApiError, AuthClient } from '../api/auth-client.js';

const mockUser: IAuthUser = {
  id: 'cust-123',
  phone: '+919876543210',
  userType: UserType.CUSTOMER,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [],
  createdAt: '2026-11-11T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response;
}

describe('AuthClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests OTP with browser transport headers and parses 429 cooldown/lockout metadata', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            cooldownSeconds: 60,
            expiresInSeconds: 300,
            message: 'OTP challenge dispatched successfully',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'COOLDOWN_ACTIVE',
              message: 'Please wait 42 seconds before requesting a new OTP',
              details: { cooldownRemainingSeconds: 42 },
              timestamp: '2026-11-11T00:00:00.000Z',
            },
          },
          429,
        ),
      );

    const client = new AuthClient();
    const res = await client.requestOtp(' 9876543210 ');

    expect(res).toEqual({
      cooldownSeconds: 60,
      expiresInSeconds: 300,
      message: 'OTP challenge dispatched successfully',
    });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/otp/request');
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ phone: '9876543210', userType: 'CUSTOMER' }));
    expect((init?.headers as Record<string, string>)['X-Auth-Transport']).toBe('cookie');
    expect((init?.headers as Record<string, string>)['X-Client-Type']).toBe('browser');

    try {
      await client.requestOtp('9876543210');
      expect.fail('Expected COOLDOWN_ACTIVE error');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthApiError);
      const authErr = err as AuthApiError;
      expect(authErr.code).toBe('COOLDOWN_ACTIVE');
      expect(authErr.status).toBe(429);
      expect(authErr.cooldownRemainingSeconds).toBe(42);
    }
  });

  it('verifies OTP, stores accessToken in memory only, strips any refreshToken, and never touches web storage', async () => {
    const localSetSpy = vi.spyOn(Storage.prototype, 'setItem');
    const sessionSetSpy = vi.spyOn(window.sessionStorage, 'setItem');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          tokens: {
            accessToken: 'jwt-access-1',
            refreshToken: 'should-be-stripped-if-ever-present',
            expiresIn: 900,
            tokenType: 'Bearer',
          },
          user: mockUser,
        },
      }),
    );

    const client = new AuthClient();
    const result = await client.verifyOtp('9876543210', '123456');

    expect(result.user.id).toBe('cust-123');
    expect(result.tokens).toEqual({
      accessToken: 'jwt-access-1',
      expiresIn: 900,
      tokenType: 'Bearer',
    });
    expect('refreshToken' in result.tokens).toBe(false);
    expect(client.getAccessToken()).toBe('jwt-access-1');
    expect(localSetSpy).not.toHaveBeenCalled();
    expect(sessionSetSpy).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent refreshSession calls into a single POST /api/v1/auth/refresh request', async () => {
    let resolveRefresh!: (res: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pendingFetch);

    const client = new AuthClient();
    const p1 = client.refreshSession();
    const p2 = client.refreshSession();
    const p3 = client.refreshSession();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/refresh');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBe('{}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init?.headers as Record<string, string>)['X-Auth-Transport']).toBe('cookie');

    resolveRefresh(
      jsonResponse({
        success: true,
        data: {
          tokens: {
            accessToken: 'rotated-jwt-2',
            expiresIn: 900,
            tokenType: 'Bearer',
          },
        },
      }),
    );

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.accessToken).toBe('rotated-jwt-2');
    expect(r2.accessToken).toBe('rotated-jwt-2');
    expect(r3.accessToken).toBe('rotated-jwt-2');
    expect(client.getAccessToken()).toBe('rotated-jwt-2');
  });

  it('clears in-memory token and fires onSessionExpired when refresh fails', async () => {
    const onSessionExpired = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'initial-jwt', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'REFRESH_TOKEN_EXPIRED',
              message: 'Refresh token has expired',
              timestamp: '2026-11-11T00:00:00.000Z',
            },
          },
          401,
        ),
      );

    const client = new AuthClient({ onSessionExpired });
    await client.verifyOtp('9876543210', '123456');
    expect(client.getAccessToken()).toBe('initial-jwt');

    await expect(client.refreshSession()).rejects.toThrow(/Refresh token has expired/);
    expect(client.getAccessToken()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('retries parallel 401 authorizedFetch requests once after a single-flight refresh', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // 1. verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'old-jwt', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2 & 3. Two parallel protected requests get 401
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired' } }, 401))
      // 4. Single shared refresh call
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'fresh-jwt', expiresIn: 900, tokenType: 'Bearer' },
          },
        }),
      )
      // 5 & 6. Retried protected requests succeed with fresh-jwt
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { ok: 1 } }, 200))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { ok: 2 } }, 200));

    const client = new AuthClient();
    await client.verifyOtp('9876543210', '123456');

    const [res1, res2] = await Promise.all([
      client.authorizedFetch('/cart'),
      client.authorizedFetch('/customer/addresses'),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const refreshCalls = fetchSpy.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(1);

    const retryAuthHeaders = fetchSpy.mock.calls
      .slice(4)
      .map(([, init]) => (init?.headers as Record<string, string>)['Authorization']);
    expect(retryAuthHeaders).toEqual(['Bearer fresh-jwt', 'Bearer fresh-jwt']);
  });

  it('retries logout without Authorization if a stale Bearer token yields 401 so cookie is still cleared', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'stale-jwt', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired' } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { message: 'Successfully logged out' } }, 200),
      );

    const client = new AuthClient();
    await client.verifyOtp('9876543210', '123456');

    const res = await client.logout();
    expect(res.message).toBe('Successfully logged out');
    expect(client.getAccessToken()).toBeNull();

    const logoutCalls = fetchSpy.mock.calls.filter(([url]) => url === '/api/v1/auth/logout');
    expect(logoutCalls).toHaveLength(2);
    expect((logoutCalls[0]![1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer stale-jwt');
    expect((logoutCalls[1]![1]?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('strips stale caller Authorization headers when access token is cleared (ISSUE-5A2-04)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { items: [] } }, 200));

    const client = new AuthClient();
    expect(client.getAccessToken()).toBeNull();

    await client.authorizedFetch('/storefront/products', {
      headers: {
        Authorization: 'Bearer stale-upper-jwt',
        authorization: 'Bearer stale-lower-jwt',
      },
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    const sentHeaders = init?.headers as Record<string, string>;
    expect(sentHeaders['Authorization']).toBeUndefined();
    expect(sentHeaders['authorization']).toBeUndefined();
  });

  it('never sends a stale Authorization header when session is cleared while refresh is in flight (ISSUE-5A2-04)', async () => {
    let resolveRefresh!: (res: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // 1. verifyOtp establishes short-lived (5s -> expiring soon) session
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'expiring-jwt', expiresIn: 5, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. Proactive refresh in getValidAccessToken() stays pending
      .mockReturnValueOnce(pendingRefresh)
      // 3. Downstream fetch after clearSession()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { items: [] } }, 200));

    const client = new AuthClient();
    await client.verifyOtp('9876543210', '123456');

    const requestPromise = client.authorizedFetch('/storefront/products', {
      headers: { Authorization: 'Bearer expiring-jwt' },
    });

    // Simulate logout/session clearance occurring before refresh resolves
    client.clearSession();
    resolveRefresh(
      jsonResponse({
        success: true,
        data: { tokens: { accessToken: 'post-logout-zombie-jwt', expiresIn: 900, tokenType: 'Bearer' } },
      }),
    );

    const res = await requestPromise;
    expect(res.status).toBe(200);

    const productCall = fetchSpy.mock.calls.find(([u]) => u === '/api/v1/storefront/products')!;
    const sentHeaders = productCall[1]?.headers as Record<string, string>;
    expect(sentHeaders['Authorization']).toBeUndefined();
    expect(sentHeaders['authorization']).toBeUndefined();
    expect(client.getAccessToken()).toBeNull();
  });
});
