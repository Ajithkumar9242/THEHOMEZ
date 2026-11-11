/**
 * TheHomez Customer Authentication Context & Session Lifecycle Manager
 *
 * Provides reactive access to:
 * - Authenticated customer identity (`user: IAuthUser | null`)
 * - In-memory short-lived JWT access token (`accessToken` + `getAccessToken()`)
 * - HTTP-only cookie-backed session restoration on app mount
 * - Proactive automatic access-token refresh before expiry + visibility resume check
 * - Single-flight refresh deduplication & 401 retry-capable `authorizedFetch`
 * - Login (`requestOtp`, `verifyOtp`), `logout`, `logoutAll`, loading, and error states
 *
 * Security guarantees:
 * - Refresh tokens are NEVER read, stored in localStorage/sessionStorage, or exposed to React.
 * - Access tokens live strictly in memory and are cleared on logout or terminal session failure.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UserType, type IAuthUser, type IOtpRequestResponse } from '@thehomez/shared-types';
import { AuthApiError, AuthClient } from '../api/auth-client.js';
import type { AuthContextValue, AuthStatus, IAuthError } from '../types/auth.js';

export type { AuthContextValue, AuthStatus, IAuthError } from '../types/auth.js';

export interface AuthProviderProps {
  children: React.ReactNode;
  /** Optional custom AuthClient instance (useful for tests or custom API baseUrl). */
  client?: AuthClient;
  /** Skips mount-time cookie session restoration when true (for isolated unit tests). */
  skipInitialRestore?: boolean;
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const REFRESH_BUFFER_MS = 60_000;

function computeRefreshDelayMs(expiresInSeconds: number): number {
  const expiresInMs = Math.max(1, expiresInSeconds) * 1000;
  if (expiresInMs <= REFRESH_BUFFER_MS) {
    return Math.max(1_000, Math.floor(expiresInMs * 0.75));
  }
  return Math.min(expiresInMs - REFRESH_BUFFER_MS, MAX_TIMEOUT_MS);
}

function toAuthError(err: unknown, fallbackMessage: string): IAuthError {
  if (err instanceof AuthApiError) {
    return err.toAuthError();
  }
  return {
    code: 'AUTH_ERROR',
    message: err instanceof Error ? err.message : fallbackMessage,
    status: 500,
  };
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  client,
  skipInitialRestore = false,
}) => {
  const authClient = useMemo(() => client ?? new AuthClient(), [client]);

  const [user, setUser] = useState<IAuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => authClient.getAccessToken());
  const [status, setStatus] = useState<AuthStatus>(
    skipInitialRestore ? 'unauthenticated' : 'initializing',
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<IAuthError | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const isRestoringRef = useRef<boolean>(!skipInitialRestore);
  const statusRef = useRef<AuthStatus>(status);
  const authEpochRef = useRef<number>(0);
  const activeRequestsRef = useRef<number>(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  statusRef.current = status;

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const performSilentRefreshRef = useRef<() => Promise<string | null>>(async () => null);

  const scheduleRefreshFromExpiry = useCallback(
    (expiresAtMs: number | null) => {
      clearRefreshTimer();
      if (!expiresAtMs || !isMountedRef.current) {
        return;
      }
      const remainingSeconds = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
      const delayMs = computeRefreshDelayMs(remainingSeconds);
      refreshTimerRef.current = setTimeout(() => {
        void performSilentRefreshRef.current();
      }, delayMs);
    },
    [clearRefreshTimer],
  );

  // Synchronize AuthClient in-memory token changes & terminal expiration events with React state
  useEffect(() => {
    authClient.setCallbacks({
      onAccessTokenChange: (token, expiresAtMs) => {
        if (!isMountedRef.current) {
          return;
        }
        setAccessToken(token);
        if (token && expiresAtMs) {
          scheduleRefreshFromExpiry(expiresAtMs);
        } else {
          clearRefreshTimer();
        }
      },
      onSessionExpired: (expiredError) => {
        if (!isMountedRef.current) {
          return;
        }
        clearRefreshTimer();
        setUser(null);
        setAccessToken(null);
        setStatus('unauthenticated');

        // Only surface session-expired feedback if an active session expired (never on initial guest visit)
        if (!isRestoringRef.current && statusRef.current === 'authenticated') {
          setAuthError({
            code: expiredError.code,
            message: 'Your session has expired. Please sign in again.',
            status: expiredError.status,
          });
        }
      },
    });

    return () => {
      authClient.setCallbacks({});
    };
  }, [authClient, clearRefreshTimer, scheduleRefreshFromExpiry]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearRefreshTimer();
    };
  }, [clearRefreshTimer]);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const epochAtStart = authEpochRef.current;
    activeRequestsRef.current += 1;
    try {
      const session = await authClient.refreshSession();
      if (!isMountedRef.current || authEpochRef.current !== epochAtStart) {
        return null;
      }
      setAccessToken(session.accessToken);
      return session.accessToken;
    } catch {
      return null;
    } finally {
      activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
    }
  }, [authClient]);

  performSilentRefreshRef.current = refreshSession;

  // Initial session restoration through the HTTP-only refresh cookie on app mount
  useEffect(() => {
    if (skipInitialRestore) {
      isRestoringRef.current = false;
      return;
    }

    let cancelled = false;
    const epochAtMount = authEpochRef.current;
    isRestoringRef.current = true;

    const restoreSession = async () => {
      activeRequestsRef.current += 1;
      try {
        // Reuse existing in-memory token if StrictMode remounts immediately after mount #1 succeeded
        let token = authClient.getAccessToken();
        if (!token || authClient.isAccessTokenExpiringSoon(5_000)) {
          const session = await authClient.refreshSession();
          token = session.accessToken;
        }

        if (cancelled || !isMountedRef.current || authEpochRef.current !== epochAtMount) {
          return;
        }

        const profile = await authClient.getMe(token);
        if (cancelled || !isMountedRef.current || authEpochRef.current !== epochAtMount) {
          return;
        }

        setUser(profile);
        setAccessToken(token);
        setStatus('authenticated');
        setAuthError(null);
        scheduleRefreshFromExpiry(authClient.getTokenExpiresAt());
      } catch {
        // Unauthenticated visitors (400 missing cookie / 401 expired cookie) fall back gracefully
        if (!cancelled && isMountedRef.current && authEpochRef.current === epochAtMount) {
          authClient.clearSession();
          setUser(null);
          setAccessToken(null);
          setStatus('unauthenticated');
          setAuthError(null);
        }
      } finally {
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        if (!cancelled) {
          isRestoringRef.current = false;
        }
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [authClient, scheduleRefreshFromExpiry, skipInitialRestore]);

  // Proactively refresh if the browser tab wakes from sleep with an expiring access token
  useEffect(() => {
    if (typeof document === 'undefined' || status !== 'authenticated') {
      return;
    }

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        statusRef.current === 'authenticated' &&
        authClient.isAccessTokenExpiringSoon(REFRESH_BUFFER_MS)
      ) {
        void refreshSession();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authClient, refreshSession, status]);

  const requestOtp = useCallback(
    async (phone: string): Promise<IOtpRequestResponse> => {
      activeRequestsRef.current += 1;
      setIsSubmitting(true);
      setAuthError(null);
      try {
        return await authClient.requestOtp(phone, UserType.CUSTOMER);
      } catch (err) {
        const authErr = toAuthError(err, 'Failed to send OTP. Please try again.');
        if (isMountedRef.current) {
          setAuthError(authErr);
        }
        throw err;
      } finally {
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [authClient],
  );

  const verifyOtp = useCallback(
    async (phone: string, otp: string): Promise<IAuthUser> => {
      activeRequestsRef.current += 1;
      setIsSubmitting(true);
      setAuthError(null);
      authEpochRef.current += 1;

      try {
        const result = await authClient.verifyOtp(phone, otp, UserType.CUSTOMER);
        if (isMountedRef.current) {
          setUser(result.user);
          setAccessToken(result.tokens.accessToken);
          setStatus('authenticated');
          setAuthError(null);
        }
        return result.user;
      } catch (err) {
        const authErr = toAuthError(err, 'OTP verification failed. Please check the code and retry.');
        if (isMountedRef.current) {
          setAuthError(authErr);
        }
        throw err;
      } finally {
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [authClient],
  );

  const refreshProfile = useCallback(async (): Promise<IAuthUser | null> => {
    const token = await authClient.getValidAccessToken();
    if (!token) {
      return null;
    }
    activeRequestsRef.current += 1;
    try {
      const profile = await authClient.getMe(token);
      if (isMountedRef.current) {
        setUser(profile);
      }
      return profile;
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        const refreshedToken = await refreshSession();
        if (refreshedToken) {
          const profile = await authClient.getMe(refreshedToken);
          if (isMountedRef.current) {
            setUser(profile);
          }
          return profile;
        }
      }
      throw err;
    } finally {
      activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
    }
  }, [authClient, refreshSession]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    return authClient.getValidAccessToken();
  }, [authClient]);

  const authorizedFetch = useCallback(
    (endpointOrUrl: string, init?: RequestInit): Promise<Response> => {
      return authClient.authorizedFetch(endpointOrUrl, init);
    },
    [authClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    clearRefreshTimer();
    authEpochRef.current += 1;
    activeRequestsRef.current += 1;
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await authClient.logout();
    } catch (err) {
      // If cookie was already cleared/expired (400/401), local sign-out still completes cleanly
      if (!(err instanceof AuthApiError && (err.status === 400 || err.status === 401))) {
        if (isMountedRef.current) {
          setAuthError(toAuthError(err, 'Logout encountered a network issue, local session cleared.'));
        }
      }
    } finally {
      activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
      authClient.clearSession();
      if (isMountedRef.current) {
        setUser(null);
        setAccessToken(null);
        setStatus('unauthenticated');
        setIsSubmitting(false);
      }
    }
  }, [authClient, clearRefreshTimer]);

  const logoutAll = useCallback(async (): Promise<void> => {
    const epochAtStart = authEpochRef.current;
    activeRequestsRef.current += 1;
    setIsSubmitting(true);
    setAuthError(null);

    try {
      await authClient.logoutAll();

      if (authEpochRef.current !== epochAtStart) {
        return;
      }

      clearRefreshTimer();
      authEpochRef.current += 1;
      authClient.clearSession();

      if (isMountedRef.current) {
        setUser(null);
        setAccessToken(null);
        setStatus('unauthenticated');
        setAuthError(null);
      }
    } catch (err) {
      const isNetworkFailure =
        !(err instanceof AuthApiError) &&
        (err instanceof TypeError ||
          (err instanceof Error && /network|fetch|offline|connect/i.test(err.message)));

      const normalizedErr =
        err instanceof AuthApiError
          ? err
          : isNetworkFailure
            ? new AuthApiError(
                'Unable to reach the server to sign out of all devices. Other devices may still be signed in. Please check your connection and try again.',
                'NETWORK_ERROR',
                0,
                err,
              )
            : new AuthApiError(
                err instanceof Error
                  ? err.message
                  : 'Unable to sign out of all devices right now. Please try again.',
                'LOGOUT_ALL_FAILED',
                500,
                err,
              );

      if (isMountedRef.current && authEpochRef.current === epochAtStart) {
        // Only clear React session state if the underlying token was already invalidated
        // (e.g., refresh failed and fired onSessionExpired or no token existed).
        if (!authClient.getAccessToken()) {
          clearRefreshTimer();
          authEpochRef.current += 1;
          setUser(null);
          setAccessToken(null);
          setStatus('unauthenticated');
        }
        setAuthError(normalizedErr.toAuthError());
      }

      throw normalizedErr;
    } finally {
      activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [authClient, clearRefreshTimer]);

  const clearError = useCallback(() => setAuthError(null), []);
  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    if (activeRequestsRef.current === 0) {
      setAuthError(null);
    }
  }, []);

  const isInitializing = status === 'initializing';
  const isLoading = isInitializing || isSubmitting;
  const isAuthenticated = status === 'authenticated' && user !== null && accessToken !== null;
  const error = authError?.message ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      status,
      isAuthenticated,
      isInitializing,
      isLoading,
      error,
      authError,
      isAuthModalOpen,
      requestOtp,
      verifyOtp,
      refreshSession,
      refreshProfile,
      getAccessToken,
      authorizedFetch,
      logout,
      logoutAll,
      clearError,
      openAuthModal,
      closeAuthModal,
    }),
    [
      user,
      accessToken,
      status,
      isAuthenticated,
      isInitializing,
      isLoading,
      error,
      authError,
      isAuthModalOpen,
      requestOtp,
      verifyOtp,
      refreshSession,
      refreshProfile,
      getAccessToken,
      authorizedFetch,
      logout,
      logoutAll,
      clearError,
      openAuthModal,
      closeAuthModal,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
