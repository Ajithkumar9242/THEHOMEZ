import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  type IStorefrontProductListResponse,
  type IStorefrontProductDetailResponse,
  type IStorefrontProductCard,
  type IStorefrontCategorySummary,
  type IStorefrontUnitSummary,
  type IStorefrontStandalonePricingDto,
  type IStorefrontPriceRangeDto,
  type IStorefrontAvailabilityDto,
  type IStorefrontLocalizationSummary,
  type IStorefrontFacets,
  type IStorefrontMasterProductDetail,
  type IStorefrontVariantDetail,
  type IStorefrontProductQuery,
  type IStorefrontSearchQuery,
  type StorefrontSortOption,
  type StorefrontCustomerSegment,
  type IB2BVolumeTier,
  formatPaiseToINR,
} from '@thehomez/shared-types';
import { ProductModel, type IProductDocument } from '../../models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../../models/product-variant.model.js';
import {
  ProductPricingModel,
  type IProductPricingDocument,
} from '../../models/product-pricing.model.js';
import { CategoryModel, type ICategoryDocument } from '../../models/category.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { PartnerModel } from '../../models/partner.model.js';
import {
  PartnerProductModel,
  type IPartnerProductDocument,
} from '../../models/partner-product.model.js';
import { PricingEngineService, type AuthContext } from '../pricing/pricing-engine.service.js';

/**
 * Standard Storefront Domain Error.
 */
export class StorefrontError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StorefrontError';
  }
}

/**
 * Consumer Storefront Discovery & Browsing Service.
 *
 * Implements the Milestone 4 Step 7 core discovery engine for TheHomez marketplace.
 * Features:
 * - Bounded query budget (4 <= Q <= 9 roundtrips for listing/search; 3 <= Q <= 8 for detail).
 * - Constant O(1) query scaling across pagination limits (zero N+1 loops).
 * - Multi-variant price range aggregation and neutral initial variant selection.
 * - Tri-state localization semantics (unlocalized, localized serviceable, localized unserviceable).
 * - Dual-segment pricing (B2C retail vs. verified B2B wholesale volume discount tiers).
 * - Regional pricing override precedence.
 * - Absolute supplier and margin anonymity across all public responses.
 */
export class StorefrontDiscoveryService {
  constructor(
    private readonly pricingEngineService: PricingEngineService = new PricingEngineService(),
  ) {}

  // =========================================================================
  // 1. Product Listing Pipeline (GET /api/v1/storefront/products)
  // =========================================================================

  /**
   * Retrieves paginated products matching filters, enriched with localized pricing and stock.
   */
  public async listProducts(
    query: IStorefrontProductQuery,
    authContext?: AuthContext,
  ): Promise<IStorefrontProductListResponse> {
    return this.executeDiscoveryPipeline({
      query,
      authContext,
      isSearch: false,
    });
  }

  // =========================================================================
  // 2. Keyword Search Pipeline (GET /api/v1/storefront/search)
  // =========================================================================

  /**
   * Executes full-text search with MongoDB text relevance scoring and bounded batch collation.
   */
  public async searchProducts(
    query: IStorefrontSearchQuery,
    authContext?: AuthContext,
  ): Promise<IStorefrontProductListResponse> {
    return this.executeDiscoveryPipeline({
      query,
      authContext,
      isSearch: true,
    });
  }

  // =========================================================================
  // 3. Single Product Detail Pipeline (GET /api/v1/storefront/products/:slug)
  // =========================================================================

  /**
   * Retrieves complete product detail by unique slug, including active priced variants and stock.
   */
  public async getProductBySlug(
    slug: string,
    pincode?: string,
    authContext?: AuthContext,
  ): Promise<IStorefrontProductDetailResponse> {
    const normalizedSlug = slug.trim().toLowerCase();

    // -----------------------------------------------------------------------
    // OP 1: Customer Segment Resolution (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    const customerSegment = await this.pricingEngineService.resolveCustomerSegment(authContext);

    // -----------------------------------------------------------------------
    // OP 2: Geographic Service-Area Resolution (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    const { serviceArea, localization } = await this.resolveServiceAreaContext(pincode);

    // -----------------------------------------------------------------------
    // OP 4 (Detail): Product Find by Slug (1 Roundtrip)
    // -----------------------------------------------------------------------
    const product = await ProductModel.findOne({
      slug: normalizedSlug,
      status: 'ACTIVE',
    }).collation({ locale: 'en', strength: 2 });

    if (!product) {
      throw new StorefrontError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }

    // -----------------------------------------------------------------------
    // OP 3: Taxonomy & Active Category Verification (1 Roundtrip)
    // -----------------------------------------------------------------------
    const activeCategories = await CategoryModel.find({
      _id: { $in: [product.categoryId, product.subcategoryId] },
      isActive: true,
    });

    if (activeCategories.length !== 2) {
      // Inactive category or subcategory suppresses the product (Decision #4)
      throw new StorefrontError(`Product with slug "${slug}" not found`, 'PRODUCT_NOT_FOUND', 404);
    }

    const rootCategoryDoc = activeCategories.find((c) => c._id.equals(product.categoryId))!;
    const subCategoryDoc = activeCategories.find((c) => c._id.equals(product.subcategoryId))!;

    const categorySummary: IStorefrontCategorySummary = {
      id: rootCategoryDoc._id.toString(),
      slug: rootCategoryDoc.slug,
      name: rootCategoryDoc.name,
    };

    const subcategorySummary: IStorefrontCategorySummary = {
      id: subCategoryDoc._id.toString(),
      slug: subCategoryDoc.slug,
      name: subCategoryDoc.name,
    };

    // -----------------------------------------------------------------------
    // Multi-Variant vs. Standalone Product Processing
    // -----------------------------------------------------------------------
    if (product.hasVariants) {
      // OP 5: Batch Child Variants (1 Roundtrip)
      const variants = await ProductVariantModel.find({
        productId: product._id,
        status: 'ACTIVE',
      });

      if (variants.length === 0) {
        throw new StorefrontError(
          `Product with slug "${slug}" not found`,
          'PRODUCT_NOT_FOUND',
          404,
        );
      }

      const variantIds = variants.map((v) => v._id);

      // OP 6: Batch Pricing Loading (1 Roundtrip)
      const pricingFilter: FilterQuery<IProductPricingDocument> = {
        productId: product._id,
        variantId: { $in: variantIds },
        isActive: true,
      };
      if (serviceArea) {
        pricingFilter.serviceAreaId = { $in: [null, serviceArea._id] };
      } else {
        pricingFilter.serviceAreaId = null;
      }
      const pricingDocs = await ProductPricingModel.find(pricingFilter);

      // OP 7 & 8: Partner Stock Resolution
      const { activePartnerIds, availabilityDocs } = await this.resolveAvailabilityBatch(
        serviceArea,
        [],
        variantIds,
      );

      // Collate variants
      const collatedVariants: IStorefrontVariantDetail[] = [];
      for (const variant of variants) {
        const pricing = this.collateItemPricing({
          productId: product._id,
          variantId: variant._id,
          pricingDocs,
          serviceAreaId: serviceArea?._id,
          customerSegment,
        });

        // Unpriced variants are omitted from public storefront (Decision #40)
        if (!pricing || pricing.pricePaise <= 0) {
          continue;
        }

        const availability = this.collateItemAvailability({
          productId: product._id,
          variantId: variant._id,
          serviceArea,
          isLocalized: localization.isLocalized,
          activePartnerIds,
          availabilityDocs,
        });

        collatedVariants.push({
          id: variant._id.toString(),
          sku: variant.sku,
          title: variant.title,
          attributes: this.toAttributesObject(variant.attributes),
          images: variant.images || [],
          unit: this.toUnitSummary(variant),
          pricing,
          availability,
        });
      }

      // Parent container visible only if >= 1 child variant is active and priced
      if (collatedVariants.length === 0) {
        throw new StorefrontError(
          `Product with slug "${slug}" not found`,
          'PRODUCT_NOT_FOUND',
          404,
        );
      }

      const masterDetail: IStorefrontMasterProductDetail = {
        id: product._id.toString(),
        slug: product.slug,
        title: product.title,
        brand: product.brand,
        description: product.description,
        hasVariants: true,
        category: categorySummary,
        subcategory: subcategorySummary,
        images: product.images || [],
        specifications: this.toSpecificationsObject(product.specifications),
      };

      return {
        product: masterDetail,
        variants: collatedVariants,
        localization,
      };
    } else {
      // Standalone single-SKU product:
      // OP 5 is bypassed (0 Roundtrips)

      // OP 6: Standalone Pricing Loading (1 Roundtrip)
      const pricingFilter: FilterQuery<IProductPricingDocument> = {
        productId: product._id,
        variantId: null,
        isActive: true,
      };
      if (serviceArea) {
        pricingFilter.serviceAreaId = { $in: [null, serviceArea._id] };
      } else {
        pricingFilter.serviceAreaId = null;
      }
      const pricingDocs = await ProductPricingModel.find(pricingFilter);

      const pricing = this.collateItemPricing({
        productId: product._id,
        variantId: null,
        pricingDocs,
        serviceAreaId: serviceArea?._id,
        customerSegment,
      });

      // Must have active pricing with price > 0 (Decision #45)
      if (!pricing || pricing.pricePaise <= 0) {
        throw new StorefrontError(
          `Product with slug "${slug}" not found`,
          'PRODUCT_NOT_FOUND',
          404,
        );
      }

      // OP 7 & 8: Partner Stock Resolution
      const { activePartnerIds, availabilityDocs } = await this.resolveAvailabilityBatch(
        serviceArea,
        [product._id],
        [],
      );

      const availability = this.collateItemAvailability({
        productId: product._id,
        variantId: null,
        serviceArea,
        isLocalized: localization.isLocalized,
        activePartnerIds,
        availabilityDocs,
      });

      const masterDetail: IStorefrontMasterProductDetail = {
        id: product._id.toString(),
        slug: product.slug,
        title: product.title,
        brand: product.brand,
        description: product.description,
        hasVariants: false,
        sku: product.sku,
        category: categorySummary,
        subcategory: subcategorySummary,
        images: product.images || [],
        specifications: this.toSpecificationsObject(product.specifications),
        unit: this.toUnitSummary(product),
        pricing,
        availability,
      };

      return {
        product: masterDetail,
        variants: [],
        localization,
      };
    }
  }

  // =========================================================================
  // 4. Core Batch Execution Engine (Bounded O(1) Queries)
  // =========================================================================

  private async executeDiscoveryPipeline(params: {
    query: IStorefrontProductQuery | IStorefrontSearchQuery;
    authContext?: AuthContext;
    isSearch: boolean;
  }): Promise<IStorefrontProductListResponse> {
    const { query, authContext, isSearch } = params;

    // -----------------------------------------------------------------------
    // OP 1: Customer Segment Resolution (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    const customerSegment = await this.pricingEngineService.resolveCustomerSegment(authContext);

    // -----------------------------------------------------------------------
    // OP 2: Geographic Service-Area Resolution (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    const { serviceArea, localization } = await this.resolveServiceAreaContext(query.pincode);

    // -----------------------------------------------------------------------
    // OP 3: Taxonomy & Active Category Barrier (1 Roundtrip)
    // -----------------------------------------------------------------------
    // Uses compound index prefix { level: 1, isActive: 1, displayOrder: 1 }
    const activeCategories = await CategoryModel.find({
      level: { $in: [0, 1] },
      isActive: true,
    }).select('_id slug name parentId level');

    const categoryMap = new Map<string, ICategoryDocument>();
    const activeRootIds: Types.ObjectId[] = [];
    const activeSubIds: Types.ObjectId[] = [];

    for (const cat of activeCategories) {
      categoryMap.set(cat._id.toString(), cat);
      if (cat.level === 0) {
        activeRootIds.push(cat._id);
      } else {
        activeSubIds.push(cat._id);
      }
    }

    // Slug filter verification
    let filterRootId: Types.ObjectId | undefined;
    let filterSubId: Types.ObjectId | undefined;

    if (query.category) {
      const normalizedCatSlug = query.category.trim().toLowerCase();
      const matchedCat = activeCategories.find(
        (c) => c.level === 0 && c.slug === normalizedCatSlug,
      );
      if (!matchedCat) {
        return this.createEmptyListResponse(query, localization);
      }
      filterRootId = matchedCat._id;
    }

    if (query.subcategory) {
      const normalizedSubcatSlug = query.subcategory.trim().toLowerCase();
      const matchedSub = activeCategories.find((c) => {
        if (c.level !== 1 || c.slug !== normalizedSubcatSlug) return false;
        if (filterRootId && c.parentId && !c.parentId.equals(filterRootId)) {
          return false;
        }
        return true;
      });
      if (!matchedSub) {
        return this.createEmptyListResponse(query, localization);
      }
      filterSubId = matchedSub._id;
    }

    // -----------------------------------------------------------------------
    // OP 4: Product Candidates & Count (2 Distinct Parallel Roundtrips)
    // -----------------------------------------------------------------------
    const productFilter: FilterQuery<IProductDocument> = {
      status: 'ACTIVE',
      categoryId: filterRootId || { $in: activeRootIds },
      subcategoryId: filterSubId || { $in: activeSubIds },
    };

    if (query.brand) {
      productFilter.brand = query.brand.trim();
    }

    if (isSearch && 'q' in query && query.q) {
      productFilter.$text = { $search: query.q.trim() };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const dbSort = this.resolveDatabaseSort(query.sort, isSearch);

    const [candidateProducts, totalCount] = await Promise.all([
      ProductModel.find(productFilter, isSearch ? { score: { $meta: 'textScore' } } : undefined)
        .sort(dbSort)
        .skip(skip)
        .limit(limit),
      ProductModel.countDocuments(productFilter),
    ]);

    // -----------------------------------------------------------------------
    // OP 5: Batch Child Variants Loading (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    const multiVariantParentIds = candidateProducts.filter((p) => p.hasVariants).map((p) => p._id);

    let childVariants: IProductVariantDocument[] = [];
    if (multiVariantParentIds.length > 0) {
      childVariants = await ProductVariantModel.find({
        productId: { $in: multiVariantParentIds },
        status: 'ACTIVE',
      });
    }

    // -----------------------------------------------------------------------
    // OP 6: Batch Pricing Loading (1 Roundtrip)
    // -----------------------------------------------------------------------
    const standaloneProductIds = candidateProducts.filter((p) => !p.hasVariants).map((p) => p._id);

    const childVariantIds = childVariants.map((v) => v._id);

    const pricingConditions: FilterQuery<IProductPricingDocument>[] = [];
    if (standaloneProductIds.length > 0) {
      pricingConditions.push({
        productId: { $in: standaloneProductIds },
        variantId: null,
      });
    }
    if (childVariantIds.length > 0) {
      pricingConditions.push({
        variantId: { $in: childVariantIds },
      });
    }

    let allPricingRecords: IProductPricingDocument[] = [];
    if (pricingConditions.length > 0) {
      const pricingFilter: FilterQuery<IProductPricingDocument> = {
        $or: pricingConditions,
        isActive: true,
      };
      if (serviceArea) {
        pricingFilter.serviceAreaId = { $in: [null, serviceArea._id] };
      } else {
        pricingFilter.serviceAreaId = null;
      }
      allPricingRecords = await ProductPricingModel.find(pricingFilter);
    } else {
      // Empty page executes empty batch query preserving constant Q(N) invariant
      allPricingRecords = await ProductPricingModel.find({
        _id: { $in: [] },
        isActive: true,
      });
    }

    // -----------------------------------------------------------------------
    // OP 7 & 8: Batch Partner Availability Resolution (0 to 2 Roundtrips)
    // -----------------------------------------------------------------------
    const { activePartnerIds, availabilityDocs } = await this.resolveAvailabilityBatch(
      serviceArea,
      standaloneProductIds,
      childVariantIds,
    );

    // -----------------------------------------------------------------------
    // OP 9: Optional Facet Aggregation Pipeline (0 or 1 Roundtrip)
    // -----------------------------------------------------------------------
    let facets: IStorefrontFacets | undefined = undefined;
    if (query.includeFacets) {
      facets = await this.executeFacetAggregation(productFilter, categoryMap);
    }

    // -----------------------------------------------------------------------
    // Collation Engine: In-Memory Transformation & Invariants (0 DB roundtrips)
    // -----------------------------------------------------------------------
    const variantsByProduct = new Map<string, IProductVariantDocument[]>();
    for (const v of childVariants) {
      const pid = v.productId.toString();
      if (!variantsByProduct.has(pid)) {
        variantsByProduct.set(pid, []);
      }
      variantsByProduct.get(pid)!.push(v);
    }

    const cards: IStorefrontProductCard[] = [];

    for (const product of candidateProducts) {
      const rootCat = categoryMap.get(product.categoryId.toString());
      const subCat = categoryMap.get(product.subcategoryId.toString());

      if (!rootCat || !subCat) continue;

      const catSummary: IStorefrontCategorySummary = {
        id: rootCat._id.toString(),
        slug: rootCat.slug,
        name: rootCat.name,
      };
      const subcatSummary: IStorefrontCategorySummary = {
        id: subCat._id.toString(),
        slug: subCat.slug,
        name: subCat.name,
      };

      if (product.hasVariants) {
        const productVariants = variantsByProduct.get(product._id.toString()) || [];
        const pricedVariants: {
          variant: IProductVariantDocument;
          pricing: IStorefrontStandalonePricingDto;
        }[] = [];

        for (const variant of productVariants) {
          const pricing = this.collateItemPricing({
            productId: product._id,
            variantId: variant._id,
            pricingDocs: allPricingRecords,
            serviceAreaId: serviceArea?._id,
            customerSegment,
          });

          if (pricing && pricing.pricePaise > 0) {
            pricedVariants.push({ variant, pricing });
          }
        }

        // Multi-variant parent visible only if >= 1 priced variant exists (Decision #40)
        if (pricedVariants.length === 0) {
          continue;
        }

        const variantPrices = pricedVariants.map((p) => p.pricing.pricePaise);
        const minPricePaise = Math.min(...variantPrices);
        const maxPricePaise = Math.max(...variantPrices);

        const priceRange: IStorefrontPriceRangeDto = {
          minPricePaise,
          maxPricePaise,
          currency: 'INR',
          displayFormatted:
            minPricePaise === maxPricePaise
              ? formatPaiseToINR(minPricePaise)
              : `${formatPaiseToINR(minPricePaise)} – ${formatPaiseToINR(maxPricePaise)}`,
        };

        const availability = this.collateMultiVariantAvailability({
          serviceArea,
          isLocalized: localization.isLocalized,
          activePartnerIds,
          variantIds: pricedVariants.map((p) => p.variant._id),
          availabilityDocs,
        });

        cards.push({
          id: product._id.toString(),
          slug: product.slug,
          title: product.title,
          brand: product.brand,
          hasVariants: true,
          variantCount: pricedVariants.length,
          category: catSummary,
          subcategory: subcatSummary,
          images: product.images || [],
          priceRange,
          availability,
        });
      } else {
        const pricing = this.collateItemPricing({
          productId: product._id,
          variantId: null,
          pricingDocs: allPricingRecords,
          serviceAreaId: serviceArea?._id,
          customerSegment,
        });

        // Standalone product visible only if active global pricing > 0 exists
        if (!pricing || pricing.pricePaise <= 0) {
          continue;
        }

        const availability = this.collateItemAvailability({
          productId: product._id,
          variantId: null,
          serviceArea,
          isLocalized: localization.isLocalized,
          activePartnerIds,
          availabilityDocs,
        });

        cards.push({
          id: product._id.toString(),
          slug: product.slug,
          title: product.title,
          brand: product.brand,
          hasVariants: false,
          sku: product.sku,
          category: catSummary,
          subcategory: subcatSummary,
          images: product.images || [],
          unit: this.toUnitSummary(product),
          pricing,
          availability,
        });
      }
    }

    // -----------------------------------------------------------------------
    // In-Memory Filter Refinement & Dynamic Price Sorting
    // -----------------------------------------------------------------------
    let filteredCards = cards;

    // Filter inStockOnly
    if (query.inStockOnly) {
      filteredCards = filteredCards.filter((c) => c.availability.isAvailable === true);
    }

    // Filter price range
    if (query.minPricePaise !== undefined || query.maxPricePaise !== undefined) {
      filteredCards = filteredCards.filter((c) => {
        const itemMinPrice = c.hasVariants ? c.priceRange.minPricePaise : c.pricing.pricePaise;
        const itemMaxPrice = c.hasVariants ? c.priceRange.maxPricePaise : c.pricing.pricePaise;

        if (query.minPricePaise !== undefined && itemMaxPrice < query.minPricePaise) {
          return false;
        }
        if (query.maxPricePaise !== undefined && itemMinPrice > query.maxPricePaise) {
          return false;
        }
        return true;
      });
    }

    // In-memory dynamic price sorting
    if (query.sort === 'price_asc') {
      filteredCards.sort((a, b) => {
        const priceA = a.hasVariants ? a.priceRange.minPricePaise : a.pricing.pricePaise;
        const priceB = b.hasVariants ? b.priceRange.minPricePaise : b.pricing.pricePaise;
        return priceA - priceB;
      });
    } else if (query.sort === 'price_desc') {
      filteredCards.sort((a, b) => {
        const priceA = a.hasVariants ? a.priceRange.maxPricePaise : a.pricing.pricePaise;
        const priceB = b.hasVariants ? b.priceRange.maxPricePaise : b.pricing.pricePaise;
        return priceB - priceA;
      });
    }

    const totalPages = Math.ceil(totalCount / limit);

    return {
      items: filteredCards,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      localization,
      facets,
    };
  }

  // =========================================================================
  // 5. Helper Methods (Reused Business Rules & Pure Collations)
  // =========================================================================

  private async resolveServiceAreaContext(pincode?: string): Promise<{
    serviceArea: IServiceAreaDocument | null;
    localization: IStorefrontLocalizationSummary;
  }> {
    if (!pincode) {
      return {
        serviceArea: null,
        localization: {
          pincode: null,
          isLocalized: false,
          isServiceable: false,
          serviceAreaId: null,
          serviceAreaName: null,
        },
      };
    }

    const sanitizedPin = pincode.trim();
    // OP 2: ServiceArea point lookup on unique_active_pincodes
    const serviceArea = await ServiceAreaModel.findOne({
      pincodes: sanitizedPin,
      isActive: true,
    });

    if (!serviceArea) {
      return {
        serviceArea: null,
        localization: {
          pincode: sanitizedPin,
          isLocalized: true,
          isServiceable: false,
          serviceAreaId: null,
          serviceAreaName: null,
        },
      };
    }

    return {
      serviceArea,
      localization: {
        pincode: sanitizedPin,
        isLocalized: true,
        isServiceable: true,
        serviceAreaId: serviceArea._id.toString(),
        serviceAreaName: serviceArea.name,
      },
    };
  }

  private async resolveAvailabilityBatch(
    serviceArea: IServiceAreaDocument | null,
    standaloneProductIds: Types.ObjectId[],
    variantIds: Types.ObjectId[],
  ): Promise<{
    activePartnerIds: Types.ObjectId[];
    availabilityDocs: IPartnerProductDocument[];
  }> {
    if (!serviceArea) {
      return { activePartnerIds: [], availabilityDocs: [] };
    }

    // OP 7: Active Partner Resolution (1 Roundtrip)
    const activePartners = await PartnerModel.find({
      serviceAreaIds: serviceArea._id,
      status: 'ACTIVE',
    }).select('_id');

    const activePartnerIds = activePartners.map((p) => p._id);

    // Short-circuit OP 8 if zero active partners in service area
    if (activePartnerIds.length === 0) {
      return { activePartnerIds: [], availabilityDocs: [] };
    }

    const conditions: FilterQuery<IPartnerProductDocument>[] = [];
    if (standaloneProductIds.length > 0) {
      conditions.push({
        productId: { $in: standaloneProductIds },
        variantId: null,
      });
    }
    if (variantIds.length > 0) {
      conditions.push({
        variantId: { $in: variantIds },
      });
    }

    if (conditions.length === 0) {
      return { activePartnerIds, availabilityDocs: [] };
    }

    // OP 8: Batch Partner Availability (1 Roundtrip)
    const availabilityDocs = await PartnerProductModel.find({
      partnerId: { $in: activePartnerIds },
      serviceAreaId: serviceArea._id,
      $or: conditions,
      isAvailable: true,
    });

    return { activePartnerIds, availabilityDocs };
  }

  private collateItemPricing(params: {
    productId: Types.ObjectId;
    variantId: Types.ObjectId | null;
    pricingDocs: IProductPricingDocument[];
    serviceAreaId?: Types.ObjectId | null;
    customerSegment: StorefrontCustomerSegment;
  }): IStorefrontStandalonePricingDto | null {
    const { productId, variantId, pricingDocs, serviceAreaId, customerSegment } = params;

    const matching = pricingDocs.filter((p) => {
      if (!p.productId.equals(productId)) return false;
      if (variantId) {
        return p.variantId && p.variantId.equals(variantId);
      }
      return p.variantId === null;
    });

    if (matching.length === 0) return null;

    // Precedence: Regional Override > Global Pricing (Decisions #31, #38)
    let selected: IProductPricingDocument | undefined;
    let isRegionalOverride = false;

    if (serviceAreaId) {
      selected = matching.find((p) => p.serviceAreaId && p.serviceAreaId.equals(serviceAreaId));
      if (selected) {
        isRegionalOverride = true;
      }
    }

    if (!selected) {
      selected = matching.find((p) => p.serviceAreaId === null);
    }

    if (!selected) return null;

    const b2cPricePaise = selected.b2cPricePaise;
    const b2cMrpPaise = selected.b2cMrpPaise;

    let pricePaise = b2cPricePaise;
    let retailBenchmarkPaise: number | undefined = undefined;
    let hasVolumeTiers = false;
    let b2bTiers: IB2BVolumeTier[] | undefined = undefined;

    if (customerSegment === 'B2B') {
      if (
        selected.b2bPricePaise !== null &&
        selected.b2bPricePaise !== undefined &&
        selected.b2bPricePaise > 0
      ) {
        pricePaise = selected.b2bPricePaise;
        retailBenchmarkPaise = b2cPricePaise;
        if (selected.b2bTiers && selected.b2bTiers.length > 0) {
          hasVolumeTiers = true;
          b2bTiers = selected.b2bTiers.map((t) => ({
            minQuantity: t.minQuantity,
            pricePaise: t.pricePaise,
          }));
        }
      } else {
        // Fallback to B2C pricing per Decision #30
        pricePaise = b2cPricePaise;
        hasVolumeTiers = false;
      }
    }

    let savingsPaise: number | undefined;
    let discountPercentage: number | undefined;

    if (b2cMrpPaise !== null && b2cMrpPaise > pricePaise) {
      savingsPaise = b2cMrpPaise - pricePaise;
      discountPercentage = Math.round((savingsPaise / b2cMrpPaise) * 100 * 100) / 100;
    }

    return {
      customerSegment,
      pricePaise,
      mrpPaise: b2cMrpPaise,
      savingsPaise,
      discountPercentage,
      isRegionalOverride,
      hasVolumeTiers,
      retailBenchmarkPaise,
      b2bTiers,
    };
  }

  private collateItemAvailability(params: {
    productId: Types.ObjectId;
    variantId: Types.ObjectId | null;
    serviceArea: IServiceAreaDocument | null;
    isLocalized: boolean;
    activePartnerIds: Types.ObjectId[];
    availabilityDocs: IPartnerProductDocument[];
  }): IStorefrontAvailabilityDto {
    const { productId, variantId, serviceArea, isLocalized, activePartnerIds, availabilityDocs } =
      params;

    // State 1: Unlocalized (Decision #48)
    if (!isLocalized) {
      return {
        availabilityUnknown: true,
        isAvailable: null,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };
    }

    // State 3: Unserviceable PIN (Decision #50)
    if (!serviceArea) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };
    }

    // State 2: Serviceable area with zero active partners
    if (activePartnerIds.length === 0) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: serviceArea._id.toString(),
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
    }

    // Matching active available partner records
    const matching = availabilityDocs.filter((r) => {
      if (!r.productId.equals(productId)) return false;
      if (variantId) {
        return r.variantId && r.variantId.equals(variantId);
      }
      return r.variantId === null;
    });

    if (matching.length === 0) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: serviceArea._id.toString(),
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
    }

    const leadTimes = matching.map((r) => r.minLeadTimeHours);
    const partnerIdSet = new Set(matching.map((r) => r.partnerId.toString()));

    return {
      availabilityUnknown: false,
      isAvailable: true,
      serviceAreaId: serviceArea._id.toString(),
      minLeadTimeHours: Math.min(...leadTimes),
      availablePartnerCount: partnerIdSet.size,
    };
  }

  private collateMultiVariantAvailability(params: {
    serviceArea: IServiceAreaDocument | null;
    isLocalized: boolean;
    activePartnerIds: Types.ObjectId[];
    variantIds: Types.ObjectId[];
    availabilityDocs: IPartnerProductDocument[];
  }): IStorefrontAvailabilityDto {
    const { serviceArea, isLocalized, activePartnerIds, variantIds, availabilityDocs } = params;

    // State 1: Unlocalized (Decision #48)
    if (!isLocalized) {
      return {
        availabilityUnknown: true,
        isAvailable: null,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };
    }

    // State 3: Unserviceable PIN (Decision #50)
    if (!serviceArea) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };
    }

    if (activePartnerIds.length === 0) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: serviceArea._id.toString(),
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
    }

    const variantIdStrings = new Set(variantIds.map((v) => v.toString()));
    const matching = availabilityDocs.filter(
      (r) => r.variantId && variantIdStrings.has(r.variantId.toString()),
    );

    if (matching.length === 0) {
      return {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: serviceArea._id.toString(),
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
    }

    const leadTimes = matching.map((r) => r.minLeadTimeHours);
    const partnerIdSet = new Set(matching.map((r) => r.partnerId.toString()));

    return {
      availabilityUnknown: false,
      isAvailable: true,
      serviceAreaId: serviceArea._id.toString(),
      minLeadTimeHours: Math.min(...leadTimes),
      availablePartnerCount: partnerIdSet.size,
    };
  }

  private async executeFacetAggregation(
    productFilter: FilterQuery<IProductDocument>,
    categoryMap: Map<string, ICategoryDocument>,
  ): Promise<IStorefrontFacets> {
    const facetPipeline: PipelineStage[] = [
      { $match: productFilter },
      {
        $facet: {
          brands: [
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          subcategories: [
            { $group: { _id: '$subcategoryId', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
        },
      },
    ];

    const [rawFacets] = await ProductModel.aggregate(facetPipeline);

    const brands =
      rawFacets?.brands?.map((b: { _id: string; count: number }) => ({
        brand: b._id,
        count: b.count,
      })) || [];

    const subcategories =
      rawFacets?.subcategories?.map((s: { _id: Types.ObjectId; count: number }) => {
        const cat = categoryMap.get(s._id.toString());
        return {
          id: s._id.toString(),
          slug: cat?.slug || '',
          name: cat?.name || '',
          count: s.count,
        };
      }) || [];

    return { brands, subcategories };
  }

  private resolveDatabaseSort(
    sort?: StorefrontSortOption,
    isSearch?: boolean,
  ): Record<string, 1 | -1 | { $meta: 'textScore' }> {
    if (isSearch && !sort) {
      return { score: { $meta: 'textScore' } };
    }

    switch (sort) {
      case 'newest':
        return { createdAt: -1, _id: -1 };
      case 'title_asc':
        return { title: 1, _id: 1 };
      case 'title_desc':
        return { title: -1, _id: -1 };
      case 'price_asc':
      case 'price_desc':
      case 'featured':
      default:
        return isSearch
          ? { score: { $meta: 'textScore' }, createdAt: -1 }
          : { createdAt: -1, _id: -1 };
    }
  }

  private toSpecificationsObject(specMap: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!specMap) return result;
    if (specMap instanceof Map) {
      for (const [k, v] of specMap.entries()) {
        if (typeof v === 'string') result[k] = v;
      }
    } else if (typeof specMap === 'object') {
      for (const [k, v] of Object.entries(specMap)) {
        if (typeof v === 'string') result[k] = v;
      }
    }
    return result;
  }

  private toAttributesObject(attrMap: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!attrMap) return result;
    if (attrMap instanceof Map) {
      for (const [k, v] of attrMap.entries()) {
        if (typeof v === 'string') result[k] = v;
      }
    } else if (typeof attrMap === 'object') {
      for (const [k, v] of Object.entries(attrMap)) {
        if (typeof v === 'string') result[k] = v;
      }
    }
    return result;
  }

  private toUnitSummary(entity: {
    unitCode?: string | null;
    quantityPrecision?: number | null;
    minOrderQuantity?: string | null;
    maxOrderQuantity?: string | null;
    stepIncrement?: string | null;
  }): IStorefrontUnitSummary {
    return {
      unitCode: entity.unitCode || 'PIECE',
      quantityPrecision: entity.quantityPrecision ?? 0,
      minOrderQuantity: entity.minOrderQuantity || '1',
      maxOrderQuantity: entity.maxOrderQuantity ?? null,
      stepIncrement: entity.stepIncrement || '1',
    };
  }

  private createEmptyListResponse(
    query: IStorefrontProductQuery | IStorefrontSearchQuery,
    localization: IStorefrontLocalizationSummary,
  ): IStorefrontProductListResponse {
    const page = query.page || 1;
    const limit = query.limit || 20;
    return {
      items: [],
      pagination: {
        total: 0,
        page,
        limit,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
      localization,
    };
  }
}

export const storefrontDiscoveryService = new StorefrontDiscoveryService();
