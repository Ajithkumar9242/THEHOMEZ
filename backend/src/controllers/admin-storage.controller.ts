import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse } from '@thehomez/shared-types';
import {
  storageCleanupService,
  type StorageCleanupService,
} from '../services/storage/storage-cleanup.service.js';

export class AdminStorageController {
  constructor(private readonly service: StorageCleanupService = storageCleanupService) {}

  /**
   * API: Admin Storage Cleanup Job Retry
   * POST /api/v1/admin/storage/cleanup-jobs/:jobId/retry
   */
  public retryCleanupJob = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const jobId = String(req.params.jobId);
      const staffUser = {
        id: req.user!.id,
        email: req.user?.email,
      };
      const auditMetadata = {
        correlationId: req.correlationId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      const result = await this.service.retryCleanupJob(jobId, staffUser, auditMetadata);

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

export const adminStorageController = new AdminStorageController();
