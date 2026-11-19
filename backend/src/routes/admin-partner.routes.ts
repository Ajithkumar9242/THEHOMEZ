import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import {
  authenticate,
  authorize,
  staffOnlyGuard,
  validateQuery,
  validateParams,
  validateBody,
  createApiRateLimiter,
} from '../middleware/index.js';
import {
  type AdminPartnerController,
  adminPartnerController,
} from '../controllers/admin-partner.controller.js';
import { authorizePartnerStatusMutation } from '../middleware/authorize-partner-status.middleware.js';
import {
  adminPartnerQuerySchema,
  adminPartnerIdParamSchema,
  updatePartnerStatusSchema,
  adminPartnerAuditLogsQuerySchema,
} from './admin-partner.schemas.js';

/**
 * Creates and configures the Express router for administrative partner operations.
 * Base path: /api/v1/admin/partners
 */
export function createAdminPartnerRouter(
  controller: AdminPartnerController = adminPartnerController,
): Router {
  const router = Router();
  const apiLimiter = createApiRateLimiter();

  // API 1: List partner directory with pagination, search, and filtering
  router.get(
    '/',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateQuery(adminPartnerQuerySchema),
    controller.listPartners,
  );

  // API 2: Partner detail inspection
  router.get(
    '/:partnerId',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateParams(adminPartnerIdParamSchema),
    controller.getPartnerById,
  );

  // API 3: Partner lifecycle status mutation
  router.patch(
    '/:partnerId/status',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    validateParams(adminPartnerIdParamSchema),
    validateBody(updatePartnerStatusSchema),
    authorizePartnerStatusMutation,
    controller.updatePartnerStatus,
  );

  // API 4: Partner lifecycle audit history inspection
  router.get(
    '/:partnerId/audit-logs',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateParams(adminPartnerIdParamSchema),
    validateQuery(adminPartnerAuditLogsQuerySchema),
    controller.getPartnerAuditLogs,
  );

  return router;
}

export const adminPartnerRouter = createAdminPartnerRouter();
