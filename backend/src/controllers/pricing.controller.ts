import type { Request, Response, NextFunction } from 'express';
import type {
  IApiResponse,
  IProductPricing,
  IPriceHistory,
  IPricingCalculationResponseDto,
  ISetPricingDto,
  IPricingCalculationRequestDto,
} from '@thehomez/shared-types';
import { pricingService, type PricingService } from '../services/pricing/pricing.service.js';

export class PricingController {
  constructor(private readonly service: PricingService = pricingService) {}

  /**
   * Admin: Set or update pricing for a standalone product.
   * PUT /api/v1/products/:id/pricing
   */
  public async setStandalonePricing(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = String(req.params.id);
      const dto: ISetPricingDto = req.body;
      const pricing = await this.service.setStandalonePricing(id, dto, req.user, {
        expectedVersion: req.body.expectedVersion,
      });

      const response: IApiResponse<{ pricing: IProductPricing }> = {
        success: true,
        data: { pricing },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve pricing records for a standalone product.
   * GET /api/v1/products/:id/pricing
   */
  public async getStandalonePricing(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = String(req.params.id);
      const serviceAreaId = req.query.serviceAreaId ? String(req.query.serviceAreaId) : undefined;
      const items = await this.service.getStandalonePricing(id, serviceAreaId, req.user);

      const response: IApiResponse<{ items: IProductPricing[] }> = {
        success: true,
        data: { items },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Set or update pricing for a product variant.
   * PUT /api/v1/products/:productId/variants/:variantId/pricing
   */
  public async setVariantPricing(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const dto: ISetPricingDto = req.body;
      const pricing = await this.service.setVariantPricing(productId, variantId, dto, req.user, {
        expectedVersion: req.body.expectedVersion,
      });

      const response: IApiResponse<{ pricing: IProductPricing }> = {
        success: true,
        data: { pricing },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve pricing records for a product variant.
   * GET /api/v1/products/:productId/variants/:variantId/pricing
   */
  public async getVariantPricing(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.productId);
      const variantId = String(req.params.variantId);
      const serviceAreaId = req.query.serviceAreaId ? String(req.query.serviceAreaId) : undefined;
      const items = await this.service.getVariantPricing(
        productId,
        variantId,
        serviceAreaId,
        req.user,
      );

      const response: IApiResponse<{ items: IProductPricing[] }> = {
        success: true,
        data: { items },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Retrieve paginated price audit history for a product or variant.
   * GET /api/v1/products/:id/pricing/history
   */
  public async getPricingHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id);
      const variantId = req.query.variantId ? String(req.query.variantId) : undefined;
      const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;

      const result = await this.service.getPricingHistory(
        { productId, variantId, page, limit },
        req.user,
      );

      const response: IApiResponse<{
        items: IPriceHistory[];
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
   * Public: Calculate authoritative catalogue selling price.
   * POST /api/v1/pricing/calculate
   */
  public async calculatePrice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const requestDto: IPricingCalculationRequestDto = req.body;
      const result = await this.service.calculateEffectivePrice(requestDto, req.user);

      const response: IApiResponse<IPricingCalculationResponseDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const pricingController = new PricingController();
