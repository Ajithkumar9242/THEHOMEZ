import { Router } from 'express';
import { z } from 'zod';
import {
  acknowledgeCartPricesSchema,
  addCartItemSchema,
  cartItemIdParamSchema,
  updateCartItemQuantitySchema,
  updateCartLocationSchema,
  validateCartSchema,
} from '@thehomez/shared-types';
import {
  createApiRateLimiter,
  enforceOptionalCustomerPrincipal,
  optionalAuthenticate,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/index.js';
import { CartController } from '../controllers/cart.controller.js';

const emptyQuerySchema = z.object({}).strict();

const removeCartItemQuerySchema = z
  .object({
    expectedVersion: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/, 'expectedVersion must be a non-negative integer')
      .transform((val) => Number(val))
      .refine((val) => Number.isSafeInteger(val), 'expectedVersion must be a safe integer')
      .optional(),
  })
  .strict();

const clearCartBodySchema = z.preprocess(
  (val) => (val === undefined ? {} : val),
  z
    .object({
      expectedVersion: z.number().int().min(0).optional(),
    })
    .strict(),
);

/**
 * Customer Shopping Cart Router (Milestone 5B.2 + 5B.3)
 *
 * Base path: /api/v1/cart
 *
 * All routes enforce:
 * 1. API rate limiting
 * 2. Optional Bearer JWT authentication (optionalAuthenticate)
 * 3. Active CUSTOMER principal enforcement when authenticated + anti-spoofing (enforceOptionalCustomerPrincipal)
 *    or validated guest UUID v4 session token header in CartController
 * 4. Strict Zod schema validation (.strict() query, params, and body)
 */
export function createCartRouter(controller?: CartController): Router {
  const router = Router();
  const resolvedController = controller || new CartController();
  const apiLimiter = createApiRateLimiter();

  router.get(
    '/',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    resolvedController.getCart,
  );

  router.post(
    '/items',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    validateBody(addCartItemSchema),
    resolvedController.addItem,
  );

  router.patch(
    '/items/:itemId',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateParams(cartItemIdParamSchema),
    validateQuery(emptyQuerySchema),
    validateBody(updateCartItemQuantitySchema),
    resolvedController.updateItemQuantity,
  );

  router.delete(
    '/items/:itemId',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateParams(cartItemIdParamSchema),
    validateQuery(removeCartItemQuerySchema),
    resolvedController.removeItem,
  );

  router.patch(
    '/location',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    validateBody(updateCartLocationSchema),
    resolvedController.updateLocation,
  );

  router.post(
    '/validate',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    validateBody(validateCartSchema),
    resolvedController.validateCart,
  );

  router.post(
    '/acknowledge-prices',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    validateBody(acknowledgeCartPricesSchema),
    resolvedController.acknowledgePrices,
  );

  router.post(
    '/clear',
    apiLimiter,
    optionalAuthenticate,
    enforceOptionalCustomerPrincipal,
    validateQuery(emptyQuerySchema),
    validateBody(clearCartBodySchema),
    resolvedController.clearCart,
  );

  return router;
}

export const cartRouter = createCartRouter();
