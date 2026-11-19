import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse } from '@thehomez/shared-types';
import {
  partnerApplicationService,
  type PartnerApplicationService,
} from '../services/partner-application/partner-application.service.js';
import type {
  CreatePartnerApplicationSchemaInput,
  RejectPartnerApplicationSchemaInput,
  WithdrawPartnerApplicationSchemaInput,
  ApprovePartnerApplicationSchemaInput,
  AdminPartnerApplicationQuery,
} from '../routes/admin-partner-application.schemas.js';

export class AdminPartnerApplicationController {
  constructor(private readonly service: PartnerApplicationService = partnerApplicationService) {}

  private extractStaffContext(req: Request) {
    return {
      id: req.user!.id,
      email: req.user!.email,
      phone: req.user!.phone,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      correlationId: req.correlationId,
    };
  }

  /**
   * API 1: Create Partner Application (Intake)
   * POST /api/v1/admin/partner-applications
   */
  public createApplication = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = req.body as CreatePartnerApplicationSchemaInput;
      const staffContext = this.extractStaffContext(req);
      const result = await this.service.createApplication(input, staffContext);
      const response: IApiResponse<typeof result> = {
        success: true,
        data: result,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * List Partner Applications with filtering and pagination
   * GET /api/v1/admin/partner-applications
   */
  public listApplications = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as AdminPartnerApplicationQuery;
      const result = await this.service.listApplications(query);
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
   * Get Application Detail by ID
   * GET /api/v1/admin/partner-applications/:id
   */
  public getApplicationById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const result = await this.service.getApplicationById(id);
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
   * API 2: Move Application to Review
   * POST /api/v1/admin/partner-applications/:id/review
   */
  public reviewApplication = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const staffContext = this.extractStaffContext(req);
      const result = await this.service.reviewApplication(id, staffContext);
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
   * API 3: Reject Partner Application
   * POST /api/v1/admin/partner-applications/:id/reject
   */
  public rejectApplication = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const input = req.body as RejectPartnerApplicationSchemaInput;
      const staffContext = this.extractStaffContext(req);
      const result = await this.service.rejectApplication(id, input, staffContext);
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
   * Withdraw Partner Application
   * POST /api/v1/admin/partner-applications/:id/withdraw
   */
  public withdrawApplication = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const input = req.body as WithdrawPartnerApplicationSchemaInput;
      const staffContext = this.extractStaffContext(req);
      const result = await this.service.withdrawApplication(id, input, staffContext);
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
   * API 4: Approve Partner Application Gate
   * POST /api/v1/admin/partner-applications/:id/approve
   */
  public approveApplication = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const input = req.body as ApprovePartnerApplicationSchemaInput;
      const staffContext = this.extractStaffContext(req);
      const result = await this.service.approveApplication(id, input, staffContext);
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

export const adminPartnerApplicationController = new AdminPartnerApplicationController();
