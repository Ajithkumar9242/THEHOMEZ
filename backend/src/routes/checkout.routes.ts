import { Router } from 'express';
import { checkoutSessionIdParamSchema, idempotencyKeyHeaderSchema, prepareCheckoutSchema } from '@thehomez/shared-types';
import { createApiRateLimiter, authenticate, requireCustomerPrincipal, validateBody, validateParams } from '../middleware/index.js';
import { CheckoutController } from '../controllers/checkout.controller.js';

export function createCheckoutRouter(controller = new CheckoutController()): Router {
  const router = Router(); const limiter = createApiRateLimiter();
  router.post('/prepare', limiter, authenticate, requireCustomerPrincipal, (req, _res, next) => {
    const parsed = idempotencyKeyHeaderSchema.safeParse(req.get('Idempotency-Key'));
    if (!parsed.success) { const err = Object.assign(new Error('Invalid or missing Idempotency-Key'), { code: req.get('Idempotency-Key') ? 'INVALID_IDEMPOTENCY_KEY' : 'IDEMPOTENCY_KEY_REQUIRED', statusCode: 400 }); next(err); return; }
    next();
  }, validateBody(prepareCheckoutSchema), controller.prepare);
  router.get('/sessions/:sessionId', limiter, authenticate, requireCustomerPrincipal, validateParams(checkoutSessionIdParamSchema), controller.get);
  return router;
}
