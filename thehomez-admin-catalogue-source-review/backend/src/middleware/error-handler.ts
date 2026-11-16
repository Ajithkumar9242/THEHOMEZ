import type { Request, Response, NextFunction } from 'express';
import type { IApiErrorResponse, IApiErrorDetail } from '@thehomez/shared-types';
import { getConfig } from '../config/env.js';

/**
 * 404 Not Found handler for undefined routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const correlationId = req.correlationId;
  const timestamp = new Date().toISOString();

  const responseBody: IApiErrorResponse = {
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl || req.url}`,
      correlationId,
      timestamp,
    },
  };

  res.status(404).json(responseBody);
}

/**
 * Centralized error handler. Formats errors conforming to IApiErrorResponse
 * and ensures internal server error details and stack traces are not exposed
 * in production responses.
 */
export function errorHandlerMiddleware(
  err: Error & { statusCode?: number; code?: string; details?: unknown[] },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const config = getConfig();
  const statusCode =
    err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;

  const correlationId = req.correlationId;
  const timestamp = new Date().toISOString();

  // Log error with child logger if available
  const log = req.log;
  if (log) {
    log.error(
      {
        err,
        statusCode,
        method: req.method,
        url: req.originalUrl || req.url,
      },
      'Unhandled error during request processing',
    );
  }

  // Sanitize message in production for 5xx errors
  const isServerErr = statusCode >= 500;
  const publicMessage =
    isServerErr && config.isProduction
      ? 'An unexpected internal error occurred'
      : err.message || 'An error occurred';

  const errorCode = err.code || (isServerErr ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');

  const responseBody: IApiErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: publicMessage,
      ...(err.details ? { details: err.details as unknown as IApiErrorDetail[] } : {}),
      correlationId,
      timestamp,
    },
  };

  res.status(statusCode).json(responseBody);
}
