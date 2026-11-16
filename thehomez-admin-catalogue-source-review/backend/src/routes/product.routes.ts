import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import { authenticate, optionalAuthenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.middleware.js';
import { productController } from '../controllers/product.controller.js';
import { productVariantController } from '../controllers/product-variant.controller.js';
import {
  createProductSchema,
  updateProductSchema,
  productIdParamSchema,
  productSlugParamSchema,
  adminProductQuerySchema,
  publicProductQuerySchema,
} from './product.schemas.js';
import {
  createProductVariantSchema,
  updateProductVariantSchema,
  variantParamSchema,
} from './product-variant.schemas.js';
import { pricingController } from '../controllers/pricing.controller.js';
import {
  standalonePricingParamSchema,
  variantPricingParamSchema,
  setPricingSchema,
  getPricingQuerySchema,
  getPricingHistoryQuerySchema,
} from './pricing.schemas.js';

export const productRouter: Router = Router();

// ==========================================
// 1. PUBLIC DISCOVERY ROUTES (Must precede /:id)
// ==========================================

/**
 * Public: List active products for discovery storefront.
 * GET /api/v1/products/public
 */
productRouter.get(
  '/public',
  optionalAuthenticate,
  validateQuery(publicProductQuerySchema),
  (req, res, next) => productController.listPublicProducts(req, res, next),
);

/**
 * Public: Retrieve active product details & active variants by slug.
 * GET /api/v1/products/public/:slug
 */
productRouter.get(
  '/public/:slug',
  optionalAuthenticate,
  validateParams(productSlugParamSchema),
  (req, res, next) => productController.getPublicProductBySlug(req, res, next),
);

// ==========================================
// 2. ADMINISTRATIVE PRODUCT ROUTES
// ==========================================

/**
 * Admin: List products with pagination and filters.
 * GET /api/v1/products
 */
productRouter.get(
  '/',
  authenticate,
  authorize(PermissionCode.CATALOG_READ),
  validateQuery(adminProductQuerySchema),
  (req, res, next) => productController.listProducts(req, res, next),
);

/**
 * Admin: Create a product (draft or immediate publish if holding CATALOG_PUBLISH).
 * POST /api/v1/products
 */
productRouter.post(
  '/',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateBody(createProductSchema),
  (req, res, next) => productController.createProduct(req, res, next),
);

/**
 * Admin: Publish product (transitions to ACTIVE).
 * POST /api/v1/products/:id/publish
 */
productRouter.post(
  '/:id/publish',
  authenticate,
  authorize(PermissionCode.CATALOG_PUBLISH),
  validateParams(productIdParamSchema),
  (req, res, next) => productController.publishProduct(req, res, next),
);

/**
 * Admin: Deactivate product (transitions to INACTIVE).
 * POST /api/v1/products/:id/deactivate
 */
productRouter.post(
  '/:id/deactivate',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(productIdParamSchema),
  (req, res, next) => productController.deactivateProduct(req, res, next),
);

/**
 * Admin: Archive product (transitions to ARCHIVED and cascades).
 * POST /api/v1/products/:id/archive
 */
productRouter.post(
  '/:id/archive',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(productIdParamSchema),
  (req, res, next) => productController.archiveProduct(req, res, next),
);

/**
 * Admin: Delete draft product (only unpublished DRAFT).
 * DELETE /api/v1/products/:id
 */
productRouter.delete(
  '/:id',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(productIdParamSchema),
  (req, res, next) => productController.deleteDraftProduct(req, res, next),
);

/**
 * Admin: Retrieve single product by internal ID.
 * GET /api/v1/products/:id
 */
productRouter.get(
  '/:id',
  authenticate,
  authorize(PermissionCode.CATALOG_READ),
  validateParams(productIdParamSchema),
  (req, res, next) => productController.getProductById(req, res, next),
);

/**
 * Admin: Update product details.
 * PATCH /api/v1/products/:id
 */
productRouter.patch(
  '/:id',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  (req, res, next) => productController.updateProduct(req, res, next),
);

// ==========================================
// 3. PRODUCT VARIANT ROUTES (Nested under /:productId/variants)
// ==========================================

/**
 * Admin: Add variant to a multi-variant product.
 * POST /api/v1/products/:productId/variants
 */
productRouter.post(
  '/:productId/variants',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateBody(createProductVariantSchema),
  (req, res, next) => productVariantController.createVariant(req, res, next),
);

/**
 * Admin: List variants for a product.
 * GET /api/v1/products/:productId/variants
 */
productRouter.get(
  '/:productId/variants',
  authenticate,
  authorize(PermissionCode.CATALOG_READ),
  (req, res, next) => productVariantController.listVariants(req, res, next),
);

/**
 * Admin: Retrieve variant details by ID.
 * GET /api/v1/products/:productId/variants/:variantId
 */
productRouter.get(
  '/:productId/variants/:variantId',
  authenticate,
  authorize(PermissionCode.CATALOG_READ),
  validateParams(variantParamSchema),
  (req, res, next) => productVariantController.getVariantById(req, res, next),
);

/**
 * Admin: Update variant metadata, attributes, or status.
 * PATCH /api/v1/products/:productId/variants/:variantId
 */
productRouter.patch(
  '/:productId/variants/:variantId',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(variantParamSchema),
  validateBody(updateProductVariantSchema),
  (req, res, next) => productVariantController.updateVariant(req, res, next),
);

/**
 * Admin: Deactivate variant.
 * POST /api/v1/products/:productId/variants/:variantId/deactivate
 */
productRouter.post(
  '/:productId/variants/:variantId/deactivate',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(variantParamSchema),
  (req, res, next) => productVariantController.deactivateVariant(req, res, next),
);

/**
 * Admin: Archive variant.
 * POST /api/v1/products/:productId/variants/:variantId/archive
 */
productRouter.post(
  '/:productId/variants/:variantId/archive',
  authenticate,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(variantParamSchema),
  (req, res, next) => productVariantController.archiveVariant(req, res, next),
);

// ==========================================
// 4. PRODUCT PRICING ROUTES
// ==========================================

/**
 * Admin: Retrieve paginated price audit history for a product.
 * GET /api/v1/products/:id/pricing/history
 */
productRouter.get(
  '/:id/pricing/history',
  authenticate,
  authorize(PermissionCode.PRICING_READ),
  validateParams(standalonePricingParamSchema),
  validateQuery(getPricingHistoryQuerySchema),
  (req, res, next) => pricingController.getPricingHistory(req, res, next),
);

/**
 * Admin: Set or update standalone product pricing.
 * PUT /api/v1/products/:id/pricing
 */
productRouter.put(
  '/:id/pricing',
  authenticate,
  authorize(PermissionCode.PRICING_WRITE),
  validateParams(standalonePricingParamSchema),
  validateBody(setPricingSchema),
  (req, res, next) => pricingController.setStandalonePricing(req, res, next),
);

/**
 * Admin: Retrieve pricing records for a standalone product.
 * GET /api/v1/products/:id/pricing
 */
productRouter.get(
  '/:id/pricing',
  authenticate,
  authorize(PermissionCode.PRICING_READ),
  validateParams(standalonePricingParamSchema),
  validateQuery(getPricingQuerySchema),
  (req, res, next) => pricingController.getStandalonePricing(req, res, next),
);

/**
 * Admin: Set or update variant pricing.
 * PUT /api/v1/products/:productId/variants/:variantId/pricing
 */
productRouter.put(
  '/:productId/variants/:variantId/pricing',
  authenticate,
  authorize(PermissionCode.PRICING_WRITE),
  validateParams(variantPricingParamSchema),
  validateBody(setPricingSchema),
  (req, res, next) => pricingController.setVariantPricing(req, res, next),
);

/**
 * Admin: Retrieve pricing records for a variant.
 * GET /api/v1/products/:productId/variants/:variantId/pricing
 */
productRouter.get(
  '/:productId/variants/:variantId/pricing',
  authenticate,
  authorize(PermissionCode.PRICING_READ),
  validateParams(variantPricingParamSchema),
  validateQuery(getPricingQuerySchema),
  (req, res, next) => pricingController.getVariantPricing(req, res, next),
);
