import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse, IApiErrorResponse } from '@thehomez/shared-types';
import {
  serviceAreaService,
  ServiceAreaError,
} from '../services/service-area/service-area.service.js';
import { checkPincodeQuerySchema } from '../routes/service-area.schemas.js';

export class ServiceAreaController {
  /**
   * Public: Check PIN code serviceability
   */
  public async checkPincode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = checkPincodeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'INVALID_PINCODE',
            message: firstIssue?.message || 'Invalid Indian postal PIN code format',
            details: parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
              code: i.code,
            })),
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const result = await serviceAreaService.checkPincodeServiceability(parsed.data.pincode);

      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Administrative: Create a new service area
   */
  public async createServiceArea(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const serviceArea = await serviceAreaService.createServiceArea(req.body);

      const response: IApiResponse<typeof serviceArea> = {
        success: true,
        data: serviceArea,
      };

      res.status(201).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }

  /**
   * Administrative: List service areas with pagination
   */
  public async listServiceAreas(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const city = typeof req.query.city === 'string' ? req.query.city : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const isActive =
        req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await serviceAreaService.getServiceAreas({
        city,
        state,
        isActive,
        page,
        limit,
      });

      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Administrative: Get service area details by ID
   */
  public async getServiceAreaById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const serviceArea = await serviceAreaService.getServiceAreaById(req.params.id as string);

      const response: IApiResponse<typeof serviceArea> = {
        success: true,
        data: serviceArea,
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }

  /**
   * Administrative: Update service area
   */
  public async updateServiceArea(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const serviceArea = await serviceAreaService.updateServiceArea(
        req.params.id as string,
        req.body,
      );

      const response: IApiResponse<typeof serviceArea> = {
        success: true,
        data: serviceArea,
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }

  /**
   * Administrative: Inspect active partners serving this service area
   */
  public async getPartnersForServiceArea(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const partners = await serviceAreaService.getPartnersForServiceArea(req.params.id as string);

      const response: IApiResponse<typeof partners> = {
        success: true,
        data: partners,
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }

  /**
   * Administrative: Assign service areas to a partner
   */
  public async assignPartnerServiceAreas(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const partner = await serviceAreaService.assignPartnerServiceAreas(
        req.params.partnerId as string,
        req.body.serviceAreaIds,
      );

      const response: IApiResponse<{ partnerId: string; serviceAreaIds: string[] }> = {
        success: true,
        data: {
          partnerId: partner._id.toString(),
          serviceAreaIds: partner.serviceAreaIds.map((id) => id.toString()),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }

  /**
   * Partner / Administrative: Retrieve service areas assigned to a partner
   */
  public async getPartnerServiceAreas(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const areas = await serviceAreaService.getPartnerServiceAreas(req.params.partnerId as string);

      const response: IApiResponse<typeof areas> = {
        success: true,
        data: areas,
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof ServiceAreaError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(err.statusCode).json(errorResponse);
        return;
      }
      next(err);
    }
  }
}

export const serviceAreaController = new ServiceAreaController();
