/**
 * Customer Authentication Route Guard (`ProtectedRoute`)
 *
 * Protects customer-only routes (e.g. `/account`) without blocking public
 * storefront discovery.
 *
 * Lifecycle behaviour:
 * - While `isInitializing` is true (HTTP-only cookie session restoration in flight),
 *   renders a non-redirecting verification state so hard refreshes on protected
 *   routes do not prematurely bounce authenticated customers to `/login`.
 * - Once initialization completes and `isAuthenticated` is false, invokes
 *   `onRedirectToLogin(requestedPath)` once per unauthenticated transition.
 * - When `isAuthenticated` is true, renders `children`.
 */

import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { LOGIN_ROUTE_PATH, sanitizeRedirectPath } from './redirect-utils.js';

export interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Callback used to navigate the user to `/login` while preserving the requested path. */
  onRedirectToLogin: (requestedPath: string) => void;
  /** Optional explicit fallback element rendered while session restoration is in progress. */
  loadingFallback?: React.ReactNode;
}

function getCurrentRequestedPath(): string {
  if (typeof window === 'undefined' || !window.location) {
    return '/';
  }
  const raw = `${window.location.pathname}${window.location.search}`;
  const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (cleanPath === LOGIN_ROUTE_PATH) {
    return '/';
  }
  return sanitizeRedirectPath(raw);
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  onRedirectToLogin,
  loadingFallback,
}) => {
  const { isAuthenticated, isInitializing } = useAuth();
  const hasRedirectedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isInitializing || isAuthenticated) {
      hasRedirectedRef.current = false;
      return;
    }

    if (!hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      onRedirectToLogin(getCurrentRequestedPath());
    }
  }, [isInitializing, isAuthenticated, onRedirectToLogin]);

  if (isInitializing) {
    if (loadingFallback) {
      return <>{loadingFallback}</>;
    }
    return (
      <section
        className="thz-protected-loading"
        role="status"
        aria-live="polite"
        aria-label="Verifying customer session"
      >
        <div className="thz-protected-loading-card">
          <div className="thz-protected-spinner" aria-hidden="true" />
          <h2 className="thz-protected-loading-title">Checking your session…</h2>
          <p className="thz-protected-loading-copy">
            Verifying your credentials securely before loading your account.
          </p>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};
