import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import {
  type IApiResponse,
  type IProductImageUploadResponse,
  type IUploadPartnerDocumentResponseDto,
  PartnerDocumentType,
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
} from '@thehomez/shared-types';
import { cloudinaryService, CloudinaryError } from '../services/cloudinary/cloudinary.service.js';
import { cloudinaryPrivateStorageAdapter } from '../services/storage/cloudinary-private-storage.service.js';
import { storageCleanupService } from '../services/storage/storage-cleanup.service.js';
import { validateDocumentSignature } from '../services/storage/file-signature.validator.js';
import { PartnerModel, type IPartnerDocumentItem } from '../models/partner.model.js';
import { PartnerAuditLogModel } from '../models/partner-audit-log.model.js';
import { StorageCleanupTriggerReason } from '../models/storage-cleanup-job.model.js';
import { logger } from '../logger/logger.js';

export class UploadController {
  /**
   * Handles single product image upload.
   * Requires STAFF principal and CATALOG_WRITE permission.
   */
  public async uploadProductImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_PROVIDED',
            message:
              'No image file was provided in the multipart request. Expected field name: "file"',
          },
        });
        return;
      }

      const result = await cloudinaryService.uploadProductImage(req.file.buffer, {
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      logger.info(
        {
          audit: true,
          action: 'PRODUCT_IMAGE_UPLOAD',
          publicId: result.publicId,
          url: result.secureUrl,
          performedBy: req.user?.id,
          correlationId: req.correlationId,
        },
        'Audit: Product image uploaded to Cloudinary',
      );

      const response: IApiResponse<IProductImageUploadResponse> = {
        success: true,
        data: {
          url: result.secureUrl,
          publicId: result.publicId,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        },
      };

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof CloudinaryError) {
        res.status(err.status).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Handles deletion of an unreferenced product image asset from Cloudinary.
   */
  public async deleteProductImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const publicId = req.body?.publicId;
      if (!publicId || typeof publicId !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'publicId is required in request body',
          },
        });
        return;
      }

      await cloudinaryService.deleteProductImage(publicId);

      logger.info(
        {
          audit: true,
          action: 'PRODUCT_IMAGE_DELETE',
          publicId,
          performedBy: req.user?.id,
          correlationId: req.correlationId,
        },
        'Audit: Product image deleted from Cloudinary',
      );

      res.status(200).json({
        success: true,
        data: { message: 'Image deleted successfully' },
      });
    } catch (err) {
      if (err instanceof CloudinaryError) {
        res.status(err.status).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Handles multipart statutory KYC document upload for partners.
   * Enforces 10 MB limit, binary magic-byte inspection, SHA-256 tamper hash,
   * private authenticated storage delivery, and dual-layer cleanup compensation.
   */
  public async uploadPartnerDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_PROVIDED',
            message: 'No document file was provided in the multipart request. Expected field name: "file"',
          },
        });
        return;
      }

      const partnerId = req.body?.partnerId;
      if (!partnerId || !Types.ObjectId.isValid(partnerId)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid partnerId is required in multipart form data',
          },
        });
        return;
      }

      const documentType = req.body?.documentType;
      if (!documentType || !Object.values(PartnerDocumentType).includes(documentType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Valid documentType is required. Must be one of: ${Object.values(PartnerDocumentType).join(', ')}`,
          },
        });
        return;
      }

      const partner = await PartnerModel.findById(partnerId);
      if (!partner) {
        res.status(404).json({
          success: false,
          error: {
            code: 'PARTNER_NOT_FOUND',
            message: `Partner not found with ID ${partnerId}`,
          },
        });
        return;
      }

      // Binary magic-byte inspection (not malware scanning)
      const sigResult = validateDocumentSignature(req.file.buffer);
      if (!sigResult.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE_SIGNATURE',
            message: sigResult.error || 'Unsupported file signature',
          },
        });
        return;
      }

      // Compute SHA-256 hash of raw uploaded bytes
      const sha256Hash = createHash('sha256').update(req.file.buffer).digest('hex');


      // Upload to private authenticated storage
      const uploadResult = await cloudinaryPrivateStorageAdapter.uploadPrivateDocument(
        req.file.buffer,
        {
          partnerId: partner._id.toHexString(),
          documentType,
          originalFilename: req.file.originalname,
          mimeType: sigResult.mimeType!,
          sha256Hash,
          tags: { status: 'PENDING_COMMIT' },
        },
      );

      const docId = new Types.ObjectId();
      const newDoc: IPartnerDocumentItem = {
        _id: docId,
        documentType: documentType as PartnerDocumentType,
        storageKey: uploadResult.storageKey,
        originalFilename: req.file.originalname,
        mimeType: sigResult.mimeType!,
        fileSizeBytes: uploadResult.bytes,
        sha256Hash,
        uploadedAt: new Date(),
        uploadedBy: new Types.ObjectId(req.user!.id),
        status: DocumentReviewStatus.PENDING_REVIEW,
        scanStatus: DocumentScanStatus.PENDING_SCAN,
        scanGeneration: 1,
        manualSecurityReview: {
          status: ManualSecurityReviewStatus.NOT_REVIEWED,
        },
        notes: typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined,
        isDeleted: false,
      };

      // Persist document subdocument with compensation safety
      try {
        const updateResult = await PartnerModel.updateOne(
          { _id: partnerId },
          { $push: { documents: newDoc } },
        );

        if (updateResult.matchedCount === 0) {
          throw new Error(`Partner not found during document attachment (matchedCount === 0)`);
        }

        // Best-effort post-persist tag update
        await cloudinaryPrivateStorageAdapter
          .updateObjectTags(uploadResult.storageKey, { status: 'COMMITTED' })
          .catch((tagErr) => {
            logger.warn(
              { err: tagErr, storageKey: uploadResult.storageKey },
              'UploadController: Best-effort COMMITTED tag update failed (will be healed by reconciliation)',
            );
          });
      } catch (dbErr) {
        logger.error(
          { err: dbErr, partnerId, storageKey: uploadResult.storageKey },
          'UploadController: Database persistence failed after upload. Executing compensation.',
        );

        try {
          await cloudinaryPrivateStorageAdapter.deletePrivateDocument(uploadResult.storageKey);
        } catch (cleanupErr) {
          logger.error(
            { err: cleanupErr, storageKey: uploadResult.storageKey },
            'UploadController: Storage deletion failed during compensation. Registering durable cleanup failure.',
          );
          await storageCleanupService.recordCompensationFailure({
            storageKey: uploadResult.storageKey,
            partnerId,
            documentId: docId,
            triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
            error: (cleanupErr as Error)?.message || 'Compensating storage deletion failed',
          });
        }

        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to record document upload. Storage cleanup compensation was triggered.',
          },
        });
        return;
      }

      // Emit mandatory audit log with safe rollback strategy if audit persistence fails
      try {
        await PartnerAuditLogModel.create({
          partnerId: partner._id,
          staffUserId: new Types.ObjectId(req.user!.id),
          action: 'PARTNER_DOCUMENT_UPLOADED',
          previousState: {
            documentCount: partner.documents?.length || 0,
          },
          newState: {
            documentId: docId,
            documentType,
            storageKey: uploadResult.storageKey,
            sha256Hash,
            fileSizeBytes: uploadResult.bytes,
            originalFilename: req.file.originalname,
          },
          reason: `KYC document ${documentType} uploaded by staff user`,
          metadata: {
            correlationId: req.correlationId,
            staffEmail: req.user?.email,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          },
        });
      } catch (auditErr) {
        logger.error(
          { err: auditErr, partnerId, documentId: docId, storageKey: uploadResult.storageKey },
          'UploadController: Mandatory audit log creation failed. Rolling back persisted document and storage.',
        );

        // Roll back MongoDB document subdocument and verify rollback success
        try {
          const pullResult = await PartnerModel.updateOne(
            { _id: partnerId },
            { $pull: { documents: { _id: docId } } },
          );
          if (pullResult.modifiedCount === 0) {
            logger.fatal(
              { partnerId, documentId: docId, storageKey: uploadResult.storageKey },
              'UploadController: Critical state inconsistency — document subdocument was not removed from MongoDB during audit rollback (modifiedCount === 0)',
            );
            await storageCleanupService.recordCompensationFailure({
              storageKey: uploadResult.storageKey,
              partnerId,
              documentId: docId,
              triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
              error: 'Audit log rollback failed: document subdocument was not removed from MongoDB (modifiedCount === 0)',
            });
          }
        } catch (rollbackDbErr) {
          logger.fatal(
            { err: rollbackDbErr, partnerId, documentId: docId, storageKey: uploadResult.storageKey },
            'UploadController: Critical state inconsistency — MongoDB error during document subdocument pull rollback',
          );
          await storageCleanupService.recordCompensationFailure({
            storageKey: uploadResult.storageKey,
            partnerId,
            documentId: docId,
            triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
            error: `Audit log rollback failed: MongoDB error during document pull: ${(rollbackDbErr as Error)?.message}`,
          });
        }

        // Roll back storage asset
        try {
          await cloudinaryPrivateStorageAdapter.deletePrivateDocument(uploadResult.storageKey);
        } catch (cleanupErr) {
          logger.error(
            { err: cleanupErr, storageKey: uploadResult.storageKey },
            'UploadController: Storage deletion failed during audit rollback. Registering durable cleanup failure.',
          );
          await storageCleanupService.recordCompensationFailure({
            storageKey: uploadResult.storageKey,
            partnerId,
            documentId: docId,
            triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
            error: (cleanupErr as Error)?.message || 'Storage deletion failed during audit rollback',
          });
        }

        res.status(500).json({
          success: false,
          error: {
            code: 'AUDIT_LOG_FAILED',
            message: 'Mandatory audit event could not be recorded. Document upload has been rolled back.',
          },
        });
        return;
      }

      const response: IApiResponse<IUploadPartnerDocumentResponseDto> = {
        success: true,
        data: {
          document: {
            id: docId.toHexString(),
            documentType: newDoc.documentType,
            originalFilename: newDoc.originalFilename,
            mimeType: newDoc.mimeType,
            fileSizeBytes: newDoc.fileSizeBytes,
            sha256Hash: newDoc.sha256Hash,
            uploadedAt: newDoc.uploadedAt.toISOString(),
            uploadedBy: req.user!.id,
            status: newDoc.status,
            scanStatus: newDoc.scanStatus,
            scanGeneration: newDoc.scanGeneration,
            manualSecurityReview: {
              status: newDoc.manualSecurityReview.status,
            },
            isDeleted: false,
          },
        },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const uploadController = new UploadController();
