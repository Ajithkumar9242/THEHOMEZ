import { Types } from 'mongoose';
import {
  type IProduct,
  type ICreateProductDto,
  type IUpdateProductDto,
  type IAdminProductQueryDto,
  type IPublicProductQueryDto,
  type ProductStatus,
  PRODUCT_SLUG_REGEX,
  PermissionCode,
  ExactDecimalQuantity,
} from '@thehomez/shared-types';
import { ProductModel, type IProductDocument } from '../../models/product.model.js';
import { ProductVariantModel } from '../../models/product-variant.model.js';
import { ProductPricingModel } from '../../models/product-pricing.model.js';
import { PriceHistoryModel } from '../../models/price-history.model.js';
import { SkuRegistryModel } from '../../models/sku-registry.model.js';
import { CategoryModel } from '../../models/category.model.js';
import { UnitModel } from '../../models/unit.model.js';
import { skuGeneratorService } from './sku-generator.service.js';
import { UnitValidator, UnitValidationError } from './unit-validator.js';
import { ProductVariantService } from './product-variant.service.js';
import { PartnerAvailabilityService } from '../partner-availability/index.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';

export class ProductError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

export class ProductService {
  constructor(
    private readonly partnerAvailabilityService: PartnerAvailabilityService = new PartnerAvailabilityService(),
  ) {}
  /**
   * Transforms a Mongoose Product document into a standard IProduct DTO.
   */
  public static toProductDto(doc: IProductDocument): IProduct {
    const specMap: Record<string, string> = {};
    if (doc.specifications) {
      if (doc.specifications instanceof Map) {
        for (const [k, v] of doc.specifications.entries()) {
          specMap[k] = v;
        }
      } else if (typeof doc.specifications === 'object') {
        Object.assign(specMap, doc.specifications);
      }
    }

    return {
      id: doc._id.toString(),
      slug: doc.slug,
      title: doc.title,
      brand: doc.brand,
      description: doc.description,
      categoryId: doc.categoryId.toString(),
      subcategoryId: doc.subcategoryId.toString(),
      hasVariants: doc.hasVariants,
      sku: doc.sku,
      status: doc.status,
      images: doc.images || [],
      specifications: specMap,
      unitCode: doc.unitCode ?? null,
      quantityPrecision: doc.quantityPrecision ?? null,
      minOrderQuantity: doc.minOrderQuantity ?? null,
      maxOrderQuantity: doc.maxOrderQuantity ?? null,
      stepIncrement: doc.stepIncrement ?? null,
      publishedBy: doc.publishedBy ? doc.publishedBy.toString() : null,
      publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
      createdBy: doc.createdBy.toString(),
      updatedBy: doc.updatedBy.toString(),
      version: doc.version,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Normalizes and validates specification map entries.
   * Rejects duplicate keys with differing casing (e.g. "Grade" and "grade").
   */
  public static normalizeSpecifications(specs?: Record<string, string>): Record<string, string> {
    if (!specs || typeof specs !== 'object') return {};

    const normalized: Record<string, string> = {};
    const lowerKeySet = new Set<string>();

    for (const [key, value] of Object.entries(specs)) {
      const trimmedKey = key.trim();
      const lower = trimmedKey.toLowerCase();

      if (lowerKeySet.has(lower)) {
        throw new ProductError(
          `Duplicate specification key detected with different casing: "${trimmedKey}"`,
          'DUPLICATE_SPECIFICATION_KEY',
          400,
        );
      }
      lowerKeySet.add(lower);

      if (typeof value !== 'string') {
        throw new ProductError(
          `Specification value for key "${trimmedKey}" must be a string`,
          'VALIDATION_ERROR',
          400,
        );
      }
      normalized[trimmedKey] = value.trim();
    }

    return normalized;
  }

  /**
   * Normalizes or generates a product slug from its title.
   */
  public static normalizeSlug(title: string, customSlug?: string): string {
    if (customSlug) {
      const trimmed = customSlug.trim().toLowerCase();
      if (!PRODUCT_SLUG_REGEX.test(trimmed)) {
        throw new ProductError(
          'Slug must consist of lowercase alphanumeric words separated by single hyphens',
          'VALIDATION_ERROR',
          400,
        );
      }
      return trimmed;
    }
    const slugified = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slugified || `product-${Date.now().toString(36)}`;
  }

  /**
   * Creates a new product (single-item or variant container).
   * Supports immediate publication if caller holds catalog:publish.
   */
  public async createProduct(
    dto: ICreateProductDto,
    userId: string,
    userPermissions: string[] = [],
  ): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new ProductError('Invalid user ID', 'UNAUTHORIZED', 401);
    }
    if (!Types.ObjectId.isValid(dto.categoryId) || !Types.ObjectId.isValid(dto.subcategoryId)) {
      throw new ProductError('Invalid category ID format', 'VALIDATION_ERROR', 400);
    }

    const hasPublishPermission = userPermissions.includes(PermissionCode.CATALOG_PUBLISH);
    const requestedPublish = dto.publish === true || dto.status === 'ACTIVE';

    if (requestedPublish && !hasPublishPermission) {
      throw new ProductError(
        'Principal lacks permission to publish products directly',
        'CANNOT_PUBLISH_WITHOUT_PERMISSION',
        403,
      );
    }

    const hasVariants = dto.hasVariants === true;
    if (requestedPublish && hasVariants) {
      throw new ProductError(
        'Cannot directly publish multi-variant product container without active child variants',
        'CANNOT_PUBLISH_PRODUCT',
        400,
      );
    }

    const specifications = ProductService.normalizeSpecifications(dto.specifications);
    const slug = ProductService.normalizeSlug(dto.title, dto.slug);

    // Verify slug uniqueness
    const existingSlug = await ProductModel.findOne({ slug }).collation({
      locale: 'en',
      strength: 2,
    });
    if (existingSlug) {
      throw new ProductError(
        `Product with slug "${slug}" already exists`,
        'PRODUCT_SLUG_EXISTS',
        409,
      );
    }

    return await withTransaction(async (session) => {
      // 1. Verify category hierarchy
      const rootCat = await CategoryModel.findById(dto.categoryId).session(session);
      const subCat = await CategoryModel.findById(dto.subcategoryId).session(session);

      if (!rootCat || !subCat) {
        throw new ProductError(
          'Category or subcategory not found',
          'INVALID_CATEGORY_RELATION',
          400,
        );
      }

      if (
        rootCat.level !== 0 ||
        subCat.level !== 1 ||
        !subCat.parentId ||
        !subCat.parentId.equals(rootCat._id)
      ) {
        throw new ProductError(
          'Subcategory does not belong to specified root category',
          'INVALID_CATEGORY_RELATION',
          400,
        );
      }

      // If publishing, both categories must be active
      if (requestedPublish) {
        if (!rootCat.isActive || !subCat.isActive) {
          throw new ProductError(
            'Cannot publish product: category or subcategory is inactive',
            'CATEGORY_INACTIVE',
            400,
          );
        }
        if (!dto.images || dto.images.length === 0) {
          throw new ProductError(
            'Cannot publish product: at least one image is required',
            'CANNOT_PUBLISH_PRODUCT',
            400,
          );
        }

        // Acquire category coordination locks
        await CategoryModel.updateOne({ _id: rootCat._id }, { $inc: { version: 1 } }, { session });
        await CategoryModel.updateOne({ _id: subCat._id }, { $inc: { version: 1 } }, { session });
      }

      // 2. Unit Configuration Validation
      if (requestedPublish && !hasVariants) {
        if (
          !dto.unitCode ||
          dto.quantityPrecision === undefined ||
          dto.quantityPrecision === null ||
          !dto.minOrderQuantity ||
          !dto.stepIncrement
        ) {
          throw new ProductError(
            'Cannot publish product: complete unit configuration (unitCode, quantityPrecision, minOrderQuantity, stepIncrement) is required',
            'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
            400,
          );
        }
      }

      if (dto.unitCode) {
        try {
          await UnitValidator.validateConfiguration(
            {
              unitCode: dto.unitCode,
              quantityPrecision: dto.quantityPrecision,
              minOrderQuantity: dto.minOrderQuantity,
              maxOrderQuantity: dto.maxOrderQuantity,
              stepIncrement: dto.stepIncrement,
            },
            session,
          );
        } catch (err: unknown) {
          if (err instanceof UnitValidationError) {
            throw new ProductError(err.message, err.code, err.statusCode);
          }
          throw err;
        }
      }

      const initialStatus: ProductStatus = requestedPublish ? 'ACTIVE' : dto.status || 'DRAFT';
      const productId = new Types.ObjectId();
      const userObjectId = new Types.ObjectId(userId);

      const product = new ProductModel({
        _id: productId,
        slug,
        title: dto.title.trim(),
        brand: dto.brand.trim(),
        description: dto.description?.trim(),
        categoryId: rootCat._id,
        subcategoryId: subCat._id,
        hasVariants,
        sku: null, // Will set below if single item
        status: initialStatus,
        images: dto.images || [],
        specifications,
        unitCode: dto.unitCode ? dto.unitCode.trim().toUpperCase() : null,
        quantityPrecision: dto.quantityPrecision ?? null,
        minOrderQuantity: dto.minOrderQuantity ? dto.minOrderQuantity.trim() : null,
        maxOrderQuantity: dto.maxOrderQuantity ? dto.maxOrderQuantity.trim() : null,
        stepIncrement: dto.stepIncrement ? dto.stepIncrement.trim() : null,
        publishedBy: requestedPublish ? userObjectId : null,
        publishedAt: requestedPublish ? new Date() : null,
        createdBy: userObjectId,
        updatedBy: userObjectId,
        version: 0,
      });

      // 2. SKU Handling
      if (!hasVariants) {
        const reservedRegistry = await skuGeneratorService.reserveSku({
          sku: dto.sku,
          entityType: 'PRODUCT',
          entityId: product._id,
          productId: product._id,
          status: requestedPublish ? 'ASSIGNED' : 'RESERVED',
          session,
        });
        product.sku = reservedRegistry.sku;
      }

      await product.save({ session });
      logger.info(
        { productId: product._id.toString(), sku: product.sku, status: product.status },
        'Product created successfully',
      );
      return product;
    });
  }

  /**
   * Retrieves single product details by internal ID (Admin).
   */
  public async getProductById(id: string): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new ProductError('Invalid product ID format', 'VALIDATION_ERROR', 400);
    }
    const product = await ProductModel.findById(id);
    if (!product) {
      throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }
    return product;
  }

  /**
   * Retrieves single product details by slug (Admin).
   */
  public async getProductBySlug(slug: string): Promise<IProductDocument> {
    const normalized = slug.trim().toLowerCase();
    const product = await ProductModel.findOne({ slug: normalized }).collation({
      locale: 'en',
      strength: 2,
    });
    if (!product) {
      throw new ProductError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }
    return product;
  }

  /**
   * Lists products with administrative filtering and pagination.
   */
  public async listProducts(query: IAdminProductQueryDto): Promise<{
    items: IProduct[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter.status = query.status;
    }
    if (query.categoryId && Types.ObjectId.isValid(query.categoryId)) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    if (query.subcategoryId && Types.ObjectId.isValid(query.subcategoryId)) {
      filter.subcategoryId = new Types.ObjectId(query.subcategoryId);
    }
    if (query.brand) {
      filter.brand = query.brand.trim();
    }
    if (query.search) {
      filter.$text = { $search: query.search.trim() };
    }

    const [docs, total] = await Promise.all([
      ProductModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ProductModel.countDocuments(filter),
    ]);

    return {
      items: docs.map(ProductService.toProductDto),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Lists active products for public discovery.
   * Strictly filters out unpublished, inactive, or archived items and products under inactive categories.
   */
  public async listPublicProducts(query: IPublicProductQueryDto): Promise<{
    items: IProduct[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    // Fetch active categories
    const activeCategories = await CategoryModel.find({ isActive: true }).select(
      '_id slug level parentId',
    );
    const activeCategoryIds = activeCategories.map((c) => c._id);

    // Decision 40: Expose only products with active global pricing > 0
    const standalonePricedIds = await ProductPricingModel.distinct('productId', {
      variantId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      isActive: true,
      b2cPricePaise: { $gt: 0 },
    });

    const activePricedVariantDocs = await ProductPricingModel.find({
      variantId: { $ne: null },
      pricingScope: 'VARIANT_GLOBAL',
      isActive: true,
      b2cPricePaise: { $gt: 0 },
    }).select('variantId productId');

    const pricedVariantIds = activePricedVariantDocs.map((d) => d.variantId);
    const activeVariants = await ProductVariantModel.find({
      _id: { $in: pricedVariantIds },
      status: 'ACTIVE',
    }).select('productId');

    const multiVariantParentIds = activeVariants.map((v) => v.productId);
    const eligibleProductIds = Array.from(
      new Set([...standalonePricedIds.map(String), ...multiVariantParentIds.map(String)]),
    ).map((id) => new Types.ObjectId(id));

    const filter: Record<string, unknown> = {
      _id: { $in: eligibleProductIds },
      status: 'ACTIVE',
      categoryId: { $in: activeCategoryIds },
      subcategoryId: { $in: activeCategoryIds },
    };

    if (query.category) {
      const catSlug = query.category.toLowerCase();
      const cat = activeCategories.find((c) => c.slug === catSlug && c.level === 0);
      if (cat) filter.categoryId = cat._id;
      else return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    if (query.subcategory) {
      const subSlug = query.subcategory.toLowerCase();
      const sub = activeCategories.find((c) => c.slug === subSlug && c.level === 1);
      if (sub) filter.subcategoryId = sub._id;
      else return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    if (query.brand) {
      filter.brand = query.brand.trim();
    }

    if (query.search) {
      filter.$text = { $search: query.search.trim() };
    }

    const [docs, total] = await Promise.all([
      ProductModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ProductModel.countDocuments(filter),
    ]);

    return {
      items: docs.map(ProductService.toProductDto),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves single public product detail with active variants.
   */
  public async getPublicProductBySlug(slug: string): Promise<{
    product: IProduct;
    variants: unknown[];
  }> {
    const normalized = slug.trim().toLowerCase();
    const product = await ProductModel.findOne({ slug: normalized, status: 'ACTIVE' }).collation({
      locale: 'en',
      strength: 2,
    });

    if (!product) {
      throw new ProductError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }

    // Verify parent categories are active
    const rootCat = await CategoryModel.findById(product.categoryId);
    const subCat = await CategoryModel.findById(product.subcategoryId);

    if (!rootCat || !rootCat.isActive || !subCat || !subCat.isActive) {
      throw new ProductError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }

    let variants: unknown[] = [];
    if (product.hasVariants) {
      const activeVariants = await ProductVariantModel.find({
        productId: product._id,
        status: 'ACTIVE',
      });

      const variantIds = activeVariants.map((v) => v._id);
      const activeVariantPricings = await ProductPricingModel.find({
        productId: product._id,
        variantId: { $in: variantIds },
        pricingScope: 'VARIANT_GLOBAL',
        isActive: true,
        b2cPricePaise: { $gt: 0 },
      });
      const pricedVariantIds = new Set(activeVariantPricings.map((p) => p.variantId?.toString()));

      const validVariants = activeVariants.filter((v) => pricedVariantIds.has(v._id.toString()));

      // Decision 40: Multi-variant parent exposed only when at least one child variant is ACTIVE and has valid active global pricing
      if (validVariants.length === 0) {
        throw new ProductError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }

      variants = validVariants.map(ProductVariantService.toVariantDto);
    } else {
      // Standalone product must have an active global pricing record with price > 0
      const activePricing = await ProductPricingModel.findOne({
        productId: product._id,
        variantId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        isActive: true,
        b2cPricePaise: { $gt: 0 },
      });

      if (!activePricing) {
        throw new ProductError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }
    }

    return {
      product: ProductService.toProductDto(product),
      variants,
    };
  }

  /**
   * Updates an existing product.
   * Supports in-place atomic SKU replacement if entity is unpublished DRAFT.
   */
  public async updateProduct(
    id: string,
    dto: IUpdateProductDto,
    userId: string,
  ): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw new ProductError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      const product = await ProductModel.findById(id).session(session);
      if (!product) {
        throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }

      if (product.status === 'ARCHIVED') {
        throw new ProductError(
          'Cannot modify archived product',
          'INVALID_PRODUCT_STATE_TRANSITION',
          400,
        );
      }

      // 1. Slug change check
      if (dto.slug) {
        const newSlug = dto.slug.trim().toLowerCase();
        if (newSlug !== product.slug) {
          const collision = await ProductModel.findOne({
            slug: newSlug,
            _id: { $ne: product._id },
          })
            .collation({ locale: 'en', strength: 2 })
            .session(session);

          if (collision) {
            throw new ProductError(
              `Product with slug "${newSlug}" already exists`,
              'PRODUCT_SLUG_EXISTS',
              409,
            );
          }
          product.slug = newSlug;
        }
      }

      // 2. Category updates
      if (dto.categoryId || dto.subcategoryId) {
        const newCatId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : product.categoryId;
        const newSubId = dto.subcategoryId
          ? new Types.ObjectId(dto.subcategoryId)
          : product.subcategoryId;

        const rootCat = await CategoryModel.findById(newCatId).session(session);
        const subCat = await CategoryModel.findById(newSubId).session(session);

        if (
          !rootCat ||
          !subCat ||
          rootCat.level !== 0 ||
          subCat.level !== 1 ||
          !subCat.parentId ||
          !subCat.parentId.equals(rootCat._id)
        ) {
          throw new ProductError(
            'Subcategory does not belong to specified root category',
            'INVALID_CATEGORY_RELATION',
            400,
          );
        }

        if (product.status === 'ACTIVE' && (!rootCat.isActive || !subCat.isActive)) {
          throw new ProductError(
            'Cannot assign inactive category to active product',
            'CATEGORY_INACTIVE',
            400,
          );
        }

        product.categoryId = rootCat._id;
        product.subcategoryId = subCat._id;
      }

      // 3. SKU Update (in-place replacement for draft only)
      if (dto.sku !== undefined) {
        if (product.hasVariants) {
          throw new ProductError(
            'Cannot assign SKU to variant parent container',
            'CANNOT_ADD_SKU_TO_VARIANT_PARENT',
            400,
          );
        }
        if (product.status !== 'DRAFT' || product.publishedAt !== null) {
          throw new ProductError(
            'Cannot modify SKU of a product that is active, inactive after publication, or archived',
            'IMMUTABLE_SKU_MODIFICATION',
            400,
          );
        }
        const replaced = await skuGeneratorService.replaceDraftSku({
          entityId: product._id,
          entityType: 'PRODUCT',
          productId: product._id,
          newSku: dto.sku,
          session,
        });
        product.sku = replaced.sku;
      }

      // 4. Update basic fields
      if (dto.title !== undefined) product.title = dto.title.trim();
      if (dto.brand !== undefined) product.brand = dto.brand.trim();
      if (dto.description !== undefined) product.description = dto.description.trim() || undefined;
      if (dto.images !== undefined) product.images = dto.images;
      if (dto.specifications !== undefined) {
        product.specifications = ProductService.normalizeSpecifications(dto.specifications);
      }

      // 5. Unit configuration updates & immutability checks
      if (dto.unitCode !== undefined || dto.quantityPrecision !== undefined) {
        if (product.publishedAt !== null) {
          const normalizedUnitCode = dto.unitCode ? dto.unitCode.trim().toUpperCase() : null;
          const currentUnitCode = product.unitCode ? product.unitCode.trim().toUpperCase() : null;
          const unitCodeChanged =
            dto.unitCode !== undefined && normalizedUnitCode !== currentUnitCode;
          const precisionChanged =
            dto.quantityPrecision !== undefined &&
            dto.quantityPrecision !== product.quantityPrecision;
          if (unitCodeChanged || precisionChanged) {
            throw new ProductError(
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
          : product.unitCode;
      const effectivePrecision =
        dto.quantityPrecision !== undefined ? dto.quantityPrecision : product.quantityPrecision;
      const effectiveMoq =
        dto.minOrderQuantity !== undefined ? dto.minOrderQuantity : product.minOrderQuantity;
      const effectiveMaxOq =
        dto.maxOrderQuantity !== undefined ? dto.maxOrderQuantity : product.maxOrderQuantity;
      const effectiveStep =
        dto.stepIncrement !== undefined ? dto.stepIncrement : product.stepIncrement;

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
            throw new ProductError(err.message, err.code, err.statusCode);
          }
          throw err;
        }
      }

      // Decision 44: Unit mutation and B2B volume tier validity invariant enforcement
      if (
        !product.hasVariants &&
        (dto.unitCode !== undefined ||
          dto.quantityPrecision !== undefined ||
          dto.minOrderQuantity !== undefined ||
          dto.maxOrderQuantity !== undefined ||
          dto.stepIncrement !== undefined)
      ) {
        if (
          effectiveUnitCode &&
          effectivePrecision !== null &&
          effectivePrecision !== undefined &&
          effectiveMoq &&
          effectiveStep
        ) {
          const activePricings = await ProductPricingModel.find({
            productId: product._id,
            variantId: null,
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
                  throw new ProductError(
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

      if (dto.unitCode !== undefined) product.unitCode = dto.unitCode.trim().toUpperCase();
      if (dto.quantityPrecision !== undefined) product.quantityPrecision = dto.quantityPrecision;
      if (dto.minOrderQuantity !== undefined)
        product.minOrderQuantity = dto.minOrderQuantity ? dto.minOrderQuantity.trim() : null;
      if (dto.maxOrderQuantity !== undefined)
        product.maxOrderQuantity = dto.maxOrderQuantity ? dto.maxOrderQuantity.trim() : null;
      if (dto.stepIncrement !== undefined)
        product.stepIncrement = dto.stepIncrement ? dto.stepIncrement.trim() : null;

      product.updatedBy = new Types.ObjectId(userId);
      await product.save({ session });
      return product;
    });
  }

  /**
   * Publishes a product (transitions to ACTIVE). Requires CATALOG_PUBLISH.
   */
  public async publishProduct(id: string, userId: string): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw new ProductError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      const product = await ProductModel.findById(id).session(session);
      if (!product) {
        throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }

      if (product.status === 'ARCHIVED') {
        throw new ProductError(
          'Cannot publish archived product',
          'INVALID_PRODUCT_STATE_TRANSITION',
          400,
        );
      }

      // Verify categories are active and acquire coordination lock
      const rootCat = await CategoryModel.findOneAndUpdate(
        { _id: product.categoryId, isActive: true },
        { $inc: { version: 1 } },
        { session, new: true },
      );
      const subCat = await CategoryModel.findOneAndUpdate(
        { _id: product.subcategoryId, isActive: true },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!rootCat || !subCat) {
        throw new ProductError(
          'Cannot publish product: category or subcategory is inactive',
          'CATEGORY_INACTIVE',
          400,
        );
      }

      if (!product.images || product.images.length === 0) {
        throw new ProductError(
          'Cannot publish product: at least one image is required',
          'CANNOT_PUBLISH_PRODUCT',
          400,
        );
      }

      // Unit configuration validation gate
      if (!product.hasVariants) {
        if (
          !product.unitCode ||
          product.quantityPrecision === undefined ||
          product.quantityPrecision === null ||
          !product.minOrderQuantity ||
          !product.stepIncrement
        ) {
          throw new ProductError(
            'Cannot publish product: complete unit configuration (unitCode, quantityPrecision, minOrderQuantity, stepIncrement) is required',
            'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
            400,
          );
        }

        // Acquire unit coordination write lock to prevent race conditions with unit tuning
        const unit = await UnitModel.findOneAndUpdate(
          { code: product.unitCode, isActive: true },
          { $inc: { version: 1 } },
          { session, new: true },
        );
        if (!unit) {
          throw new ProductError(
            `Unit with code "${product.unitCode}" does not exist or is inactive`,
            'UNIT_NOT_FOUND',
            400,
          );
        }
        if (unit.isDiscrete && product.quantityPrecision > 0) {
          throw new ProductError(
            `Discrete unit "${unit.code}" cannot have decimal precision`,
            'DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION',
            400,
          );
        }
        if (product.quantityPrecision > unit.allowedMaxPrecision) {
          throw new ProductError(
            `Precision ${product.quantityPrecision} exceeds maximum allowed precision of ${unit.allowedMaxPrecision} for unit "${unit.code}"`,
            'PRECISION_EXCEEDS_UNIT_MAXIMUM',
            400,
          );
        }

        try {
          await UnitValidator.validateConfiguration(
            {
              unitCode: product.unitCode,
              quantityPrecision: product.quantityPrecision,
              minOrderQuantity: product.minOrderQuantity,
              maxOrderQuantity: product.maxOrderQuantity,
              stepIncrement: product.stepIncrement,
            },
            session,
          );
        } catch (err: unknown) {
          if (err instanceof UnitValidationError) {
            throw new ProductError(err.message, err.code, err.statusCode);
          }
          throw err;
        }
      } else {
        const activeVariants = await ProductVariantModel.find({
          productId: product._id,
          status: 'ACTIVE',
        }).session(session);

        if (activeVariants.length === 0) {
          throw new ProductError(
            'Cannot publish multi-variant product without at least one active variant',
            'CANNOT_PUBLISH_PRODUCT',
            400,
          );
        }

        for (const v of activeVariants) {
          if (
            !v.unitCode ||
            v.quantityPrecision === undefined ||
            v.quantityPrecision === null ||
            !v.minOrderQuantity ||
            !v.stepIncrement
          ) {
            throw new ProductError(
              `Cannot publish multi-variant product: active variant "${v.title}" lacks complete unit configuration`,
              'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
              400,
            );
          }

          // Acquire unit coordination write lock to prevent race conditions with unit tuning
          const vUnit = await UnitModel.findOneAndUpdate(
            { code: v.unitCode, isActive: true },
            { $inc: { version: 1 } },
            { session, new: true },
          );
          if (!vUnit) {
            throw new ProductError(
              `Unit with code "${v.unitCode}" does not exist or is inactive`,
              'UNIT_NOT_FOUND',
              400,
            );
          }
          if (vUnit.isDiscrete && v.quantityPrecision > 0) {
            throw new ProductError(
              `Discrete unit "${vUnit.code}" cannot have decimal precision`,
              'DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION',
              400,
            );
          }
          if (v.quantityPrecision > vUnit.allowedMaxPrecision) {
            throw new ProductError(
              `Precision ${v.quantityPrecision} exceeds maximum allowed precision of ${vUnit.allowedMaxPrecision} for unit "${vUnit.code}"`,
              'PRECISION_EXCEEDS_UNIT_MAXIMUM',
              400,
            );
          }

          try {
            await UnitValidator.validateConfiguration(
              {
                unitCode: v.unitCode,
                quantityPrecision: v.quantityPrecision,
                minOrderQuantity: v.minOrderQuantity,
                maxOrderQuantity: v.maxOrderQuantity,
                stepIncrement: v.stepIncrement,
              },
              session,
            );
          } catch (err: unknown) {
            if (err instanceof UnitValidationError) {
              throw new ProductError(err.message, err.code, err.statusCode);
            }
            throw err;
          }
        }
      }

      // Mandatory Pricing Verification Gate (Decisions #30, #40, #45)
      if (!product.hasVariants) {
        const globalPricing = await ProductPricingModel.findOne({
          productId: product._id,
          variantId: null,
          serviceAreaId: null,
          pricingScope: 'STANDALONE_GLOBAL',
          isActive: true,
        }).session(session);

        if (!globalPricing || !globalPricing.b2cPricePaise || globalPricing.b2cPricePaise <= 0) {
          throw new ProductError(
            'Cannot publish product: an active global B2C pricing record with price > 0 is required',
            'CANNOT_PUBLISH_UNPRICED_PRODUCT',
            400,
          );
        }
      } else {
        // Multi-variant parent: verify that every active variant has active global B2C pricing with price > 0
        const currentActiveVariants = await ProductVariantModel.find({
          productId: product._id,
          status: 'ACTIVE',
        }).session(session);

        for (const v of currentActiveVariants) {
          const variantGlobalPricing = await ProductPricingModel.findOne({
            productId: product._id,
            variantId: v._id,
            serviceAreaId: null,
            pricingScope: 'VARIANT_GLOBAL',
            isActive: true,
          }).session(session);

          if (
            !variantGlobalPricing ||
            !variantGlobalPricing.b2cPricePaise ||
            variantGlobalPricing.b2cPricePaise <= 0
          ) {
            throw new ProductError(
              `Cannot publish multi-variant product: active variant "${v.title}" lacks active global B2C pricing with price > 0`,
              'CANNOT_PUBLISH_PRODUCT_WITH_UNPRICED_VARIANTS',
              400,
            );
          }
        }
      }

      if (!product.hasVariants) {
        // Transition single product SKU registry record to ASSIGNED
        await SkuRegistryModel.updateOne(
          { entityId: product._id, entityType: 'PRODUCT' },
          { $set: { status: 'ASSIGNED' } },
          { session },
        );
      }

      product.status = 'ACTIVE';
      product.publishedBy = new Types.ObjectId(userId);
      if (product.publishedAt === null) {
        product.publishedAt = new Date();
      }
      product.updatedBy = new Types.ObjectId(userId);

      await product.save({ session });
      logger.info({ productId: product._id.toString() }, 'Product published successfully');
      return product;
    });
  }

  /**
   * Deactivates an active product (transitions to INACTIVE).
   * Does NOT clear publishedAt.
   */
  public async deactivateProduct(id: string, userId: string): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw new ProductError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      const product = await ProductModel.findById(id).session(session);
      if (!product) {
        throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }
      if (product.status === 'ARCHIVED') {
        throw new ProductError(
          'Cannot deactivate archived product',
          'INVALID_PRODUCT_STATE_TRANSITION',
          400,
        );
      }

      product.status = 'INACTIVE';
      product.updatedBy = new Types.ObjectId(userId);
      await product.save({ session });
      logger.info({ productId: product._id.toString() }, 'Product deactivated successfully');
      return product;
    });
  }

  /**
   * Protocol 4: Parent Product Archival.
   * Acquires parent coordination lock, cascades ARCHIVED status to variants and registry records.
   */
  public async archiveProduct(id: string, userId: string): Promise<IProductDocument> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw new ProductError('Invalid ID format', 'VALIDATION_ERROR', 400);
    }

    return await withTransaction(async (session) => {
      // 1. Acquire parent coordination lock
      const parent = await ProductModel.findOneAndUpdate(
        { _id: id },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!parent) {
        throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }

      if (parent.status === 'ARCHIVED') {
        return parent; // Idempotent success
      }

      parent.status = 'ARCHIVED';
      parent.updatedBy = new Types.ObjectId(userId);
      await parent.save({ session });

      // 2. Cascade ARCHIVED status to child variants
      await ProductVariantModel.updateMany(
        { productId: parent._id, status: { $ne: 'ARCHIVED' } },
        { $set: { status: 'ARCHIVED' } },
        { session },
      );

      // 3. Cascade ARCHIVED status to all SKU registry records
      await SkuRegistryModel.updateMany(
        { productId: parent._id, status: { $ne: 'ARCHIVED' } },
        { $set: { status: 'ARCHIVED' } },
        { session },
      );

      // 4. Decision 42: Cascade deactivation to all active pricing records for this product and its variants
      const activePricingDocs = await ProductPricingModel.find({
        productId: parent._id,
        isActive: true,
      }).session(session);

      for (const pr of activePricingDocs) {
        await ProductPricingModel.updateOne(
          { _id: pr._id, version: pr.version },
          {
            $set: {
              isActive: false,
              updatedBy: new Types.ObjectId(userId),
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
              changeReason: 'Product archived: cascade pricing deactivation',
              changedBy: new Types.ObjectId(userId),
            },
          ],
          { session },
        );
      }

      // 5. Cascade deactivation to all active partner availability records for this product and its variants
      await this.partnerAvailabilityService.deactivateAvailabilityForProduct(
        parent._id.toString(),
        userId,
        session,
      );

      logger.info(
        { productId: parent._id.toString() },
        'Product and associated variants/SKUs archived successfully',
      );
      return parent;
    });
  }

  /**
   * Protocol 1: Restricted Draft Parent Deletion.
   * Strictly enforces status === 'DRAFT' && publishedAt === null for parent and all child variants.
   * Deletes only verified child IDs and releases only their exact matching RESERVED SKU reservations.
   */
  public async deleteDraftProduct(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new ProductError('Invalid product ID format', 'VALIDATION_ERROR', 400);
    }

    await withTransaction(async (session) => {
      // 1. Acquire parent coordination write lock
      const parent = await ProductModel.findOneAndUpdate(
        { _id: id },
        { $inc: { version: 1 } },
        { session, new: true },
      );

      if (!parent) {
        throw new ProductError(`Product with ID "${id}" not found`, 'PRODUCT_NOT_FOUND', 404);
      }

      // 2. Strict Dual-Condition Check on Parent
      if (parent.status !== 'DRAFT' || parent.publishedAt !== null) {
        throw new ProductError(
          'Cannot delete product: entity is not an unpublished draft (status must be DRAFT and publishedAt must be null). Archival is the only permitted operational removal.',
          'CANNOT_DELETE_PUBLISHED_PRODUCT',
          400,
        );
      }

      // 3. Inspect All Child Variants
      const childVariants = await ProductVariantModel.find({ productId: parent._id }).session(
        session,
      );

      const hasNonDraftChild = childVariants.some(
        (v) => v.status !== 'DRAFT' || v.publishedAt !== null,
      );

      if (hasNonDraftChild) {
        throw new ProductError(
          'Cannot delete draft parent: one or more child variants are not unpublished drafts (status must be DRAFT and publishedAt must be null).',
          'CANNOT_DELETE_PARENT_WITH_PUBLISHED_VARIANTS',
          400,
        );
      }

      // 4. Delete Only Verified Child Variant IDs
      const verifiedVariantIds = childVariants.map((v) => v._id);
      if (verifiedVariantIds.length > 0) {
        await ProductVariantModel.deleteMany({ _id: { $in: verifiedVariantIds } }).session(session);
        // 5. Release Only Verified Child SKU Reservations
        await SkuRegistryModel.deleteMany({
          entityId: { $in: verifiedVariantIds },
          entityType: 'VARIANT',
          status: 'RESERVED',
        }).session(session);
      }

      // 6. Delete Parent Document
      await ProductModel.deleteOne({ _id: parent._id }).session(session);

      // 7. Release Parent SKU Reservation (for single product)
      if (!parent.hasVariants) {
        await SkuRegistryModel.deleteOne({
          entityId: parent._id,
          entityType: 'PRODUCT',
          status: 'RESERVED',
        }).session(session);
      }

      // 8. Decision 43: Delete associated ProductPricing documents (standalone and draft variant records)
      await ProductPricingModel.deleteMany({ productId: parent._id }).session(session);

      logger.info({ productId: id, slug: parent.slug }, 'Draft product deleted successfully');
    });
  }
}

export const productService = new ProductService();
