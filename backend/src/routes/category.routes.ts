import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import {
  authenticate,
  optionalAuthenticate,
  authorize,
  staffOnlyGuard,
} from '../middleware/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.middleware.js';
import { categoryController } from '../controllers/category.controller.js';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema,
  listCategoriesQuerySchema,
} from './category.schemas.js';

export const categoryRouter: Router = Router();

/**
 * Public / Contextual: Retrieve two-tier category hierarchy tree.
 * GET /api/v1/categories
 *
 * Query options:
 * - includeInactive=true (requires authenticated staff with CATALOG_READ)
 */
categoryRouter.get(
  '/',
  optionalAuthenticate,
  validateQuery(listCategoriesQuerySchema),
  (req, res, next) => categoryController.getCategoryTree(req, res, next),
);

/**
 * Public / Contextual: Retrieve single category details with subcategories by slug.
 * GET /api/v1/categories/:slug
 */
categoryRouter.get('/:slug', optionalAuthenticate, (req, res, next) =>
  categoryController.getCategoryBySlug(req, res, next),
);

/**
 * Administrative: Retrieve category by internal MongoDB ObjectId.
 * GET /api/v1/categories/id/:id
 */
categoryRouter.get(
  '/id/:id',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_READ),
  validateParams(categoryIdParamSchema),
  (req, res, next) => categoryController.getCategoryById(req, res, next),
);

/**
 * Administrative: Create a new category or subcategory.
 * POST /api/v1/categories
 */
categoryRouter.post(
  '/',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_WRITE),
  validateBody(createCategorySchema),
  (req, res, next) => categoryController.createCategory(req, res, next),
);

/**
 * Administrative: Update category details, parent, active status, or display order.
 * PATCH /api/v1/categories/:id
 */
categoryRouter.patch(
  '/:id',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(categoryIdParamSchema),
  validateBody(updateCategorySchema),
  (req, res, next) => categoryController.updateCategory(req, res, next),
);

/**
 * Administrative: Delete a category (only if it has no child subcategories and no products).
 * DELETE /api/v1/categories/:id
 */
categoryRouter.delete(
  '/:id',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_WRITE),
  validateParams(categoryIdParamSchema),
  (req, res, next) => categoryController.deleteCategory(req, res, next),
);
