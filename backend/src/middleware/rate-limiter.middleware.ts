import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { IApiErrorResponse } from '@thehomez/shared-types';
import { getConfig } from '../config/env.js';
import { normalizePhoneNumber } from '../services/phone.utils.js';

/**
 * Standard 429 Rate Limit Exceeded handler conforming to IApiErrorResponse.
 * Avoids account enumeration by returning a standardized neutral message.
 */
function rateLimitErrorHandler(req: Request, res: Response): void {
  const response: IApiErrorResponse = {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later',
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  };
  res.status(429).json(response);
}

/**
 * Key generator combining client IP with normalized phone number (if present in body).
 * Scopes rate-limiting per phone number across distributed clients while maintaining
 * standard IP-based fallback with IPv6 subnet security.
 */
function authKeyGenerator(req: Request): string {
  const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const clientIp = ipKeyGenerator(rawIp);

  if (req.body && typeof req.body.phone === 'string') {
    try {
      const normalized = normalizePhoneNumber(req.body.phone);
      return `${clientIp}_${normalized}`;
    } catch {
      // If phone normalization fails, fall back to pure IP
      return clientIp;
    }
  }

  return clientIp;
}

/**
 * Rate Limiter for Authentication & OTP Operations
 *
 * ARCHITECTURAL LIMITATION & PRODUCTION STORE REQUIREMENT:
 * - This middleware utilizes express-rate-limit's default in-memory store.
 * - Suitable ONLY for single-process development, testing, and isolated staging instances.
 * - Multi-instance / clustered production deployments MUST supply a shared distributed
 *   store adapter (e.g. rate-limit-redis or ioredis) so limits are enforced globally
 *   across all backend pods.
 *
 * PROXY TRUST CONFIGURATION:
 * - When running behind reverse proxies (Nginx, Cloudflare, AWS ALB), Express must be
 *   configured with `app.set('trust proxy', numberOfHops)` so that `req.ip` reflects
 *   the verified upstream client IP rather than an easily spoofable `X-Forwarded-For`.
 */
export function createAuthRateLimiter(overrideOptions?: Partial<Options>) {
  const config = getConfig();

  return rateLimit({
    windowMs: config.auth.rateLimit.windowMs,
    limit: config.auth.rateLimit.authMaxRequests,
    standardHeaders: true, // Draft-6 RateLimit headers
    legacyHeaders: false, // X-RateLimit headers disabled
    keyGenerator: authKeyGenerator,
    handler: rateLimitErrorHandler,
    ...overrideOptions,
  });
}

/**
 * Rate Limiter for General Protected API Operations
 */
export function createApiRateLimiter(overrideOptions?: Partial<Options>) {
  const config = getConfig();

  return rateLimit({
    windowMs: config.auth.rateLimit.windowMs,
    limit: config.auth.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler,
    ...overrideOptions,
  });
}
