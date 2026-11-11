/**
 * TheHomez Customer Authentication Types & Public Context Contract
 *
 * Shared interface definitions coordinated across:
 * - Auth API client (`apps/customer/src/api/auth-client.ts`)
 * - AuthContext (`apps/customer/src/context/AuthContext.tsx`)
 * - Customer Auth UI (Chat B) and App/Routing integration (Chat C)
 *
 * Security invariants:
 * - Refresh tokens are transported strictly via HTTP-only cookies and are
 *   NEVER represented or exposed in frontend React state or browser storage.
 * - Access tokens live strictly in memory.
 */

import type { IAuthUser, IOtpRequestResponse } from '@thehomez/shared-types';

/**
 * Browser-safe access token metadata held strictly in memory.
 * Deliberately excludes `refreshToken` so components never receive or store it.
 */
export interface IAccessTokenSession {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Verified OTP sign-in result returned to the auth context.
 */
export interface IVerifyOtpResult {
  tokens: IAccessTokenSession;
  user: IAuthUser;
}

/**
 * Lifecycle state of the customer authentication session.
 */
export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

/**
 * Structured authentication error exposed to UI components.
 */
export interface IAuthError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  cooldownRemainingSeconds?: number;
  lockoutRemainingSeconds?: number;
}

/**
 * Public interface of `AuthContext` consumed by Login UI (Chat B) and
 * Routing/Header/Storefront integration (Chat C).
 */
export interface AuthContextValue {
  /** Authenticated customer profile, or null when unauthenticated. */
  user: IAuthUser | null;
  /** Short-lived JWT access token stored strictly in memory, or null. */
  accessToken: string | null;
  /** Current lifecycle status of the auth session. */
  status: AuthStatus;
  /** True when an authenticated customer session is active. */
  isAuthenticated: boolean;
  /** True while initial HTTP-only cookie session restoration is in progress. */
  isInitializing: boolean;
  /** True while initializing or executing an auth operation (OTP request/verify/refresh/logout). */
  isLoading: boolean;
  /** Human-readable message for the most recent authentication error, or null. */
  error: string | null;
  /** Structured metadata (code, HTTP status, cooldown/lockout seconds) for the most recent auth error, or null. */
  authError: IAuthError | null;
  /** Shared modal visibility state for triggering customer sign-in from anywhere in the app. */
  isAuthModalOpen: boolean;

  /** Requests a 6-digit OTP challenge for a customer Indian mobile number. */
  requestOtp: (phone: string) => Promise<IOtpRequestResponse>;
  /** Verifies the 6-digit OTP, establishes cookie + in-memory session, and returns the user. */
  verifyOtp: (phone: string, otp: string) => Promise<IAuthUser>;
  /** Rotates the session via the HTTP-only refresh cookie (deduplicated single-flight). */
  refreshSession: () => Promise<string | null>;
  /** Re-fetches the authenticated user profile from GET /api/v1/auth/me. */
  refreshProfile: () => Promise<IAuthUser | null>;
  /** Returns a valid in-memory access token, proactively refreshing if near expiry. */
  getAccessToken: () => Promise<string | null>;
  /** Fetch wrapper that attaches the in-memory Bearer token and retries once on 401 after refresh. */
  authorizedFetch: (endpointOrUrl: string, init?: RequestInit) => Promise<Response>;
  /** Logs out the current session, revoking and clearing the HTTP-only refresh cookie. */
  logout: () => Promise<void>;
  /** Logs out all active sessions across devices for the authenticated customer. */
  logoutAll: () => Promise<void>;
  /** Clears the current authentication error state. */
  clearError: () => void;
  /** Opens the customer authentication modal. */
  openAuthModal: () => void;
  /** Closes the customer authentication modal. */
  closeAuthModal: () => void;
}
