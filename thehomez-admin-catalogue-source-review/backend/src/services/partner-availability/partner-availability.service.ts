import { Types, type ClientSession } from 'mongoose';
import {
  UserType,
  PermissionCode,
  type IPartnerProductDto,
  type ISetPartnerProductAvailabilityDto,
  type ITogglePartnerAvailabilityDto,
  type IBatchPartnerAvailabilityRequestDto,
  type IBatchPartnerAvailabilityResponseDto,
  type IPartnerAvailabilityHistoryDto,
  type IPartnerAvailabilityQueryDto,
  type IPartnerAvailabilityListResponseDto,
  type IPublicProductAvailabilityDto,
  type IUserPrincipal,
  MIN_LEAD_TIME_HOURS,
  MAX_LEAD_TIME_HOURS,
  MAX_PARTNER_CUSTOM_SKU_LENGTH,
  MAX_AVAILABILITY_REASON_LENGTH,
  MIN_BATCH_AVAILABILITY_ITEMS,
  MAX_BATCH_AVAILABILITY_ITEMS,
} from '@thehomez/shared-types';
import { withTransaction } from '../../database/transaction.js';
import {
  PartnerProductModel,
  type IPartnerProductDocument,
} from '../../models/partner-product.model.js';
import {
  PartnerAvailabilityHistoryModel,
  type IPartnerAvailabilityHistoryDocument,
} from '../../models/partner-availability-history.model.js';
import { PartnerModel } from '../../models/partner.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { ProductModel, type IProductDocument } from '../../models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../../models/product-variant.model.js';
import { PartnerAvailabilityError } from './partner-availability.errors.js';

export class PartnerAvailabilityService {
  /**
   * Asserts that the acting principal holds the required dynamic permission code.
   */
  private assertPermission(principal: IUserPrincipal, requiredPerm: PermissionCode): void {
    if (!principal || !principal.permissions) {
      throw new PartnerAvailabilityError('Authentication required', 'UNAUTHENTICATED', 401);
    }
    if (!principal.permissions.includes(requiredPerm)) {
      throw new PartnerAvailabilityError(
        `Principal lacks required permission: ${requiredPerm}`,
        'FORBIDDEN',
        403,
      );
    }
  }

  /**
   * Resolves the target partner tenant ID from the trusted server-side principal context.
   * Partners can ONLY operate on their own tenant ID. Any mismatch throws 403 TENANT_MISMATCH.
   */
  private resolveTargetPartnerId(
    principal: IUserPrincipal,
    explicitPartnerId?: string,
  ): Types.ObjectId {
    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      if (explicitPartnerId && explicitPartnerId !== principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Tenant mismatch: cannot operate on another partner',
          'TENANT_MISMATCH',
          403,
        );
      }
      return new Types.ObjectId(principal.partnerId);
    }

    if (principal.userType === UserType.STAFF) {
      if (!explicitPartnerId) {
        throw new PartnerAvailabilityError(
          'Staff caller must specify target partnerId',
          'VALIDATION_ERROR',
          400,
        );
      }
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      return new Types.ObjectId(explicitPartnerId);
    }

    throw new PartnerAvailabilityError('Access denied for userType', 'FORBIDDEN', 403);
  }

  /**
   * Formats a PartnerProduct document into an IPartnerProductDto matching the approved API contract.
   */
  private formatDto(
    doc: IPartnerProductDocument,
    product?: IProductDocument | null,
    variant?: IProductVariantDocument | null,
    serviceArea?: IServiceAreaDocument | null,
  ): IPartnerProductDto {
    const dto: IPartnerProductDto = {
      id: doc._id.toString(),
      partnerId: doc.partnerId.toString(),
      productId: doc.productId.toString(),
      variantId: doc.variantId ? doc.variantId.toString() : null,
      serviceAreaId: doc.serviceAreaId.toString(),
      isAvailable: doc.isAvailable,
      minLeadTimeHours: doc.minLeadTimeHours,
      version: doc.version,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };

    if (doc.partnerCustomSku !== undefined && doc.partnerCustomSku !== null) {
      dto.partnerCustomSku = doc.partnerCustomSku;
    }

    if (product) {
      dto.product = {
        title: product.title,
        brand: product.brand,
        slug: product.slug,
        sku: product.sku || null,
        hasVariants: product.hasVariants,
        images: product.images || [],
        unitCode: product.unitCode || null,
      };
    }

    if (variant) {
      const attributesObj: Record<string, string> =
        variant.attributes instanceof Map
          ? Object.fromEntries(variant.attributes)
          : variant.attributes || {};

      dto.variant = {
        title: variant.title,
        sku: variant.sku,
        attributes: attributesObj,
        images: variant.images || [],
        unitCode: variant.unitCode || null,
      };
    }

    if (serviceArea) {
      dto.serviceArea = {
        code: serviceArea.code,
        name: serviceArea.name,
        city: serviceArea.city,
        state: serviceArea.state,
      };
    }

    return dto;
  }

  /**
   * Loads a PartnerProduct document with populated relations and formats it.
   */
  private async loadAndFormatDto(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<IPartnerProductDto> {
    let query = PartnerProductModel.findById(id);
    if (session) {
      query = query.session(session);
    }
    const doc = await query;
    if (!doc) {
      throw new PartnerAvailabilityError(
        'Partner product record not found',
        'PARTNER_PRODUCT_NOT_FOUND',
        404,
      );
    }

    let prodQuery = ProductModel.findById(doc.productId);
    let saQuery = ServiceAreaModel.findById(doc.serviceAreaId);
    let varQuery = doc.variantId ? ProductVariantModel.findById(doc.variantId) : null;

    if (session) {
      prodQuery = prodQuery.session(session);
      saQuery = saQuery.session(session);
      if (varQuery) varQuery = varQuery.session(session);
    }

    const [product, variant, serviceArea] = await Promise.all([
      prodQuery,
      varQuery ? varQuery : Promise.resolve(null),
      saQuery,
    ]);

    return this.formatDto(doc, product, variant, serviceArea);
  }

  /**
   * Sets or links partner product availability for a standalone product or child variant.
   * Transactional and atomic. Appends immutable audit history.
   */
  public async setAvailability(
    principal: IUserPrincipal,
    dto: ISetPartnerProductAvailabilityDto,
    explicitPartnerId?: string,
  ): Promise<IPartnerProductDto> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_WRITE);
    const targetPartnerId = this.resolveTargetPartnerId(principal, explicitPartnerId);

    // Validate ObjectIds
    if (!Types.ObjectId.isValid(dto.productId)) {
      throw new PartnerAvailabilityError('Invalid productId format', 'VALIDATION_ERROR', 400);
    }
    if (!Types.ObjectId.isValid(dto.serviceAreaId)) {
      throw new PartnerAvailabilityError('Invalid serviceAreaId format', 'VALIDATION_ERROR', 400);
    }
    if (dto.variantId && !Types.ObjectId.isValid(dto.variantId)) {
      throw new PartnerAvailabilityError('Invalid variantId format', 'VALIDATION_ERROR', 400);
    }

    // Validate bounds
    if (
      dto.minLeadTimeHours !== undefined &&
      (!Number.isInteger(dto.minLeadTimeHours) ||
        dto.minLeadTimeHours < MIN_LEAD_TIME_HOURS ||
        dto.minLeadTimeHours > MAX_LEAD_TIME_HOURS)
    ) {
      throw new PartnerAvailabilityError(
        `minLeadTimeHours must be an integer between ${MIN_LEAD_TIME_HOURS} and ${MAX_LEAD_TIME_HOURS}`,
        'VALIDATION_ERROR',
        400,
      );
    }

    if (
      dto.partnerCustomSku !== undefined &&
      dto.partnerCustomSku.trim().length > MAX_PARTNER_CUSTOM_SKU_LENGTH
    ) {
      throw new PartnerAvailabilityError(
        `partnerCustomSku cannot exceed ${MAX_PARTNER_CUSTOM_SKU_LENGTH} characters`,
        'VALIDATION_ERROR',
        400,
      );
    }

    const targetProductId = new Types.ObjectId(dto.productId);
    const targetSaId = new Types.ObjectId(dto.serviceAreaId);
    const targetVariantId = dto.variantId ? new Types.ObjectId(dto.variantId) : null;
    const targetIsAvailable = dto.isAvailable !== undefined ? dto.isAvailable : true;
    const targetLeadTime = dto.minLeadTimeHours !== undefined ? dto.minLeadTimeHours : 0;
    const targetCustomSku =
      dto.partnerCustomSku !== undefined ? dto.partnerCustomSku.trim() : undefined;
    const actingUserId = new Types.ObjectId(principal.id);

    try {
      return await withTransaction(async (session: ClientSession) => {
        // 1. Partner Verification
        const partner = await PartnerModel.findById(targetPartnerId).session(session);
        if (!partner) {
          throw new PartnerAvailabilityError(
            'The referenced partner tenant does not exist',
            'PARTNER_NOT_FOUND',
            400,
          );
        }
        if (partner.status !== 'ACTIVE') {
          throw new PartnerAvailabilityError(
            `Cannot configure availability for partner with status ${partner.status}`,
            'PARTNER_NOT_ACTIVE',
            400,
          );
        }

        // 2. Service Area Verification
        const isAssigned =
          Array.isArray(partner.serviceAreaIds) &&
          partner.serviceAreaIds.some((saId) => saId.equals(targetSaId));
        if (!isAssigned) {
          throw new PartnerAvailabilityError(
            'Target service area is not assigned to this partner',
            'SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER',
            400,
          );
        }

        const serviceArea = await ServiceAreaModel.findById(targetSaId).session(session);
        if (!serviceArea) {
          throw new PartnerAvailabilityError(
            'Target service area does not exist',
            'SERVICE_AREA_NOT_FOUND',
            400,
          );
        }
        if (!serviceArea.isActive) {
          throw new PartnerAvailabilityError(
            'Target service area is currently inactive',
            'SERVICE_AREA_NOT_ACTIVE',
            400,
          );
        }

        // 3. Product & Variant Verification
        const product = await ProductModel.findById(targetProductId).session(session);
        if (!product) {
          throw new PartnerAvailabilityError(
            'The referenced product does not exist',
            'PRODUCT_NOT_FOUND',
            400,
          );
        }
        if (product.status !== 'ACTIVE' || !product.publishedAt) {
          throw new PartnerAvailabilityError(
            'Partner availability can only be configured for active, published products',
            'CANNOT_LINK_UNPUBLISHED_PRODUCT',
            400,
          );
        }

        let variant: IProductVariantDocument | null = null;
        if (targetVariantId) {
          if (product.hasVariants === false) {
            throw new PartnerAvailabilityError(
              'Standalone products cannot have variant availability',
              'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY',
              400,
            );
          }
          variant = await ProductVariantModel.findById(targetVariantId).session(session);
          if (!variant) {
            throw new PartnerAvailabilityError(
              'The referenced variant does not exist',
              'VARIANT_NOT_FOUND',
              400,
            );
          }
          if (!variant.productId.equals(targetProductId)) {
            throw new PartnerAvailabilityError(
              'The referenced variant belongs to a different parent product',
              'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
              400,
            );
          }
          if (variant.status !== 'ACTIVE' || !variant.publishedAt) {
            throw new PartnerAvailabilityError(
              'Partner availability can only be configured for active, published variants',
              'CANNOT_LINK_UNPUBLISHED_PRODUCT',
              400,
            );
          }
        } else {
          if (product.hasVariants === true) {
            throw new PartnerAvailabilityError(
              'Standalone availability cannot be assigned to multi-variant parent products',
              'PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY',
              400,
            );
          }
        }

        // 4. Upsert Logic with OCC & Audit History
        const filter = {
          partnerId: targetPartnerId,
          productId: targetProductId,
          variantId: targetVariantId,
          serviceAreaId: targetSaId,
        };

        const existing = await PartnerProductModel.findOne(filter).session(session);

        if (existing) {
          const previousState = existing.isAvailable;
          const stateChanged = previousState !== targetIsAvailable;

          existing.isAvailable = targetIsAvailable;
          existing.minLeadTimeHours = targetLeadTime;
          if (targetCustomSku !== undefined) {
            existing.partnerCustomSku = targetCustomSku;
          }
          existing.updatedBy = actingUserId;
          existing.version = existing.version + 1;

          await existing.save({ session });

          if (stateChanged) {
            await PartnerAvailabilityHistoryModel.create(
              [
                {
                  partnerProductId: existing._id,
                  partnerId: targetPartnerId,
                  productId: targetProductId,
                  variantId: targetVariantId,
                  serviceAreaId: targetSaId,
                  previousState,
                  newState: targetIsAvailable,
                  reason: 'Availability state updated via setAvailability',
                  changedBy: actingUserId,
                },
              ],
              { session },
            );
          }

          return this.formatDto(existing, product, variant, serviceArea);
        }

        // Create new record
        const newRecord = new PartnerProductModel({
          partnerId: targetPartnerId,
          productId: targetProductId,
          variantId: targetVariantId,
          serviceAreaId: targetSaId,
          isAvailable: targetIsAvailable,
          partnerCustomSku: targetCustomSku,
          minLeadTimeHours: targetLeadTime,
          version: 0,
          createdBy: actingUserId,
          updatedBy: actingUserId,
        });

        await newRecord.save({ session });

        await PartnerAvailabilityHistoryModel.create(
          [
            {
              partnerProductId: newRecord._id,
              partnerId: targetPartnerId,
              productId: targetProductId,
              variantId: targetVariantId,
              serviceAreaId: targetSaId,
              previousState: null,
              newState: targetIsAvailable,
              reason: 'Initial availability linking',
              changedBy: actingUserId,
            },
          ],
          { session },
        );

        return this.formatDto(newRecord, product, variant, serviceArea);
      });
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        throw new PartnerAvailabilityError(
          'Availability record already exists for this partner, product, variant, and service area',
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
        );
      }
      throw err;
    }
  }

  /**
   * Toggles binary availability with optional optimistic locking and operational reason.
   */
  public async toggleAvailability(
    principal: IUserPrincipal,
    id: string,
    dto: ITogglePartnerAvailabilityDto,
    explicitPartnerId?: string,
  ): Promise<IPartnerProductDto> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_WRITE);

    if (!Types.ObjectId.isValid(id)) {
      throw new PartnerAvailabilityError('Invalid id format', 'VALIDATION_ERROR', 400);
    }
    if (dto.reason !== undefined && dto.reason.trim().length > MAX_AVAILABILITY_REASON_LENGTH) {
      throw new PartnerAvailabilityError(
        `Reason cannot exceed ${MAX_AVAILABILITY_REASON_LENGTH} characters`,
        'VALIDATION_ERROR',
        400,
      );
    }

    const queryFilter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      if (explicitPartnerId && explicitPartnerId !== principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Tenant mismatch: cannot operate on another partner',
          'TENANT_MISMATCH',
          403,
        );
      }
      queryFilter.partnerId = new Types.ObjectId(principal.partnerId);
    } else if (principal.userType === UserType.STAFF && explicitPartnerId) {
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      queryFilter.partnerId = new Types.ObjectId(explicitPartnerId);
    }

    return await withTransaction(async (session: ClientSession) => {
      const existing = await PartnerProductModel.findOne(queryFilter).session(session);
      if (!existing) {
        throw new PartnerAvailabilityError(
          'Partner availability record not found',
          'PARTNER_PRODUCT_NOT_FOUND',
          404,
        );
      }

      // Optimistic concurrency control check
      if (dto.version !== undefined && existing.version !== dto.version) {
        throw new PartnerAvailabilityError(
          `Concurrent modification conflict: expected version ${dto.version}, found ${existing.version}`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
        );
      }

      // Check partner active status
      const partner = await PartnerModel.findById(existing.partnerId).session(session);
      if (!partner || partner.status !== 'ACTIVE') {
        throw new PartnerAvailabilityError(
          'Cannot toggle availability for inactive or suspended partner',
          'PARTNER_NOT_ACTIVE',
          400,
        );
      }

      // Idempotency: repeated setting to the already-current value does not create duplicate history
      if (existing.isAvailable === dto.isAvailable) {
        return this.loadAndFormatDto(existing._id, session);
      }

      const previousState = existing.isAvailable;
      existing.isAvailable = dto.isAvailable;
      existing.updatedBy = new Types.ObjectId(principal.id);
      existing.version = existing.version + 1;
      await existing.save({ session });

      await PartnerAvailabilityHistoryModel.create(
        [
          {
            partnerProductId: existing._id,
            partnerId: existing.partnerId,
            productId: existing.productId,
            variantId: existing.variantId,
            serviceAreaId: existing.serviceAreaId,
            previousState,
            newState: dto.isAvailable,
            reason: dto.reason ? dto.reason.trim() : undefined,
            changedBy: new Types.ObjectId(principal.id),
          },
        ],
        { session },
      );

      return this.loadAndFormatDto(existing._id, session);
    });
  }

  /**
   * Executes atomic bulk availability status updates for 1 to 100 items.
   * All item updates and history records are committed together or rolled back together.
   */
  public async batchUpdateAvailability(
    principal: IUserPrincipal,
    dto: IBatchPartnerAvailabilityRequestDto,
    explicitPartnerId?: string,
  ): Promise<IBatchPartnerAvailabilityResponseDto> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_WRITE);

    if (
      !dto ||
      !Array.isArray(dto.items) ||
      dto.items.length < MIN_BATCH_AVAILABILITY_ITEMS ||
      dto.items.length > MAX_BATCH_AVAILABILITY_ITEMS
    ) {
      throw new PartnerAvailabilityError(
        `Batch items must contain between ${MIN_BATCH_AVAILABILITY_ITEMS} and ${MAX_BATCH_AVAILABILITY_ITEMS} items`,
        'INVALID_BATCH_SIZE',
        400,
      );
    }

    // Check for duplicate items in batch
    const seenIds = new Set<string>();
    for (const item of dto.items) {
      if (!item.id || !Types.ObjectId.isValid(item.id)) {
        throw new PartnerAvailabilityError(
          `Invalid item ID in batch: ${item.id}`,
          'VALIDATION_ERROR',
          400,
        );
      }
      if (seenIds.has(item.id)) {
        throw new PartnerAvailabilityError(
          `Duplicate item ID in batch: ${item.id}`,
          'DUPLICATE_BATCH_ITEMS',
          400,
        );
      }
      seenIds.add(item.id);
    }

    let scopedPartnerId: Types.ObjectId | null = null;
    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      if (explicitPartnerId && explicitPartnerId !== principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Tenant mismatch: cannot operate on another partner',
          'TENANT_MISMATCH',
          403,
        );
      }
      scopedPartnerId = new Types.ObjectId(principal.partnerId);
    } else if (principal.userType === UserType.STAFF && explicitPartnerId) {
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      scopedPartnerId = new Types.ObjectId(explicitPartnerId);
    }

    return await withTransaction(async (session: ClientSession) => {
      // Validate partner active status if scoped
      if (scopedPartnerId) {
        const partner = await PartnerModel.findById(scopedPartnerId).session(session);
        if (!partner || partner.status !== 'ACTIVE') {
          throw new PartnerAvailabilityError(
            'Partner account is not active',
            'PARTNER_NOT_ACTIVE',
            400,
          );
        }
      }

      const updatedIds: string[] = [];

      for (const item of dto.items) {
        const queryFilter: Record<string, unknown> = { _id: new Types.ObjectId(item.id) };
        if (scopedPartnerId) {
          queryFilter.partnerId = scopedPartnerId;
        }

        const record = await PartnerProductModel.findOne(queryFilter).session(session);
        if (!record) {
          throw new PartnerAvailabilityError(
            `Partner availability record with ID "${item.id}" not found or unauthorized`,
            'PARTNER_PRODUCT_NOT_FOUND',
            404,
          );
        }

        if (item.version !== undefined && record.version !== item.version) {
          throw new PartnerAvailabilityError(
            `Concurrent modification conflict on item ${item.id} (expected ${item.version}, found ${record.version})`,
            'CONCURRENT_MODIFICATION_CONFLICT',
            409,
          );
        }

        if (record.isAvailable !== item.isAvailable) {
          const previousState = record.isAvailable;
          record.isAvailable = item.isAvailable;
          record.updatedBy = new Types.ObjectId(principal.id);
          record.version = record.version + 1;
          await record.save({ session });

          await PartnerAvailabilityHistoryModel.create(
            [
              {
                partnerProductId: record._id,
                partnerId: record.partnerId,
                productId: record.productId,
                variantId: record.variantId,
                serviceAreaId: record.serviceAreaId,
                previousState,
                newState: item.isAvailable,
                reason: item.reason ? item.reason.trim() : undefined,
                changedBy: new Types.ObjectId(principal.id),
              },
            ],
            { session },
          );
        }

        updatedIds.push(record._id.toString());
      }

      return {
        updatedCount: updatedIds.length,
        updatedIds,
      };
    });
  }

  /**
   * Retrieves a single partner availability record by ID.
   * Strict tenant isolation prevents cross-tenant probing.
   */
  public async getAvailabilityById(
    principal: IUserPrincipal,
    id: string,
    explicitPartnerId?: string,
  ): Promise<IPartnerProductDto> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_READ);

    if (!Types.ObjectId.isValid(id)) {
      throw new PartnerAvailabilityError('Invalid id format', 'VALIDATION_ERROR', 400);
    }

    const queryFilter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      queryFilter.partnerId = new Types.ObjectId(principal.partnerId);
    } else if (principal.userType === UserType.STAFF && explicitPartnerId) {
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      queryFilter.partnerId = new Types.ObjectId(explicitPartnerId);
    }

    const record = await PartnerProductModel.findOne(queryFilter);
    if (!record) {
      throw new PartnerAvailabilityError(
        'Partner availability record not found',
        'PARTNER_PRODUCT_NOT_FOUND',
        404,
      );
    }

    return this.loadAndFormatDto(record._id);
  }

  /**
   * Retrieves chronological state transition history for an availability record.
   */
  public async getAvailabilityHistory(
    principal: IUserPrincipal,
    id: string,
    explicitPartnerId?: string,
  ): Promise<IPartnerAvailabilityHistoryDto[]> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_READ);

    if (!Types.ObjectId.isValid(id)) {
      throw new PartnerAvailabilityError('Invalid id format', 'VALIDATION_ERROR', 400);
    }

    const queryFilter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      queryFilter.partnerId = new Types.ObjectId(principal.partnerId);
    } else if (principal.userType === UserType.STAFF && explicitPartnerId) {
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      queryFilter.partnerId = new Types.ObjectId(explicitPartnerId);
    }

    const record = await PartnerProductModel.findOne(queryFilter);
    if (!record) {
      throw new PartnerAvailabilityError(
        'Partner availability record not found',
        'PARTNER_PRODUCT_NOT_FOUND',
        404,
      );
    }

    const historyDocs = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: record._id,
    }).sort({ createdAt: -1 });

    return historyDocs.map((h: IPartnerAvailabilityHistoryDocument) => ({
      id: h._id.toString(),
      partnerProductId: h.partnerProductId.toString(),
      partnerId: h.partnerId.toString(),
      productId: h.productId.toString(),
      variantId: h.variantId ? h.variantId.toString() : null,
      serviceAreaId: h.serviceAreaId.toString(),
      previousState: h.previousState,
      newState: h.newState,
      reason: h.reason,
      changedBy: h.changedBy.toString(),
      createdAt: h.createdAt.toISOString(),
    }));
  }

  /**
   * Retrieves a paginated list of partner availability records with approved filters.
   */
  public async listAvailability(
    principal: IUserPrincipal,
    query: IPartnerAvailabilityQueryDto,
    explicitPartnerId?: string,
  ): Promise<IPartnerAvailabilityListResponseDto> {
    this.assertPermission(principal, PermissionCode.PARTNER_AVAILABILITY_READ);

    const filter: Record<string, unknown> = {};

    if (principal.userType === UserType.PARTNER) {
      if (!principal.partnerId) {
        throw new PartnerAvailabilityError(
          'Partner account has no associated partner tenant',
          'FORBIDDEN',
          403,
        );
      }
      filter.partnerId = new Types.ObjectId(principal.partnerId);
    } else if (principal.userType === UserType.STAFF && explicitPartnerId) {
      if (!Types.ObjectId.isValid(explicitPartnerId)) {
        throw new PartnerAvailabilityError('Invalid partnerId format', 'VALIDATION_ERROR', 400);
      }
      filter.partnerId = new Types.ObjectId(explicitPartnerId);
    }

    if (query.serviceAreaId) {
      if (!Types.ObjectId.isValid(query.serviceAreaId)) {
        throw new PartnerAvailabilityError('Invalid serviceAreaId format', 'VALIDATION_ERROR', 400);
      }
      filter.serviceAreaId = new Types.ObjectId(query.serviceAreaId);
    }

    if (query.isAvailable !== undefined) {
      filter.isAvailable = query.isAvailable;
    }

    if (query.categoryId) {
      if (!Types.ObjectId.isValid(query.categoryId)) {
        throw new PartnerAvailabilityError('Invalid categoryId format', 'VALIDATION_ERROR', 400);
      }
      const productsInCategory = await ProductModel.find({
        categoryId: new Types.ObjectId(query.categoryId),
      }).select('_id');
      const catProductIds = productsInCategory.map((p) => p._id);
      filter.productId = { $in: catProductIds };
    }

    if (query.search && query.search.trim().length > 0) {
      const sanitized = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(sanitized, 'i');
      const matchedProducts = await ProductModel.find({
        $or: [{ title: searchRegex }, { brand: searchRegex }, { sku: searchRegex }],
      }).select('_id');
      const searchProductIds = matchedProducts.map((p) => p._id);

      if (filter.productId && typeof filter.productId === 'object' && '$in' in filter.productId) {
        const existingIn = (filter.productId as { $in: Types.ObjectId[] }).$in;
        const intersection = existingIn.filter((id) =>
          searchProductIds.some((sId) => sId.equals(id)),
        );
        filter.productId = { $in: intersection };
      } else {
        filter.productId = { $in: searchProductIds };
      }
    }

    if (query.productId) {
      if (!Types.ObjectId.isValid(query.productId)) {
        throw new PartnerAvailabilityError('Invalid productId format', 'VALIDATION_ERROR', 400);
      }
      const requestedProductId = new Types.ObjectId(query.productId);
      if (filter.productId && typeof filter.productId === 'object' && '$in' in filter.productId) {
        const existingIn = (filter.productId as { $in: Types.ObjectId[] }).$in;
        const exists = existingIn.some((id) => id.equals(requestedProductId));
        filter.productId = exists ? requestedProductId : { $in: [] };
      } else {
        filter.productId = requestedProductId;
      }
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, records] = await Promise.all([
      PartnerProductModel.countDocuments(filter),
      PartnerProductModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    if (records.length === 0) {
      return {
        items: [],
        total,
        page,
        limit,
        totalPages,
      };
    }

    // Parallel indexed lookup of related entities
    const productIds = Array.from(new Set(records.map((r) => r.productId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );
    const variantIds = Array.from(
      new Set(records.filter((r) => r.variantId).map((r) => r.variantId!.toString())),
    ).map((id) => new Types.ObjectId(id));
    const serviceAreaIds = Array.from(new Set(records.map((r) => r.serviceAreaId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );

    const [products, variants, serviceAreas] = await Promise.all([
      ProductModel.find({ _id: { $in: productIds } }),
      variantIds.length > 0
        ? ProductVariantModel.find({ _id: { $in: variantIds } })
        : Promise.resolve([]),
      ServiceAreaModel.find({ _id: { $in: serviceAreaIds } }),
    ]);

    const productMap = new Map(products.map((p) => [p._id.toString(), p]));
    const variantMap = new Map(variants.map((v) => [v._id.toString(), v]));
    const serviceAreaMap = new Map(serviceAreas.map((sa) => [sa._id.toString(), sa]));

    const items = records.map((r) =>
      this.formatDto(
        r,
        productMap.get(r.productId.toString()),
        r.variantId ? variantMap.get(r.variantId.toString()) : null,
        serviceAreaMap.get(r.serviceAreaId.toString()),
      ),
    );

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Public storefront availability resolution (Step 7 contract / Decision #48).
   * Strictly enforces public privacy: zero partner IDs, zero vendor names, zero margins exposed.
   */
  public async resolveStorefrontAvailability(
    productId: string,
    variantId?: string | null,
    pincode?: string,
  ): Promise<IPublicProductAvailabilityDto> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new PartnerAvailabilityError('Invalid productId format', 'VALIDATION_ERROR', 400);
    }
    if (variantId && !Types.ObjectId.isValid(variantId)) {
      throw new PartnerAvailabilityError('Invalid variantId format', 'VALIDATION_ERROR', 400);
    }

    // 1. Unlocalized Browsing (No delivery PIN supplied)
    if (!pincode || pincode.trim().length === 0) {
      return {
        productId,
        variantId: variantId || null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };
    }

    // 2. Localized Browsing (Delivery PIN supplied)
    const cleanPin = pincode.trim();
    const serviceArea = await ServiceAreaModel.findOne({ pincodes: cleanPin, isActive: true });

    if (!serviceArea) {
      return {
        productId,
        variantId: variantId || null,
        serviceAreaId: null,
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };
    }

    // Find all ACTIVE partners assigned to this service area
    const activePartners = await PartnerModel.find({
      status: 'ACTIVE',
      serviceAreaIds: serviceArea._id,
    }).select('_id');

    const activePartnerIds = activePartners.map((p) => p._id);
    if (activePartnerIds.length === 0) {
      return {
        productId,
        variantId: variantId || null,
        serviceAreaId: serviceArea._id.toString(),
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
    }

    // Query active availability for this sellable item
    const targetVariantId = variantId ? new Types.ObjectId(variantId) : null;
    const availableDocs = await PartnerProductModel.find({
      partnerId: { $in: activePartnerIds },
      productId: new Types.ObjectId(productId),
      variantId: targetVariantId,
      serviceAreaId: serviceArea._id,
      isAvailable: true,
    }).select('partnerId minLeadTimeHours');

    if (availableDocs.length > 0) {
      const minLead = Math.min(...availableDocs.map((d) => d.minLeadTimeHours ?? 0));
      const distinctPartnerIds = new Set(availableDocs.map((d) => d.partnerId.toString()));

      return {
        productId,
        variantId: variantId || null,
        serviceAreaId: serviceArea._id.toString(),
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: minLead,
        availablePartnerCount: distinctPartnerIds.size,
      };
    }

    return {
      productId,
      variantId: variantId || null,
      serviceAreaId: serviceArea._id.toString(),
      isAvailable: false,
      availabilityUnknown: false,
      minLeadTimeHours: null,
      availablePartnerCount: 0,
    };
  }

  /**
   * Helper method for cascading deactivation to all active partner availability records
   * when a master product is archived or deactivated.
   */
  public async deactivateAvailabilityForProduct(
    productId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    if (!Types.ObjectId.isValid(productId) || !Types.ObjectId.isValid(userId)) {
      throw new PartnerAvailabilityError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    const filter = {
      productId: new Types.ObjectId(productId),
      isAvailable: true,
    };

    let query = PartnerProductModel.find(filter);
    if (session) {
      query = query.session(session);
    }
    const activeRecords = await query;

    if (activeRecords.length === 0) {
      return { modifiedCount: 0 };
    }

    for (const record of activeRecords) {
      record.isAvailable = false;
      record.updatedBy = new Types.ObjectId(userId);
      record.version = record.version + 1;
      await record.save({ session });

      await PartnerAvailabilityHistoryModel.create(
        [
          {
            partnerProductId: record._id,
            partnerId: record.partnerId,
            productId: record.productId,
            variantId: record.variantId,
            serviceAreaId: record.serviceAreaId,
            previousState: true,
            newState: false,
            reason: 'Product archived: cascade availability deactivation',
            changedBy: new Types.ObjectId(userId),
          },
        ],
        { session },
      );
    }

    return { modifiedCount: activeRecords.length };
  }

  /**
   * Helper method for cascading deactivation to all active partner availability records
   * when a specific variant is archived or deactivated.
   */
  public async deactivateAvailabilityForVariant(
    variantId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    if (!Types.ObjectId.isValid(variantId) || !Types.ObjectId.isValid(userId)) {
      throw new PartnerAvailabilityError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    const filter = {
      variantId: new Types.ObjectId(variantId),
      isAvailable: true,
    };

    let query = PartnerProductModel.find(filter);
    if (session) {
      query = query.session(session);
    }
    const activeRecords = await query;

    if (activeRecords.length === 0) {
      return { modifiedCount: 0 };
    }

    for (const record of activeRecords) {
      record.isAvailable = false;
      record.updatedBy = new Types.ObjectId(userId);
      record.version = record.version + 1;
      await record.save({ session });

      await PartnerAvailabilityHistoryModel.create(
        [
          {
            partnerProductId: record._id,
            partnerId: record.partnerId,
            productId: record.productId,
            variantId: record.variantId,
            serviceAreaId: record.serviceAreaId,
            previousState: true,
            newState: false,
            reason: 'Variant archived: cascade availability deactivation',
            changedBy: new Types.ObjectId(userId),
          },
        ],
        { session },
      );
    }

    return { modifiedCount: activeRecords.length };
  }
}
