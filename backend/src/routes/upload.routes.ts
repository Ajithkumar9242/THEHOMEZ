import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { PermissionCode } from '@thehomez/shared-types';
import { authenticate, staffOnlyGuard, authorize } from '../middleware/auth.middleware.js';
import { uploadController } from '../controllers/upload.controller.js';
import { MAX_FILE_SIZE_BYTES } from '../services/cloudinary/cloudinary.service.js';

export const uploadRouter: Router = Router();

// Configure memory storage multer with strict file size and count boundaries
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES, // 5 MB
    files: 1,
  },
});

/**
 * Custom error handler for Multer upload issues (e.g. file size exceeded)
 */
function handleMulterUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: `Image exceeds maximum allowed size of 5 MB`,
            },
          });
          return;
        }
        res.status(400).json({
          success: false,
          error: {
            code: 'UPLOAD_ERROR',
            message: err.message,
          },
        });
        return;
      }
      return next(err);
    }
    next();
  });
}

/**
 * POST /api/v1/admin/uploads/product-image
 * Authenticated staff only, requires CATALOG_WRITE.
 */
uploadRouter.post(
  '/product-image',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_WRITE),
  handleMulterUpload,
  (req, res, next) => uploadController.uploadProductImage(req, res, next),
);

/**
 * DELETE /api/v1/admin/uploads/product-image
 * Authenticated staff only, requires CATALOG_WRITE. Deletion safety enforced.
 */
uploadRouter.delete(
  '/product-image',
  authenticate,
  staffOnlyGuard,
  authorize(PermissionCode.CATALOG_WRITE),
  (req, res, next) => uploadController.deleteProductImage(req, res, next),
);
