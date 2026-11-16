import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse, IProduct } from '@thehomez/shared-types';
import { productService, ProductService } from '../services/catalog/product.service.js';

export class ProductController {
  /**
   * Admin: Create a new product.
   */
  public async createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id as string;
      const permissions = req.user?.permissions || [];
      const product = await productService.createProduct(req.body, userId, permissions);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: List products with pagination and filters.
   */
  public async listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await productService.listProducts(req.query as Record<string, unknown>);

      const response: IApiResponse<{
        items: IProduct[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve product by internal ID.
   */
  public async getProductById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const product = await productService.getProductById(id);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve product by slug.
   */
  public async getProductBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = String(req.params.slug);
      const product = await productService.getProductBySlug(slug);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Update product details.
   */
  public async updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const userId = req.user?.id as string;
      const product = await productService.updateProduct(id, req.body, userId);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Publish product (transitions to ACTIVE).
   */
  public async publishProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const userId = req.user?.id as string;
      const product = await productService.publishProduct(id, userId);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Deactivate product (transitions to INACTIVE).
   */
  public async deactivateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const userId = req.user?.id as string;
      const product = await productService.deactivateProduct(id, userId);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Archive product (transitions to ARCHIVED and cascades).
   */
  public async archiveProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const userId = req.user?.id as string;
      const product = await productService.archiveProduct(id, userId);

      const response: IApiResponse<{ product: IProduct }> = {
        success: true,
        data: { product: ProductService.toProductDto(product) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Delete draft product (strictly unpublished DRAFT only).
   */
  public async deleteDraftProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      await productService.deleteDraftProduct(id);

      const response: IApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Draft product deleted successfully' },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: List active products for public storefront.
   */
  public async listPublicProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await productService.listPublicProducts(req.query as Record<string, unknown>);

      const response: IApiResponse<{
        items: IProduct[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: Retrieve public product detail by slug.
   */
  public async getPublicProductBySlug(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const slug = String(req.params.slug);
      const result = await productService.getPublicProductBySlug(slug);

      const response: IApiResponse<{ product: IProduct; variants: unknown[] }> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const productController = new ProductController();
