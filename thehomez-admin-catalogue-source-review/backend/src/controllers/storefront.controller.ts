import type { Request, Response, NextFunction } from 'express';
import type {
  IApiResponse,
  IStorefrontProductListResponse,
  IStorefrontProductDetailResponse,
  IStorefrontProductQuery,
  IStorefrontSearchQuery,
} from '@thehomez/shared-types';
import {
  storefrontDiscoveryService,
  StorefrontDiscoveryService,
} from '../services/catalog/storefront-discovery.service.js';
import type { AuthContext } from '../services/pricing/pricing-engine.service.js';

/**
 * Consumer Storefront Discovery & Browsing Controller.
 * Handles public and authenticated catalog exploration, product detail resolution,
 * and full-text keyword search.
 */
export class StorefrontController {
  constructor(private readonly service: StorefrontDiscoveryService = storefrontDiscoveryService) {
    this.listProducts = this.listProducts.bind(this);
    this.getProductBySlug = this.getProductBySlug.bind(this);
    this.searchProducts = this.searchProducts.bind(this);
  }

  /**
   * Public / Authenticated: List products with bounded pagination, filters, sorting & availability.
   * GET /api/v1/storefront/products
   */
  public async listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IStorefrontProductQuery;
      const authContext = this.extractAuthContext(req);

      const result = await this.service.listProducts(query, authContext);

      const response: IApiResponse<IStorefrontProductListResponse> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public / Authenticated: Retrieve complete product detail and active priced variants by slug.
   * GET /api/v1/storefront/products/:slug
   */
  public async getProductBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = String(req.params.slug);
      const pincode = req.query.pincode ? String(req.query.pincode) : undefined;
      const authContext = this.extractAuthContext(req);

      const result = await this.service.getProductBySlug(slug, pincode, authContext);

      const response: IApiResponse<IStorefrontProductDetailResponse> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public / Authenticated: Full-text search with text relevance scoring and bounded batch collation.
   * GET /api/v1/storefront/search
   */
  public async searchProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as IStorefrontSearchQuery;
      const authContext = this.extractAuthContext(req);

      const result = await this.service.searchProducts(query, authContext);

      const response: IApiResponse<IStorefrontProductListResponse> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Helper extracting authenticated context from verified principal (if present).
   * Note: Customer segment and B2B role verification is strictly resolved against the database
   * in StorefrontDiscoveryService (Op 1) to enforce instant revocation and reject client-supplied claims.
   */
  private extractAuthContext(req: Request): AuthContext | undefined {
    if (!req.user || !req.user.id) {
      return undefined;
    }
    return {
      userId: req.user.id,
      roles: req.user.roles,
    };
  }
}

export const storefrontController = new StorefrontController();
