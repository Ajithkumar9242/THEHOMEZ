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
  updatePartnerProfileSchema,
  adminPartnerAuditLogsQuerySchema,
  adminPartnerDocumentsQuerySchema,
  adminPartnerDocParamSchema,
  emptyQuerySchema,
  scanOverrideSchema,
  reviewPartnerDocumentSchema,
  reactivatePartnerSchema,
} from './admin-partner.schemas.js';
import { assignPartnerServiceAreasSchema } from './service-area.schemas.js';

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

  // API (P1A-13): Partner profile edit
  router.put(
    '/:partnerId',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_WRITE),
    validateParams(adminPartnerIdParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(updatePartnerProfileSchema),
    controller.updatePartnerProfile,
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

  // API 5 (P1A-08): Partner KYC document metadata inspection
  router.get(
    '/:partnerId/documents',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateParams(adminPartnerIdParamSchema),
    validateQuery(adminPartnerDocumentsQuerySchema),
    controller.getPartnerDocuments,
  );

  // API 6 (P1A-09): Expiring signed download URL generation with unified KYC eligibility
  router.get(
    '/:partnerId/documents/:docId/signed-url',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_READ),
    validateParams(adminPartnerDocParamSchema),
    validateQuery(emptyQuerySchema),
    controller.getPartnerDocumentSignedUrl,
  );

  // API 7 (P1A-10): Soft deletion and storage cleanup trigger for partner KYC document
  router.delete(
    '/:partnerId/documents/:docId',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_WRITE),
    validateParams(adminPartnerDocParamSchema),
    validateQuery(emptyQuerySchema),
    controller.deletePartnerDocument,
  );

  // API 8 (P1A-11): Manual security override for partner KYC document scan status
  router.post(
    '/:partnerId/documents/:docId/scan-override',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize([PermissionCode.PARTNER_VERIFY, PermissionCode.RBAC_MANAGE], { mode: 'ALL' }),
    validateParams(adminPartnerDocParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(scanOverrideSchema),
    controller.overrideDocumentScanStatus,
  );

  // API (P1A-15): Partner KYC document review (verify or reject)
  router.patch(
    '/:partnerId/documents/:docId/status',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(adminPartnerDocParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(reviewPartnerDocumentSchema),
    controller.reviewPartnerDocument,
  );

  // API (P1A-14): Partner reactivation with KYC proof validation and supervisory waiver
  router.post(
    '/:partnerId/reactivate',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.PARTNER_VERIFY),
    validateParams(adminPartnerIdParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(reactivatePartnerSchema),
    controller.reactivatePartner,
  );

  // API (P1A-16): Dedicated administrative partner service area assignment
  router.put(
    '/:partnerId/service-areas',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.SERVICE_AREA_WRITE),
    validateParams(adminPartnerIdParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(assignPartnerServiceAreasSchema),
    controller.assignPartnerServiceAreas,
  );

  return router;
}

export const adminPartnerRouter = createAdminPartnerRouter();
