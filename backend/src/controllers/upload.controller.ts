import type { Request, Response, NextFunction } from 'express';
import type { IApiResponse, IProductImageUploadResponse } from '@thehomez/shared-types';
import { cloudinaryService, CloudinaryError } from '../services/cloudinary/cloudinary.service.js';
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
}

export const uploadController = new UploadController();
