import type { Server } from 'node:http';
import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './database/database.js';
import { RbacService } from './services/rbac/rbac.service.js';
import { logger } from './logger/logger.js';

export interface RunningServer {
  server: Server;
  close: (timeoutMs?: number) => Promise<void>;
}

let isShuttingDown = false;

export function _resetShutdownStateForTesting(): void {
  isShuttingDown = false;
}

/**
 * Executes a graceful shutdown of the HTTP server and database connections.
 * 1. Stops accepting new incoming connections.
 * 2. Closes idle keep-alive connections.
 * 3. Waits for active in-flight requests to complete.
 * 4. Gracefully disconnects the MongoDB connection.
 * 5. Applies a hard timeout to guarantee termination.
 */
export async function gracefulShutdown(
  server: Server,
  signal: string,
  timeoutMs = 10000,
): Promise<void> {
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  isShuttingDown = true;

  logger.info({ signal, timeoutMs }, 'Starting graceful shutdown...');

  // Set a hard timeout to prevent hanging indefinitely
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, timeoutMs);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new HTTP requests
    await new Promise<void>((resolve, reject) => {
      // Close idle keep-alive sockets if supported (Node 18.2+)
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      server.close((err) => {
        if (err) {
          logger.error({ err: err.message }, 'Error closing HTTP server');
          reject(err);
        } else {
          logger.info('HTTP server closed, no longer accepting requests');
          resolve();
        }
      });
    });

    // 2. Disconnect database
    await disconnectDatabase();

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown completed successfully');
  } catch (error) {
    clearTimeout(forceExitTimer);
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message }, 'Error encountered during graceful shutdown');
    throw err;
  }
}

/**
 * Boots the database connection and HTTP listener.
 */
export async function startServer(): Promise<RunningServer> {
  const config = getConfig();
  const app = createApp();

  // Connect to database and seed required default role templates
  try {
    await connectDatabase();
    const rbacService = new RbacService();
    const seedResult = await rbacService.seedDefaultRoles();
    logger.info(seedResult, 'System default roles initialization completed successfully');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Server starting without initial database connection or role initialization (readiness probe will report unavailable)',
    );
  }

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        prefix: config.apiPrefix,
      },
      `TheHomez Backend service started successfully on port ${config.port}`,
    );
  });

  const shutdown = (sig: string) => async () => {
    try {
      await gracefulShutdown(server, sig);
      process.exit(sig === 'uncaughtException' ? 1 : 0);
    } catch {
      process.exit(1);
    }
  };

  // Register process termination signals
  const onSigTerm = shutdown('SIGTERM');
  const onSigInt = shutdown('SIGINT');

  process.once('SIGTERM', onSigTerm);
  process.once('SIGINT', onSigInt);

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection encountered');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception encountered');
    shutdown('uncaughtException')();
  });

  return {
    server,
    close: async (timeoutMs?: number) => {
      process.removeListener('SIGTERM', onSigTerm);
      process.removeListener('SIGINT', onSigInt);
      await gracefulShutdown(server, 'MANUAL_CLOSE', timeoutMs);
    },
  };
}
