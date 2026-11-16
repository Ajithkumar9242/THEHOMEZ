import { Types } from 'mongoose';
import {
  type IProductVariant,
  type ICreateProductVariantDto,
  type IUpdateProductVariantDto,
  type ProductVariantStatus,
  MAX_VARIANTS_PER_PRODUCT,
  PermissionCode,
  ExactDecimalQuantity,
} from '@thehomez/shared-types';
import { ProductModel } from '../../models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../../models/product-variant.model.js';
import { ProductPricingModel } from '../../models/product-pricing.model.js';
import { PriceHistoryModel } from '../../models/price-history.model.js';
import { SkuRegistryModel } from '../../models/sku-registry.model.js';
import { UnitModel } from '../../models/unit.model.js';
import { skuGeneratorService } from './sku-generator.service.js';
import { UnitValidator, UnitValidationError } from './unit-validator.js';
import { PartnerAvailabilityService } from '../partner-availability/index.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';

export class ProductVariantError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ProductVariantError';
  }
}

export class ProductVariantService {
  constructor(
    private readonly partnerAvailabilityService: PartnerAvailabilityService = new PartnerAvailabilityService(),
  ) {}
  /**
   * Transforms a Mongoose variant document into a standard IProductVariant DTO.
   */
  public static toVariantDto(doc: IProductVariantDocument): IProductVariant {
    const attrMap: Record<string, string> = {};
    if (doc.attributes) {
      if (doc.attributes instanceof Map) {
        for (const [k, v] of doc.attributes.entries()) {
          attrMap[k] = v;
        }
      } else if (typeof doc.attributes === 'object') {
        Object.assign(attrMap, doc.attributes);
      }
    }

    return {
      id: doc._id.toString(),
      productId: doc.productId.toString(),
      sku: doc.sku,
      title: doc.title,
      status: doc.status,
      attributes: attrMap,
      images: doc.images || [],
      unitCode: doc.unitCode ?? null,
      quantityPrecision: doc.quantityPrecision ?? null,
      minOrderQuantity: doc.minOrderQuantity ?? null,
      maxOrderQuantity: doc.maxOrderQuantity ?? null,
      stepIncrement: doc.stepIncrement ?? null,
      publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Normalizes variant attributes into a canonical sorted representation.
   */
  public static canonicalizeAttributes(attrs: Record<string, string>): {
    normalized: Record<string, string>;
    hashKey: string;
  } {
    if (!attrs || typeof attrs !== 'object' || Object.keys(attrs).length === 0) {
      throw new ProductVariantError(
        'Variant attributes map cannot be empty',
        'VALIDATION_ERROR',
        400,
      );
    }

    const sortedKeys = Object.keys(attrs)
      .map((k) => k.trim().toLowerCase())
      .sort();

    const normalized: Record<string, string> = {};
    const keyPairs: string[] = [];

    for (const key of sortedKeys) {
      const origKey = Object.keys(attrs).find((k) => k.trim().toLowerCase() === key)!;
      const value = String(attrs[origKey]).trim().toLowerCase();
      normalized[key] = String(attrs[origKey]).trim();
      keyPairs.push(`${key}:${value}`);
    }

    return {
      normalized,
      hashKey: keyPairs.join('|'),
    };
  }

  /**
   * Protocol 2: Variant Creation with Parent Coordination Lock.
   */
  public async createVariant(
    productId: string,
    dto: ICreateProductVariantDto,
    userPermissions: string[] = [],
  ): Promise<IProductVariantDocument> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new ProductVariantError('Invalid product ID format', 'VALIDATION_ERROR', 400);
    }

    // Decision 41: Direct ACTIVE variant creation is prohibited
    if (dto.status === 'ACTIVE') {
      throw new ProductVariantError(
        'New variants cannot be created directly as ACTIVE. Create as DRAFT or INACTIVE, configure pricing, then activate.',
        'CANNOT_CREATE_ACTIVE_VARIANT_WITHOUT_PRICING',
        400,
      );
    }

    const { normalized, hashKey } = ProductVariantService.canonicalizeAttributes(dto.attributes);

    return await withTransaction(async (session) => {
      // 1. Acquire Parent Coordination Lock
      const parent = await ProductModel.findOneAndUpdate(
        { _id: productId },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!parent) {
        throw new ProductVariantError('Parent product not found', 'PRODUCT_NOT_FOUND', 404);
      }

      if (parent.status === 'ARCHIVED') {
        throw new ProductVariantError(
          'Cannot add variant to archived product',
          'PRODUCT_ARCHIVED',
          400,
        );
      }

      if (!parent.hasVariants) {
        throw new ProductVariantError(
          'Parent product is a single-item catalog item without variant capability',
          'CANNOT_ADD_VARIANT_TO_NON_VARIANT_PRODUCT',
          400,
        );
      }

      // 2. Enforce 50-Variant Ceiling
      const count = await ProductVariantModel.countDocuments({
        productId: parent._id,
        status: { $ne: 'ARCHIVED' },
      }).session(session);

      if (count >= MAX_VARIANTS_PER_PRODUCT) {
        throw new ProductVariantError(
          `Cannot add variant: maximum limit of ${MAX_VARIANTS_PER_PRODUCT} variants reached for this product`,
          'MAX_VARIANTS_EXCEEDED',
          400,
        );
      }

      // 3. Verify Attribute Uniqueness among non-archived variants
      const siblings = await ProductVariantModel.find({
        productId: parent._id,
        status: { $ne: 'ARCHIVED' },
      }).session(session);

      for (const sibling of siblings) {
        const siblingAttr =
          sibling.attributes instanceof Map
            ? Object.fromEntries(sibling.attributes)
            : sibling.attributes;
        const siblingCanonical = ProductVariantService.canonicalizeAttributes(siblingAttr);
        if (siblingCanonical.hashKey === hashKey) {
          throw new ProductVariantError(
            'A variant with identical attributes already exists under this parent product',
            'DUPLICATE_VARIANT_ATTRIBUTES',
            409,
          );
        }
      }

      // 4. Resolve Unit Configuration (one-time snapshot copy from parent if omitted, or validate overrides)
      const resolvedUnitCode =
        dto.unitCode !== undefined
          ? dto.unitCode
            ? dto.unitCode.trim().toUpperCase()
            : null
          : parent.unitCode || null;
      const resolvedPrecision =
        dto.quantityPrecision !== undefined
          ? dto.quantityPrecision
          : (parent.quantityPrecision ?? null);
      const resolvedMoq =
        dto.minOrderQuantity !== undefined
          ? dto.minOrderQuantity
            ? dto.minOrderQuantity.trim()
            : null
          : parent.minOrderQuantity || null;
      const resolvedMaxOq =
        dto.maxOrderQuantity !== undefined
          ? dto.maxOrderQuantity
            ? dto.maxOrderQuantity.trim()
            : null
          : parent.maxOrderQuantity || null;
      const resolvedStep =
        dto.stepIncrement !== undefined
          ? dto.stepIncrement
            ? dto.stepIncrement.trim()
            : null
          : parent.stepIncrement || null;

      if (resolvedUnitCode) {
        try {
          await UnitValidator.validateConfiguration(
            {
              unitCode: resolvedUnitCode,
              quantityPrecision: resolvedPrecision,
              minOrderQuantity: resolvedMoq,
              maxOrderQuantity: resolvedMaxOq,
              stepIncrement: resolvedStep,
            },
            session,
          );
        } catch (err: unknown) {
          if (err instanceof UnitValidationError) {
            throw new ProductVariantError(err.message, err.code, err.statusCode);
          }
          throw err;
        }
      }

      // 5. Status and Publication Permission
      const requestedActive = dto.status === 'ACTIVE';
      const hasPublishPermission = userPermissions.includes(PermissionCode.CATALOG_PUBLISH);

      if (requestedActive && hasPublishPermission) {
        if (
          !resolvedUnitCode ||
          resolvedPrecision === undefined ||
          resolvedPrecision === null ||
          !resolvedMoq ||
          !resolvedStep
        ) {
          throw new ProductVariantError(
            'Cannot activate variant: complete unit configuration (unitCode, quantityPrecision, minOrderQuantity, stepIncrement) is required',
            'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
            400,
          );
        }
      }

      let finalStatus: ProductVariantStatus = 'DRAFT';
      if (requestedActive) {
        if (!hasPublishPermission) {
          // If lacks publish permission, force to INACTIVE or DRAFT
          finalStatus = 'INACTIVE';
        } else {
          finalStatus = 'ACTIVE';
        }
      } else if (dto.status) {
        finalStatus = dto.status;
      }

      const variantId = new Types.ObjectId();
      const isPublishing = finalStatus === 'ACTIVE';

      // 6. Reserve Variant SKU in SkuRegistry
      const reservedRegistry = await skuGeneratorService.reserveSku({
        sku: dto.sku,
        entityType: 'VARIANT',
        entityId: variantId,
        productId: parent._id,
        status: isPublishing ? 'ASSIGNED' : 'RESERVED',
        session,
      });

      const variant = new ProductVariantModel({
        _id: variantId,
        productId: parent._id,
        sku: reservedRegistry.sku,
        title: dto.title.trim(),
        status: finalStatus,
        attributes: normalized,
        images: dto.images || [],
        unitCode: resolvedUnitCode,
        quantityPrecision: resolvedPrecision,
        minOrderQuantity: resolvedMoq,
        maxOrderQuantity: resolvedMaxOq,
        stepIncrement: resolvedStep,
        publishedAt: isPublishing ? new Date() : null,
      });

      await variant.save({ session });
      logger.info(
        { variantId: variant._id.toString(), sku: variant.sku, productId: parent._id.toString() },
        'Variant created successfully',
      );
      return variant;
    });
  }

  /**
   * Lists all variants belonging to a parent product.
   */
  public async listVariants(productId: string): Promise<IProductVariantDocument[]> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new ProductVariantError('Invalid product ID format', 'VALIDATION_ERROR', 400);
    }
    return await ProductVariantModel.find({ productId }).sort({ createdAt: 1 });
  }

  /**
   * Retrieves single variant by ID under parent product.
   */
  public async getVariantById(
    productId: string,
    variantId: string,
  ): Promise<IProductVariantDocument> {
    if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(variantId)) {
      throw new ProductVariantError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }
    const variant = await ProductVariantModel.findOne({ _id: variantId, productId });
    if (!variant) {
      throw new ProductVariantError(
        'Variant not found under this parent product',
        'VARIANT_NOT_FOUND',
        404,
      );
    }
    return variant;
  }

  /**
   * Protocol 3: Variant Update & Activation / Publication.
   * Acquires parent coordination write lock ($inc: { version: 1 }).
   */
  public async updateVariant(
    productId: string,
    variantId: string,
    dto: IUpdateProductVariantDto,
    userPermissions: string[] = [],
  ): Promise<IProductVariantDocument> {
    if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(variantId)) {
      throw new ProductVariantError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      // 1. Acquire Parent Coordination Lock
      const parent = await ProductModel.findOneAndUpdate(
        { _id: productId },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!parent) {
        throw new ProductVariantError('Parent product not found', 'PRODUCT_NOT_FOUND', 404);
      }

      if (parent.status === 'ARCHIVED') {
        throw new ProductVariantError(
          'Cannot modify variant of archived parent product',
          'INVALID_PRODUCT_STATE_TRANSITION',
          400,
        );
      }

      // 2. Retrieve Target Variant
      const variant = await ProductVariantModel.findOne({
        _id: variantId,
        productId: parent._id,
      }).session(session);

      if (!variant) {
        throw new ProductVariantError(
          'Variant not found under this parent product',
          'VARIANT_NOT_FOUND',
          404,
        );
      }

      if (variant.status === 'ARCHIVED') {
        throw new ProductVariantError(
          'Cannot modify archived variant',
          'INVALID_PRODUCT_STATE_TRANSITION',
          400,
        );
      }

      // 3. SKU Replacement (draft only)
      if (dto.sku !== undefined) {
        if (variant.status !== 'DRAFT' || variant.publishedAt !== null) {
          throw new ProductVariantError(
            'Cannot modify SKU of a variant that is active, inactive after publication, or archived',
            'IMMUTABLE_SKU_MODIFICATION',
            400,
          );
        }
        const replaced = await skuGeneratorService.replaceDraftSku({
          entityId: variant._id,
          entityType: 'VARIANT',
          productId: parent._id,
          newSku: dto.sku,
          session,
        });
        variant.sku = replaced.sku;
      }

      // 4. Attribute uniqueness check if attributes updated
      if (dto.attributes) {
        const { normalized, hashKey } = ProductVariantService.canonicalizeAttributes(
          dto.attributes,
        );
        const siblings = await ProductVariantModel.find({
          productId: parent._id,
          _id: { $ne: variant._id },
          status: { $ne: 'ARCHIVED' },
        }).session(session);

        for (const sibling of siblings) {
          const siblingAttr =
            sibling.attributes instanceof Map
              ? Object.fromEntries(sibling.attributes)
              : sibling.attributes;
          const siblingCanonical = ProductVariantService.canonicalizeAttributes(siblingAttr);
          if (siblingCanonical.hashKey === hashKey) {
            throw new ProductVariantError(
              'A variant with identical attributes already exists under this parent product',
              'DUPLICATE_VARIANT_ATTRIBUTES',
              409,
            );
          }
        }
        variant.attributes = normalized;
      }

      // 5. Unit configuration updates & immutability checks
      if (dto.unitCode !== undefined || dto.quantityPrecision !== undefined) {
        if (variant.publishedAt !== null) {
          const normalizedUnitCode = dto.unitCode ? dto.unitCode.trim().toUpperCase() : null;
          const currentUnitCode = variant.unitCode ? variant.unitCode.trim().toUpperCase() : null;
          const unitCodeChanged =
            dto.unitCode !== undefined && normalizedUnitCode !== currentUnitCode;
          const precisionChanged =
            dto.quantityPrecision !== undefined &&
            dto.quantityPrecision !== variant.quantityPrecision;
          if (unitCodeChanged || precisionChanged) {
            throw new ProductVariantError(
              'unitCode and quantityPrecision cannot be modified after initial publication',
              'IMMUTABLE_UNIT_MODIFICATION',
              400,
            );
          }
        }
      }

      const effectiveUnitCode =
        dto.unitCode !== undefined
          ? dto.unitCode
            ? dto.unitCode.trim().toUpperCase()
            : null
          : variant.unitCode;
      const effectivePrecision =
        dto.quantityPrecision !== undefined ? dto.quantityPrecision : variant.quantityPrecision;
      const effectiveMoq =
        dto.minOrderQuantity !== undefined
          ? dto.minOrderQuantity
            ? dto.minOrderQuantity.trim()
            : null
          : variant.minOrderQuantity;
      const effectiveMaxOq =
        dto.maxOrderQuantity !== undefined
          ? dto.maxOrderQuantity
            ? dto.maxOrderQuantity.trim()
            : null
          : variant.maxOrderQuantity;
      const effectiveStep =
        dto.stepIncrement !== undefined
          ? dto.stepIncrement
            ? dto.stepIncrement.trim()
            : null
          : variant.stepIncrement;

      if (effectiveUnitCode) {
        try {
          await UnitValidator.validateConfiguration(
            {
              unitCode: effectiveUnitCode,
              quantityPrecision: effectivePrecision,
              minOrderQuantity: effectiveMoq,
              maxOrderQuantity: effectiveMaxOq,
              stepIncrement: effectiveStep,
            },
            session,
          );
        } catch (err: unknown) {
          if (err instanceof UnitValidationError) {
            throw new ProductVariantError(err.message, err.code, err.statusCode);
          }
          throw err;
        }

        // Decision 44: Unit mutation and B2B volume tier validity invariant enforcement
        if (
          effectiveUnitCode &&
          effectivePrecision !== null &&
          effectivePrecision !== undefined &&
          effectiveMoq &&
          effectiveStep
        ) {
          const activePricings = await ProductPricingModel.find({
            productId: parent._id,
            variantId: variant._id,
            isActive: true,
          }).session(session);

          for (const pr of activePricings) {
            if (pr.b2bTiers && pr.b2bTiers.length > 0) {
              for (const tier of pr.b2bTiers) {
                const tierVal = ExactDecimalQuantity.validate(tier.minQuantity, {
                  unitCode: effectiveUnitCode,
                  quantityPrecision: effectivePrecision,
                  minOrderQuantity: effectiveMoq,
                  maxOrderQuantity: effectiveMaxOq || undefined,
                  stepIncrement: effectiveStep,
                });

                if (!tierVal.isValid) {
                  throw new ProductVariantError(
                    `Existing B2B volume tier minQuantity "${tier.minQuantity}" is incompatible with updated unit configuration: ${tierVal.message || 'tier step/precision violation'}`,
                    'EXISTING_TIERS_INCOMPATIBLE_WITH_UNIT_CHANGE',
                    400,
                  );
                }
              }
            }
          }
        }
      }

      // 6. Activation / Publication Guard
      if (dto.status === 'ACTIVE' && variant.status !== 'ACTIVE') {
        const hasPublishPermission = userPermissions.includes(PermissionCode.CATALOG_PUBLISH);
        if (!hasPublishPermission) {
          throw new ProductVariantError(
            'Principal lacks permission to activate/publish product variant',
            'CANNOT_ACTIVATE_VARIANT_WITHOUT_PERMISSION',
            403,
          );
        }

        if (
          !effectiveUnitCode ||
          effectivePrecision === undefined ||
          effectivePrecision === null ||
          !effectiveMoq ||
          !effectiveStep
        ) {
          throw new ProductVariantError(
            'Cannot activate variant: complete unit configuration (unitCode, quantityPrecision, minOrderQuantity, stepIncrement) is required',
            'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
            400,
          );
        }

        // Acquire coordination lock on unit to coordinate with concurrent unit ceiling updates
        const vUnit = await UnitModel.findOneAndUpdate(
          { code: effectiveUnitCode, isActive: true },
          { $inc: { version: 1 } },
          { session, new: true },
        );
        if (!vUnit) {
          throw new ProductVariantError(
            `Unit with code "${effectiveUnitCode}" does not exist or is inactive`,
            'UNIT_NOT_FOUND',
            400,
          );
        }
        if (vUnit.isDiscrete && effectivePrecision > 0) {
          throw new ProductVariantError(
            `Discrete unit "${vUnit.code}" cannot have decimal precision`,
            'DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION',
            400,
          );
        }
        if (effectivePrecision > vUnit.allowedMaxPrecision) {
          throw new ProductVariantError(
            `Precision ${effectivePrecision} exceeds maximum allowed precision of ${vUnit.allowedMaxPrecision} for unit "${vUnit.code}"`,
            'PRECISION_EXCEEDS_UNIT_MAXIMUM',
            400,
          );
        }

        // Decision 40 & Decision 45: Verify variant has active global B2C pricing with price > 0
        const variantGlobalPricing = await ProductPricingModel.findOne({
          productId: parent._id,
          variantId: variant._id,
          serviceAreaId: null,
          pricingScope: 'VARIANT_GLOBAL',
          isActive: true,
        }).session(session);

        if (
          !variantGlobalPricing ||
          !variantGlobalPricing.b2cPricePaise ||
          variantGlobalPricing.b2cPricePaise <= 0
        ) {
          throw new ProductVariantError(
            'Cannot activate variant: an active global B2C pricing record with price > 0 is required',
            'CANNOT_ACTIVATE_UNPRICED_VARIANT',
            400,
          );
        }

        variant.status = 'ACTIVE';
        if (variant.publishedAt === null) {
          variant.publishedAt = new Date();
        }

        // Transition SKU registry status to ASSIGNED
        await SkuRegistryModel.updateOne(
          { entityId: variant._id, entityType: 'VARIANT' },
          { $set: { status: 'ASSIGNED' } },
          { session },
        );
      } else if (dto.status !== undefined) {
        variant.status = dto.status;
      }

      if (dto.unitCode !== undefined)
        variant.unitCode = dto.unitCode ? dto.unitCode.trim().toUpperCase() : null;
      if (dto.quantityPrecision !== undefined) variant.quantityPrecision = dto.quantityPrecision;
      if (dto.minOrderQuantity !== undefined)
        variant.minOrderQuantity = dto.minOrderQuantity ? dto.minOrderQuantity.trim() : null;
      if (dto.maxOrderQuantity !== undefined)
        variant.maxOrderQuantity = dto.maxOrderQuantity ? dto.maxOrderQuantity.trim() : null;
      if (dto.stepIncrement !== undefined)
        variant.stepIncrement = dto.stepIncrement ? dto.stepIncrement.trim() : null;

      if (dto.title !== undefined) variant.title = dto.title.trim();
      if (dto.images !== undefined) variant.images = dto.images;

      await variant.save({ session });
      logger.info(
        { variantId: variant._id.toString(), status: variant.status },
        'Variant updated successfully',
      );
      return variant;
    });
  }

  /**
   * Deactivates a variant (transitions to INACTIVE). Does NOT clear publishedAt.
   */
  public async deactivateVariant(
    productId: string,
    variantId: string,
  ): Promise<IProductVariantDocument> {
    if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(variantId)) {
      throw new ProductVariantError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    const variant = await ProductVariantModel.findOne({ _id: variantId, productId });
    if (!variant) {
      throw new ProductVariantError(
        'Variant not found under this parent product',
        'VARIANT_NOT_FOUND',
        404,
      );
    }
    if (variant.status === 'ARCHIVED') {
      throw new ProductVariantError(
        'Cannot deactivate archived variant',
        'INVALID_PRODUCT_STATE_TRANSITION',
        400,
      );
    }

    variant.status = 'INACTIVE';
    await variant.save();
    return variant;
  }

  /**
   * Archives a variant. Permanently retains SKU reservation in sku_registry.
   */
  public async archiveVariant(
    productId: string,
    variantId: string,
    userId?: string,
  ): Promise<IProductVariantDocument> {
    if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(variantId)) {
      throw new ProductVariantError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      const variant = await ProductVariantModel.findOne({ _id: variantId, productId }).session(
        session,
      );
      if (!variant) {
        throw new ProductVariantError(
          'Variant not found under this parent product',
          'VARIANT_NOT_FOUND',
          404,
        );
      }
      if (variant.status === 'ARCHIVED') {
        return variant;
      }

      variant.status = 'ARCHIVED';
      await variant.save({ session });

      await SkuRegistryModel.updateOne(
        { entityId: variant._id, entityType: 'VARIANT' },
        { $set: { status: 'ARCHIVED' } },
        { session },
      );

      // Decision 42: Cascade deactivation to all active pricing records for this variant
      const activePricingDocs = await ProductPricingModel.find({
        productId: new Types.ObjectId(productId),
        variantId: variant._id,
        isActive: true,
      }).session(session);

      const effectiveUserId =
        userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : variant.productId;

      for (const pr of activePricingDocs) {
        await ProductPricingModel.updateOne(
          { _id: pr._id, version: pr.version },
          {
            $set: {
              isActive: false,
              updatedBy: effectiveUserId,
            },
            $inc: { version: 1 },
          },
          { session },
        );

        await PriceHistoryModel.create(
          [
            {
              pricingId: pr._id,
              productId: pr.productId,
              variantId: pr.variantId,
              serviceAreaId: pr.serviceAreaId,
              pricingScope: pr.pricingScope,
              action: 'DEACTIVATED',
              previousB2cPricePaise: pr.b2cPricePaise,
              newB2cPricePaise: pr.b2cPricePaise,
              previousB2cMrpPaise: pr.b2cMrpPaise,
              newB2cMrpPaise: pr.b2cMrpPaise,
              previousB2bPricePaise: pr.b2bPricePaise,
              newB2bPricePaise: pr.b2bPricePaise,
              previousTiers: (pr.b2bTiers || []).map((t) => ({
                minQuantity: t.minQuantity,
                pricePaise: t.pricePaise,
              })),
              newTiers: (pr.b2bTiers || []).map((t) => ({
                minQuantity: t.minQuantity,
                pricePaise: t.pricePaise,
              })),
              changeReason: 'Variant archived: cascade pricing deactivation',
              changedBy: effectiveUserId,
            },
          ],
          { session },
        );
      }

      // Cascade deactivation to all active partner availability records for this variant
      await this.partnerAvailabilityService.deactivateAvailabilityForVariant(
        variant._id.toString(),
        effectiveUserId.toString(),
        session,
      );

      logger.info(
        { variantId: variant._id.toString() },
        'Variant and associated pricing archived successfully',
      );
      return variant;
    });
  }
}

export const productVariantService = new ProductVariantService();
