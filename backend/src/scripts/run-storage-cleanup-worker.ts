#!/usr/bin/env tsx
import { connectDatabase, disconnectDatabase } from '../database/database.js';
import { logger } from '../logger/logger.js';
import { StorageCleanupWorker } from '../services/storage/storage-cleanup-worker.js';

async function main() {
  logger.info('Initializing Storage Cleanup Worker Daemon...');

  try {
    await connectDatabase();
    logger.info('Connected to MongoDB database');
  } catch (dbErr) {
    logger.fatal({ err: dbErr }, 'Failed to connect to MongoDB. Worker terminating.');
    process.exit(1);
  }

  const pollIntervalMs = process.env.WORKER_POLL_INTERVAL_MS
    ? parseInt(process.env.WORKER_POLL_INTERVAL_MS, 10)
    : 5000;
  const batchSize = process.env.WORKER_BATCH_SIZE
    ? parseInt(process.env.WORKER_BATCH_SIZE, 10)
    : 10;

  const worker = new StorageCleanupWorker({
    pollIntervalMs,
    batchSize,
  });

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, terminating Storage Cleanup Worker gracefully...');
    try {
      await worker.stop();
      await disconnectDatabase();
      logger.info('Storage Cleanup Worker shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(
    { workerId: worker.workerId, pollIntervalMs, batchSize },
    'Starting Storage Cleanup Worker loop...',
  );
  await worker.start();
}

main().catch((err) => {
  logger.fatal({ err }, 'Unhandled exception in storage cleanup worker process');
  process.exit(1);
});
