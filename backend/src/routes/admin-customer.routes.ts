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
  type AdminCustomerController,
  adminCustomerController,
} from '../controllers/admin-customer.controller.js';
import {
  adminCustomerQuerySchema,
  adminCustomerIdParamSchema,
  updateCustomerStatusSchema,
  updateCustomerB2bStatusSchema,
} from './admin-customer.schemas.js';

/**
 * Creates and configures the Express router for administrative customer operations.
 * Base path: /api/v1/admin/customers
 */
export function createAdminCustomerRouter(
  controller: AdminCustomerController = adminCustomerController,
): Router {
  const router = Router();
  const apiLimiter = createApiRateLimiter();

  // API 1: List customer directory with pagination, search, and filtering
  router.get(
    '/',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.CUSTOMER_READ),
    validateQuery(adminCustomerQuerySchema),
    controller.listCustomers,
  );

  // API 2: Customer detail inspection
  router.get(
    '/:id',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.CUSTOMER_READ),
    validateParams(adminCustomerIdParamSchema),
    controller.getCustomerById,
  );

  // API 3: Customer delivery address inspection (read-only)
  router.get(
    '/:id/addresses',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.CUSTOMER_READ),
    validateParams(adminCustomerIdParamSchema),
    controller.getCustomerAddresses,
  );

  // API 4: Customer account lifecycle status update (ACTIVE <-> SUSPENDED)
  router.patch(
    '/:id/status',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.CUSTOMER_SUSPEND),
    validateParams(adminCustomerIdParamSchema),
    validateBody(updateCustomerStatusSchema),
    controller.updateCustomerStatus,
  );

  // API 5: B2B wholesale contractor verification
  router.patch(
    '/:id/b2b-status',
    apiLimiter,
    authenticate,
    staffOnlyGuard,
    authorize(PermissionCode.B2B_VERIFY),
    validateParams(adminCustomerIdParamSchema),
    validateBody(updateCustomerB2bStatusSchema),
    controller.updateB2bStatus,
  );

  return router;
}

export const adminCustomerRouter: Router = createAdminCustomerRouter();
