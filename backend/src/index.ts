/**
 * @thehomez/backend Service Entrypoint
 */
import { fileURLToPath } from 'node:url';
import { UserType, UnitOfMeasure } from '@thehomez/shared-types';
import { startServer, gracefulShutdown, type RunningServer } from './server.js';
import { createApp } from './app.js';
import { getConfig, validateConfig, type AppConfig } from './config/env.js';
import { logger, createLogger } from './logger/logger.js';
import {
  connectDatabase,
  disconnectDatabase,
  isDatabaseReady,
  getDatabaseDiagnostics,
} from './database/database.js';
import { withTransaction } from './database/transaction.js';

// Preserve Milestone 1 verification metadata
export const BACKEND_INIT_METADATA = {
  service: '@thehomez/backend',
  version: '0.1.0',
  supportedUserTypes: Object.values(UserType),
  supportedUnits: Object.values(UnitOfMeasure),
} as const;

// Module exports
export {
  createApp,
  startServer,
  gracefulShutdown,
  getConfig,
  validateConfig,
  logger,
  createLogger,
  connectDatabase,
  disconnectDatabase,
  isDatabaseReady,
  getDatabaseDiagnostics,
  withTransaction,
};
export type { RunningServer, AppConfig };

// Auto-start server if executed directly via node or tsx
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('dist/index.js') ||
    process.argv[1].endsWith('src/index.ts'));

if (isDirectExecution) {
  startServer().catch((err) => {
    logger.fatal({ err }, 'Failed to bootstrap TheHomez Backend server');
    process.exit(1);
  });
}
