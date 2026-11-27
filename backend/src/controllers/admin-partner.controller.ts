import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse } from '@thehomez/shared-types';
import {
  adminPartnerService,
  type AdminPartnerService,
} from '../services/admin-partner/admin-partner.service.js';
import { serviceAreaService } from '../services/service-area/service-area.service.js';
import type {
  AdminPartnerQuery,
  UpdatePartnerStatusInput,
  UpdatePartnerProfileInput,
  AdminPartnerAuditLogsQuery,
  ReviewPartnerDocumentInput,
  ReactivatePartnerInput,
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
   * API: Partner profile edit (P1A-13)
   * PUT /api/v1/admin/partners/:partnerId
   */
  public updatePartnerProfile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const input = req.body as UpdatePartnerProfileInput;
      const staffUser = {
        id: req.user!.id,
        email: req.user!.email,
        phone: req.user!.phone,
      };

      const result = await this.service.updatePartnerProfile(partnerId, input, staffUser);
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

  /**
   * API 5 (P1A-08): Partner KYC document metadata inspection
   * GET /api/v1/admin/partners/:partnerId/documents
   */
  public getPartnerDocuments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const result = await this.service.getPartnerDocuments(partnerId);
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
   * API 6 (P1A-09): Expiring signed download URL generation with unified KYC eligibility
   * GET /api/v1/admin/partners/:partnerId/documents/:docId/signed-url
   */
  public getPartnerDocumentSignedUrl = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const docId = String(req.params.docId);
      const staffUser = {
        id: req.user!.id,
        email: req.user?.email,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      const result = await this.service.getPartnerDocumentSignedUrl(
        partnerId,
        docId,
        staffUser,
        auditMetadata,
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

  /**
   * API 7 (P1A-10): Soft deletion and storage cleanup trigger for partner KYC document
   * DELETE /api/v1/admin/partners/:partnerId/documents/:docId
   */
  public deletePartnerDocument = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const docId = String(req.params.docId);
      const staffUser = {
        id: req.user!.id,
        email: req.user?.email,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      const result = await this.service.deletePartnerDocument(
        partnerId,
        docId,
        staffUser,
        auditMetadata,
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

  /**
   * API 8 (P1A-11): Manual security override for partner KYC document scan status
   * POST /api/v1/admin/partners/:partnerId/documents/:docId/scan-override
   */
  public overrideDocumentScanStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const docId = String(req.params.docId);
      const staffUser = {
        id: req.user!.id,
        email: req.user?.email,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };
      const input = req.body;

      const result = await this.service.overrideDocumentScanStatus(
        partnerId,
        docId,
        input,
        staffUser,
        auditMetadata,
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

  /**
   * API (P1A-15): Partner KYC document review (verify or reject)
   * PATCH /api/v1/admin/partners/:partnerId/documents/:docId/status
   */
  public reviewPartnerDocument = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const docId = String(req.params.docId);
      const input = req.body as ReviewPartnerDocumentInput;
      const staffUser = {
        id: req.user!.id,
        email: req.user?.email,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      const result = await this.service.reviewPartnerDocument(
        partnerId,
        docId,
        input,
        staffUser,
        auditMetadata,
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

  /**
   * API (P1A-14): Partner reactivation with KYC proof validation and supervisory waiver
   * POST /api/v1/admin/partners/:partnerId/reactivate
   */
  public reactivatePartner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const input = req.body as ReactivatePartnerInput;
      const staffUser = {
        id: req.user!.id,
        email: req.user!.email,
        phone: req.user!.phone,
        roles: req.user!.roles,
        permissions: req.user!.permissions,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      const result = await this.service.reactivatePartner(
        partnerId,
        input,
        staffUser,
        auditMetadata,
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

  /**
   * API (P1A-16): Administrative assign service areas to a partner
   * PUT /api/v1/admin/partners/:partnerId/service-areas
   */
  public assignPartnerServiceAreas = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const partnerId = String(req.params.partnerId);
      const partner = await serviceAreaService.assignPartnerServiceAreas(
        partnerId,
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
      next(err);
    }
  };
}

export const adminPartnerController = new AdminPartnerController();

