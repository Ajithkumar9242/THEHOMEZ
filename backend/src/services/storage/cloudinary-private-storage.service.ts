import { randomBytes } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/logger.js';
import type {
  IPrivateDocumentStorageAdapter,
  IStorageObjectMeta,
} from './private-storage.interface.js';

export class PrivateStorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'PrivateStorageError';
  }
}

export class CloudinaryPrivateStorageAdapter implements IPrivateDocumentStorageAdapter {
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

  public isConfigured(): boolean {
    const config = getConfig();
    return Boolean(
      config.cloudinary?.cloudName && config.cloudinary?.apiKey && config.cloudinary?.apiSecret,
    );
  }

  private getFormatFromMime(mimeType: string): string {
    switch (mimeType) {
      case 'application/pdf':
        return 'pdf';
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return 'bin';
    }
  }

  public async uploadPrivateDocument(
    fileBuffer: Buffer,
    options: {
      partnerId: string;
      documentType: string;
      originalFilename: string;
      mimeType: string;
      sha256Hash: string;
      tags?: Record<string, string>;
    },
  ): Promise<{
    storageKey: string;
    bytes: number;
    mimeType: string;
  }> {
    if (!this.configureSdk()) {
      throw new PrivateStorageError(
        'Cloudinary credentials are not configured on server',
        'STORAGE_NOT_CONFIGURED',
        503,
      );
    }

    const { partnerId, documentType, mimeType, sha256Hash, tags = {} } = options;
    const isPdf = mimeType === 'application/pdf';
    const resourceType = isPdf ? 'raw' : 'image';
    const format = this.getFormatFromMime(mimeType);

    const safeDocType = documentType.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const randomSuffix = randomBytes(4).toString('hex');
    const filenameWithExt = `${safeDocType}_${Date.now()}_${randomSuffix}.${format}`;
    const publicId = `thehomez-private/partners/${partnerId}/${filenameWithExt}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          type: 'authenticated', // Restricts public CDN delivery; requires HMAC-signed token
          resource_type: resourceType,
          format: isPdf ? undefined : format,
          context: {
            sha256: sha256Hash,
            partnerId,
            documentType,
            ...tags,
          },
        },
        (error, result) => {
          if (error || !result) {
            logger.error(
              { error, partnerId, publicId },
              'Failed to upload private document to Cloudinary',
            );
            return reject(
              new PrivateStorageError(
                error?.message || 'Failed to upload private document to Cloudinary',
                'UPLOAD_FAILED',
                500,
              ),
            );
          }

          resolve({
            storageKey: result.public_id,
            bytes: result.bytes,
            mimeType,
          });
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  public async generateExpiringSignedUrl(
    storageKey: string,
    ttlSeconds: number = 900, // 15 minutes default
  ): Promise<{
    downloadUrl: string;
    expiresAt: Date;
  }> {
    if (!this.configureSdk()) {
      throw new PrivateStorageError(
        'Cloudinary credentials are not configured on server',
        'STORAGE_NOT_CONFIGURED',
        503,
      );
    }

    const epochExpiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const isPdf = storageKey.toLowerCase().endsWith('.pdf');
    const resourceType = isPdf ? 'raw' : 'image';
    const format = isPdf ? 'pdf' : (storageKey.split('.').pop() || 'jpg');

    try {
      const downloadUrl = cloudinary.utils.private_download_url(storageKey, format, {
        expires_at: epochExpiresAt,
        type: 'authenticated',
        resource_type: resourceType,
      });

      return {
        downloadUrl,
        expiresAt: new Date(epochExpiresAt * 1000),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate signed download URL';
      throw new PrivateStorageError(message, 'SIGNED_URL_FAILED', 500);
    }
  }

  public async deletePrivateDocument(storageKey: string): Promise<boolean> {
    if (!this.configureSdk()) {
      logger.warn(
        { storageKey },
        'Cloudinary not configured; cannot execute physical storage deletion',
      );
      return false;
    }

    const isPdf = storageKey.toLowerCase().endsWith('.pdf');
    const primaryResourceType = isPdf ? 'raw' : 'image';
    const fallbackResourceType = isPdf ? 'image' : 'raw';

    try {
      const resultPrimary = await cloudinary.uploader.destroy(storageKey, {
        type: 'authenticated',
        resource_type: primaryResourceType,
        invalidate: true,
      });

      if (resultPrimary.result === 'ok' || resultPrimary.result === 'not found') {
        return true;
      }

      const resultFallback = await cloudinary.uploader.destroy(storageKey, {
        type: 'authenticated',
        resource_type: fallbackResourceType,
        invalidate: true,
      });

      return resultFallback.result === 'ok' || resultFallback.result === 'not found';
    } catch (err) {
      logger.error({ err, storageKey }, 'Error executing Cloudinary storage deletion');
      return false;
    }
  }

  private async fetchAllResourcesForType(
    resourceType: 'image' | 'raw',
    prefix: string,
  ): Promise<any[]> {
    const resources: any[] = [];
    let nextCursor: string | undefined = undefined;

    do {
      const response: any = await cloudinary.api.resources({
        type: 'authenticated',
        resource_type: resourceType,
        prefix,
        max_results: 500,
        next_cursor: nextCursor,
      });

      if (response && Array.isArray(response.resources)) {
        resources.push(...response.resources);
      }
      nextCursor = response?.next_cursor;
    } while (nextCursor);

    return resources;
  }

  public async listStorageObjects(prefix: string): Promise<IStorageObjectMeta[]> {
    if (!this.configureSdk()) {
      throw new PrivateStorageError(
        'Cloudinary credentials are not configured on server',
        'STORAGE_NOT_CONFIGURED',
        503,
      );
    }

    try {
      const [images, raw] = await Promise.all([
        this.fetchAllResourcesForType('image', prefix),
        this.fetchAllResourcesForType('raw', prefix),
      ]);

      const allResources = [...images, ...raw];

      return allResources.map((res: { public_id: string; bytes: number; created_at: string; context?: { custom?: Record<string, string> } }) => ({
        key: res.public_id,
        sizeBytes: res.bytes || 0,
        lastModified: new Date(res.created_at),
        tags: res.context?.custom || {},
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list storage objects';
      throw new PrivateStorageError(message, 'LIST_OBJECTS_FAILED', 500);
    }
  }

  public async updateObjectTags(
    storageKey: string,
    tags: Record<string, string>,
  ): Promise<boolean> {
    if (!this.configureSdk()) {
      return false;
    }

    const isPdf = storageKey.toLowerCase().endsWith('.pdf');
    const resourceType = isPdf ? 'raw' : 'image';

    try {
      const contextPairs = Object.entries(tags)
        .map(([k, v]) => `${k}=${v}`)
        .join('|');

      await cloudinary.uploader.add_context(contextPairs, [storageKey], {
        type: 'authenticated',
        resource_type: resourceType,
      });
      return true;
    } catch (err) {
      logger.error({ err, storageKey, tags }, 'Failed to update Cloudinary object tags');
      return false;
    }
  }
}

export const cloudinaryPrivateStorageAdapter = new CloudinaryPrivateStorageAdapter();
