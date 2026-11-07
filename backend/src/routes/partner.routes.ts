import { Router } from 'express';
import { PermissionCode, UserType } from '@thehomez/shared-types';
import { authenticate, authorize, partnerTenantGuard } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { serviceAreaController } from '../controllers/service-area.controller.js';
import { assignPartnerServiceAreasSchema } from './service-area.schemas.js';

export const partnerRouter: Router = Router();

/**
 * Administrative: Assign or update service areas for a partner
 * PUT /api/v1/partners/:partnerId/service-areas
 */
partnerRouter.put(
  '/:partnerId/service-areas',
  authenticate,
  authorize(
    [
      PermissionCode.SERVICE_AREA_WRITE,
      PermissionCode.PARTNER_VERIFY,
      PermissionCode.PARTNER_ONBOARD,
    ],
    { mode: 'ANY' },
  ),
  validateBody(assignPartnerServiceAreasSchema),
  (req, res, next) => serviceAreaController.assignPartnerServiceAreas(req, res, next),
);

/**
 * Partner / Administrative: Retrieve service areas assigned to a partner
 * GET /api/v1/partners/:partnerId/service-areas
 *
 * Tenant Isolation:
 * - If principal is PARTNER: partnerTenantGuard enforces that req.params.partnerId === req.user.partnerId.
 * - If principal is STAFF: requires PARTNER_READ or SERVICE_AREA_READ permission.
 */
partnerRouter.get(
  '/:partnerId/service-areas',
  authenticate,
  partnerTenantGuard,
  (req, res, next) => {
    // If not a partner (e.g. staff), ensure administrative read permissions
    if (req.user?.userType !== UserType.PARTNER) {
      return authorize([PermissionCode.PARTNER_READ, PermissionCode.SERVICE_AREA_READ], {
        mode: 'ANY',
      })(req, res, next);
    }
    next();
  },
  (req, res, next) => serviceAreaController.getPartnerServiceAreas(req, res, next),
);
