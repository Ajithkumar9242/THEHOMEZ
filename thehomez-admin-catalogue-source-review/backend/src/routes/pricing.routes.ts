import { Router } from 'express';
import { optionalAuthenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { pricingController } from '../controllers/pricing.controller.js';
import { calculatePriceSchema } from './pricing.schemas.js';

export const pricingRouter: Router = Router();

/**
 * Public: Calculate authoritative catalogue selling price.
 * Optional authentication: Authenticated users automatically receive verified B2B wholesale rates if eligible.
 * POST /api/v1/pricing/calculate
 */
pricingRouter.post(
  '/calculate',
  optionalAuthenticate,
  validateBody(calculatePriceSchema),
  (req, res, next) => pricingController.calculatePrice(req, res, next),
);
