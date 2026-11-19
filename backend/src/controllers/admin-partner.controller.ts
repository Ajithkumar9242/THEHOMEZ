import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse } from '@thehomez/shared-types';
import {
  adminPartnerService,
  type AdminPartnerService,
} from '../services/admin-partner/admin-partner.service.js';
import type {
  AdminPartnerQuery,
  UpdatePartnerStatusInput,
  AdminPartnerAuditLogsQuery,
} from '../routes/admin-partner.schemas.js';

export class AdminPartnerController {
  constructor(private readonly service: AdminPartnerService = adminPartnerService) {}

  /**
   * API 1: List partner directory with pagination, search, status, and service area filtering
   * GET /api/v1/admin/partners
   */
  public listPartners = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPartners(req.query as unknown as AdminPartnerQuery);
      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 2: Partner detail inspection
   * GET /api/v1/admin/partners/:partnerId
   */
  public getPartnerById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const result = await this.service.getPartnerById(partnerId);
      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 3: Partner lifecycle status mutation
   * PATCH /api/v1/admin/partners/:partnerId/status
   */
  public updatePartnerStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const input = req.body as UpdatePartnerStatusInput;
      const staffUser = {
        id: req.user!.id,
        email: req.user!.email,
        phone: req.user!.phone,
      };

      const result = await this.service.updatePartnerStatus(partnerId, input, staffUser);
      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * API 4: Partner audit history inspection
   * GET /api/v1/admin/partners/:partnerId/audit-logs
   */
  public getPartnerAuditLogs = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const result = await this.service.getPartnerAuditLogs(
        partnerId,
        req.query as unknown as AdminPartnerAuditLogsQuery,
      );
      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}

export const adminPartnerController = new AdminPartnerController();
