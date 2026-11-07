import { connectDatabase, disconnectDatabase } from '../database/database.js';
import { serviceAreaService } from '../services/service-area/service-area.service.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/logger.js';

/**
 * Standalone Seed Script for Development & Testing:
 * Seeds the 5 approved Bengaluru PIN codes into the service_areas collection.
 *
 * Safety Guards:
 * - Unconditionally blocked in production environments (regardless of any environment variables).
 * - Idempotent upserts prevent duplicate records when re-executed in dev/test.
 */
export async function runServiceAreaSeed(): Promise<void> {
  const config = getConfig();

  if (config.isProduction) {
    logger.error(
      'FATAL: Bengaluru development fixture seeding is permanently blocked in production environments.',
    );
    throw new Error(
      'Development fixture seeding is permanently blocked in production environments.',
    );
  }

  logger.info('Starting Bengaluru service areas seed execution...');

  await connectDatabase();

  const seeded = await serviceAreaService.seedBengaluruServiceAreas();

  logger.info(
    {
      totalSeeded: seeded.length,
      areas: seeded.map((a) => ({ code: a.code, name: a.name, pincodes: a.pincodes })),
    },
    'Bengaluru service areas seed completed successfully',
  );
}

// Allow direct execution via tsx / node
if (process.argv[1] && process.argv[1].includes('service-areas.seed')) {
  runServiceAreaSeed()
    .then(async () => {
      logger.info('Seed process finished');
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Seed execution failed');
      await disconnectDatabase();
      process.exit(1);
    });
}
