import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import { authenticate, optionalAuthenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.middleware.js';
import { unitController } from '../controllers/unit.controller.js';
import {
  unitCodeParamSchema,
  unitQuerySchema,
  updateUnitSchema,
  convertUnitSchema,
  validateQuantitySchema,
} from './unit.schemas.js';

export const unitRouter: Router = Router();

// ==========================================
// 1. SPECIFIC / UTILITY ROUTES (Precede /:code)
// ==========================================

/**
 * Public: List universal unit conversions.
 * GET /api/v1/units/conversions
 */
unitRouter.get('/conversions', (req, res, next) => unitController.listConversions(req, res, next));

/**
 * Public: Convert quantity between dimensionally compatible units.
 * POST /api/v1/units/convert
 */
unitRouter.post('/convert', validateBody(convertUnitSchema), (req, res, next) =>
  unitController.convertQuantity(req, res, next),
);

/**
 * Public / Admin: Validate proposed ordering quantity against product rules.
 * POST /api/v1/units/validate-quantity
 */
unitRouter.post(
  '/validate-quantity',
  optionalAuthenticate,
  validateBody(validateQuantitySchema),
  (req, res, next) => unitController.validateQuantity(req, res, next),
);

// ==========================================
// 2. UNIT DISCOVERY & MANAGEMENT ROUTES
// ==========================================

/**
 * Public: List construction units.
 * GET /api/v1/units
 */
unitRouter.get('/', optionalAuthenticate, validateQuery(unitQuerySchema), (req, res, next) =>
  unitController.listUnits(req, res, next),
);

/**
 * Public: Retrieve unit details by code.
 * GET /api/v1/units/:code
 */
unitRouter.get('/:code', validateParams(unitCodeParamSchema), (req, res, next) =>
  unitController.getUnitByCode(req, res, next),
);

/**
 * Admin: Update unit master metadata.
 * PATCH /api/v1/units/:code
 */
unitRouter.patch(
  '/:code',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(unitCodeParamSchema),
  validateBody(updateUnitSchema),
  (req, res, next) => unitController.updateUnit(req, res, next),
);
