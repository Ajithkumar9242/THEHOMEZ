import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse, IProductVariant } from '@thehomez/shared-types';
import {
  productVariantService,
  ProductVariantService,
} from '../services/catalog/product-variant.service.js';

export class ProductVariantController {
  /**
   * Admin: Add variant to a multi-variant product.
   */
  public async createVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const permissions = req.user?.permissions || [];
      const variant = await productVariantService.createVariant(productId, req.body, permissions);

      const response: IApiResponse<{ variant: IProductVariant }> = {
        success: true,
        data: { variant: ProductVariantService.toVariantDto(variant) },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: List variants for a product.
   */
  public async listVariants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variants = await productVariantService.listVariants(productId);

      const response: IApiResponse<{ variants: IProductVariant[] }> = {
        success: true,
        data: { variants: variants.map(ProductVariantService.toVariantDto) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve variant details by ID under a product.
   */
  public async getVariantById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const variant = await productVariantService.getVariantById(productId, variantId);

      const response: IApiResponse<{ variant: IProductVariant }> = {
        success: true,
        data: { variant: ProductVariantService.toVariantDto(variant) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Update variant metadata, attributes, or status (activation/publication).
   */
  public async updateVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const permissions = req.user?.permissions || [];
      const variant = await productVariantService.updateVariant(
        productId,
        variantId,
        req.body,
        permissions,
      );

      const response: IApiResponse<{ variant: IProductVariant }> = {
        success: true,
        data: { variant: ProductVariantService.toVariantDto(variant) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Deactivate variant.
   */
  public async deactivateVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const variant = await productVariantService.deactivateVariant(productId, variantId);

      const response: IApiResponse<{ variant: IProductVariant }> = {
        success: true,
        data: { variant: ProductVariantService.toVariantDto(variant) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Archive variant.
   */
  public async archiveVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const userId = req.user?.id as string;
      const variant = await productVariantService.archiveVariant(productId, variantId, userId);

      const response: IApiResponse<{ variant: IProductVariant }> = {
        success: true,
        data: { variant: ProductVariantService.toVariantDto(variant) },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const productVariantController = new ProductVariantController();
