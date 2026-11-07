import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { serviceAreaController } from '../controllers/service-area.controller.js';
import { createServiceAreaSchema, updateServiceAreaSchema } from './service-area.schemas.js';

export const serviceAreaRouter: Router = Router();

/**
 * Public Location Eligibility Lookup:
 * GET /api/v1/service-areas/check?pincode=560037
 */
serviceAreaRouter.get('/check', (req, res, next) =>
  serviceAreaController.checkPincode(req, res, next),
);

/**
 * Administrative: List all service areas with optional filters & pagination
 * GET /api/v1/service-areas
 */
serviceAreaRouter.get(
  '/',
  authenticate,
  authorize(PermissionCode.SERVICE_AREA_READ),
  (req, res, next) => serviceAreaController.listServiceAreas(req, res, next),
);

/**
 * Administrative: Create a new service area
 * POST /api/v1/service-areas
 */
serviceAreaRouter.post(
  '/',
  authenticate,
  authorize(PermissionCode.SERVICE_AREA_WRITE),
  validateBody(createServiceAreaSchema),
  (req, res, next) => serviceAreaController.createServiceArea(req, res, next),
);

/**
 * Administrative: Retrieve service area details
 * GET /api/v1/service-areas/:id
 */
serviceAreaRouter.get(
  '/:id',
  authenticate,
  authorize(PermissionCode.SERVICE_AREA_READ),
  (req, res, next) => serviceAreaController.getServiceAreaById(req, res, next),
);

/**
 * Administrative: Update service area details, active status, or PIN codes
 * PATCH /api/v1/service-areas/:id
 */
serviceAreaRouter.patch(
  '/:id',
  authenticate,
  authorize(PermissionCode.SERVICE_AREA_WRITE),
  validateBody(updateServiceAreaSchema),
  (req, res, next) => serviceAreaController.updateServiceArea(req, res, next),
);

/**
 * Administrative: Inspect active partners servicing this service area
 * GET /api/v1/service-areas/:id/partners
 */
serviceAreaRouter.get(
  '/:id/partners',
  authenticate,
  authorize([PermissionCode.SERVICE_AREA_READ, PermissionCode.PARTNER_READ]),
  (req, res, next) => serviceAreaController.getPartnersForServiceArea(req, res, next),
);
