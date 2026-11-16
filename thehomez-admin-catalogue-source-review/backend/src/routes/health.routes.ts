import { Router, type Request, type Response } from 'express';
import { isDatabaseReady } from '../database/database.js';

export const healthRouter = Router();

/**
 * GET /health/live
 *
 * Liveness probe: verifies that the Express HTTP server process is running
 * and can accept network traffic. Strictly independent of external dependencies
 * (database, caches, message brokers).
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime() * 100) / 100,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 *
 * Readiness probe: verifies that the service and its required dependencies
 * (specifically MongoDB) are healthy and ready to process business traffic.
 *
 * Returns:
 * - 200 OK when MongoDB is connected.
 * - 503 Service Unavailable when MongoDB is disconnected, connecting, or unavailable.
 *
 * Security Note:
 * Strictly never exposes internal database errors, credentials, or connection strings.
 */
healthRouter.get('/ready', (_req: Request, res: Response) => {
  const dbReady = isDatabaseReady();
  const uptime = Math.round(process.uptime() * 100) / 100;
  const timestamp = new Date().toISOString();

  if (!dbReady) {
    res.status(503).json({
      status: 'unavailable',
      uptime,
      timestamp,
      services: {
        database: {
          status: 'disconnected',
        },
      },
    });
    return;
  }

  res.status(200).json({
    status: 'ready',
    uptime,
    timestamp,
    services: {
      database: {
        status: 'connected',
      },
    },
  });
});
