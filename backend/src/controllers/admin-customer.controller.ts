import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse } from '@thehomez/shared-types';
import {
  adminCustomerService,
  type AdminCustomerService,
} from '../services/admin-customer/admin-customer.service.js';

import type { AdminCustomerQuery } from '../routes/admin-customer.schemas.js';

export class AdminCustomerController {
  constructor(private readonly service: AdminCustomerService = adminCustomerService) {}

  /**
   * API 1: List customer directory with pagination, search, status, and B2B/B2C filter
   * GET /api/v1/admin/customers
   */
  public listCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listCustomers(req.query as unknown as AdminCustomerQuery);
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
   * API 2: Customer detail inspection
   * GET /api/v1/admin/customers/:id
   */
  public getCustomerById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const result = await this.service.getCustomerById(id);
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
   * API 3: Customer delivery addresses inspection (read-only)
   * GET /api/v1/admin/customers/:id/addresses
   */
  public getCustomerAddresses = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const result = await this.service.getCustomerAddresses(id);
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
   * API 4: Customer account status update (ACTIVE <-> SUSPENDED)
   * PATCH /api/v1/admin/customers/:id/status
   */
  public updateCustomerStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const staffUser = {
        id: req.user!.id,
        email: req.user!.email,
        phone: req.user!.phone,
      };
      const result = await this.service.updateCustomerStatus(id, req.body, staffUser);
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
   * API 5: B2B Wholesale Customer verification
   * PATCH /api/v1/admin/customers/:id/b2b-status
   */
  public updateB2bStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = String(req.params.id);
      const staffUser = {
        id: req.user!.id,
        email: req.user!.email,
        phone: req.user!.phone,
      };
      const result = await this.service.updateB2bStatus(id, req.body, staffUser);
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

export const adminCustomerController = new AdminCustomerController();
