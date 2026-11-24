import { randomBytes } from 'node:crypto';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/logger.js';
import { ProductModel } from '../../models/product.model.js';
import { ProductVariantModel } from '../../models/product-variant.model.js';

export class CloudinaryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CloudinaryError';
  }
}

export interface ICloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
}

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validates file magic bytes against genuine image header signatures.
 * Defends against spoofed extensions / disguised executables or text files.
 */
export function validateImageMagicBytes(
  buffer: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF [4 bytes] WEBP
  const isRiff =
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  const isWebp =
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  if (isRiff && isWebp) {
    return 'image/webp';
  }

  return null;
}

export class CloudinaryService {
  /**
   * Initializes Cloudinary SDK with configured backend credentials.
   */
  private configureSdk(): boolean {
    const config = getConfig();
    if (
      !config.cloudinary ||
      !config.cloudinary.cloudName ||
      !config.cloudinary.apiKey ||
      !config.cloudinary.apiSecret
    ) {
      return false;
    }

    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
    return true;
  }

  /**
   * Checks whether Cloudinary credentials are fully configured.
   */
  public isConfigured(): boolean {
    const config = getConfig();
    return Boolean(
      config.cloudinary &&
      config.cloudinary.cloudName &&
      config.cloudinary.apiKey &&
      config.cloudinary.apiSecret,
    );
  }

  /**
   * Validates and streams an image buffer to Cloudinary.
   */
  public async uploadProductImage(
    fileBuffer: Buffer,
    options: { filename?: string; mimeType: string },
  ): Promise<ICloudinaryUploadResult> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new CloudinaryError('Uploaded file is empty', 'EMPTY_FILE', 400);
    }

    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new CloudinaryError(
        `File size (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed limit of 5 MB`,
        'FILE_TOO_LARGE',
        400,
      );
    }

    // Verify declared MIME type
    const normalizedMime = options.mimeType.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(normalizedMime as any)) {
      throw new CloudinaryError(
        `Unsupported file type '${options.mimeType}'. Supported formats are JPG, JPEG, PNG, and WebP.`,
        'INVALID_MIME_TYPE',
        400,
      );
    }

    // Verify actual file content via magic bytes
    const detectedMime = validateImageMagicBytes(fileBuffer);
    if (!detectedMime) {
      throw new CloudinaryError(
        'Corrupted or invalid image file content. Header signature does not match JPEG, PNG, or WebP.',
        'INVALID_IMAGE_CONTENT',
        400,
      );
    }

    // Check consistency between declared MIME and actual magic bytes
    const isJpegMatch =
      (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') &&
      detectedMime === 'image/jpeg';
    const isPngMatch = normalizedMime === 'image/png' && detectedMime === 'image/png';
    const isWebpMatch = normalizedMime === 'image/webp' && detectedMime === 'image/webp';
    if (!isJpegMatch && !isPngMatch && !isWebpMatch) {
      throw new CloudinaryError(
        `MIME type mismatch: declared '${options.mimeType}' but detected '${detectedMime}'`,
        'MIME_TYPE_MISMATCH',
        400,
      );
    }

    // Validate that Cloudinary credentials are fully configured before initiating network upload
    if (!this.isConfigured() || !this.configureSdk()) {
      throw new CloudinaryError(
        'Cloudinary image storage is not configured. Please configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
        'CLOUDINARY_NOT_CONFIGURED',
        503,
      );
    }

    const config = getConfig();
    const folder = config.cloudinary?.folder || 'thehomez/products';
    const publicId = `prod_${Date.now()}_${randomBytes(6).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            logger.error({ err: error?.message }, 'Cloudinary upload failed');
            return reject(
              new CloudinaryError(
                error?.message || 'Failed to upload image to cloud storage',
                'CLOUDINARY_UPLOAD_ERROR',
                502,
              ),
            );
          }

          logger.info(
            {
              publicId: result.public_id,
              url: result.secure_url,
              bytes: result.bytes,
              format: result.format,
            },
            'Cloudinary image uploaded successfully',
          );

          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
          });
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  /**
   * Deletion safety: Verifies ownership and database reference state
   * before deleting an image asset from Cloudinary.
   */
  public async deleteProductImage(publicId: string): Promise<boolean> {
    if (!publicId || typeof publicId !== 'string') {
      throw new CloudinaryError('Invalid public ID format', 'VALIDATION_ERROR', 400);
    }

    const config = getConfig();
    const expectedFolder = config.cloudinary?.folder || 'thehomez/products';
    if (!publicId.startsWith(expectedFolder)) {
      throw new CloudinaryError(
        'Refusing to delete asset outside the designated product images folder',
        'UNAUTHORIZED_ASSET_DELETION',
        403,
      );
    }

    if (!this.isConfigured() || !this.configureSdk()) {
      throw new CloudinaryError(
        'Cloudinary storage is not configured',
        'CLOUDINARY_NOT_CONFIGURED',
        503,
      );
    }

    // Check if the image is referenced by any product or variant
    const escapedPublicId = publicId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPublicId);

    const [productWithImage, variantWithImage] = await Promise.all([
      ProductModel.findOne({ images: { $regex: regex } }).lean(),
      ProductVariantModel.findOne({ images: { $regex: regex } }).lean(),
    ]);

    if (productWithImage || variantWithImage) {
      throw new CloudinaryError(
        `Cannot delete image '${publicId}' because it is currently referenced by product '${productWithImage?._id || variantWithImage?._id}'`,
        'IMAGE_STILL_REFERENCED',
        409,
      );
    }

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return result.result === 'ok';
  }
}

export const cloudinaryService = new CloudinaryService();
