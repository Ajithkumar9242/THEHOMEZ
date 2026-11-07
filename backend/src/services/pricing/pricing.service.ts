import { Types, type ClientSession } from 'mongoose';
import {
  type ISetPricingDto,
  type IProductPricing,
  type IPriceHistory,
  type PricingScope,
  type IPricingCalculationRequestDto,
  type IPricingCalculationResponseDto,
  PermissionCode,
  UserType,
  UserStatus,
} from '@thehomez/shared-types';
import { ProductModel } from '../../models/product.model.js';
import { ProductVariantModel } from '../../models/product-variant.model.js';
import { ServiceAreaModel } from '../../models/service-area.model.js';
import {
  ProductPricingModel,
  type IProductPricingDocument,
} from '../../models/product-pricing.model.js';
import { PriceHistoryModel, type IPriceHistoryDocument } from '../../models/price-history.model.js';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import { RbacService } from '../rbac/rbac.service.js';
import { withTransaction } from '../../database/transaction.js';
import { PricingError } from './pricing-errors.js';
import { PricingValidator } from './pricing-validator.js';
import { PricingEngineService, type AuthContext } from './pricing-engine.service.js';

export function toPricingDto(doc: IProductPricingDocument): IProductPricing {
  return {
    id: doc._id.toString(),
    productId: doc.productId.toString(),
    variantId: doc.variantId ? doc.variantId.toString() : null,
    serviceAreaId: doc.serviceAreaId ? doc.serviceAreaId.toString() : null,
    pricingScope: doc.pricingScope,
    currency: doc.currency,
    b2cPricePaise: doc.b2cPricePaise,
    b2cMrpPaise: doc.b2cMrpPaise ?? null,
    b2bPricePaise: doc.b2bPricePaise ?? null,
    b2bTiers: (doc.b2bTiers || []).map((t) => ({
      minQuantity: t.minQuantity,
      pricePaise: t.pricePaise,
    })),
    isActive: doc.isActive,
    version: doc.version,
    createdBy: doc.createdBy.toString(),
    updatedBy: doc.updatedBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toPriceHistoryDto(doc: IPriceHistoryDocument): IPriceHistory {
  return {
    id: doc._id.toString(),
    pricingId: doc.pricingId.toString(),
    productId: doc.productId.toString(),
    variantId: doc.variantId ? doc.variantId.toString() : null,
    serviceAreaId: doc.serviceAreaId ? doc.serviceAreaId.toString() : null,
    pricingScope: doc.pricingScope,
    action: doc.action,
    previousB2cPricePaise: doc.previousB2cPricePaise ?? null,
    newB2cPricePaise: doc.newB2cPricePaise,
    previousB2cMrpPaise: doc.previousB2cMrpPaise ?? null,
    newB2cMrpPaise: doc.newB2cMrpPaise ?? null,
    previousB2bPricePaise: doc.previousB2bPricePaise ?? null,
    newB2bPricePaise: doc.newB2bPricePaise ?? null,
    previousTiers: (doc.previousTiers || []).map((t) => ({
      minQuantity: t.minQuantity,
      pricePaise: t.pricePaise,
    })),
    newTiers: (doc.newTiers || []).map((t) => ({
      minQuantity: t.minQuantity,
      pricePaise: t.pricePaise,
    })),
    changeReason: doc.changeReason,
    changedBy: doc.changedBy.toString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const mongoErr = err as { code?: number; name?: string; message?: string };
  return (
    mongoErr.code === 11000 ||
    (mongoErr.name === 'MongoServerError' && mongoErr.code === 11000) ||
    Boolean(mongoErr.message && mongoErr.message.includes('E11000 duplicate key error'))
  );
}

export class PricingService {
  private readonly rbacService = new RbacService();
  private readonly pricingEngine = new PricingEngineService();

  /**
   * Asserts that the actor is an authenticated active staff member possessing the required permission.
   * Never trusts client-supplied identity claims; loads fresh user state from MongoDB.
   */
  public async assertAuthorizedActor(
    authContext: AuthContext,
    requiredPermission: PermissionCode,
  ): Promise<IUserDocument> {
    if (!authContext) {
      throw new PricingError(
        'Authentication required for administrative pricing operations',
        'UNAUTHORIZED',
        401,
      );
    }

    let userId: string | null = null;

    if (typeof authContext === 'string') {
      userId = authContext;
    } else if ('_id' in authContext && authContext._id) {
      userId = authContext._id.toString();
    } else if ('id' in authContext && authContext.id) {
      userId = authContext.id;
    } else if ('userId' in authContext && authContext.userId) {
      userId = authContext.userId;
    } else if ('principal' in authContext && authContext.principal?.id) {
      userId = authContext.principal.id;
    } else if ('user' in authContext && authContext.user?._id) {
      userId = authContext.user._id.toString();
    }

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new PricingError(
        'Invalid or missing actor authentication identity',
        'UNAUTHORIZED',
        401,
      );
    }

    const actor = await UserModel.findById(userId);
    if (!actor) {
      throw new PricingError('Actor user account not found in database', 'UNAUTHORIZED', 401);
    }

    if (actor.status !== UserStatus.ACTIVE) {
      throw new PricingError(
        `Actor account is ${actor.status.toLowerCase()} and cannot perform pricing operations`,
        'FORBIDDEN',
        403,
      );
    }

    if (actor.userType !== UserType.STAFF) {
      throw new PricingError(
        'Only authorized staff may perform administrative pricing operations',
        'FORBIDDEN',
        403,
      );
    }

    const permissions = await this.rbacService.getEffectivePermissions(actor.roles || []);
    if (!permissions.includes(requiredPermission)) {
      throw new PricingError(
        `Insufficient privileges: actor lacks required permission '${requiredPermission}'`,
        'FORBIDDEN',
        403,
      );
    }

    return actor;
  }

  /**
   * Sets or updates pricing for a standalone product inside an ACID transaction.
   * Atomically records price history and increments version lock.
   */
  public async setStandalonePricing(
    productId: string,
    dto: ISetPricingDto,
    authContext: AuthContext,
    options?: { expectedVersion?: number },
  ): Promise<IProductPricing> {
    const actor = await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_WRITE);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      throw new PricingError('Invalid productId', 'PRODUCT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (product.hasVariants === true) {
      throw new PricingError(
        'Standalone pricing cannot be assigned to multi-variant parent products',
        'PARENT_CONTAINER_CANNOT_HAVE_PRICE',
        400,
      );
    }

    if (product.status === 'ARCHIVED') {
      throw new PricingError(
        'Cannot set pricing on an archived product',
        'CANNOT_PRICE_ARCHIVED_PRODUCT',
        400,
      );
    }

    let resolvedServiceAreaId: Types.ObjectId | null = null;
    let pricingScope: PricingScope = 'STANDALONE_GLOBAL';

    if (dto.serviceAreaId) {
      if (!Types.ObjectId.isValid(dto.serviceAreaId)) {
        throw new PricingError('Invalid serviceAreaId', 'SERVICE_AREA_NOT_FOUND', 404);
      }
      const serviceArea = await ServiceAreaModel.findById(dto.serviceAreaId);
      if (!serviceArea) {
        throw new PricingError('Service area not found', 'SERVICE_AREA_NOT_FOUND', 404);
      }
      if (!serviceArea.isActive) {
        throw new PricingError('Service area is inactive', 'SERVICE_AREA_INACTIVE', 400);
      }
      resolvedServiceAreaId = serviceArea._id;
      pricingScope = 'STANDALONE_REGIONAL';
    }

    if (
      !product.unitCode ||
      product.quantityPrecision === null ||
      product.quantityPrecision === undefined ||
      !product.minOrderQuantity ||
      !product.stepIncrement
    ) {
      throw new PricingError(
        'Product physical unit configuration is incomplete',
        'VALIDATION_ERROR',
        500,
      );
    }

    const unitRules = {
      unitCode: product.unitCode,
      quantityPrecision: product.quantityPrecision,
      minOrderQuantity: product.minOrderQuantity,
      stepIncrement: product.stepIncrement,
    };

    PricingValidator.validatePricingPayload(dto, unitRules);

    try {
      return await withTransaction(async (session: ClientSession) => {
        const freshProduct = await ProductModel.findById(product._id).session(session);
        if (!freshProduct || freshProduct.status === 'ARCHIVED') {
          throw new PricingError(
            'Cannot set pricing on an archived product',
            'CANNOT_PRICE_ARCHIVED_PRODUCT',
            400,
          );
        }

        const filter = {
          productId: product._id,
          variantId: null,
          serviceAreaId: resolvedServiceAreaId,
          pricingScope,
        };

        const existingDoc = await ProductPricingModel.findOne(filter).session(session);

        if (existingDoc) {
          if (
            options?.expectedVersion !== undefined &&
            existingDoc.version !== options.expectedVersion
          ) {
            throw new PricingError(
              `Pricing record version mismatch (expected ${options.expectedVersion}, found ${existingDoc.version})`,
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          const previousB2cPricePaise = existingDoc.b2cPricePaise;
          const previousB2cMrpPaise = existingDoc.b2cMrpPaise;
          const previousB2bPricePaise = existingDoc.b2bPricePaise;
          const previousTiers = (existingDoc.b2bTiers || []).map((t) => ({
            minQuantity: t.minQuantity,
            pricePaise: t.pricePaise,
          }));

          const updatedDoc = await ProductPricingModel.findOneAndUpdate(
            { _id: existingDoc._id, version: existingDoc.version },
            {
              $set: {
                currency: dto.currency || 'INR',
                b2cPricePaise: dto.b2cPricePaise,
                b2cMrpPaise: dto.b2cMrpPaise ?? null,
                b2bPricePaise: dto.b2bPricePaise ?? null,
                b2bTiers: dto.b2bTiers ?? [],
                isActive: true,
                updatedBy: actor._id,
              },
              $inc: { version: 1 },
            },
            { session, new: true },
          );

          if (!updatedDoc) {
            throw new PricingError(
              'Pricing record was modified concurrently by another transaction',
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          await PriceHistoryModel.create(
            [
              {
                pricingId: updatedDoc._id,
                productId: updatedDoc.productId,
                variantId: null,
                serviceAreaId: updatedDoc.serviceAreaId,
                pricingScope: updatedDoc.pricingScope,
                action: 'UPDATED',
                previousB2cPricePaise,
                newB2cPricePaise: updatedDoc.b2cPricePaise,
                previousB2cMrpPaise,
                newB2cMrpPaise: updatedDoc.b2cMrpPaise,
                previousB2bPricePaise,
                newB2bPricePaise: updatedDoc.b2bPricePaise,
                previousTiers,
                newTiers: (updatedDoc.b2bTiers || []).map((t) => ({
                  minQuantity: t.minQuantity,
                  pricePaise: t.pricePaise,
                })),
                changeReason: dto.changeReason.trim(),
                changedBy: actor._id,
              },
            ],
            { session },
          );

          return toPricingDto(updatedDoc);
        } else {
          if (options?.expectedVersion !== undefined && options.expectedVersion !== 0) {
            throw new PricingError(
              `Pricing record version mismatch (expected ${options.expectedVersion}, found 0)`,
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          const [newDoc] = await ProductPricingModel.create(
            [
              {
                productId: product._id,
                variantId: null,
                serviceAreaId: resolvedServiceAreaId,
                pricingScope,
                currency: dto.currency || 'INR',
                b2cPricePaise: dto.b2cPricePaise,
                b2cMrpPaise: dto.b2cMrpPaise ?? null,
                b2bPricePaise: dto.b2bPricePaise ?? null,
                b2bTiers: dto.b2bTiers ?? [],
                isActive: true,
                version: 1,
                createdBy: actor._id,
                updatedBy: actor._id,
              },
            ],
            { session },
          );

          if (!newDoc) {
            throw new PricingError('Failed to create pricing record', 'INTERNAL_ERROR', 500);
          }

          await PriceHistoryModel.create(
            [
              {
                pricingId: newDoc._id,
                productId: newDoc.productId,
                variantId: null,
                serviceAreaId: newDoc.serviceAreaId,
                pricingScope: newDoc.pricingScope,
                action: 'CREATED',
                previousB2cPricePaise: null,
                newB2cPricePaise: newDoc.b2cPricePaise,
                previousB2cMrpPaise: null,
                newB2cMrpPaise: newDoc.b2cMrpPaise,
                previousB2bPricePaise: null,
                newB2bPricePaise: newDoc.b2bPricePaise,
                previousTiers: [],
                newTiers: (newDoc.b2bTiers || []).map((t) => ({
                  minQuantity: t.minQuantity,
                  pricePaise: t.pricePaise,
                })),
                changeReason: dto.changeReason.trim(),
                changedBy: actor._id,
              },
            ],
            { session },
          );

          return toPricingDto(newDoc);
        }
      });
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new PricingError(
          'Pricing record already exists for this scope',
          'PRICING_ALREADY_EXISTS',
          409,
        );
      }
      throw err;
    }
  }

  /**
   * Sets or updates pricing for a product variant inside an ACID transaction.
   * Atomically records price history and increments version lock.
   */
  public async setVariantPricing(
    productId: string,
    variantId: string,
    dto: ISetPricingDto,
    authContext: AuthContext,
    options?: { expectedVersion?: number },
  ): Promise<IProductPricing> {
    const actor = await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_WRITE);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      throw new PricingError('Invalid productId', 'PRODUCT_NOT_FOUND', 404);
    }
    if (!variantId || !Types.ObjectId.isValid(variantId)) {
      throw new PricingError('Invalid variantId', 'VARIANT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (product.hasVariants !== true) {
      throw new PricingError(
        'Single product cannot have variant price',
        'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE',
        400,
      );
    }

    const variant = await ProductVariantModel.findById(variantId);
    if (!variant) {
      throw new PricingError('Variant not found', 'VARIANT_NOT_FOUND', 404);
    }

    if (!variant.productId.equals(product._id)) {
      throw new PricingError(
        'Variant does not belong to specified product',
        'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
        400,
      );
    }

    if (variant.status === 'ARCHIVED') {
      throw new PricingError(
        'Cannot set pricing on an archived variant',
        'CANNOT_PRICE_ARCHIVED_VARIANT',
        400,
      );
    }

    if (product.status === 'ARCHIVED') {
      throw new PricingError(
        'Cannot set pricing on an archived parent product',
        'CANNOT_PRICE_ARCHIVED_PRODUCT',
        400,
      );
    }

    let resolvedServiceAreaId: Types.ObjectId | null = null;
    let pricingScope: PricingScope = 'VARIANT_GLOBAL';

    if (dto.serviceAreaId) {
      if (!Types.ObjectId.isValid(dto.serviceAreaId)) {
        throw new PricingError('Invalid serviceAreaId', 'SERVICE_AREA_NOT_FOUND', 404);
      }
      const serviceArea = await ServiceAreaModel.findById(dto.serviceAreaId);
      if (!serviceArea) {
        throw new PricingError('Service area not found', 'SERVICE_AREA_NOT_FOUND', 404);
      }
      if (!serviceArea.isActive) {
        throw new PricingError('Service area is inactive', 'SERVICE_AREA_INACTIVE', 400);
      }
      resolvedServiceAreaId = serviceArea._id;
      pricingScope = 'VARIANT_REGIONAL';
    }

    if (
      !product.unitCode ||
      product.quantityPrecision === null ||
      product.quantityPrecision === undefined ||
      !product.minOrderQuantity ||
      !product.stepIncrement
    ) {
      throw new PricingError(
        'Product physical unit configuration is incomplete',
        'VALIDATION_ERROR',
        500,
      );
    }

    const unitRules = {
      unitCode: product.unitCode,
      quantityPrecision: product.quantityPrecision,
      minOrderQuantity: product.minOrderQuantity,
      stepIncrement: product.stepIncrement,
    };

    PricingValidator.validatePricingPayload(dto, unitRules);

    try {
      return await withTransaction(async (session: ClientSession) => {
        const freshVariant = await ProductVariantModel.findById(variant._id).session(session);
        if (!freshVariant || freshVariant.status === 'ARCHIVED') {
          throw new PricingError(
            'Cannot set pricing on an archived variant',
            'CANNOT_PRICE_ARCHIVED_VARIANT',
            400,
          );
        }
        const freshParent = await ProductModel.findById(product._id).session(session);
        if (!freshParent || freshParent.status === 'ARCHIVED') {
          throw new PricingError(
            'Cannot set pricing on an archived parent product',
            'CANNOT_PRICE_ARCHIVED_PRODUCT',
            400,
          );
        }

        const filter = {
          productId: product._id,
          variantId: variant._id,
          serviceAreaId: resolvedServiceAreaId,
          pricingScope,
        };

        const existingDoc = await ProductPricingModel.findOne(filter).session(session);

        if (existingDoc) {
          if (
            options?.expectedVersion !== undefined &&
            existingDoc.version !== options.expectedVersion
          ) {
            throw new PricingError(
              `Pricing record version mismatch (expected ${options.expectedVersion}, found ${existingDoc.version})`,
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          const previousB2cPricePaise = existingDoc.b2cPricePaise;
          const previousB2cMrpPaise = existingDoc.b2cMrpPaise;
          const previousB2bPricePaise = existingDoc.b2bPricePaise;
          const previousTiers = (existingDoc.b2bTiers || []).map((t) => ({
            minQuantity: t.minQuantity,
            pricePaise: t.pricePaise,
          }));

          const updatedDoc = await ProductPricingModel.findOneAndUpdate(
            { _id: existingDoc._id, version: existingDoc.version },
            {
              $set: {
                currency: dto.currency || 'INR',
                b2cPricePaise: dto.b2cPricePaise,
                b2cMrpPaise: dto.b2cMrpPaise ?? null,
                b2bPricePaise: dto.b2bPricePaise ?? null,
                b2bTiers: dto.b2bTiers ?? [],
                isActive: true,
                updatedBy: actor._id,
              },
              $inc: { version: 1 },
            },
            { session, new: true },
          );

          if (!updatedDoc) {
            throw new PricingError(
              'Pricing record was modified concurrently by another transaction',
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          await PriceHistoryModel.create(
            [
              {
                pricingId: updatedDoc._id,
                productId: updatedDoc.productId,
                variantId: variant._id,
                serviceAreaId: updatedDoc.serviceAreaId,
                pricingScope: updatedDoc.pricingScope,
                action: 'UPDATED',
                previousB2cPricePaise,
                newB2cPricePaise: updatedDoc.b2cPricePaise,
                previousB2cMrpPaise,
                newB2cMrpPaise: updatedDoc.b2cMrpPaise,
                previousB2bPricePaise,
                newB2bPricePaise: updatedDoc.b2bPricePaise,
                previousTiers,
                newTiers: (updatedDoc.b2bTiers || []).map((t) => ({
                  minQuantity: t.minQuantity,
                  pricePaise: t.pricePaise,
                })),
                changeReason: dto.changeReason.trim(),
                changedBy: actor._id,
              },
            ],
            { session },
          );

          return toPricingDto(updatedDoc);
        } else {
          if (options?.expectedVersion !== undefined && options.expectedVersion !== 0) {
            throw new PricingError(
              `Pricing record version mismatch (expected ${options.expectedVersion}, found 0)`,
              'PRICING_CONCURRENCY_CONFLICT',
              409,
            );
          }

          const [newDoc] = await ProductPricingModel.create(
            [
              {
                productId: product._id,
                variantId: variant._id,
                serviceAreaId: resolvedServiceAreaId,
                pricingScope,
                currency: dto.currency || 'INR',
                b2cPricePaise: dto.b2cPricePaise,
                b2cMrpPaise: dto.b2cMrpPaise ?? null,
                b2bPricePaise: dto.b2bPricePaise ?? null,
                b2bTiers: dto.b2bTiers ?? [],
                isActive: true,
                version: 1,
                createdBy: actor._id,
                updatedBy: actor._id,
              },
            ],
            { session },
          );

          if (!newDoc) {
            throw new PricingError('Failed to create pricing record', 'INTERNAL_ERROR', 500);
          }

          await PriceHistoryModel.create(
            [
              {
                pricingId: newDoc._id,
                productId: newDoc.productId,
                variantId: variant._id,
                serviceAreaId: newDoc.serviceAreaId,
                pricingScope: newDoc.pricingScope,
                action: 'CREATED',
                previousB2cPricePaise: null,
                newB2cPricePaise: newDoc.b2cPricePaise,
                previousB2cMrpPaise: null,
                newB2cMrpPaise: newDoc.b2cMrpPaise,
                previousB2bPricePaise: null,
                newB2bPricePaise: newDoc.b2bPricePaise,
                previousTiers: [],
                newTiers: (newDoc.b2bTiers || []).map((t) => ({
                  minQuantity: t.minQuantity,
                  pricePaise: t.pricePaise,
                })),
                changeReason: dto.changeReason.trim(),
                changedBy: actor._id,
              },
            ],
            { session },
          );

          return toPricingDto(newDoc);
        }
      });
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new PricingError(
          'Pricing record already exists for this scope',
          'PRICING_ALREADY_EXISTS',
          409,
        );
      }
      throw err;
    }
  }

  /**
   * Sets pricing for a target entity (standalone product or variant).
   */
  public async setPricing(
    target: { productId: string; variantId?: string | null },
    dto: ISetPricingDto,
    authContext: AuthContext,
    options?: { expectedVersion?: number },
  ): Promise<IProductPricing> {
    if (target.variantId) {
      return this.setVariantPricing(target.productId, target.variantId, dto, authContext, options);
    }
    return this.setStandalonePricing(target.productId, dto, authContext, options);
  }

  /**
   * Deactivates a pricing record inside an ACID transaction.
   * Atomically records price history action DEACTIVATED and increments version.
   */
  public async deactivatePricing(
    pricingId: string,
    changeReason: string,
    authContext: AuthContext,
    options?: { expectedVersion?: number },
  ): Promise<IProductPricing> {
    const actor = await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_WRITE);

    if (!pricingId || !Types.ObjectId.isValid(pricingId)) {
      throw new PricingError('Invalid pricingId', 'PRODUCT_NOT_PRICED', 404);
    }

    if (
      typeof changeReason !== 'string' ||
      changeReason.trim().length === 0 ||
      changeReason.trim().length > 500
    ) {
      throw new PricingError(
        'changeReason is required, non-empty, and must not exceed 500 characters',
        'VALIDATION_ERROR',
        400,
      );
    }

    return await withTransaction(async (session: ClientSession) => {
      const existingDoc = await ProductPricingModel.findById(pricingId).session(session);
      if (!existingDoc) {
        throw new PricingError('Pricing record not found', 'PRODUCT_NOT_PRICED', 404);
      }

      // Idempotency: If already inactive, return existing record without mutating or logging
      if (!existingDoc.isActive) {
        return toPricingDto(existingDoc);
      }

      if (
        options?.expectedVersion !== undefined &&
        existingDoc.version !== options.expectedVersion
      ) {
        throw new PricingError(
          `Pricing record version mismatch (expected ${options.expectedVersion}, found ${existingDoc.version})`,
          'PRICING_CONCURRENCY_CONFLICT',
          409,
        );
      }

      const previousB2cPricePaise = existingDoc.b2cPricePaise;
      const previousB2cMrpPaise = existingDoc.b2cMrpPaise;
      const previousB2bPricePaise = existingDoc.b2bPricePaise;
      const previousTiers = (existingDoc.b2bTiers || []).map((t) => ({
        minQuantity: t.minQuantity,
        pricePaise: t.pricePaise,
      }));

      const updatedDoc = await ProductPricingModel.findOneAndUpdate(
        { _id: existingDoc._id, version: existingDoc.version },
        {
          $set: {
            isActive: false,
            updatedBy: actor._id,
          },
          $inc: { version: 1 },
        },
        { session, new: true },
      );

      if (!updatedDoc) {
        throw new PricingError(
          'Pricing record was modified concurrently by another transaction',
          'PRICING_CONCURRENCY_CONFLICT',
          409,
        );
      }

      await PriceHistoryModel.create(
        [
          {
            pricingId: updatedDoc._id,
            productId: updatedDoc.productId,
            variantId: updatedDoc.variantId,
            serviceAreaId: updatedDoc.serviceAreaId,
            pricingScope: updatedDoc.pricingScope,
            action: 'DEACTIVATED',
            previousB2cPricePaise,
            newB2cPricePaise: updatedDoc.b2cPricePaise,
            previousB2cMrpPaise,
            newB2cMrpPaise: updatedDoc.b2cMrpPaise,
            previousB2bPricePaise,
            newB2bPricePaise: updatedDoc.b2bPricePaise,
            previousTiers,
            newTiers: (updatedDoc.b2bTiers || []).map((t) => ({
              minQuantity: t.minQuantity,
              pricePaise: t.pricePaise,
            })),
            changeReason: changeReason.trim(),
            changedBy: actor._id,
          },
        ],
        { session },
      );

      return toPricingDto(updatedDoc);
    });
  }

  /**
   * Retrieves standalone product pricing records for administrative review.
   */
  public async getStandalonePricing(
    productId: string,
    serviceAreaId?: string | null,
    authContext?: AuthContext,
  ): Promise<IProductPricing[]> {
    await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_READ);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      throw new PricingError('Invalid productId', 'PRODUCT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (product.hasVariants === true) {
      throw new PricingError(
        'Standalone pricing cannot be queried on multi-variant parent products',
        'PARENT_CONTAINER_CANNOT_HAVE_PRICE',
        400,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {
      productId: product._id,
      variantId: null,
    };

    if (serviceAreaId !== undefined) {
      if (serviceAreaId === null) {
        filter.serviceAreaId = null;
        filter.pricingScope = 'STANDALONE_GLOBAL';
      } else {
        if (!Types.ObjectId.isValid(serviceAreaId)) {
          throw new PricingError('Invalid serviceAreaId', 'SERVICE_AREA_NOT_FOUND', 404);
        }
        filter.serviceAreaId = new Types.ObjectId(serviceAreaId);
        filter.pricingScope = 'STANDALONE_REGIONAL';
      }
    }

    const docs = await ProductPricingModel.find(filter).sort({ createdAt: -1 });
    return docs.map(toPricingDto);
  }

  /**
   * Retrieves variant pricing records for administrative review.
   */
  public async getVariantPricing(
    productId: string,
    variantId: string,
    serviceAreaId?: string | null,
    authContext?: AuthContext,
  ): Promise<IProductPricing[]> {
    await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_READ);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      throw new PricingError('Invalid productId', 'PRODUCT_NOT_FOUND', 404);
    }
    if (!variantId || !Types.ObjectId.isValid(variantId)) {
      throw new PricingError('Invalid variantId', 'VARIANT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (product.hasVariants !== true) {
      throw new PricingError(
        'Single product cannot have variant price',
        'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE',
        400,
      );
    }

    const variant = await ProductVariantModel.findById(variantId);
    if (!variant) {
      throw new PricingError('Variant not found', 'VARIANT_NOT_FOUND', 404);
    }

    if (!variant.productId.equals(product._id)) {
      throw new PricingError(
        'Variant does not belong to specified product',
        'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
        400,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {
      productId: product._id,
      variantId: variant._id,
    };

    if (serviceAreaId !== undefined) {
      if (serviceAreaId === null) {
        filter.serviceAreaId = null;
        filter.pricingScope = 'VARIANT_GLOBAL';
      } else {
        if (!Types.ObjectId.isValid(serviceAreaId)) {
          throw new PricingError('Invalid serviceAreaId', 'SERVICE_AREA_NOT_FOUND', 404);
        }
        filter.serviceAreaId = new Types.ObjectId(serviceAreaId);
        filter.pricingScope = 'VARIANT_REGIONAL';
      }
    }

    const docs = await ProductPricingModel.find(filter).sort({ createdAt: -1 });
    return docs.map(toPricingDto);
  }

  /**
   * Retrieves a single pricing record by its unique ID for administrative review.
   */
  public async getPricingById(
    pricingId: string,
    authContext?: AuthContext,
  ): Promise<IProductPricing> {
    await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_READ);

    if (!pricingId || !Types.ObjectId.isValid(pricingId)) {
      throw new PricingError('Invalid pricingId', 'PRODUCT_NOT_PRICED', 404);
    }

    const doc = await ProductPricingModel.findById(pricingId);
    if (!doc) {
      throw new PricingError('Pricing record not found', 'PRODUCT_NOT_PRICED', 404);
    }

    return toPricingDto(doc);
  }

  /**
   * Retrieves paginated price audit history for a product or variant.
   */
  public async getPricingHistory(
    query: {
      productId: string;
      variantId?: string | null;
      page?: number;
      limit?: number;
    },
    authContext?: AuthContext,
  ): Promise<{
    items: IPriceHistory[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    await this.assertAuthorizedActor(authContext, PermissionCode.PRICING_READ);

    if (!query.productId || !Types.ObjectId.isValid(query.productId)) {
      throw new PricingError('Invalid productId', 'PRODUCT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(query.productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {
      productId: product._id,
    };

    if (query.variantId !== undefined) {
      if (query.variantId === null) {
        filter.variantId = null;
      } else {
        if (!Types.ObjectId.isValid(query.variantId)) {
          throw new PricingError('Invalid variantId', 'VARIANT_NOT_FOUND', 404);
        }
        filter.variantId = new Types.ObjectId(query.variantId);
      }
    }

    const page = Math.max(1, Math.floor(query.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit || 20)));
    const skip = (page - 1) * limit;

    const total = await PriceHistoryModel.countDocuments(filter);
    const docs = await PriceHistoryModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return {
      items: docs.map(toPriceHistoryDto),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Calculates effective price using the authoritative calculation engine.
   */
  public async calculateEffectivePrice(
    request: IPricingCalculationRequestDto,
    authContext?: AuthContext,
  ): Promise<IPricingCalculationResponseDto> {
    return this.pricingEngine.calculateEffectivePrice(request, authContext);
  }
}

export const pricingService = new PricingService();
