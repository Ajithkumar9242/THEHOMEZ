import type { Request, Response, NextFunction } from 'express';

/**
 * HTTP request logging middleware.
 * Records request start and logs duration, status, and metadata upon completion.
 * Does NOT log complete request bodies by default to prevent leaking sensitive data
 * and avoid memory / log overhead.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;

    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    const reqLogger = req.log;

    if (res.statusCode >= 500) {
      reqLogger.error(logData, 'HTTP request completed with server error');
    } else if (res.statusCode >= 400) {
      reqLogger.warn(logData, 'HTTP request completed with client error');
    } else {
      reqLogger.info(logData, 'HTTP request completed');
    }
  });

  next();
}
