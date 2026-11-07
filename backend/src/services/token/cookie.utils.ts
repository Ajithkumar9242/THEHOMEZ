import type { CookieOptions, Request, Response } from 'express';
import { getConfig, type IAppConfig } from '../../config/env.js';

export const REFRESH_COOKIE_NAME = 'thz_refresh_token';

/**
 * Constructs cookie options enforcing HTTP-only, Path scoping, SameSite=Strict,
 * and HTTPS in production.
 */
export function getRefreshCookieOptions(customConfig?: IAppConfig): CookieOptions {
  const config = customConfig || getConfig();
  // Standard 7-day TTL in milliseconds: 7 * 24 * 60 * 60 * 1000
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

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
 * Clears the HTTP-only refresh token cookie during logout.
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
 * Determines if an incoming request originated from a browser storefront or opted into cookie transport.
 * Non-browser API clients (and backward-compatible tests) omit these headers and continue to receive
 * refresh tokens in response bodies.
 */
export function isBrowserClient(req: Request): boolean {
  if (req.cookies && Boolean(req.cookies[REFRESH_COOKIE_NAME])) {
    return true;
  }
  if (req.headers['x-auth-transport'] === 'cookie') {
    return true;
  }
  if (req.headers['x-client-type'] === 'browser') {
    return true;
  }
  if (req.headers['sec-fetch-dest'] !== undefined) {
    return true;
  }
  if (req.headers['sec-fetch-mode'] !== undefined) {
    return true;
  }
  if (req.query?.transport === 'cookie') {
    return true;
  }
  return false;
}
