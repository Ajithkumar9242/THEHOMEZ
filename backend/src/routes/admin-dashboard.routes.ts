import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import {
  authenticate,
  authorize,
  staffOnlyGuard,
  validateQuery,
  createApiRateLimiter,
} from '../middleware/index.js';
import {
  type AdminDashboardController,
  adminDashboardController,
} from '../controllers/admin-dashboard.controller.js';
import {
  adminDashboardQuerySchema,
  adminDashboardLimitQuerySchema,
} from './admin-dashboard.schemas.js';

/**
 * Creates and configures the Express router for administrative dashboard operations.
 * Base path: /api/v1/admin/dashboard
 */
export function createAdminDashboardRouter(
  controller: AdminDashboardController = adminDashboardController,
): Router {
  const router = Router();
  const apiLimiter = createApiRateLimiter();

  // 1. Top-level summary metrics with date filtering & RBAC masking
  router.get(
    '/summary',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    validateQuery(adminDashboardQuerySchema),
    controller.getSummary,
  );

  // 2. Partner operational overview (Requires PARTNER_READ)
  router.get(
    '/partner-overview',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    controller.getPartnerOverview,
  );

  // 3. Operational exceptions (actionable pending items)
  router.get(
    '/operational-exceptions',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    validateQuery(adminDashboardLimitQuerySchema),
    controller.getOperationalExceptions,
  );

  // 4. Recent operational activity (Requires AUDIT_READ)
  router.get(
    '/recent-activity',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.AUDIT_READ),
    validateQuery(adminDashboardLimitQuerySchema),
    controller.getRecentActivity,
  );

  return router;
}

export const adminDashboardRouter: Router = createAdminDashboardRouter();
