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
  type AdminPartnerApplicationController,
  adminPartnerApplicationController,
} from '../controllers/admin-partner-application.controller.js';
import {
  adminPartnerApplicationQuerySchema,
  partnerApplicationIdParamSchema,
  createPartnerApplicationSchema,
  rejectPartnerApplicationSchema,
  withdrawPartnerApplicationSchema,
  approvePartnerApplicationSchema,
} from './admin-partner-application.schemas.js';

/**
 * Creates and configures the Express router for administrative partner applications.
 * Base path: /api/v1/admin/partner-applications
 */
export function createAdminPartnerApplicationRouter(
  controller: AdminPartnerApplicationController = adminPartnerApplicationController,
): Router {
  const router = Router();
  const apiLimiter = createApiRateLimiter();

  // API 1: Create Partner Application (Intake)
  router.post(
    '/',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_ONBOARD),
    validateBody(createPartnerApplicationSchema),
    controller.createApplication,
  );

  // List partner applications with filtering and pagination
  router.get(
    '/',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateQuery(adminPartnerApplicationQuerySchema),
    controller.listApplications,
  );

  // Get application detail by ID
  router.get(
    '/:id',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateParams(partnerApplicationIdParamSchema),
    controller.getApplicationById,
  );

  // API 2: Move Application to Review
  router.post(
    '/:id/review',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(partnerApplicationIdParamSchema),
    controller.reviewApplication,
  );

  // API 3: Reject Partner Application
  router.post(
    '/:id/reject',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(partnerApplicationIdParamSchema),
    validateBody(rejectPartnerApplicationSchema),
    controller.rejectApplication,
  );

  // Withdraw Partner Application
  router.post(
    '/:id/withdraw',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(partnerApplicationIdParamSchema),
    validateBody(withdrawPartnerApplicationSchema),
    controller.withdrawApplication,
  );

  // API 4: Approve Partner Application Gate
  router.post(
    '/:id/approve',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(partnerApplicationIdParamSchema),
    validateBody(approvePartnerApplicationSchema),
    controller.approveApplication,
  );

  return router;
}

export const adminPartnerApplicationRouter = createAdminPartnerApplicationRouter();
