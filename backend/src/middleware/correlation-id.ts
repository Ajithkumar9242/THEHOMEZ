import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger/logger.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Middleware that extracts an existing correlation ID from request headers
 * (x-correlation-id or x-request-id) or generates a new RFC 4122 v4 UUID.
 *
 * It attaches the correlation ID to:
 * - req.correlationId
 * - req.log (a Pino child logger scoped with the correlationId)
 * - Response header 'X-Correlation-Id'
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-correlation-id'] || req.headers['x-request-id'];

  const correlationId =
    typeof incomingId === 'string' && incomingId.trim().length > 0
      ? incomingId.trim()
      : randomUUID();

  req.correlationId = correlationId;
  req.log = logger.child({ correlationId });

  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  next();
}
