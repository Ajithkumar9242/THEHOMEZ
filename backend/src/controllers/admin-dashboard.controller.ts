import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse, PermissionCode } from '@thehomez/shared-types';
import {
  adminDashboardService,
  type AdminDashboardService,
  type StaffSecurityContext,
} from '../services/admin-dashboard/admin-dashboard.service.js';
import type {
  AdminDashboardQueryInput,
  AdminDashboardLimitQueryInput,
} from '../routes/admin-dashboard.schemas.js';

export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService = adminDashboardService) {}

  private getStaffContext(req: Request): StaffSecurityContext {
    return {
      userId: req.user?.id || '',
      permissions: (req.user?.permissions as PermissionCode[]) || [],
      isSuperAdmin: req.user?.roles?.includes('SUPER_ADMIN') ?? false,
    };
  }

  /**
   * GET /api/v1/admin/dashboard/summary
   * Top-level summary metrics with date range filtering and RBAC masking
   */
  public getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const staffContext = this.getStaffContext(req);
      const query = req.query as unknown as AdminDashboardQueryInput;
      const data = await this.service.getSummary(query, staffContext);

      const response: IApiResponse<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/admin/dashboard/partner-overview
   * Detailed partner metrics and breakdown (Requires PARTNER_READ)
   */
  public getPartnerOverview = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.getPartnerOverview();
      const response: IApiResponse<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/admin/dashboard/operational-exceptions
   * Actionable operator items (pending partner approvals, B2B KYC, suspensions)
   */
  public getOperationalExceptions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const staffContext = this.getStaffContext(req);
      const query = req.query as unknown as AdminDashboardLimitQueryInput;
      const data = await this.service.getOperationalExceptions(query?.limit, staffContext);

      const response: IApiResponse<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/admin/dashboard/recent-activity
   * Real operational audit log feed (Requires AUDIT_READ)
   */
  public getRecentActivity = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as AdminDashboardLimitQueryInput;
      const data = await this.service.getRecentActivity(query?.limit);

      const response: IApiResponse<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };
}

export const adminDashboardController = new AdminDashboardController();
