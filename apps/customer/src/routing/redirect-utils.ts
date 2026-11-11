/**
 * Safe Internal Redirect Utilities for Customer Authentication Routing.
 *
 * Ensures post-login redirects stay strictly within the customer storefront
 * origin and never trigger open-redirect vulnerabilities or /login loops.
 */

export const LOGIN_ROUTE_PATH = '/login';
export const ACCOUNT_ROUTE_PATH = '/account';
export const DEFAULT_POST_LOGIN_PATH = '/';

/**
 * Validates and normalizes an internal redirect target.
 * Rejects protocol-relative URLs (`//...`), external schemes (`https:`, `javascript:`),
 * and `/login` itself to prevent redirect loops.
 */
export function sanitizeRedirectPath(rawRedirect: string | null | undefined): string {
  if (!rawRedirect || typeof rawRedirect !== 'string') {
    return DEFAULT_POST_LOGIN_PATH;
  }

  const trimmed = rawRedirect.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  // Reject control characters or encoded backslashes
  if (/[\r\n\t]/.test(trimmed)) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  const pathOnly = trimmed.split('?')[0]?.split('#')[0]?.replace(/\/+$/, '') || '/';
  if (pathOnly === LOGIN_ROUTE_PATH) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return trimmed;
}

/**
 * Extracts and sanitizes the `?redirect=...` query parameter from a search string.
 */
export function getRedirectTargetFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  return sanitizeRedirectPath(params.get('redirect'));
}

/**
 * Builds `/login?redirect=...` when a customer attempts to access a protected route
 * while unauthenticated, avoiding redundant `?redirect=/` or `/login` loops.
 */
export function buildLoginRedirectUrl(requestedPath: string): string {
  const safeTarget = sanitizeRedirectPath(requestedPath);
  if (safeTarget === DEFAULT_POST_LOGIN_PATH) {
    return LOGIN_ROUTE_PATH;
  }
  const params = new URLSearchParams({ redirect: safeTarget });
  return `${LOGIN_ROUTE_PATH}?${params.toString()}`;
}
