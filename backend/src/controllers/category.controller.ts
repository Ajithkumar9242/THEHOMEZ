import type { Request, Response, NextFunction } from 'express';
import type {
  IApiResponse,
  ICategoryTreeItem,
  ICategoryDetailsResponse,
  ICategory,
} from '@thehomez/shared-types';
import { PermissionCode, UserType } from '@thehomez/shared-types';
import { categoryService, CategoryService } from '../services/catalog/category.service.js';
import { logger } from '../logger/logger.js';

export class CategoryController {
  /**
   * Helper to determine whether the request context has permission to view inactive categories.
   * Strictly limited to internal STAFF principals holding CATALOG_READ permission.
   * Anonymous callers, customers, partners, and unauthorized staff are strictly rejected.
   */
  private static canViewInactive(req: Request): boolean {
    if (!req.user || !req.user.permissions) return false;
    if (req.user.userType !== UserType.STAFF) return false;
    return req.user.permissions.includes(PermissionCode.CATALOG_READ);
  }

  /**
   * Public / Admin: Retrieve full two-tier category hierarchy tree.
   * Public callers only receive active categories and subcategories.
   * Authorized catalog managers can pass ?includeInactive=true to inspect drafts/inactive hubs.
   */
  public async getCategoryTree(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const includeInactive =
        String(req.query.includeInactive) === 'true' && CategoryController.canViewInactive(req);

      const categories = await categoryService.getCategoryTree(includeInactive);

      const response: IApiResponse<{ categories: ICategoryTreeItem[] }> = {
        success: true,
        data: { categories },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public / Admin: Retrieve category details and subcategories by URL slug.
   */
  public async getCategoryBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const includeInactive =
        String(req.query.includeInactive) === 'true' && CategoryController.canViewInactive(req);

      const slug = String(req.params.slug);
      const result = await categoryService.getCategoryBySlug(slug, includeInactive);

      const response: IApiResponse<ICategoryDetailsResponse> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve category details by internal ID.
   */
  public async getCategoryById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const category = await categoryService.getCategoryById(id);

      const response: IApiResponse<{ category: ICategory }> = {
        success: true,
        data: { category: CategoryService.toCategoryDto(category) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Create a new category or subcategory (requires CATALOG_WRITE).
   * Audited under FR-ADM-009.
   */
  public async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const newCategory = await categoryService.createCategory(req.body);

      logger.info(
        {
          audit: true,
          action: 'CATEGORY_CREATE',
          categoryId: newCategory._id.toString(),
          slug: newCategory.slug,
          level: newCategory.level,
          performedBy: req.user?.id,
          correlationId: req.correlationId,
        },
        'Audit: Category created successfully',
      );

      const response: IApiResponse<{ category: ICategory }> = {
        success: true,
        data: { category: CategoryService.toCategoryDto(newCategory) },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Update an existing category (requires CATALOG_WRITE).
   * Audited under FR-ADM-009.
   */
  public async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const updatedCategory = await categoryService.updateCategory(id, req.body);

      logger.info(
        {
          audit: true,
          action: 'CATEGORY_UPDATE',
          categoryId: updatedCategory._id.toString(),
          slug: updatedCategory.slug,
          isActive: updatedCategory.isActive,
          performedBy: req.user?.id,
          correlationId: req.correlationId,
        },
        'Audit: Category updated successfully',
      );

      const response: IApiResponse<{ category: ICategory }> = {
        success: true,
        data: { category: CategoryService.toCategoryDto(updatedCategory) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Delete a category (requires CATALOG_WRITE).
   * Audited under FR-ADM-009.
   */
  public async deleteCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      await categoryService.deleteCategory(id);

      logger.info(
        {
          audit: true,
          action: 'CATEGORY_DELETE',
          categoryId: id,
          performedBy: req.user?.id,
          correlationId: req.correlationId,
        },
        'Audit: Category deleted successfully',
      );

      const response: IApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Category deleted successfully' },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const categoryController = new CategoryController();
