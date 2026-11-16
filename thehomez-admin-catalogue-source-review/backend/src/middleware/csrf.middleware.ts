import type { Request, Response, NextFunction } from 'express';
import type { IApiErrorResponse } from '@thehomez/shared-types';
import { getConfig } from '../config/env.js';
import {
  REFRESH_COOKIE_NAME,
  hasBrowserSignalHeaders,
} from '../services/token/cookie.utils.js';

const FORBIDDEN_FORM_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

function sendCsrfError(req: Request, res: Response, code: string, message: string): void {
  const response: IApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  };
  res.status(403).json(response);
}

function extractRefererOrigin(referer: string): string | null {
  try {
    const parsed = new URL(referer);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Explicit CSRF protection middleware for cookie-capable authentication endpoints (/refresh, /logout).
 *
 * Defense-in-depth layers:
 * 1. Allows headerless non-browser API clients (e.g. mobile/backend clients using body tokens without cookies).
 * 2. Blocks CORS-safelisted simple form/text Content-Types on cookie-authenticated requests.
 * 3. Rejects cross-site Fetch Metadata (`Sec-Fetch-Site: cross-site`) and enforces strict origin
 *    allowlisting for `same-site` (sibling subdomain) requests.
 * 4. Validates `Origin` (or `Referer` origin fallback) against `config.corsOrigins`.
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasCookie = Boolean(req.cookies?.[REFRESH_COOKIE_NAME]);
  const hasBrowserSignals = hasBrowserSignalHeaders(req);

  if (!hasCookie && !hasBrowserSignals) {
    next();
    return;
  }

  const config = getConfig();
  const allowedOrigins = new Set(config.corsOrigins);

  const rawContentType =
    typeof req.headers['content-type'] === 'string'
      ? req.headers['content-type'].trim().toLowerCase()
      : '';

  const hasCustomCsrfHeader =
    req.headers['x-auth-transport'] === 'cookie' ||
    req.headers['x-client-type'] === 'browser' ||
    (typeof req.headers['x-requested-with'] === 'string' &&
      req.headers['x-requested-with'].trim().length > 0);

  // 1. Reject simple HTML form / text-beacon Content-Types on cookie-authenticated requests
  if (
    hasCookie &&
    FORBIDDEN_FORM_CONTENT_TYPES.some((forbidden) => rawContentType.startsWith(forbidden))
  ) {
    sendCsrfError(
      req,
      res,
      'CSRF_VALIDATION_FAILED',
      'Form-encoded and plain-text requests are not permitted for cookie-authenticated endpoints',
    );
    return;
  }

  // Require either application/json Content-Type or an explicit custom anti-CSRF header when cookie is present
  if (hasCookie && !hasCustomCsrfHeader && !rawContentType.includes('application/json')) {
    sendCsrfError(
      req,
      res,
      'CSRF_VALIDATION_FAILED',
      'Cookie-authenticated requests require application/json Content-Type or an anti-CSRF header',
    );
    return;
  }

  // 2. Evaluate Fetch Metadata Sec-Fetch-Site when supplied
  const secFetchSite =
    typeof req.headers['sec-fetch-site'] === 'string'
      ? req.headers['sec-fetch-site'].trim().toLowerCase()
      : undefined;

  if (secFetchSite === 'cross-site') {
    sendCsrfError(req, res, 'CSRF_VALIDATION_FAILED', 'Cross-site request blocked by CSRF policy');
    return;
  }

  // 3. Validate Origin / Referer against configured trusted origins
  const originHeader =
    typeof req.headers.origin === 'string' ? req.headers.origin.trim() : undefined;
  const refererHeader =
    typeof req.headers.referer === 'string' ? req.headers.referer.trim() : undefined;

  let originVerified = false;

  if (originHeader !== undefined) {
    if (originHeader === 'null' || !allowedOrigins.has(originHeader)) {
      sendCsrfError(req, res, 'CSRF_ORIGIN_REJECTED', 'Request origin not permitted by CSRF policy');
      return;
    }
    originVerified = true;
  } else if (refererHeader !== undefined) {
    const refererOrigin = extractRefererOrigin(refererHeader);
    if (!refererOrigin || !allowedOrigins.has(refererOrigin)) {
      sendCsrfError(
        req,
        res,
        'CSRF_ORIGIN_REJECTED',
        'Request referer origin not permitted by CSRF policy',
      );
      return;
    }
    originVerified = true;
  }

  // Same-site (e.g. sibling subdomain) MUST present a verified trusted Origin/Referer
  if (secFetchSite === 'same-site' && !originVerified) {
    sendCsrfError(
      req,
      res,
      'CSRF_ORIGIN_REJECTED',
      'Same-site request without trusted origin blocked by CSRF policy',
    );
    return;
  }

  // Browser requests lacking both Origin and Referer must either be same-origin or carry a custom anti-CSRF header
  if (hasBrowserSignals && !originVerified && secFetchSite !== 'same-origin' && !hasCustomCsrfHeader) {
    sendCsrfError(
      req,
      res,
      'CSRF_VALIDATION_FAILED',
      'Browser request missing Origin/Referer and anti-CSRF header',
    );
    return;
  }

  next();
}
