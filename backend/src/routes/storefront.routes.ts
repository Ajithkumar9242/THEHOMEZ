import { Router } from 'express';
import { optionalAuthenticate } from '../middleware/auth.middleware.js';
import { validateQuery, validateParams } from '../middleware/validate.middleware.js';
import { createApiRateLimiter } from '../middleware/rate-limiter.middleware.js';
import {
  storefrontController,
  StorefrontController,
} from '../controllers/storefront.controller.js';
import {
  storefrontProductQuerySchema,
  storefrontProductSlugParamSchema,
  storefrontProductDetailQuerySchema,
  storefrontSearchQuerySchema,
} from './storefront.schemas.js';

/**
 * Creates and configures the Express Router for Storefront Discovery & Browsing.
 */
export function createStorefrontRouter(
  controller: StorefrontController = storefrontController,
): Router {
  const router = Router();
  const apiRateLimiter = createApiRateLimiter();

  // Apply standard API rate limiter to all storefront discovery routes
  router.use(apiRateLimiter);

  // 1. Storefront Product Listing: GET /api/v1/storefront/products
  router.get(
    '/products',
    optionalAuthenticate,
    validateQuery(storefrontProductQuerySchema),
    controller.listProducts,
  );

  // 2. Storefront Product Detail by Slug: GET /api/v1/storefront/products/:slug
  router.get(
    '/products/:slug',
    optionalAuthenticate,
    validateParams(storefrontProductSlugParamSchema),
    validateQuery(storefrontProductDetailQuerySchema),
    controller.getProductBySlug,
  );

  // 3. Storefront Keyword Search: GET /api/v1/storefront/search
  router.get(
    '/search',
    optionalAuthenticate,
    validateQuery(storefrontSearchQuerySchema),
    controller.searchProducts,
  );

  return router;
}

export const storefrontRouter: Router = createStorefrontRouter();
