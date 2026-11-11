// @vitest-environment jsdom
/**
 * Integration tests for AuthContext & AuthProvider (apps/customer/src/context/AuthContext.tsx)
 *
 * Verifies:
 * - Cookie-based session restoration on mount (/auth/refresh -> /auth/me)
 * - React 18 StrictMode double-mount safety (single /auth/refresh request)
 * - Graceful unauthenticated fallback on missing/expired refresh cookie (400/401)
 * - OTP request + verify login flow, loading & error states
 * - Proactive automatic access-token refresh before expiry and expired-session handling
 * - Logout clearing in-memory state and cancelling scheduled refresh timers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { UserStatus, UserType, type IAuthUser } from '@thehomez/shared-types';
import { AuthProvider, useAuth } from '../context/AuthContext.js';
import { AuthClient } from '../api/auth-client.js';

const mockUser: IAuthUser = {
  id: 'cust-101',
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

const AuthConsumer: React.FC<{ onReady?: (ctx: ReturnType<typeof useAuth>) => void }> = ({
  onReady,
}) => {
  const auth = useAuth();
  React.useEffect(() => {
    onReady?.(auth);
  }, [auth, onReady]);

  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="initializing">{String(auth.isInitializing)}</span>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="user-phone">{auth.user?.phone ?? 'none'}</span>
      <span data-testid="token">{auth.accessToken ?? 'none'}</span>
      <span data-testid="error">{auth.error ?? 'none'}</span>
      <span data-testid="error-code">{auth.authError?.code ?? 'none'}</span>
    </div>
  );
};

describe('AuthContext & AuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws a clear error when useAuth is called outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      useAuth();
      return null;
    };
    expect(() => render(<Broken />)).toThrow(/useAuth must be used within an AuthProvider/);
    spy.mockRestore();
  });

  it('restores session via HTTP-only refresh cookie on mount and avoids duplicate calls in React StrictMode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'restored-jwt', expiresIn: 900, tokenType: 'Bearer' },
          },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({
          success: true,
          data: { user: mockUser },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(
      <React.StrictMode>
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('initializing')).toHaveTextContent('false');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('+919876543210');
    expect(screen.getByTestId('token')).toHaveTextContent('restored-jwt');
    expect(screen.getByTestId('error')).toHaveTextContent('none');

    const refreshCalls = fetchSpy.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('falls back gracefully to unauthenticated without error when no refresh cookie exists (400 VALIDATION_ERROR)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Refresh token is required in cookie or request body',
            timestamp: '2026-11-11T00:00:00.000Z',
          },
        },
        400,
      ),
    );

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('initializing')).toHaveTextContent('false');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('handles OTP request, invalid OTP error state, successful OTP login, and logout', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1. requestOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { cooldownSeconds: 60, expiresInSeconds: 300, message: 'OTP sent' },
        }),
      )
      // 2. invalid verifyOtp
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid or expired OTP code. Please check the code or request a new OTP',
            },
          },
          400,
        ),
      )
      // 3. valid verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'login-jwt-1', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 4. logout
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Successfully logged out' },
        }),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');

    await act(async () => {
      const otpRes = await latestCtx.requestOtp('9876543210');
      expect(otpRes.cooldownSeconds).toBe(60);
    });

    await act(async () => {
      await expect(latestCtx.verifyOtp('9876543210', '000000')).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
    });

    expect(screen.getByTestId('error')).toHaveTextContent(/Invalid or expired OTP code/);
    expect(screen.getByTestId('error-code')).toHaveTextContent('INVALID_OTP');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');

    await act(async () => {
      const user = await latestCtx.verifyOtp('9876543210', '123456');
      expect(user.id).toBe('cust-101');
    });

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('login-jwt-1');
    expect(screen.getByTestId('error')).toHaveTextContent('none');

    await act(async () => {
      await latestCtx.logout();
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('none');
  });

  it('proactively refreshes access token before expiry and handles expired session on refresh failure', async () => {
    vi.useFakeTimers();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // 1. verifyOtp (short 10s expiry for timer test -> schedules refresh at 7.5s)
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'short-jwt-1', expiresIn: 10, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. First proactive refresh succeeds
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'proactive-jwt-2', expiresIn: 10, tokenType: 'Bearer' },
          },
        }),
      )
      // 3. Second proactive refresh fails (revoked/expired refresh cookie)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'REFRESH_TOKEN_EXPIRED',
              message: 'Refresh token has expired',
            },
          },
          401,
        ),
      );

    let latestCtx!: ReturnType<typeof useAuth>;
    const client = new AuthClient();

    render(
      <AuthProvider client={client} skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    expect(screen.getByTestId('token')).toHaveTextContent('short-jwt-1');

    // Advance 7.5s -> triggers first proactive refresh
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7500);
    });

    expect(screen.getByTestId('token')).toHaveTextContent('proactive-jwt-2');
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');

    // Advance another 7.5s -> triggers second proactive refresh which fails with 401
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7500);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('Your session has expired. Please sign in again.');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('clears session and cancels scheduled refresh timers when logoutAll succeeds', async () => {
    vi.useFakeTimers();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'active-jwt-1', expiresIn: 90, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Logged out from all devices' },
        }),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');

    await act(async () => {
      await latestCtx.logoutAll();
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    // Advancing past the prior 30s refresh delay must NOT trigger a background refresh
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves authenticated session and exposes error state when logoutAll fails with HTTP 500 or 400', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1. verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'active-jwt-1', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. logoutAll fails with 500
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unable to revoke sessions on backend',
            },
          },
          500,
        ),
      )
      // 3. logoutAll fails with 400 (must not be silently swallowed)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid global logout request',
            },
          },
          400,
        ),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    await act(async () => {
      await expect(latestCtx.logoutAll()).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Unable to revoke sessions on backend',
      });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('token')).toHaveTextContent('active-jwt-1');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('+919876543210');
    expect(screen.getByTestId('error')).toHaveTextContent('Unable to revoke sessions on backend');
    expect(screen.getByTestId('error-code')).toHaveTextContent('INTERNAL_ERROR');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    await act(async () => {
      await expect(latestCtx.logoutAll()).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Invalid global logout request',
      });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('active-jwt-1');
    expect(screen.getByTestId('error')).toHaveTextContent('Invalid global logout request');
    expect(screen.getByTestId('error-code')).toHaveTextContent('VALIDATION_ERROR');
  });

  it('does not silently swallow HTTP 401 failures from logoutAll', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1. verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'active-jwt-1', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. /auth/logout-all returns 401
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Access token rejected',
            },
          },
          401,
        ),
      )
      // 3. Single-flight /auth/refresh inside authorizedFetch also returns 401
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'REFRESH_TOKEN_EXPIRED',
              message: 'Refresh token expired',
            },
          },
          401,
        ),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    await act(async () => {
      await expect(latestCtx.logoutAll()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
        message: 'Access token rejected',
      });
    });

    // Token was invalidated by failed refresh, so local auth clears, while error remains visible
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('Access token rejected');
    expect(screen.getByTestId('error-code')).toHaveTextContent('UNAUTHORIZED');
  });

  it('preserves authenticated session on logoutAll network failure and allows retry to succeed', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1. verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'active-jwt-1', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. logoutAll network error
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // 3. Retry logoutAll succeeds
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Logged out from all devices' },
        }),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    await act(async () => {
      await expect(latestCtx.logoutAll()).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        status: 0,
      });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('token')).toHaveTextContent('active-jwt-1');
    expect(screen.getByTestId('error-code')).toHaveTextContent('NETWORK_ERROR');
    expect(screen.getByTestId('error')).toHaveTextContent(/Other devices may still be signed in/i);

    // Retry succeeds cleanly using preserved session
    await act(async () => {
      await latestCtx.logoutAll();
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('preserves refreshed session and surfaces 401 when retried /auth/logout-all still fails with 401', async () => {
    vi.spyOn(globalThis, 'fetch')
      // 1. verifyOtp
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'stale-jwt-1', expiresIn: 900, tokenType: 'Bearer' },
            user: mockUser,
          },
        }),
      )
      // 2. /auth/logout-all returns 401
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, error: { code: 'UNAUTHORIZED', message: 'Stale token' } },
          401,
        ),
      )
      // 3. Single-flight /auth/refresh succeeds
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'fresh-jwt-2', expiresIn: 900, tokenType: 'Bearer' },
          },
        }),
      )
      // 4. Retried /auth/logout-all still returns 401
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'GLOBAL_LOGOUT_DENIED',
              message: 'Global logout rejected by server',
            },
          },
          401,
        ),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    await act(async () => {
      await latestCtx.verifyOtp('9876543210', '123456');
    });

    await act(async () => {
      await expect(latestCtx.logoutAll()).rejects.toMatchObject({
        code: 'GLOBAL_LOGOUT_DENIED',
        status: 401,
        message: 'Global logout rejected by server',
      });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('token')).toHaveTextContent('fresh-jwt-2');
    expect(screen.getByTestId('error')).toHaveTextContent('Global logout rejected by server');
    expect(screen.getByTestId('error-code')).toHaveTextContent('GLOBAL_LOGOUT_DENIED');
  });

  it('ISSUE-5A2-02: clears stale authError on closeAuthModal when idle without clearing errors during active requests', async () => {
    let rejectPendingVerify!: (reason?: unknown) => void;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // 1. Initial failed verifyOtp (produces stale modal error)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid or expired OTP code. Please check the code or request a new OTP',
            },
          },
          400,
        ),
      )
      // 2. Second request stays pending while closeAuthModal is invoked mid-flight
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_, reject) => {
            rejectPendingVerify = reject;
          }),
      );

    let latestCtx!: ReturnType<typeof useAuth>;

    render(
      <AuthProvider skipInitialRestore>
        <AuthConsumer
          onReady={(ctx) => {
            latestCtx = ctx;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      latestCtx.openAuthModal();
    });
    expect(latestCtx.isAuthModalOpen).toBe(true);

    await act(async () => {
      await expect(latestCtx.verifyOtp('9876543210', '000000')).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
    });

    expect(screen.getByTestId('error-code')).toHaveTextContent('INVALID_OTP');
    expect(screen.getByTestId('error')).toHaveTextContent(/Invalid or expired OTP code/);

    // Idle modal close must clear the stale login error
    act(() => {
      latestCtx.closeAuthModal();
    });

    expect(latestCtx.isAuthModalOpen).toBe(false);
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('error-code')).toHaveTextContent('none');

    // Now start an active request while modal is open and close modal mid-flight
    act(() => {
      latestCtx.openAuthModal();
    });

    let pendingPromise!: Promise<unknown>;
    act(() => {
      pendingPromise = latestCtx.requestOtp('9876543210').catch((err) => err);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Closing modal during active request must not prevent/clear the active request's error
    act(() => {
      latestCtx.closeAuthModal();
    });
    expect(latestCtx.isAuthModalOpen).toBe(false);

    await act(async () => {
      rejectPendingVerify(new TypeError('Failed to fetch'));
      await pendingPromise;
    });

    expect(screen.getByTestId('error-code')).toHaveTextContent('NETWORK_ERROR');
    expect(screen.getByTestId('error')).toHaveTextContent(/Unable to connect/i);
  });
});
