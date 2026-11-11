// @vitest-environment jsdom
/**
 * Customer Authentication Integration & Protected Route Tests (Milestone 5A.2 — Chat C)
 *
 * Verifies end-to-end frontend integration across:
 * - App.tsx + AuthProvider + StorefrontProvider + Header + CustomerAuthModal + CustomerLoginView
 * - ProtectedRoute (/account) guard, session restoration on refresh, and post-login route restoration
 * - Redirect sanitization & anti-loop protection
 * - Public storefront discovery remaining unblocked for guest visitors
 * - Simultaneous API 401 single-flight refresh deduplication via StorefrontClient + AuthClient
 * - Logout & error-safe session cleanup
 * - Zero browser web-storage persistence of refresh/access tokens
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserStatus, UserType, type IAuthUser } from '@thehomez/shared-types';
import { App } from '../App.js';
import { AuthClient } from '../api/auth-client.js';
import {
  buildLoginRedirectUrl,
  getRedirectTargetFromSearch,
  sanitizeRedirectPath,
} from '../routing/redirect-utils.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function makeCustomerUser(overrides: Partial<IAuthUser> = {}): IAuthUser {
  return {
    id: 'cust-int-001',
    phone: '+919876543210',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: [],
    permissions: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    lastLoginAt: '2026-11-11T09:00:00.000Z',
    ...overrides,
  };
}

function mockPublicStorefrontUrl(url: string): Response | null {
  if (url.startsWith('/api/v1/categories')) {
    return jsonResponse({ success: true, data: { categories: [] } });
  }
  if (url.startsWith('/api/v1/storefront/products')) {
    return jsonResponse({
      success: true,
      data: {
        items: [],
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
        facets: { brands: [] },
      },
    });
  }
  return null;
}

describe('Customer Authentication Integration (Milestone 5A.2 — Chat C)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  describe('Redirect sanitization & anti-loop helpers', () => {
    it('allows valid internal paths and rejects external or /login loop targets', () => {
      expect(sanitizeRedirectPath('/account')).toBe('/account');
      expect(sanitizeRedirectPath('/products?category=steel')).toBe('/products?category=steel');
      expect(sanitizeRedirectPath('/login')).toBe('/');
      expect(sanitizeRedirectPath('/login?redirect=/account')).toBe('/');
      expect(sanitizeRedirectPath('//evil.example.com')).toBe('/');
      expect(sanitizeRedirectPath('https://evil.example.com/phish')).toBe('/');
      expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/');
      expect(getRedirectTargetFromSearch('?redirect=%2Faccount')).toBe('/account');
      expect(buildLoginRedirectUrl('/account')).toBe('/login?redirect=%2Faccount');
      expect(buildLoginRedirectUrl('/login')).toBe('/login');
    });
  });

  describe('Modal OTP login & guest storefront preservation', () => {
    it('keeps public storefront accessible for guests and completes modal OTP login + logout', async () => {
      const user = makeCustomerUser();
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

        if (url === '/api/v1/auth/refresh') {
          return jsonResponse(
            {
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'Refresh token cookie is required' },
            },
            400,
          );
        }
        if (url === '/api/v1/auth/otp/request') {
          return jsonResponse({
            success: true,
            data: { cooldownSeconds: 60, expiresInSeconds: 300, message: 'OTP sent' },
          });
        }
        if (url === '/api/v1/auth/otp/verify') {
          return jsonResponse({
            success: true,
            data: {
              tokens: {
                accessToken: 'in-memory-access-jwt',
                expiresIn: 900,
                tokenType: 'Bearer',
              },
              user,
            },
          });
        }
        if (url === '/api/v1/auth/logout') {
          return jsonResponse({
            success: true,
            data: { message: 'Logged out successfully' },
          });
        }
        const publicRes = mockPublicStorefrontUrl(url);
        if (publicRes) return publicRes;
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      render(<App />);

      // Public homepage renders immediately without blocking product discovery
      expect(await screen.findByRole('button', { name: /Sign in with phone OTP/i })).toBeInTheDocument();
      expect(screen.getByText(/Commercial Wholesale Rates/i)).toBeInTheDocument();

      // Open login modal from header
      fireEvent.click(screen.getByRole('button', { name: /Sign in with phone OTP/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Step 1: Enter 10-digit Indian mobile number & request OTP
      const phoneInput = screen.getByRole('textbox', { name: /Mobile number/i });
      fireEvent.change(phoneInput, { target: { value: '9876543210' } });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      // Step 2: Enter 6-digit OTP & verify
      expect(await screen.findByLabelText(/Digit 1 of 6/i)).toBeInTheDocument();
      for (let idx = 0; idx < 6; idx++) {
        const digitInput = screen.getByLabelText(`Digit ${idx + 1} of 6`);
        fireEvent.change(digitInput, { target: { value: String(idx + 1) } });
      }
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      // Modal shows success and Header immediately reflects authenticated state
      expect(await screen.findByText(/Signed in to TheHomez/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /My Account/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /Continue to Storefront/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Logout via Header button
      fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
      expect(await screen.findByRole('button', { name: /Sign in with phone OTP/i })).toBeInTheDocument();

      // Verify zero tokens stored in localStorage / sessionStorage
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/auth/logout',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });
  });

  describe('Protected routes & post-login route restoration', () => {
    it('redirects unauthenticated /account visitor to /login?redirect=%2Faccount and restores /account after OTP verification', async () => {
      window.history.replaceState(null, '', '/account');
      const user = makeCustomerUser();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/v1/auth/refresh') {
          return jsonResponse(
            {
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'Refresh token cookie is required' },
            },
            400,
          );
        }
        if (url === '/api/v1/auth/otp/request') {
          return jsonResponse({
            success: true,
            data: { cooldownSeconds: 60, expiresInSeconds: 300, message: 'OTP sent' },
          });
        }
        if (url === '/api/v1/auth/otp/verify') {
          return jsonResponse({
            success: true,
            data: {
              tokens: {
                accessToken: 'restored-route-access-jwt',
                expiresIn: 900,
                tokenType: 'Bearer',
              },
              user,
            },
          });
        }
        const publicRes = mockPublicStorefrontUrl(url);
        if (publicRes) return publicRes;
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      render(<App />);

      // Redirected to /login?redirect=%2Faccount with full-page CustomerLoginView
      expect(
        await screen.findByRole('heading', { name: /Sign in with mobile number/i }),
      ).toBeInTheDocument();
      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('?redirect=%2Faccount');

      // Complete OTP login on /login
      fireEvent.change(screen.getByRole('textbox', { name: /Mobile number/i }), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      expect(await screen.findByLabelText(/Digit 1 of 6/i)).toBeInTheDocument();
      for (let idx = 0; idx < 6; idx++) {
        fireEvent.change(screen.getByLabelText(`Digit ${idx + 1} of 6`), {
          target: { value: String(idx + 1) },
        });
      }
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      // Originally requested /account route is restored automatically
      expect(await screen.findByRole('heading', { name: /Customer Account/i })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/account');
      expect(screen.getByText('+919876543210')).toBeInTheDocument();
    });

    it('restores authenticated /account session on page refresh without bouncing to /login', async () => {
      window.history.replaceState(null, '', '/account');
      const user = makeCustomerUser();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/v1/auth/refresh') {
          return jsonResponse({
            success: true,
            data: {
              tokens: {
                accessToken: 'cookie-restored-jwt',
                expiresIn: 900,
                tokenType: 'Bearer',
              },
            },
          });
        }
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ success: true, data: { user } });
        }
        const publicRes = mockPublicStorefrontUrl(url);
        if (publicRes) return publicRes;
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      render(<App />);

      // Directly renders protected /account view after HTTP-only cookie restore
      expect(await screen.findByRole('heading', { name: /Customer Account/i })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/account');
      expect(screen.queryByRole('heading', { name: /Sign in or create account/i })).not.toBeInTheDocument();
    });

    it('prevents redirect loops when an authenticated customer visits /login directly', async () => {
      window.history.replaceState(null, '', '/login');
      const user = makeCustomerUser();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/v1/auth/refresh') {
          return jsonResponse({
            success: true,
            data: {
              tokens: { accessToken: 'active-jwt', expiresIn: 900, tokenType: 'Bearer' },
            },
          });
        }
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ success: true, data: { user } });
        }
        const publicRes = mockPublicStorefrontUrl(url);
        if (publicRes) return publicRes;
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe('/');
      });
      expect(screen.getByRole('button', { name: /My Account/i })).toBeInTheDocument();
    });
  });

  describe('Simultaneous 401 refresh deduplication & logout resilience', () => {
    it('deduplicates concurrent storefront 401 refreshes through StorefrontClient + AuthClient', async () => {
      const user = makeCustomerUser();
      const authClient = new AuthClient();
      let refreshCount = 0;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const authHeader = headers['Authorization'];

        if (url === '/api/v1/auth/otp/verify') {
          return jsonResponse({
            success: true,
            data: {
              tokens: { accessToken: 'stale-jwt', expiresIn: 900, tokenType: 'Bearer' },
              user,
            },
          });
        }
        if (url === '/api/v1/auth/refresh') {
          refreshCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          return jsonResponse({
            success: true,
            data: {
              tokens: { accessToken: 'fresh-jwt', expiresIn: 900, tokenType: 'Bearer' },
            },
          });
        }
        if (url.startsWith('/api/v1/categories') || url.startsWith('/api/v1/storefront/products')) {
          if (authHeader === 'Bearer stale-jwt') {
            return jsonResponse(
              { success: false, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired' } },
              401,
            );
          }
          if (authHeader === 'Bearer fresh-jwt') {
            return mockPublicStorefrontUrl(url)!;
          }
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      await authClient.verifyOtp('+919876543210', '123456');

      const [res1, res2] = await Promise.all([
        authClient.authorizedFetch('/categories'),
        authClient.authorizedFetch('/storefront/products'),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(refreshCount).toBe(1);
      expect(fetchSpy.mock.calls.filter(([u]) => u === '/api/v1/auth/refresh')).toHaveLength(1);
    });

    it('clears authenticated UI state safely even when logout API fails with a network error', async () => {
      window.history.replaceState(null, '', '/account');
      const user = makeCustomerUser();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/v1/auth/refresh') {
          return jsonResponse({
            success: true,
            data: {
              tokens: { accessToken: 'active-jwt', expiresIn: 900, tokenType: 'Bearer' },
            },
          });
        }
        if (url === '/api/v1/auth/me') {
          return jsonResponse({ success: true, data: { user } });
        }
        if (url === '/api/v1/auth/logout') {
          throw new TypeError('Network disconnected');
        }
        const publicRes = mockPublicStorefrontUrl(url);
        if (publicRes) return publicRes;
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      render(<App />);

      expect(await screen.findByRole('heading', { name: /Customer Account/i })).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: /^Sign Out$/i })[0]!);

      // Local state clears and ProtectedRoute navigates away from /account to /login
      await waitFor(() => {
        expect(window.location.pathname).toBe('/login');
      });
      expect(screen.getByRole('button', { name: /Sign in with phone OTP/i })).toBeInTheDocument();
    });

    it('reproduces and prevents stale Authorization header surviving StorefrontClient after AuthClient token clearance (ISSUE-5A2-04)', async () => {
      const user = makeCustomerUser();
      const authClient = new AuthClient();
      const observedAuthHeaders: Array<string | undefined> = [];

      // Simulate StorefrontContext holding a lagged getAuthToken snapshot alongside live fetchWithAuth
      let laggedReactToken: string | null = null;
      const storefrontClient = new (await import('../api/storefront-client.js')).StorefrontClient({
        getAuthToken: () => laggedReactToken,
        fetchWithAuth: (url, init) => authClient.authorizedFetch(url, init),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;

        if (url === '/api/v1/auth/otp/verify') {
          return jsonResponse({
            success: true,
            data: {
              tokens: { accessToken: 'live-customer-jwt', expiresIn: 900, tokenType: 'Bearer' },
              user,
            },
          });
        }
        if (url.startsWith('/api/v1/storefront/products')) {
          observedAuthHeaders.push(headers['Authorization'] ?? headers['authorization']);
          return mockPublicStorefrontUrl(url)!;
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      await authClient.verifyOtp('+919876543210', '123456');
      laggedReactToken = 'live-customer-jwt';

      // 1. Normal authenticated storefront request carries live Bearer token
      await storefrontClient.listProducts();
      expect(observedAuthHeaders[0]).toBe('Bearer live-customer-jwt');

      // 2. Race: AuthClient clears in-memory session synchronously BEFORE React updates laggedReactToken
      authClient.clearSession();
      expect(authClient.getAccessToken()).toBeNull();
      expect(laggedReactToken).toBe('live-customer-jwt');

      await storefrontClient.listProducts({
        // Even if caller passes a stale Authorization header, it must be stripped
        // and never transmitted once AuthClient's token is cleared.
      });
      expect(observedAuthHeaders[1]).toBeUndefined();
    });
  });
});
