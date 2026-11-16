import type { Request, Response, NextFunction } from 'express';
import {
  type IApiResponse,
  type IUnit,
  type IUnitConversionRate,
  type IConvertUnitResult,
  type IValidateQuantityResult,
  type UnitClassification,
  PermissionCode,
} from '@thehomez/shared-types';
import { unitService } from '../services/catalog/unit.service.js';

export class UnitController {
  /**
   * Public: List construction units with optional filtering.
   */
  public async listUnits(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classification = req.query.classification as UnitClassification | undefined;
      const activeOnly =
        req.query.activeOnly !== undefined ? req.query.activeOnly === 'true' : true;

      const units = await unitService.listUnits({ classification, activeOnly });

      const response: IApiResponse<IUnit[]> = {
        success: true,
        data: units,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: Retrieve details for a single unit code.
   */
  public async getUnitByCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const code = String(req.params.code);
      const unit = await unitService.getUnitByCode(code);

      const response: IApiResponse<IUnit> = {
        success: true,
        data: unit,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Update unit master metadata.
   */
  public async updateUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const code = String(req.params.code);
      const unit = await unitService.updateUnit(code, req.body);

      const response: IApiResponse<IUnit> = {
        success: true,
        data: unit,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: List universal unit conversions.
   */
  public async listConversions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const conversions = unitService.getUniversalConversions();

      const response: IApiResponse<IUnitConversionRate[]> = {
        success: true,
        data: conversions,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public: Convert quantity between dimensionally compatible units.
   */
  public async convertQuantity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await unitService.convertQuantity(req.body);

      const response: IApiResponse<IConvertUnitResult> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Public / Admin: Validate proposed ordering quantity against product rules.
   */
  public async validateQuantity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userPermissions = req.user?.permissions || [];
      const userHasCatalogRead = userPermissions.includes(PermissionCode.CATALOG_READ);

      const result = await unitService.validateOrderQuantity(req.body, userHasCatalogRead);

      const response: IApiResponse<IValidateQuantityResult> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const unitController = new UnitController();
