import { connectDatabase, disconnectDatabase } from '../database/database.js';
import { categoryService } from '../services/catalog/category.service.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/logger.js';

/**
 * Standalone Seed Script for Initial Product Taxonomy:
 * Seeds baseline construction material and trade service categories.
 *
 * Safety Guards:
 * - Unconditionally blocked in production environments.
 * - Idempotent upserts prevent duplicate records when re-executed.
 */
export async function runCategoriesSeed(configOverride?: {
  isProduction: boolean;
}): Promise<{ seeded: number; updated: number }> {
  const isProduction = configOverride?.isProduction ?? getConfig().isProduction;

  if (isProduction) {
    logger.error(
      'FATAL: Category development fixture seeding is permanently blocked in production environments.',
    );
    throw new Error(
      'Development fixture seeding is permanently blocked in production environments.',
    );
  }

  logger.info('Starting product taxonomy categories seed execution...');

  await connectDatabase();

  const result = await categoryService.seedInitialCategories();

  logger.info(result, 'Product taxonomy categories seed completed successfully');

  return result;
}

// Allow direct execution via tsx / node
if (process.argv[1] && process.argv[1].includes('categories.seed')) {
  runCategoriesSeed()
    .then(async () => {
      logger.info('Categories seed process finished');
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Categories seed execution failed');
      await disconnectDatabase();
      process.exit(1);
    });
}
