import type { CookieOptions, Request, Response } from 'express';
import { getConfig, type IAppConfig } from '../../config/env.js';
import { parseDurationToSeconds } from './token.service.js';

export const REFRESH_COOKIE_NAME = 'thz_refresh_token';

const BROWSER_USER_AGENT_REGEX =
  /mozilla\/|chrome\/|safari\/|firefox\/|edg\/|opera\/|opr\/|crios\/|fxios\//i;

/**
 * Constructs cookie options enforcing HTTP-only, Path scoping, SameSite=Strict,
 * HTTPS in production, and maxAge derived from configured refresh token expiry.
 */
export function getRefreshCookieOptions(customConfig?: IAppConfig): CookieOptions {
  const config = customConfig || getConfig();
  const refreshTtlSeconds = parseDurationToSeconds(config.auth.refreshToken.expiresIn);
  const maxAgeMs = refreshTtlSeconds * 1000;

  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: `${config.apiPrefix}/auth`,
    maxAge: maxAgeMs,
  };
}

/**
 * Issues the HTTP-only refresh token cookie on a response.
 */
export function setRefreshTokenCookie(
  res: Response,
  token?: string,
  customConfig?: IAppConfig,
): void {
  if (!token) {
    return;
  }
  const options = getRefreshCookieOptions(customConfig);
  res.cookie(REFRESH_COOKIE_NAME, token, options);
}

/**
 * Clears the HTTP-only refresh token cookie during logout or terminal auth failure.
 */
export function clearRefreshTokenCookie(res: Response, customConfig?: IAppConfig): void {
  const options = getRefreshCookieOptions(customConfig);
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: options.path,
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
  });
}

/**
 * Detects passive browser-managed request headers (Origin, Referer, Fetch Metadata,
 * Client Hints, HTML Accept, or browser User-Agent) that scripts inside a browser cannot suppress.
 */
export function hasBrowserSignalHeaders(req: Request): boolean {
  if (req.headers.origin !== undefined || req.headers.referer !== undefined) {
    return true;
  }
  if (
    req.headers['sec-fetch-mode'] !== undefined ||
    req.headers['sec-fetch-dest'] !== undefined ||
    req.headers['sec-fetch-site'] !== undefined ||
    req.headers['sec-fetch-user'] !== undefined
  ) {
    return true;
  }
  if (
    req.headers['sec-ch-ua'] !== undefined ||
    req.headers['sec-ch-ua-mobile'] !== undefined ||
    req.headers['sec-ch-ua-platform'] !== undefined
  ) {
    return true;
  }
  const accept = req.headers.accept;
  if (
    typeof accept === 'string' &&
    (accept.toLowerCase().includes('text/html') ||
      accept.toLowerCase().includes('application/xhtml+xml'))
  ) {
    return true;
  }
  const userAgent = req.headers['user-agent'];
  if (typeof userAgent === 'string' && BROWSER_USER_AGENT_REGEX.test(userAgent)) {
    return true;
  }
  return false;
}

/**
 * Determines if an incoming request originated from a browser client or opted into cookie transport.
 * Browser-managed headers always take precedence over client opt-out headers so XSS payloads
 * cannot trick the server into returning refresh tokens in JSON responses.
 */
export function isBrowserClient(req: Request): boolean {
  if (req.cookies && Boolean(req.cookies[REFRESH_COOKIE_NAME])) {
    return true;
  }
  if (hasBrowserSignalHeaders(req)) {
    return true;
  }
  if (req.headers['x-auth-transport'] === 'cookie') {
    return true;
  }
  if (req.headers['x-client-type'] === 'browser') {
    return true;
  }
  if (req.query?.transport === 'cookie') {
    return true;
  }
  return false;
}
