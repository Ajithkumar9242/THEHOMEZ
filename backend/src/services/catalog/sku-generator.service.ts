import crypto from 'crypto';
import type { ClientSession, Types } from 'mongoose';
import {
  type SkuEntityType,
  type SkuRegistryStatus,
  CANONICAL_SKU_REGEX,
  MIN_SKU_LENGTH,
  MAX_SKU_LENGTH,
} from '@thehomez/shared-types';
import { SkuRegistryModel, type ISkuRegistryDocument } from '../../models/sku-registry.model.js';
import { logger } from '../../logger/logger.js';

export class SkuError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SkuError';
  }
}

export class SkuGeneratorService {
  private static readonly MAX_GENERATION_RETRIES = 3;

  /**
   * Canonical normalization: trims whitespace and converts to uppercase.
   */
  public static normalizeSku(sku: string): string {
    return sku.trim().toUpperCase();
  }

  /**
   * Validates manual SKU against canonical regex and length constraints.
   */
  public static validateManualSku(sku: string): boolean {
    const normalized = SkuGeneratorService.normalizeSku(sku);
    if (normalized.length < MIN_SKU_LENGTH || normalized.length > MAX_SKU_LENGTH) {
      return false;
    }
    return CANONICAL_SKU_REGEX.test(normalized);
  }

  /**
   * Generates a collision-resistant canonical SKU (Decision #21, Option A).
   * Pattern: THZ-[P|V]-[TIMESTAMP_BASE36]-[CRYPTO_ENTROPY]
   */
  public static generateSku(entityType: SkuEntityType): string {
    const prefix = entityType === 'PRODUCT' ? 'THZ-P' : 'THZ-V';
    const timestamp = Date.now().toString(36).toUpperCase();
    const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${entropy}`;
  }

  /**
   * Atomically reserves a SKU in the sku_registry collection.
   * If manual SKU provided, validates and reserves it.
   * If auto-generating, retries up to 3 times on E11000 collisions.
   */
  public async reserveSku(params: {
    sku?: string;
    entityType: SkuEntityType;
    entityId: Types.ObjectId;
    productId: Types.ObjectId;
    status?: SkuRegistryStatus;
    session: ClientSession;
  }): Promise<ISkuRegistryDocument> {
    const { sku, entityType, entityId, productId, status = 'RESERVED', session } = params;

    // 1. Manual SKU path
    if (sku) {
      const normalizedSku = SkuGeneratorService.normalizeSku(sku);
      if (!SkuGeneratorService.validateManualSku(normalizedSku)) {
        throw new SkuError(
          `Invalid manual SKU format: "${sku}". Must match ${CANONICAL_SKU_REGEX.source}`,
          'INVALID_SKU_FORMAT',
          400,
        );
      }

      // Check collision in sku_registry with case-insensitive collation
      const existing = await SkuRegistryModel.findOne({ normalizedSku })
        .collation({ locale: 'en', strength: 2 })
        .session(session);

      if (existing) {
        const errCode = entityType === 'PRODUCT' ? 'PRODUCT_SKU_EXISTS' : 'VARIANT_SKU_EXISTS';
        throw new SkuError(`SKU "${normalizedSku}" already exists in the catalogue`, errCode, 409);
      }

      try {
        const created = await SkuRegistryModel.create(
          [
            {
              sku: normalizedSku,
              normalizedSku,
              entityType,
              entityId,
              productId,
              status,
            },
          ],
          { session },
        );
        const reserved = created[0];
        if (!reserved) {
          throw new SkuError('Failed to reserve SKU record', 'SKU_RESERVATION_FAILED', 500);
        }
        return reserved;
      } catch (err: unknown) {
        this.handleMongoDuplicateKey(err, normalizedSku, entityType);
        throw err;
      }
    }

    // 2. Automatic SKU Generation with Bounded Retries
    let attempts = 0;
    while (attempts < SkuGeneratorService.MAX_GENERATION_RETRIES) {
      attempts++;
      const generated = SkuGeneratorService.generateSku(entityType);
      const normalizedSku = SkuGeneratorService.normalizeSku(generated);

      try {
        const created = await SkuRegistryModel.create(
          [
            {
              sku: normalizedSku,
              normalizedSku,
              entityType,
              entityId,
              productId,
              status,
            },
          ],
          { session },
        );
        const reserved = created[0];
        if (!reserved) {
          throw new SkuError('Failed to reserve SKU record', 'SKU_RESERVATION_FAILED', 500);
        }
        return reserved;
      } catch (err: unknown) {
        const mongoErr = err as { code?: number; message?: string };
        if (mongoErr.code === 11000) {
          logger.warn(
            { attempt: attempts, generated, entityId: entityId.toString() },
            'SKU collision during automated generation, retrying with new entropy',
          );
          continue; // retry with fresh entropy
        }
        throw err;
      }
    }

    throw new SkuError(
      'Failed to generate unique SKU after maximum retry attempts',
      'SKU_GENERATION_FAILED',
      500,
    );
  }

  /**
   * In-place atomic SKU replacement for DRAFT entities respecting unique_entity_ownership.
   */
  public async replaceDraftSku(params: {
    entityId: Types.ObjectId;
    entityType: SkuEntityType;
    productId: Types.ObjectId;
    newSku: string;
    session: ClientSession;
  }): Promise<ISkuRegistryDocument> {
    const { entityId, entityType, productId, newSku, session } = params;

    const normalizedNewSku = SkuGeneratorService.normalizeSku(newSku);
    if (!SkuGeneratorService.validateManualSku(normalizedNewSku)) {
      throw new SkuError(
        `Invalid replacement SKU format: "${newSku}". Must match ${CANONICAL_SKU_REGEX.source}`,
        'INVALID_SKU_FORMAT',
        400,
      );
    }

    // 1. Locate existing reservation
    const existing = await SkuRegistryModel.findOne({
      entityId,
      entityType,
      productId,
      status: 'RESERVED',
    }).session(session);

    if (!existing) {
      throw new SkuError(
        'Cannot replace SKU: entity has no reserved DRAFT SKU or is already published/archived',
        'IMMUTABLE_SKU_MODIFICATION',
        400,
      );
    }

    if (existing.normalizedSku === normalizedNewSku) {
      return existing; // No-op, same SKU
    }

    // 2. Pre-check uniqueness of new SKU
    const collision = await SkuRegistryModel.findOne({
      normalizedSku: normalizedNewSku,
      _id: { $ne: existing._id },
    })
      .collation({ locale: 'en', strength: 2 })
      .session(session);

    if (collision) {
      const errCode = entityType === 'PRODUCT' ? 'PRODUCT_SKU_EXISTS' : 'VARIANT_SKU_EXISTS';
      throw new SkuError(`SKU "${normalizedNewSku}" already exists in the catalogue`, errCode, 409);
    }

    // 3. In-place update
    existing.sku = normalizedNewSku;
    existing.normalizedSku = normalizedNewSku;

    try {
      await existing.save({ session });
      return existing;
    } catch (err: unknown) {
      this.handleMongoDuplicateKey(err, normalizedNewSku, entityType);
      throw err;
    }
  }

  /**
   * Handles duplicate key translation into standard domain errors.
   */
  private handleMongoDuplicateKey(err: unknown, sku: string, entityType: SkuEntityType): void {
    const mongoErr = err as {
      code?: number;
      message?: string;
      keyPattern?: Record<string, unknown>;
    };
    if (mongoErr?.code === 11000) {
      const errCode = entityType === 'PRODUCT' ? 'PRODUCT_SKU_EXISTS' : 'VARIANT_SKU_EXISTS';
      throw new SkuError(`SKU "${sku}" already exists in the catalogue`, errCode, 409);
    }
  }
}

export const skuGeneratorService = new SkuGeneratorService();
