import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import {
  StorefrontDiscoveryService,
  StorefrontError,
} from '../src/services/catalog/storefront-discovery.service.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import {
  ProductPricingModel,
  type IProductPricingDocument,
} from '../src/models/product-pricing.model.js';
import { CategoryModel, type ICategoryDocument } from '../src/models/category.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import {
  UserType,
  UserStatus,
  type IStorefrontProductCard,
  type IStorefrontProductDetailResponse,
} from '@thehomez/shared-types';

describe('Milestone 4 Step 7: Subtask 7.2B — StorefrontDiscoveryService Domain Implementation & Verification', () => {
  const service = new StorefrontDiscoveryService();

  const dummyStaffId = new Types.ObjectId();

  // Categories
  let rootCementCat: ICategoryDocument;
  let subPpcCementCat: ICategoryDocument;
  let subOpcCementCat: ICategoryDocument;
  let rootSteelCat: ICategoryDocument;
  let subTmtSteelCat: ICategoryDocument;
  let inactiveRootCat: ICategoryDocument;
  let inactiveSubCat: ICategoryDocument;

  // Service Areas
  let serviceableAreaEast: IServiceAreaDocument;
  let serviceableAreaWestEmpty: IServiceAreaDocument;

  // Partners
  let partnerHubEast: IPartnerDocument;
  let partnerSteelEast: IPartnerDocument;

  // Users
  let b2cCustomer: IUserDocument;
  let b2bContractor: IUserDocument;
  let suspendedB2bUser: IUserDocument;

  // Products
  let standaloneProduct: IProductDocument;
  let multiVariantProduct: IProductDocument;
  let variant12mm: IProductVariantDocument;
  let variant16mm: IProductVariantDocument;
  let variantUnpriced: IProductVariantDocument;
  let outOfStockProduct: IProductDocument;
  let archivedProduct: IProductDocument;
  let draftProduct: IProductDocument;
  let inactiveCatProduct: IProductDocument;

  // Fixtures for page-size invariance profiling (25 additional standalone products)
  const paginationFixtures: IProductDocument[] = [];

  // Query Profiling Harness
  interface MongooseQueryLog {
    collection: string;
    method: string;
  }
  const queryLogs: MongooseQueryLog[] = [];
  let isProfiling = false;

  beforeAll(async () => {
    await connectDatabase();

    // Attach Mongoose query profiler
    mongoose.set('debug', (collection: string, method: string) => {
      if (isProfiling) {
        queryLogs.push({ collection, method });
      }
    });

    // Clean existing test collections
    await Promise.all([
      ProductModel.deleteMany({}),
      ProductVariantModel.deleteMany({}),
      ProductPricingModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      ServiceAreaModel.deleteMany({}),
      PartnerModel.deleteMany({}),
      PartnerProductModel.deleteMany({}),
      UserModel.deleteMany({}),
    ]);

    // -----------------------------------------------------------------------
    // 1. Seed Taxonomy
    // -----------------------------------------------------------------------
    rootCementCat = await CategoryModel.create({
      slug: 'cement',
      name: 'Cement',
      level: 0,
      displayOrder: 1,
      isActive: true,
    });

    subPpcCementCat = await CategoryModel.create({
      slug: 'ppc-cement',
      name: 'PPC Cement',
      parentId: rootCementCat._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
    });

    subOpcCementCat = await CategoryModel.create({
      slug: 'opc-cement',
      name: 'OPC Cement',
      parentId: rootCementCat._id,
      level: 1,
      displayOrder: 2,
      isActive: true,
    });

    rootSteelCat = await CategoryModel.create({
      slug: 'structural-steel',
      name: 'Structural Steel',
      level: 0,
      displayOrder: 2,
      isActive: true,
    });

    subTmtSteelCat = await CategoryModel.create({
      slug: 'tmt-rebars',
      name: 'TMT Rebars',
      parentId: rootSteelCat._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
    });

    inactiveRootCat = await CategoryModel.create({
      slug: 'paints-coatings',
      name: 'Paints & Coatings',
      level: 0,
      displayOrder: 99,
      isActive: false, // Inactive!
    });

    inactiveSubCat = await CategoryModel.create({
      slug: 'wall-putty',
      name: 'Wall Putty',
      parentId: inactiveRootCat._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
    });

    // -----------------------------------------------------------------------
    // 2. Seed Service Areas
    // -----------------------------------------------------------------------
    serviceableAreaEast = await ServiceAreaModel.create({
      code: 'BLR-EAST',
      name: 'Bangalore East Hub',
      city: 'Bangalore',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560037', '560066'],
      isActive: true,
    });

    serviceableAreaWestEmpty = await ServiceAreaModel.create({
      code: 'BLR-WEST',
      name: 'Bangalore West Hub',
      city: 'Bangalore',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560010'],
      isActive: true, // Active area, but 0 partners mapped
    });

    // -----------------------------------------------------------------------
    // 3. Seed Partners
    // -----------------------------------------------------------------------
    partnerHubEast = await PartnerModel.create({
      businessName: 'Bangalore Material Hub',
      phone: '+919876543210',
      serviceAreaIds: [serviceableAreaEast._id],
      status: 'ACTIVE',
    });

    partnerSteelEast = await PartnerModel.create({
      businessName: 'Karnataka Steel Suppliers',
      phone: '+919876543211',
      serviceAreaIds: [serviceableAreaEast._id],
      status: 'ACTIVE',
    });

    // -----------------------------------------------------------------------
    // 4. Seed Users
    // -----------------------------------------------------------------------
    b2cCustomer = await UserModel.create({
      phone: '+919100000001',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });

    b2bContractor = await UserModel.create({
      phone: '+919100000002',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['B2B_CUSTOMER'], // Authoritative B2B role
    });

    suspendedB2bUser = await UserModel.create({
      phone: '+919100000003',
      userType: UserType.CUSTOMER,
      status: UserStatus.SUSPENDED, // Suspended -> Fallback to B2C (Instant revocation)
      roles: ['B2B_CUSTOMER'],
    });

    // -----------------------------------------------------------------------
    // 4b. Seed Additional Products for Page-Size Invariance Profiling
    // -----------------------------------------------------------------------
    for (let i = 1; i <= 25; i++) {
      const p = await ProductModel.create({
        slug: `standard-cement-bag-${i}`,
        title: `Standard Construction Cement Grade ${i}`,
        brand: i % 2 === 0 ? 'UltraTech' : 'JSW',
        categoryId: rootCementCat._id,
        subcategoryId: subOpcCementCat._id,
        hasVariants: false,
        sku: `THZ-CEM-OPC-${String(i).padStart(3, '0')}`,
        status: 'ACTIVE',
        images: [`https://assets.thehomez.in/products/opc-${i}.webp`],
        specifications: { Grade: 'OPC 53' },
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        stepIncrement: '1',
        publishedAt: new Date(),
        createdBy: dummyStaffId,
        updatedBy: dummyStaffId,
      });

      await ProductPricingModel.create({
        productId: p._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 36000 + i * 100,
        b2cMrpPaise: 40000 + i * 100,
        isActive: true,
        createdBy: dummyStaffId,
        updatedBy: dummyStaffId,
      });

      paginationFixtures.push(p);
    }

    // Small delay ensuring core fixtures get strictly newer timestamps for default desc sort
    await new Promise((resolve) => setTimeout(resolve, 50));

    // -----------------------------------------------------------------------
    // 5. Seed Core Products & Variants
    // -----------------------------------------------------------------------
    // Standalone product: UltraTech Super Cement
    standaloneProduct = await ProductModel.create({
      slug: 'ultratech-super-cement',
      title: 'UltraTech Super Cement',
      brand: 'UltraTech',
      description: 'Engineered for high-strength durable structural foundations.',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      sku: 'THZ-CEM-ULT-001',
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/products/ultratech-ppc.webp'],
      specifications: { Grade: 'PPC', Standard: 'IS 1489:1991' },
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '500',
      stepIncrement: '1',
      publishedAt: new Date(),
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Global Pricing for Standalone
    await ProductPricingModel.create({
      productId: standaloneProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 38000,
      b2cMrpPaise: 42000,
      b2bPricePaise: 35000,
      b2bTiers: [{ minQuantity: '100', pricePaise: 34000 }],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Regional Pricing Override for Standalone in BLR-EAST (Decisions #31, #38)
    await ProductPricingModel.create({
      productId: standaloneProduct._id,
      variantId: null,
      serviceAreaId: serviceableAreaEast._id,
      pricingScope: 'STANDALONE_REGIONAL',
      b2cPricePaise: 37500, // Discounted regional base price
      b2cMrpPaise: 42000,
      b2bPricePaise: 34500,
      b2bTiers: [{ minQuantity: '100', pricePaise: 33500 }],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Partner Stock for Standalone in BLR-EAST
    await PartnerProductModel.create({
      partnerId: partnerHubEast._id,
      productId: standaloneProduct._id,
      variantId: null,
      serviceAreaId: serviceableAreaEast._id,
      isAvailable: true,
      minLeadTimeHours: 12,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Multi-variant parent product: Tata Tiscon 550D TMT Rebars
    multiVariantProduct = await ProductModel.create({
      slug: 'tata-tiscon-550d-tmt-bars',
      title: 'Tata Tiscon 550D TMT Rebars',
      brand: 'Tata Tiscon',
      description: 'High-ductility earthquake resistant TMT reinforcement steel bars.',
      categoryId: rootSteelCat._id,
      subcategoryId: subTmtSteelCat._id,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/products/tata-main.webp'],
      specifications: { Grade: 'Fe 550D', Standard: 'IS 1786:2008' },
      publishedAt: new Date(),
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Variant 1: 12mm TMT Bar
    variant12mm = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      sku: 'THZ-TATA-550D-12MM',
      title: 'Tata Tiscon 12mm TMT Bar (12m Rod)',
      status: 'ACTIVE',
      attributes: { Diameter: '12mm', StandardLength: '12 Metres' },
      images: ['https://assets.thehomez.in/products/tata-12mm.webp'],
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      maxOrderQuantity: '50.00',
      stepIncrement: '0.05',
      publishedAt: new Date(),
    });

    await ProductPricingModel.create({
      productId: multiVariantProduct._id,
      variantId: variant12mm._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      b2cPricePaise: 54000,
      b2cMrpPaise: 58000,
      b2bPricePaise: 51500,
      b2bTiers: [{ minQuantity: '5.05', pricePaise: 50000 }],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Stock for 12mm: PartnerHubEast (24h) and PartnerSteelEast (18h)
    await PartnerProductModel.create({
      partnerId: partnerHubEast._id,
      productId: multiVariantProduct._id,
      variantId: variant12mm._id,
      serviceAreaId: serviceableAreaEast._id,
      isAvailable: true,
      minLeadTimeHours: 24,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    await PartnerProductModel.create({
      partnerId: partnerSteelEast._id,
      productId: multiVariantProduct._id,
      variantId: variant12mm._id,
      serviceAreaId: serviceableAreaEast._id,
      isAvailable: true,
      minLeadTimeHours: 18,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Variant 2: 16mm TMT Bar (Lacks dedicated B2B pricing to test fallback per Decision #30)
    variant16mm = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      sku: 'THZ-TATA-550D-16MM',
      title: 'Tata Tiscon 16mm TMT Bar (12m Rod)',
      status: 'ACTIVE',
      attributes: { Diameter: '16mm', StandardLength: '12 Metres' },
      images: ['https://assets.thehomez.in/products/tata-16mm.webp'],
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      maxOrderQuantity: '50.00',
      stepIncrement: '0.05',
      publishedAt: new Date(),
    });

    await ProductPricingModel.create({
      productId: multiVariantProduct._id,
      variantId: variant16mm._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      b2cPricePaise: 78000,
      b2cMrpPaise: 82000,
      b2bPricePaise: null, // Lacks B2B price -> falls back to b2cPricePaise!
      b2bTiers: [],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Variant 3: Unpriced Variant (Decision #40: must be suppressed from public view!)
    variantUnpriced = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      sku: 'THZ-TATA-550D-20MM',
      title: 'Tata Tiscon 20mm TMT Bar (Unpriced)',
      status: 'ACTIVE',
      attributes: { Diameter: '20mm' },
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      stepIncrement: '0.05',
      publishedAt: new Date(),
    });

    // Out of Stock Product (Has active global pricing, but 0 partners have stock in BLR-EAST)
    outOfStockProduct = await ProductModel.create({
      slug: 'ambuja-plus-cement',
      title: 'Ambuja Plus Roof Special Cement',
      brand: 'Ambuja',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      sku: 'THZ-CEM-AMB-001',
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/products/ambuja.webp'],
      specifications: { Grade: 'PPC' },
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '1',
      publishedAt: new Date(),
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    await ProductPricingModel.create({
      productId: outOfStockProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 39000,
      b2cMrpPaise: 43000,
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Archived Product (Decision #42: strictly excluded from listing and detail)
    archivedProduct = await ProductModel.create({
      slug: 'discontinued-old-cement',
      title: 'Discontinued Old Cement',
      brand: 'OldBrand',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      status: 'ARCHIVED',
      images: [],
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Draft Product (Excluded from public storefront)
    draftProduct = await ProductModel.create({
      slug: 'draft-cement-product',
      title: 'Draft Cement Product',
      brand: 'TestBrand',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      status: 'DRAFT',
      images: [],
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Product under Inactive Category (Decision #4: strictly suppressed)
    inactiveCatProduct = await ProductModel.create({
      slug: 'weather-shield-paint',
      title: 'Weather Shield Exterior Paint',
      brand: 'Asian Paints',
      categoryId: inactiveRootCat._id,
      subcategoryId: inactiveSubCat._id,
      hasVariants: false,
      sku: 'THZ-PNT-ASI-001',
      status: 'ACTIVE',
      images: [],
      unitCode: 'BOX',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      publishedAt: new Date(),
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    await ProductPricingModel.create({
      productId: inactiveCatProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 55000,
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });
  });

  afterAll(async () => {
    isProfiling = false;
    await Promise.all([
      ProductModel.deleteMany({}),
      ProductVariantModel.deleteMany({}),
      ProductPricingModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      ServiceAreaModel.deleteMany({}),
      PartnerModel.deleteMany({}),
      PartnerProductModel.deleteMany({}),
      UserModel.deleteMany({}),
    ]);
    await disconnectDatabase();
  });

  function startProfiling(): void {
    queryLogs.length = 0;
    isProfiling = true;
  }

  function stopProfiling(): MongooseQueryLog[] {
    isProfiling = false;
    return [...queryLogs];
  }

  // =========================================================================
  // 1. Unlocalized Browsing Semantics (Decision #48)
  // =========================================================================
  describe('1. Unlocalized Catalog Browsing (Decision #48)', () => {
    it('returns active products with availabilityUnknown: true and isAvailable: null', async () => {
      const response = await service.listProducts({ page: 1, limit: 10 });

      expect(response.localization.isLocalized).toBe(false);
      expect(response.localization.pincode).toBeNull();
      expect(response.items.length).toBeGreaterThan(0);

      for (const item of response.items) {
        expect(item.availability.availabilityUnknown).toBe(true);
        expect(item.availability.isAvailable).toBeNull();
        expect(item.availability.serviceAreaId).toBeNull();
        expect(item.availability.minLeadTimeHours).toBeNull();
        expect(item.availability.availablePartnerCount).toBeNull();
      }
    });

    it('returns retail B2C integer paise for unauthenticated callers', async () => {
      const response = await service.listProducts({ page: 1, limit: 10 });
      const cementCard = response.items.find((i) => i.slug === 'ultratech-super-cement')!;

      expect(cementCard.hasVariants).toBe(false);
      if (!cementCard.hasVariants) {
        expect(cementCard.pricing.customerSegment).toBe('B2C');
        expect(cementCard.pricing.pricePaise).toBe(38000); // Global B2C price
        expect(cementCard.pricing.mrpPaise).toBe(42000);
        expect(cementCard.pricing.savingsPaise).toBe(4000);
        expect(cementCard.pricing.discountPercentage).toBe(9.52);
        expect(cementCard.pricing.isRegionalOverride).toBe(false);
        expect(cementCard.pricing.hasVolumeTiers).toBe(false);
        expect(cementCard.pricing.b2bTiers).toBeUndefined();
      }
    });

    it('returns dynamic price ranges for multi-variant products', async () => {
      const response = await service.listProducts({ page: 1, limit: 10 });
      const steelCard = response.items.find((i) => i.slug === 'tata-tiscon-550d-tmt-bars')!;

      expect(steelCard.hasVariants).toBe(true);
      if (steelCard.hasVariants) {
        expect(steelCard.variantCount).toBe(2); // 12mm & 16mm (20mm is unpriced and suppressed)
        expect(steelCard.priceRange.minPricePaise).toBe(54000); // 12mm B2C price
        expect(steelCard.priceRange.maxPricePaise).toBe(78000); // 16mm B2C price
        expect(steelCard.priceRange.currency).toBe('INR');
      }
    });
  });

  // =========================================================================
  // 2. Localized Serviceable Browsing (Decisions #48, #49) & Regional Overrides
  // =========================================================================
  describe('2. Localized Serviceable Stock & Regional Pricing (Decisions #31, #38, #48, #49)', () => {
    it('resolves active service area and computes partner availability and min lead time', async () => {
      const response = await service.listProducts({
        pincode: '560037',
        page: 1,
        limit: 10,
      });

      expect(response.localization.isLocalized).toBe(true);
      expect(response.localization.isServiceable).toBe(true);
      expect(response.localization.serviceAreaName).toBe('Bangalore East Hub');

      // Standalone in stock (Partner Hub East: 12h)
      const cementCard = response.items.find((i) => i.slug === 'ultratech-super-cement')!;
      expect(cementCard.availability.availabilityUnknown).toBe(false);
      expect(cementCard.availability.isAvailable).toBe(true);
      expect(cementCard.availability.serviceAreaId).toBe(serviceableAreaEast._id.toString());
      expect(cementCard.availability.minLeadTimeHours).toBe(12);
      expect(cementCard.availability.availablePartnerCount).toBe(1);

      // Applies regional pricing override (₹375.00 instead of ₹380.00 global)
      if (!cementCard.hasVariants) {
        expect(cementCard.pricing.pricePaise).toBe(37500);
        expect(cementCard.pricing.isRegionalOverride).toBe(true);
      }

      // Multi-variant in stock: variant 12mm has PartnerHubEast (24h) and PartnerSteelEast (18h)
      const steelCard = response.items.find((i) => i.slug === 'tata-tiscon-550d-tmt-bars')!;
      expect(steelCard.availability.isAvailable).toBe(true);
      expect(steelCard.availability.minLeadTimeHours).toBe(18); // Minimum lead time
      expect(steelCard.availability.availablePartnerCount).toBe(2); // 2 distinct partners
    });

    it('returns isAvailable: false when 0 partners have declared stock in area', async () => {
      const response = await service.listProducts({
        pincode: '560037',
        page: 1,
        limit: 10,
      });

      const ambujaCard = response.items.find((i) => i.slug === 'ambuja-plus-cement')!;
      expect(ambujaCard.availability.availabilityUnknown).toBe(false);
      expect(ambujaCard.availability.isAvailable).toBe(false);
      expect(ambujaCard.availability.serviceAreaId).toBe(serviceableAreaEast._id.toString());
      expect(ambujaCard.availability.minLeadTimeHours).toBeNull();
      expect(ambujaCard.availability.availablePartnerCount).toBe(0);
    });

    it('handles serviceable area with 0 active partners gracefully', async () => {
      // PIN 560010 is mapped to BLR-WEST which has 0 active partners
      const response = await service.listProducts({
        pincode: '560010',
        page: 1,
        limit: 10,
      });

      expect(response.localization.isServiceable).toBe(true);
      expect(response.localization.serviceAreaName).toBe('Bangalore West Hub');

      for (const item of response.items) {
        expect(item.availability.isAvailable).toBe(false);
        expect(item.availability.availablePartnerCount).toBe(0);
      }
    });
  });

  // =========================================================================
  // 3. Unserviceable PIN Localization (Decision #50)
  // =========================================================================
  describe('3. Unserviceable PIN Handling (Decision #50)', () => {
    it('returns isAvailable: false, serviceAreaId: null, and informative message', async () => {
      // 999999 is valid 6-digit Indian PIN format, but unmapped to any service area
      const response = await service.listProducts({
        pincode: '999999',
        page: 1,
        limit: 10,
      });

      expect(response.localization.isLocalized).toBe(true);
      expect(response.localization.isServiceable).toBe(false);
      expect(response.localization.serviceAreaId).toBeNull();

      for (const item of response.items) {
        expect(item.availability.availabilityUnknown).toBe(false);
        expect(item.availability.isAvailable).toBe(false);
        expect(item.availability.serviceAreaId).toBeNull();
        expect(item.availability.minLeadTimeHours).toBeNull();
        expect(item.availability.availablePartnerCount).toBe(0);
        expect(item.availability.message).toBe('Delivery not available in this area');
      }
    });
  });

  // =========================================================================
  // 4. Commercial B2B Segmentation & Wholesale Fallback (Decision #30)
  // =========================================================================
  describe('4. Verified B2B Wholesale Pricing (Decision #30)', () => {
    it('provides verified B2B contractor with wholesale base rates and volume tiers', async () => {
      const response = await service.listProducts(
        { pincode: '560037', page: 1, limit: 10 },
        { userId: b2bContractor._id.toString() },
      );

      const cementCard = response.items.find((i) => i.slug === 'ultratech-super-cement')!;

      if (!cementCard.hasVariants) {
        expect(cementCard.pricing.customerSegment).toBe('B2B');
        expect(cementCard.pricing.pricePaise).toBe(34500); // Regional B2B rate
        expect(cementCard.pricing.retailBenchmarkPaise).toBe(37500); // Regional retail comparison
        expect(cementCard.pricing.hasVolumeTiers).toBe(true);
        expect(cementCard.pricing.b2bTiers).toEqual([{ minQuantity: '100', pricePaise: 33500 }]);
      }
    });

    it('applies automatic B2B fallback to B2C price when item lacks B2B price (Decision #30)', async () => {
      const detail = await service.getProductBySlug('tata-tiscon-550d-tmt-bars', '560037', {
        userId: b2bContractor._id.toString(),
      });

      // 16mm variant has b2bPricePaise: null -> falls back to b2cPricePaise (78000)
      const variant16 = detail.variants.find((v) => v.sku === 'THZ-TATA-550D-16MM')!;
      expect(variant16.pricing.customerSegment).toBe('B2B');
      expect(variant16.pricing.pricePaise).toBe(78000); // Fallback to B2C retail price
      expect(variant16.pricing.hasVolumeTiers).toBe(false);
      expect(variant16.pricing.retailBenchmarkPaise).toBeUndefined();
    });

    it('enforces instant revocation for suspended B2B accounts (falls back to B2C)', async () => {
      const response = await service.listProducts(
        { pincode: '560037', page: 1, limit: 10 },
        { userId: suspendedB2bUser._id.toString() },
      );

      const cementCard = response.items.find((i) => i.slug === 'ultratech-super-cement')!;
      if (!cementCard.hasVariants) {
        expect(cementCard.pricing.customerSegment).toBe('B2C'); // Instant fallback!
        expect(cementCard.pricing.pricePaise).toBe(37500);
      }
    });
  });

  // =========================================================================
  // 5. Lifecycle Suppression & Taxonomy Barriers (Decisions #4, #40, #42)
  // =========================================================================
  describe('5. Lifecycle Suppression & Taxonomy Barriers (Decisions #4, #40, #42)', () => {
    it('strictly excludes archived and draft products from public discovery', async () => {
      const response = await service.listProducts({ page: 1, limit: 50 });
      const slugs = response.items.map((i) => i.slug);

      expect(slugs.includes('discontinued-old-cement')).toBe(false);
      expect(slugs.includes('draft-cement-product')).toBe(false);
    });

    it('suppresses products under inactive categories immediately (Decision #4)', async () => {
      const response = await service.listProducts({ page: 1, limit: 50 });
      const slugs = response.items.map((i) => i.slug);

      expect(slugs.includes('weather-shield-paint')).toBe(false);

      await expect(service.getProductBySlug('weather-shield-paint')).rejects.toThrow(
        StorefrontError,
      );
    });

    it('suppresses unpriced variants from public variant selector (Decision #40)', async () => {
      const detail = await service.getProductBySlug('tata-tiscon-550d-tmt-bars');
      const skus = detail.variants.map((v) => v.sku);

      expect(skus.includes('THZ-TATA-550D-12MM')).toBe(true);
      expect(skus.includes('THZ-TATA-550D-16MM')).toBe(true);
      expect(skus.includes('THZ-TATA-550D-20MM')).toBe(false); // Unpriced suppressed
    });

    it('throws 404 PRODUCT_NOT_FOUND when accessing archived item by slug', async () => {
      await expect(service.getProductBySlug('discontinued-old-cement')).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  // =========================================================================
  // 6. Filtering, In-Stock Toggle & Sorting
  // =========================================================================
  describe('6. Filtering, In-Stock Toggle & Sorting', () => {
    it('filters strictly by category and subcategory slug', async () => {
      const response = await service.listProducts({
        category: 'cement',
        subcategory: 'ppc-cement',
        page: 1,
        limit: 10,
      });

      for (const item of response.items) {
        expect(item.category.slug).toBe('cement');
        expect(item.subcategory.slug).toBe('ppc-cement');
      }
    });

    it('filters strictly by brand with indexed match', async () => {
      const response = await service.listProducts({
        brand: 'UltraTech',
        page: 1,
        limit: 10,
      });

      for (const item of response.items) {
        expect(item.brand).toBe('UltraTech');
      }
    });

    it('filters in-stock items only when inStockOnly: true', async () => {
      const response = await service.listProducts({
        pincode: '560037',
        inStockOnly: true,
        page: 1,
        limit: 10,
      });

      for (const item of response.items) {
        expect(item.availability.isAvailable).toBe(true);
      }
    });

    it('filters by price range (minPricePaise and maxPricePaise)', async () => {
      const response = await service.listProducts({
        minPricePaise: 35000,
        maxPricePaise: 38000,
        page: 1,
        limit: 10,
      });

      for (const item of response.items) {
        const itemPrice = item.hasVariants
          ? item.priceRange.minPricePaise
          : item.pricing.pricePaise;
        expect(itemPrice).toBeGreaterThanOrEqual(35000);
        expect(itemPrice).toBeLessThanOrEqual(38000);
      }
    });

    it('sorts by price_asc and price_desc deterministically', async () => {
      const ascResponse = await service.listProducts({
        sort: 'price_asc',
        page: 1,
        limit: 10,
      });

      for (let i = 0; i < ascResponse.items.length - 1; i++) {
        const priceA = ascResponse.items[i].hasVariants
          ? ascResponse.items[i].priceRange.minPricePaise
          : ascResponse.items[i].pricing.pricePaise;
        const priceB = ascResponse.items[i + 1].hasVariants
          ? ascResponse.items[i + 1].priceRange.minPricePaise
          : ascResponse.items[i + 1].pricing.pricePaise;
        expect(priceA).toBeLessThanOrEqual(priceB);
      }
    });
  });

  // =========================================================================
  // 7. Full-Text Keyword Search
  // =========================================================================
  describe('7. Keyword Search (searchProducts)', () => {
    it('executes text search matching title and brand with relevance ranking', async () => {
      const searchRes = await service.searchProducts({ q: 'UltraTech Cement' });

      expect(searchRes.items.length).toBeGreaterThan(0);
      const topMatch = searchRes.items[0];
      expect(topMatch.brand).toBe('UltraTech');
    });

    it('supports facets in search when includeFacets: true', async () => {
      const searchRes = await service.searchProducts({
        q: 'Cement',
        includeFacets: true,
      });

      expect(searchRes.facets).toBeDefined();
      expect(searchRes.facets?.brands).toBeDefined();
      expect(searchRes.facets?.subcategories).toBeDefined();
    });
  });

  // =========================================================================
  // 8. Security & Partner Privacy Guard (AC-DISCOV-06, Decisions #46 & #47)
  // =========================================================================
  describe('8. Supplier & Margin Privacy Guard (AC-DISCOV-06)', () => {
    const forbiddenKeys = [
      'partnerId',
      'partnerName',
      'businessName',
      'partnerAddress',
      'warehouseAddress',
      'supplierCost',
      'costPaise',
      'purchasePrice',
      'margin',
      'grossMargin',
      'commissionRate',
      'partnerCustomSku',
      'operationalNotes',
    ];

    it('verifies public product cards and detail responses contain zero partner identities or costs', async () => {
      const listResponse = await service.listProducts({
        pincode: '560037',
        page: 1,
        limit: 10,
      });

      const detailResponse = await service.getProductBySlug('tata-tiscon-550d-tmt-bars', '560037');

      function collectKeys(obj: unknown, keySet: Set<string>): void {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) collectKeys(item, keySet);
          return;
        }
        for (const [k, v] of Object.entries(obj)) {
          keySet.add(k);
          collectKeys(v, keySet);
        }
      }

      const foundKeys = new Set<string>();
      collectKeys(listResponse, foundKeys);
      collectKeys(detailResponse, foundKeys);

      for (const forbidden of forbiddenKeys) {
        expect(
          foundKeys.has(forbidden),
          `Security violation: forbidden key "${forbidden}" exposed in public response!`,
        ).toBe(false);
      }
    });
  });

  // =========================================================================
  // 9. Database Query Budget Profiling & Page-Size Invariance (Step 7B ADR-04)
  // =========================================================================
  describe('9. Database Query Budget Profiling & Page-Size Invariance (Step 7B ADR-04)', () => {
    it('Scenario 1: Unlocalized Guest Listing with mixed variants executes exactly 5 queries', async () => {
      startProfiling();
      await service.listProducts({ page: 1, limit: 10 });
      const logs = stopProfiling();

      // Op 3 (Cat: 1) + Op 4 (Find & Count: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1)
      expect(logs.length).toBe(5);
    });

    it('Scenario 2: Unlocalized Authenticated B2B Listing executes exactly 6 queries', async () => {
      startProfiling();
      await service.listProducts({ page: 1, limit: 10 }, { userId: b2bContractor._id.toString() });
      const logs = stopProfiling();

      // Op 1 (User: 1) + Op 3 (Cat: 1) + Op 4 (Find & Count: 2) + Op 5 (Var: 1) + Op 6 (Price: 1)
      expect(logs.length).toBe(6);
    });

    it('Scenario 3: Localized Unserviceable Guest Listing executes exactly 6 queries', async () => {
      startProfiling();
      await service.listProducts({ pincode: '999999', page: 1, limit: 10 });
      const logs = stopProfiling();

      // Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Find & Count: 2) + Op 5 (Var: 1) + Op 6 (Price: 1)
      expect(logs.length).toBe(6);
    });

    it('Scenario 5: Localized Serviceable Guest Listing executes exactly 8 queries', async () => {
      startProfiling();
      await service.listProducts({ pincode: '560037', page: 1, limit: 10 });
      const logs = stopProfiling();

      // Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Find & Count: 2) + Op 5 (Var: 1) + Op 6 (Price: 1) + Op 7 (Part: 1) + Op 8 (Avail: 1)
      expect(logs.length).toBe(8);
    });

    it('Scenario 6: Localized Serviceable B2B Listing executes exactly 9 queries', async () => {
      startProfiling();
      await service.listProducts(
        { pincode: '560037', page: 1, limit: 10 },
        { userId: b2bContractor._id.toString() },
      );
      const logs = stopProfiling();

      // Op 1 (User: 1) + Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Find & Count: 2) + Op 5 (Var: 1) + Op 6 (Price: 1) + Op 7 (Part: 1) + Op 8 (Avail: 1)
      expect(logs.length).toBe(9);
    });

    it('Scenario 8: Optional Facet Aggregation adds exactly +1 query', async () => {
      startProfiling();
      await service.listProducts({
        pincode: '560037',
        includeFacets: true,
        page: 1,
        limit: 10,
      });
      const logs = stopProfiling();

      // 8 baseline + 1 Op 9 (Facets aggregate) = 9 queries
      expect(logs.length).toBe(9);
    });

    it('Single Product Detail Query Verification (D1 through D4)', async () => {
      // D1: Unlocalized Standalone (3 queries: Cat + Find + Price)
      startProfiling();
      await service.getProductBySlug('ultratech-super-cement');
      expect(stopProfiling().length).toBe(3);

      // D2: Unlocalized B2B Multi-Variant (5 queries: User + Cat + Find + Var + Price)
      startProfiling();
      await service.getProductBySlug('tata-tiscon-550d-tmt-bars', undefined, {
        userId: b2bContractor._id.toString(),
      });
      expect(stopProfiling().length).toBe(5);

      // D3: Localized Serviceable Guest Multi-Variant (7 queries: Area + Cat + Find + Var + Price + Part + Avail)
      startProfiling();
      await service.getProductBySlug('tata-tiscon-550d-tmt-bars', '560037');
      expect(stopProfiling().length).toBe(7);

      // D4: Localized Serviceable B2B Multi-Variant (8 queries: User + Area + Cat + Find + Var + Price + Part + Avail)
      startProfiling();
      await service.getProductBySlug('tata-tiscon-550d-tmt-bars', '560037', {
        userId: b2bContractor._id.toString(),
      });
      expect(stopProfiling().length).toBe(8);
    });

    it('Mathematically proves Constant O(1) query scaling across page sizes N = 10, 20, 50, 100', async () => {
      const pageLimits = [10, 20, 50, 100];
      const counts: number[] = [];

      for (const limit of pageLimits) {
        startProfiling();
        await service.listProducts({
          pincode: '560037',
          page: 1,
          limit,
        });
        counts.push(stopProfiling().length);
      }

      // Assert Q(10) == Q(20) == Q(50) == Q(100) == 8 queries
      expect(counts[0]).toBe(8);
      expect(counts[1]).toBe(8);
      expect(counts[2]).toBe(8);
      expect(counts[3]).toBe(8);
      expect(new Set(counts).size).toBe(1); // Strictly identical query count!
    });
  });

  // =========================================================================
  // 10. explain('executionStats') Index Scan Verification
  // =========================================================================
  describe('10. explain("executionStats") Index Verification', () => {
    it('verifies that brand filter uses IXSCAN on brand_1_status_1 with zero COLLSCAN', async () => {
      const explainRes = (await ProductModel.find({
        status: 'ACTIVE',
        brand: 'UltraTech',
      }).explain('executionStats')) as any;

      const winningPlan = explainRes.queryPlanner.winningPlan;
      const executionStats = explainRes.executionStats;

      // Assert leaf stage or inputStage is an IXSCAN on brand_1_status_1
      const isIxScan =
        winningPlan.stage === 'IXSCAN' ||
        winningPlan.inputStage?.stage === 'IXSCAN' ||
        winningPlan.inputStage?.inputStage?.stage === 'IXSCAN';

      expect(isIxScan).toBe(true);
      expect(winningPlan.stage).not.toBe('COLLSCAN');
      expect(winningPlan.inputStage?.stage).not.toBe('COLLSCAN');
      expect(executionStats.totalDocsExamined).toBeGreaterThan(0);
    });
  });
});
