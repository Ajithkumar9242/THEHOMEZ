import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import {
  authenticate,
  authorize,
  staffOnlyGuard,
  validateParams,
  validateQuery,
  validateBody,
  createApiRateLimiter,
} from '../middleware/index.js';
import {
  type AdminStorageController,
  adminStorageController,
} from '../controllers/admin-storage.controller.js';
import {
  adminStorageJobParamSchema,
  emptyQuerySchema,
  emptyBodySchema,
} from './admin-storage.schemas.js';

/**
 * Creates and configures the Express router for administrative storage operations.
 * Base path: /api/v1/admin/storage
 */
export function createAdminStorageRouter(
  controller: AdminStorageController = adminStorageController,
): Router {
  const router = Router();
  const apiLimiter = createApiRateLimiter();

  // Task P1A-12: Admin Cleanup Job Retry API
  // POST /api/v1/admin/storage/cleanup-jobs/:jobId/retry
  router.post(
    '/cleanup-jobs/:jobId/retry',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize([PermissionCode.SETTINGS_WRITE, PermissionCode.RBAC_MANAGE], { mode: 'ANY' }),
    validateParams(adminStorageJobParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(emptyBodySchema),
    controller.retryCleanupJob,
  );

  return router;
}

export const adminStorageRouter = createAdminStorageRouter();
