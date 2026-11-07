import { Router, type Request, type Response, type NextFunction } from 'express';
import { PermissionCode, UserType } from '@thehomez/shared-types';
import {
  authenticate,
  optionalAuthenticate,
  authorize,
  partnerTenantGuard,
} from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.middleware.js';
import { partnerAvailabilityController } from '../controllers/partner-availability.controller.js';
import {
  setPartnerAvailabilitySchema,
  togglePartnerAvailabilitySchema,
  batchPartnerAvailabilityRequestSchema,
  getPartnerAvailabilityQuerySchema,
  partnerAvailabilityIdParamSchema,
  adminPartnerIdParamSchema,
  adminPartnerAvailabilityItemParamSchema,
  getPartnerAvailabilityHistoryQuerySchema,
  publicAvailabilityQuerySchema,
} from './partner-availability.schemas.js';

export const partnerAvailabilityRouter: Router = Router();
export const adminPartnerAvailabilityRouter: Router = Router();

/**
 * Staff-Only Administrative Guard Middleware
 *
 * Enforces that only authenticated principals with userType === UserType.STAFF
 * are permitted to access administrative oversight routes.
 * Rejects non-STAFF principals (e.g. PARTNER, CUSTOMER) with HTTP 403 FORBIDDEN,
 * even if they possess the permission code and supply their own partner tenant ID.
 */
export function staffOnlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required prior to administrative authorization',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  if (req.user.userType !== UserType.STAFF) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: administrative partner routes are restricted to staff principals',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  next();
}

// ============================================================================
// 1. PUBLIC STOREFRONT AVAILABILITY RESOLUTION
// (Must precede /:id to prevent matching "public" as an ID param)
// ============================================================================

/**
 * Public: Standalone Step 6 Public Availability Lookup (Decision #48).
 * GET /api/v1/partner/availability/public
 *
 * Middleware Order:
 * 1. Optional Authentication (public access without credentials; associates identity if present)
 * 2. Zod Query Validation (pincode, productId, variantId)
 * 3. Controller execution
 */
partnerAvailabilityRouter.get(
  '/public',
  optionalAuthenticate,
  validateQuery(publicAvailabilityQuerySchema),
  (req, res, next) => partnerAvailabilityController.getPublicAvailability(req, res, next),
);

// ============================================================================
// 2. PROTECTED PARTNER AVAILABILITY MUTATIONS & LISTINGS
// ============================================================================

/**
 * Partner: Paginated listing of partner's availability records.
 * GET /api/v1/partner/availability
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_READ)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Query Validation
 * 5. Controller execution
 */
partnerAvailabilityRouter.get(
  '/',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_READ),
  partnerTenantGuard,
  validateQuery(getPartnerAvailabilityQuerySchema),
  (req, res, next) => partnerAvailabilityController.listPartnerAvailability(req, res, next),
);

/**
 * Partner: Configure or link product availability in an assigned service area.
 * PUT /api/v1/partner/availability
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_WRITE)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Body Validation (rejects unknown / injected tenant / pricing fields)
 * 5. Controller execution
 */
partnerAvailabilityRouter.put(
  '/',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_WRITE),
  partnerTenantGuard,
  validateBody(setPartnerAvailabilitySchema),
  (req, res, next) => partnerAvailabilityController.setAvailability(req, res, next),
);

/**
 * Partner: Atomic bulk stock status updates for 1 to 100 items.
 * POST /api/v1/partner/availability/batch
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_WRITE)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Body Validation (bounded batch array 1..100)
 * 5. Controller execution
 */
partnerAvailabilityRouter.post(
  '/batch',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_WRITE),
  partnerTenantGuard,
  validateBody(batchPartnerAvailabilityRequestSchema),
  (req, res, next) => partnerAvailabilityController.batchUpdateAvailability(req, res, next),
);

/**
 * Partner: Retrieve single availability record details by ID.
 * GET /api/v1/partner/availability/:id
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_READ)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Params Validation (id)
 * 5. Controller execution
 */
partnerAvailabilityRouter.get(
  '/:id',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_READ),
  partnerTenantGuard,
  validateParams(partnerAvailabilityIdParamSchema),
  (req, res, next) => partnerAvailabilityController.getPartnerAvailabilityById(req, res, next),
);

/**
 * Partner: Fast binary stock toggle with optional reason and optimistic locking.
 * PATCH /api/v1/partner/availability/:id
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_WRITE)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Params Validation (id)
 * 5. Zod Body Validation (isAvailable, reason, version)
 * 6. Controller execution
 */
partnerAvailabilityRouter.patch(
  '/:id',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_WRITE),
  partnerTenantGuard,
  validateParams(partnerAvailabilityIdParamSchema),
  validateBody(togglePartnerAvailabilitySchema),
  (req, res, next) => partnerAvailabilityController.toggleAvailability(req, res, next),
);

/**
 * Partner: Retrieve chronological state transition audit history.
 * GET /api/v1/partner/availability/:id/history
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Authorization (PARTNER_AVAILABILITY_READ)
 * 3. Tenant Boundary Isolation (partnerTenantGuard)
 * 4. Zod Params Validation (id)
 * 5. Zod Query Validation (page, limit)
 * 6. Controller execution
 */
partnerAvailabilityRouter.get(
  '/:id/history',
  authenticate,
  authorize(PermissionCode.PARTNER_AVAILABILITY_READ),
  partnerTenantGuard,
  validateParams(partnerAvailabilityIdParamSchema),
  validateQuery(getPartnerAvailabilityHistoryQuerySchema),
  (req, res, next) => partnerAvailabilityController.getPartnerAvailabilityHistory(req, res, next),
);

// ============================================================================
// 3. ADMINISTRATIVE OVERSIGHT ROUTES
// ============================================================================

/**
 * Admin: List availability records for a specific partner across service areas.
 * GET /api/v1/admin/partners/:partnerId/availability
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Staff-Only Guard (strictly rejects non-STAFF principals with 403 FORBIDDEN)
 * 3. Authorization (PARTNER_AVAILABILITY_READ or PARTNER_READ)
 * 4. Tenant Boundary Isolation (partnerTenantGuard)
 * 5. Zod Params Validation (partnerId)
 * 6. Zod Query Validation (page, limit, serviceAreaId, etc.)
 * 7. Controller execution
 */
adminPartnerAvailabilityRouter.get(
  '/:partnerId/availability',
  authenticate,
  staffOnlyGuard,
  authorize([PermissionCode.PARTNER_AVAILABILITY_READ, PermissionCode.PARTNER_READ], {
    mode: 'ANY',
  }),
  partnerTenantGuard,
  validateParams(adminPartnerIdParamSchema),
  validateQuery(getPartnerAvailabilityQuerySchema),
  (req, res, next) => partnerAvailabilityController.adminListPartnerAvailability(req, res, next),
);

/**
 * Admin: Emergency toggle of partner availability.
 * PATCH /api/v1/admin/partners/:partnerId/availability/:id
 *
 * Middleware Order:
 * 1. Authentication
 * 2. Staff-Only Guard (strictly rejects non-STAFF principals with 403 FORBIDDEN)
 * 3. Authorization (PARTNER_AVAILABILITY_WRITE or PARTNER_SUSPEND)
 * 4. Tenant Boundary Isolation (partnerTenantGuard)
 * 5. Zod Params Validation (partnerId, id)
 * 6. Zod Body Validation (isAvailable, reason, version)
 * 7. Controller execution
 */
adminPartnerAvailabilityRouter.patch(
  '/:partnerId/availability/:id',
  authenticate,
  staffOnlyGuard,
  authorize([PermissionCode.PARTNER_AVAILABILITY_WRITE, PermissionCode.PARTNER_SUSPEND], {
    mode: 'ANY',
  }),
  partnerTenantGuard,
  validateParams(adminPartnerAvailabilityItemParamSchema),
  validateBody(togglePartnerAvailabilitySchema),
  (req, res, next) => partnerAvailabilityController.adminTogglePartnerAvailability(req, res, next),
);
