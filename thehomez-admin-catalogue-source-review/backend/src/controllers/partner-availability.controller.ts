import type { Request, Response, NextFunction } from 'express';
import type {
  IApiResponse,
  IPartnerProductDto,
  ISetPartnerProductAvailabilityDto,
  ITogglePartnerAvailabilityDto,
  IBatchPartnerAvailabilityRequestDto,
  IBatchPartnerAvailabilityResponseDto,
  IPartnerAvailabilityHistoryDto,
  IPartnerAvailabilityQueryDto,
  IPublicProductAvailabilityDto,
  IUserPrincipal,
} from '@thehomez/shared-types';
import { PartnerAvailabilityService } from '../services/partner-availability/partner-availability.service.js';

export interface IPaginatedEnvelope<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export class PartnerAvailabilityController {
  constructor(
    private readonly service: PartnerAvailabilityService = new PartnerAvailabilityService(),
  ) {
    this.setAvailability = this.setAvailability.bind(this);
    this.toggleAvailability = this.toggleAvailability.bind(this);
    this.batchUpdateAvailability = this.batchUpdateAvailability.bind(this);
    this.listPartnerAvailability = this.listPartnerAvailability.bind(this);
    this.getPartnerAvailabilityById = this.getPartnerAvailabilityById.bind(this);
    this.getPartnerAvailabilityHistory = this.getPartnerAvailabilityHistory.bind(this);
    this.adminListPartnerAvailability = this.adminListPartnerAvailability.bind(this);
    this.adminTogglePartnerAvailability = this.adminTogglePartnerAvailability.bind(this);
    this.getPublicAvailability = this.getPublicAvailability.bind(this);
  }

  /**
   * Partner: Configure or link product availability in an assigned service area.
   * PUT /api/v1/partner/availability
   */
  public async setAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto: ISetPartnerProductAvailabilityDto = req.body;
      const principal = req.user as IUserPrincipal;

      const result = await this.service.setAvailability(principal, dto);

      // Return 201 Created for newly created links (version === 0), 200 OK for updates
      const statusCode = result.version === 0 ? 201 : 200;

      const response: IApiResponse<IPartnerProductDto> = {
        success: true,
        data: result,
      };

      res.status(statusCode).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partner: Fast binary stock toggle with optional reason and optimistic locking.
   * PATCH /api/v1/partner/availability/:id
   */
  public async toggleAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id);
      const dto: ITogglePartnerAvailabilityDto = req.body;
      const principal = req.user as IUserPrincipal;

      const result = await this.service.toggleAvailability(principal, id, dto);

      const response: IApiResponse<IPartnerProductDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partner: Atomic bulk stock status updates for 1 to 100 items.
   * POST /api/v1/partner/availability/batch
   */
  public async batchUpdateAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const dto: IBatchPartnerAvailabilityRequestDto = req.body;
      const principal = req.user as IUserPrincipal;

      const result = await this.service.batchUpdateAvailability(principal, dto);

      const response: IApiResponse<IBatchPartnerAvailabilityResponseDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partner: Paginated listing of partner's availability records with approved filters.
   * GET /api/v1/partner/availability
   */
  public async listPartnerAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const principal = req.user as IUserPrincipal;
      const query = this.parseQueryFilters(req.query);

      const result = await this.service.listAvailability(principal, query);

      const response: IPaginatedEnvelope<IPartnerProductDto> = {
        success: true,
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalItems: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.page < result.totalPages,
          hasPrevPage: result.page > 1,
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partner: Retrieve single availability record details by ID.
   * GET /api/v1/partner/availability/:id
   */
  public async getPartnerAvailabilityById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = String(req.params.id);
      const principal = req.user as IUserPrincipal;

      const result = await this.service.getAvailabilityById(principal, id);

      const response: IApiResponse<IPartnerProductDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partner: Retrieve chronological state transition audit history.
   * GET /api/v1/partner/availability/:id/history
   */
  public async getPartnerAvailabilityHistory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = String(req.params.id);
      const principal = req.user as IUserPrincipal;

      const history = await this.service.getAvailabilityHistory(principal, id);

      const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

      if (hasPagination) {
        const page = req.query.page !== undefined ? Math.max(1, Number(req.query.page)) : 1;
        const limit =
          req.query.limit !== undefined ? Math.min(100, Math.max(1, Number(req.query.limit))) : 20;
        const total = history.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const skip = (page - 1) * limit;
        const items = history.slice(skip, skip + limit);

        const response: IPaginatedEnvelope<IPartnerAvailabilityHistoryDto> = {
          success: true,
          data: items,
          pagination: {
            page,
            limit,
            totalItems: total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        };

        res.status(200).json(response);
      } else {
        const response: IApiResponse<IPartnerAvailabilityHistoryDto[]> = {
          success: true,
          data: history,
        };

        res.status(200).json(response);
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: List availability records for a specific partner across service areas.
   * GET /api/v1/admin/partners/:partnerId/availability
   */
  public async adminListPartnerAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const partnerId = String(req.params.partnerId);
      const principal = req.user as IUserPrincipal;
      const query = this.parseQueryFilters(req.query);

      const result = await this.service.listAvailability(principal, query, partnerId);

      const response: IPaginatedEnvelope<IPartnerProductDto> = {
        success: true,
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalItems: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.page < result.totalPages,
          hasPrevPage: result.page > 1,
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Emergency toggle of partner availability.
   * PATCH /api/v1/admin/partners/:partnerId/availability/:id
   */
  public async adminTogglePartnerAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const partnerId = String(req.params.partnerId);
      const id = String(req.params.id);
      const dto: ITogglePartnerAvailabilityDto = req.body;
      const principal = req.user as IUserPrincipal;

      const result = await this.service.toggleAvailability(principal, id, dto, partnerId);

      const response: IApiResponse<IPartnerProductDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: Resolve storefront availability (Step 7 contract / Decision #48).
   * GET /api/v1/products/public/availability
   */
  public async getPublicAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const productId = req.query.productId
        ? String(req.query.productId)
        : req.params.productId
          ? String(req.params.productId)
          : req.params.id
            ? String(req.params.id)
            : '';

      const variantId = req.query.variantId
        ? String(req.query.variantId)
        : req.params.variantId
          ? String(req.params.variantId)
          : null;

      const pincode = req.query.pincode
        ? String(req.query.pincode)
        : req.query.deliveryPincode
          ? String(req.query.deliveryPincode)
          : undefined;

      const result = await this.service.resolveStorefrontAvailability(
        productId,
        variantId,
        pincode,
      );

      const response: IApiResponse<IPublicProductAvailabilityDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Helper to parse and normalize listing query parameters.
   */
  private parseQueryFilters(rawQuery: Request['query']): IPartnerAvailabilityQueryDto {
    const page = rawQuery.page !== undefined ? Number(rawQuery.page) : undefined;
    const limit = rawQuery.limit !== undefined ? Number(rawQuery.limit) : undefined;
    const productId = rawQuery.productId ? String(rawQuery.productId) : undefined;
    const serviceAreaId = rawQuery.serviceAreaId ? String(rawQuery.serviceAreaId) : undefined;
    const categoryId = rawQuery.categoryId ? String(rawQuery.categoryId) : undefined;
    const search = rawQuery.search ? String(rawQuery.search) : undefined;

    let isAvailable: boolean | undefined = undefined;
    if (rawQuery.isAvailable === 'true' || (rawQuery.isAvailable as unknown) === true) {
      isAvailable = true;
    } else if (rawQuery.isAvailable === 'false' || (rawQuery.isAvailable as unknown) === false) {
      isAvailable = false;
    }

    return {
      page,
      limit,
      productId,
      serviceAreaId,
      isAvailable,
      categoryId,
      search,
    };
  }
}

export const partnerAvailabilityController = new PartnerAvailabilityController();
