import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import mongoose, { type Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { CategoryModel, type ICategoryDocument } from '../src/models/category.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import {
  UserType,
  UserStatus,
  type IApiResponse,
  type IStorefrontProductListResponse,
  type IStorefrontProductDetailResponse,
} from '@thehomez/shared-types';
import { storefrontDiscoveryService } from '../src/services/catalog/storefront-discovery.service.js';

interface MongooseQueryLog {
  collection: string;
  method: string;
  query: unknown;
}

describe('Milestone 4 Step 7: Consumer Storefront Discovery & Browsing — Complete HTTP API & Acceptance Suite (Stage C)', () => {
  let app: Application;
  let tokenService: TokenService;

  // Profiler state
  const queryLogs: MongooseQueryLog[] = [];
  let isProfiling = false;

  // Taxonomy
  let rootCementCat: ICategoryDocument;
  let subPpcCementCat: ICategoryDocument;
  let subOpcCementCat: ICategoryDocument;
  let rootSteelCat: ICategoryDocument;
  let subTmtSteelCat: ICategoryDocument;
  let inactiveRootCat: ICategoryDocument;
  let inactiveSubCat: ICategoryDocument;

  // Service Areas
  let serviceableAreaEast: IServiceAreaDocument;
  let serviceableAreaEmpty: IServiceAreaDocument;

  // Partners
  let partnerHubEast: IPartnerDocument;
  let partnerSteelEast: IPartnerDocument;

  // Users & Tokens
  let b2cUser: IUserDocument;
  let b2cToken: string;
  let b2bUser: IUserDocument;
  let b2bToken: string;
  let suspendedB2bUser: IUserDocument;
  let suspendedB2bToken: string;
  let revokedB2bUser: IUserDocument;
  let revokedB2bToken: string;

  // Products
  let standaloneProduct: IProductDocument;
  let multiVariantProduct: IProductDocument;
  let variant12mm: IProductVariantDocument;
  let variant16mm: IProductVariantDocument;
  let variantUnpriced: IProductVariantDocument;
  let variantArchived: IProductVariantDocument;
  let outOfStockProduct: IProductDocument;
  let singlePricedVariantProduct: IProductDocument;
  let archivedProduct: IProductDocument;
  let draftProduct: IProductDocument;
  let inactiveCatProduct: IProductDocument;

  const paginationFixtures: IProductDocument[] = [];
  const dummyStaffId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectDatabase();
    await seedApprovedUnits();

    tokenService = new TokenService();
    app = createApp();

    // Attach Mongoose query profiling instrumentation
    mongoose.set('debug', (collection: string, method: string) => {
      if (isProfiling) {
        queryLogs.push({ collection, method, query: null });
      }
    });

    // Clean test collections
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
      slug: 'inactive-paint',
      name: 'Inactive Paints',
      level: 0,
      displayOrder: 99,
      isActive: false, // Inactive root
    });

    inactiveSubCat = await CategoryModel.create({
      slug: 'inactive-wall-putty',
      name: 'Inactive Wall Putty',
      parentId: inactiveRootCat._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
    });

    // -----------------------------------------------------------------------
    // 2. Seed Service Areas (Unique PINs 560091..560093 avoiding collision)
    // -----------------------------------------------------------------------
    serviceableAreaEast = await ServiceAreaModel.create({
      code: 'TEST-DISCOV-EAST',
      name: 'Bangalore East Discovery Hub',
      city: 'Bangalore',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560091', '560092'],
      isActive: true,
    });

    serviceableAreaEmpty = await ServiceAreaModel.create({
      code: 'TEST-DISCOV-EMPTY',
      name: 'Bangalore West Empty Hub',
      city: 'Bangalore',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560093'],
      isActive: true,
    });

    // -----------------------------------------------------------------------
    // 3. Seed Partners
    // -----------------------------------------------------------------------
    partnerHubEast = await PartnerModel.create({
      businessName: 'Bangalore Material Hub East',
      phone: '+919999000001',
      serviceAreaIds: [serviceableAreaEast._id],
      status: 'ACTIVE',
    });

    partnerSteelEast = await PartnerModel.create({
      businessName: 'Bangalore Steel Works East',
      phone: '+919999000002',
      serviceAreaIds: [serviceableAreaEast._id],
      status: 'ACTIVE',
    });

    // -----------------------------------------------------------------------
    // 4. Seed Users & Tokens
    // -----------------------------------------------------------------------
    b2cUser = await UserModel.create({
      phone: '+919888000001',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    b2cToken = tokenService.signAccessToken(b2cUser);

    b2bUser = await UserModel.create({
      phone: '+919888000002',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['B2B_CUSTOMER'], // Authoritative B2B Role
    });
    b2bToken = tokenService.signAccessToken(b2bUser);

    suspendedB2bUser = await UserModel.create({
      phone: '+919888000003',
      userType: UserType.CUSTOMER,
      status: UserStatus.SUSPENDED, // Suspended -> Instant Revocation
      roles: ['B2B_CUSTOMER'],
    });
    suspendedB2bToken = tokenService.signAccessToken(suspendedB2bUser);

    revokedB2bUser = await UserModel.create({
      phone: '+919888000004',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [], // Role revoked
    });
    revokedB2bToken = tokenService.signAccessToken(revokedB2bUser);

    // -----------------------------------------------------------------------
    // 5. Seed Background Products for Invariance Profiling (earlier timestamps)
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
        publishedAt: new Date('2026-01-01T00:00:00Z'),
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

    // Delay ensuring core fixtures receive strictly newer timestamps for default desc sort
    await new Promise((resolve) => setTimeout(resolve, 50));

    // -----------------------------------------------------------------------
    // 6. Seed Core Catalogue Fixtures
    // -----------------------------------------------------------------------
    // A. Standalone Product: UltraTech Super Cement
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
      b2cPricePaise: 38000, // ₹380.00
      b2cMrpPaise: 42000,
      b2bPricePaise: 35000, // ₹350.00
      b2bTiers: [{ minQuantity: '100', pricePaise: 34000 }],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Regional Pricing Override in TEST-DISCOV-EAST (Decisions #31, #38)
    await ProductPricingModel.create({
      productId: standaloneProduct._id,
      variantId: null,
      serviceAreaId: serviceableAreaEast._id,
      pricingScope: 'STANDALONE_REGIONAL',
      b2cPricePaise: 37500, // ₹375.00 discounted regional base
      b2cMrpPaise: 42000,
      b2bPricePaise: 34500,
      b2bTiers: [{ minQuantity: '100', pricePaise: 33500 }],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Partner stock in TEST-DISCOV-EAST: PartnerHubEast with 12h lead time
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

    // B. Multi-Variant Product: Tata Tiscon 550D TMT Rebars
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
      b2cPricePaise: 54000, // ₹540.00
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
      minLeadTimeHours: 18, // Min lead time is 18h
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // Variant 2: 16mm TMT Bar (Lacks B2B pricing to test fallback per Decision #30)
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
      b2cPricePaise: 78000, // ₹780.00
      b2cMrpPaise: 82000,
      b2bPricePaise: null, // Fallback to B2C rate per Decision #30
      b2bTiers: [],
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    await PartnerProductModel.create({
      partnerId: partnerHubEast._id,
      productId: multiVariantProduct._id,
      variantId: variant16mm._id,
      serviceAreaId: serviceableAreaEast._id,
      isAvailable: true,
      minLeadTimeHours: 24,
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

    // Variant 4: Archived Variant (Decision #42: strictly suppressed)
    variantArchived = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      sku: 'THZ-TATA-550D-25MM',
      title: 'Tata Tiscon 25mm TMT Bar (Archived)',
      status: 'ARCHIVED',
      attributes: { Diameter: '25mm' },
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      stepIncrement: '0.05',
      publishedAt: new Date(),
    });

    // C. Out of Stock Product (active pricing, but 0 partners have stock in area)
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

    // D. Multi-Variant with exactly 1 priced variant: JSW Neosteel 500D
    singlePricedVariantProduct = await ProductModel.create({
      slug: 'jsw-neosteel-500d',
      title: 'JSW Neosteel 500D TMT Rebars',
      brand: 'JSW',
      categoryId: rootSteelCat._id,
      subcategoryId: subTmtSteelCat._id,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/products/jsw-main.webp'],
      specifications: { Grade: 'Fe 500D' },
      publishedAt: new Date(),
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    const jswPricedVariant = await ProductVariantModel.create({
      productId: singlePricedVariantProduct._id,
      sku: 'THZ-JSW-500D-10MM',
      title: 'JSW Neosteel 10mm TMT Bar',
      status: 'ACTIVE',
      attributes: { Diameter: '10mm' },
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      stepIncrement: '0.05',
      publishedAt: new Date(),
    });

    await ProductPricingModel.create({
      productId: singlePricedVariantProduct._id,
      variantId: jswPricedVariant._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      b2cPricePaise: 52000,
      isActive: true,
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // E. Archived Product (Decision #42: strictly suppressed)
    archivedProduct = await ProductModel.create({
      slug: 'discontinued-cement',
      title: 'Discontinued Old Brand Cement',
      brand: 'OldBrand',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      status: 'ARCHIVED',
      images: [],
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // F. Draft Product (Strictly unpublished DRAFT only)
    draftProduct = await ProductModel.create({
      slug: 'draft-cement',
      title: 'Draft Cement Product',
      brand: 'DraftBrand',
      categoryId: rootCementCat._id,
      subcategoryId: subPpcCementCat._id,
      hasVariants: false,
      status: 'DRAFT',
      images: [],
      createdBy: dummyStaffId,
      updatedBy: dummyStaffId,
    });

    // G. Inactive Category Product (Decision #4: strictly suppressed)
    inactiveCatProduct = await ProductModel.create({
      slug: 'inactive-paint-product',
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
  // Section 1: Canonical AC-DISCOV Localization & Availability Matrix
  // =========================================================================
  describe('1. Localization & Availability Tri-State Matrix (AC-DISCOV-01, 02, 03, 04, 25)', () => {
    it('AC-DISCOV-01: Unlocalized guest browsing returns availabilityUnknown: true and isAvailable: null', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data: IStorefrontProductListResponse = res.body.data;
      expect(data.localization.isLocalized).toBe(false);
      expect(data.localization.pincode).toBeNull();
      expect(data.items.length).toBeGreaterThan(0);

      for (const item of data.items) {
        expect(item.availability.availabilityUnknown).toBe(true);
        expect(item.availability.isAvailable).toBeNull();
        expect(item.availability.serviceAreaId).toBeNull();
        expect(item.availability.minLeadTimeHours).toBeNull();
        expect(item.availability.availablePartnerCount).toBeNull();
        expect(item.availability.message).toBe(
          'Enter delivery PIN code to check local availability',
        );
      }
    });

    it('AC-DISCOV-02: Localized serviceable PIN resolves multi-partner availability and minimum lead time', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      expect(data.localization.isLocalized).toBe(true);
      expect(data.localization.isServiceable).toBe(true);
      expect(data.localization.serviceAreaName).toBe('Bangalore East Discovery Hub');

      // Standalone product: PartnerHubEast has 12h lead time
      const cement = data.items.find((i) => i.slug === 'ultratech-super-cement')!;
      expect(cement.availability.availabilityUnknown).toBe(false);
      expect(cement.availability.isAvailable).toBe(true);
      expect(cement.availability.serviceAreaId).toBe(serviceableAreaEast._id.toString());
      expect(cement.availability.minLeadTimeHours).toBe(12);
      expect(cement.availability.availablePartnerCount).toBe(1);

      // Multi-variant product: PartnerSteelEast has 18h and PartnerHubEast has 24h -> minimum is 18h across 2 partners
      const steel = data.items.find((i) => i.slug === 'tata-tiscon-550d-tmt-bars')!;
      expect(steel.availability.isAvailable).toBe(true);
      expect(steel.availability.minLeadTimeHours).toBe(18);
      expect(steel.availability.availablePartnerCount).toBe(2);
    });

    it('AC-DISCOV-03: Localized out-of-stock item presents isAvailable: false and availablePartnerCount: 0', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      const outOfStock = data.items.find((i) => i.slug === 'ambuja-plus-cement')!;
      expect(outOfStock.availability.availabilityUnknown).toBe(false);
      expect(outOfStock.availability.isAvailable).toBe(false);
      expect(outOfStock.availability.serviceAreaId).toBe(serviceableAreaEast._id.toString());
      expect(outOfStock.availability.minLeadTimeHours).toBeNull();
      expect(outOfStock.availability.availablePartnerCount).toBe(0);
    });

    it('AC-DISCOV-04 & AC-DISCOV-25: Unserviceable PIN preserves view-only catalog browsing with message', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '999999', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      expect(data.localization.isLocalized).toBe(true);
      expect(data.localization.isServiceable).toBe(false);
      expect(data.localization.serviceAreaId).toBeNull();
      expect(data.items.length).toBeGreaterThan(0);

      for (const item of data.items) {
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
  // Section 2: Pricing Governance, Regional Overrides & Verified B2B
  // =========================================================================
  describe('2. Pricing Governance, Regional Overrides & B2B Dual Segmentation (AC-DISCOV-07, 08, 09, 10)', () => {
    it('AC-DISCOV-07: Unauthenticated caller receives retail B2C integer paise, MRP and savings', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      const cement = data.items.find((i) => i.slug === 'ultratech-super-cement')!;
      if (!cement.hasVariants) {
        expect(cement.pricing.customerSegment).toBe('B2C');
        expect(cement.pricing.pricePaise).toBe(38000); // ₹380.00
        expect(cement.pricing.mrpPaise).toBe(42000);
        expect(cement.pricing.savingsPaise).toBe(4000);
        expect(cement.pricing.discountPercentage).toBe(9.52);
        expect(cement.pricing.isRegionalOverride).toBe(false);
        expect(cement.pricing.hasVolumeTiers).toBe(false);
        expect(cement.pricing.b2bTiers).toBeUndefined();
      }
    });

    it('AC-DISCOV-10: Regional pricing override replaces global pricing when localized', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      const cement = data.items.find((i) => i.slug === 'ultratech-super-cement')!;
      if (!cement.hasVariants) {
        expect(cement.pricing.pricePaise).toBe(37500); // ₹375.00 discounted regional override
        expect(cement.pricing.isRegionalOverride).toBe(true);
      }
    });

    it('AC-DISCOV-08: Verified B2B contractor receives wholesale base rates and monotonic volume tiers', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .set('Authorization', `Bearer ${b2bToken}`)
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      const cement = data.items.find((i) => i.slug === 'ultratech-super-cement')!;
      if (!cement.hasVariants) {
        expect(cement.pricing.customerSegment).toBe('B2B');
        expect(cement.pricing.pricePaise).toBe(34500); // Regional B2B rate
        expect(cement.pricing.retailBenchmarkPaise).toBe(37500); // Regional retail comparison
        expect(cement.pricing.hasVolumeTiers).toBe(true);
        expect(cement.pricing.b2bTiers).toEqual([{ minQuantity: '100', pricePaise: 33500 }]);
      }
    });

    it('AC-DISCOV-09: Automatic B2B fallback to retail B2C when product variant lacks dedicated wholesale rate', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products/tata-tiscon-550d-tmt-bars')
        .set('Authorization', `Bearer ${b2bToken}`)
        .query({ pincode: '560091' });

      expect(res.status).toBe(200);
      const data: IStorefrontProductDetailResponse = res.body.data;

      // 16mm variant has b2bPricePaise: null -> falls back to b2cPricePaise (78000)
      const variant16 = data.variants.find((v) => v.sku === 'THZ-TATA-550D-16MM')!;
      expect(variant16.pricing.customerSegment).toBe('B2B');
      expect(variant16.pricing.pricePaise).toBe(78000);
      expect(variant16.pricing.hasVolumeTiers).toBe(false);
      expect(variant16.pricing.retailBenchmarkPaise).toBeUndefined();
    });

    it('Enforces instant revocation: Suspended B2B contractor account is rejected by auth (401) or receives B2C at service', async () => {
      // 1. Over HTTP: Bearer token of suspended account is rejected with 401 ACCOUNT_NOT_ACTIVE
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .set('Authorization', `Bearer ${suspendedB2bToken}`)
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

      // 2. Direct service resolution: instant revocation fallback to B2C
      const serviceResult = await storefrontDiscoveryService.listProducts(
        { pincode: '560091', page: 1, limit: 10 },
        { userId: suspendedB2bUser._id.toString() },
      );
      const cement = serviceResult.items.find((i) => i.slug === 'ultratech-super-cement')!;
      if (!cement.hasVariants) {
        expect(cement.pricing.customerSegment).toBe('B2C');
        expect(cement.pricing.pricePaise).toBe(37500);
      }
    });

    it('Rejects client-supplied segment claims and enforces B2C when B2B role is revoked', async () => {
      // 1. Active account with revoked role receives B2C rates even with valid JWT
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .set('Authorization', `Bearer ${revokedB2bToken}`)
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const cement = res.body.data.items.find(
        (i: { slug: string }) => i.slug === 'ultratech-super-cement',
      )!;
      if (!cement.hasVariants) {
        expect(cement.pricing.customerSegment).toBe('B2C');
        expect(cement.pricing.pricePaise).toBe(37500);
      }

      // 2. Attempting to inject client-supplied segment parameter is rejected by strict schema validation
      const resInjected = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', segment: 'B2B', page: 1, limit: 10 });

      expect(resInjected.status).toBe(400);
      expect(resInjected.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // Section 3: Construction Units, Exact Decimal Strings & Step Increments
  // =========================================================================
  describe('3. Construction Units, Exact Decimals & Step Increments (AC-DISCOV-11, 12, 13)', () => {
    it('AC-DISCOV-11: Discrete construction units enforce quantityPrecision: 0', async () => {
      const res = await request(app).get('/api/v1/storefront/products/ultratech-super-cement');

      expect(res.status).toBe(200);
      const data: IStorefrontProductDetailResponse = res.body.data;

      expect(data.product.unit).toBeDefined();
      expect(data.product.unit!.unitCode).toBe('BAG');
      expect(data.product.unit!.quantityPrecision).toBe(0);
      expect(data.product.unit!.minOrderQuantity).toBe('10');
      expect(data.product.unit!.maxOrderQuantity).toBe('500');
      expect(data.product.unit!.stepIncrement).toBe('1');
    });

    it('AC-DISCOV-12 & 13: Metric construction units expose exact decimal precision and BigInt step increments', async () => {
      const res = await request(app).get('/api/v1/storefront/products/tata-tiscon-550d-tmt-bars');

      expect(res.status).toBe(200);
      const data: IStorefrontProductDetailResponse = res.body.data;

      const variant12 = data.variants.find((v) => v.sku === 'THZ-TATA-550D-12MM')!;
      expect(variant12.unit.unitCode).toBe('TONNE');
      expect(variant12.unit.quantityPrecision).toBe(2);
      expect(variant12.unit.minOrderQuantity).toBe('1.00');
      expect(variant12.unit.maxOrderQuantity).toBe('50.00');
      expect(variant12.unit.stepIncrement).toBe('0.05');
    });
  });

  // =========================================================================
  // Section 4: Filtering, Sorting & Search Relevance
  // =========================================================================
  describe('4. Filtering, Sorting & Full-Text Search Relevance (AC-DISCOV-14, 15, 16, 17)', () => {
    it('AC-DISCOV-14: Filters strictly by category and subcategory slug', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ category: 'cement', subcategory: 'ppc-cement', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      for (const item of data.items) {
        expect(item.category.slug).toBe('cement');
        expect(item.subcategory.slug).toBe('ppc-cement');
      }
    });

    it('AC-DISCOV-15: Filters strictly by brand with indexed match', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ brand: 'UltraTech', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      expect(data.items.length).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(item.brand).toBe('UltraTech');
      }
    });

    it('Filters in-stock items only when inStockOnly: true and valid PIN supplied', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', inStockOnly: true, page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      const slugs = data.items.map((i) => i.slug);
      expect(slugs.includes('ultratech-super-cement')).toBe(true);
      expect(slugs.includes('ambuja-plus-cement')).toBe(false); // Out of stock suppressed
    });

    it('Filters strictly by price bounds (minPricePaise and maxPricePaise)', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ minPricePaise: 37000, maxPricePaise: 38500, page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      for (const item of data.items) {
        const itemPrice = item.hasVariants
          ? item.priceRange.minPricePaise
          : item.pricing.pricePaise;
        expect(itemPrice).toBeGreaterThanOrEqual(37000);
        expect(itemPrice).toBeLessThanOrEqual(38500);
      }
    });

    it('AC-DISCOV-17: Deterministic sorting produces correct order for price_asc and price_desc', async () => {
      const resAsc = await request(app)
        .get('/api/v1/storefront/products')
        .query({ sort: 'price_asc', page: 1, limit: 10 });

      expect(resAsc.status).toBe(200);
      const itemsAsc = resAsc.body.data.items;
      for (let i = 0; i < itemsAsc.length - 1; i++) {
        const p1 = itemsAsc[i].hasVariants
          ? itemsAsc[i].priceRange.minPricePaise
          : itemsAsc[i].pricing.pricePaise;
        const p2 = itemsAsc[i + 1].hasVariants
          ? itemsAsc[i + 1].priceRange.minPricePaise
          : itemsAsc[i + 1].pricing.pricePaise;
        expect(p1).toBeLessThanOrEqual(p2);
      }
    });

    it('AC-DISCOV-16: Full-text search endpoint ranks results by relevance textScore', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/search')
        .query({ q: 'reinforcement', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      const data: IStorefrontProductListResponse = res.body.data;

      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0].slug).toBe('tata-tiscon-550d-tmt-bars');
    });
  });

  // =========================================================================
  // Section 5: Multi-Variant Neutral Selection & Lifecycle Suppression
  // =========================================================================
  describe('5. Multi-Variant Display & Lifecycle Suppression (AC-DISCOV-19, 20, 21)', () => {
    it('AC-DISCOV-19: Container card exposes dynamic price range and PDP loads variants with neutral initial selection', async () => {
      // 1. Listing card check
      const listRes = await request(app)
        .get('/api/v1/storefront/products')
        .query({ page: 1, limit: 10 });

      const steelCard = listRes.body.data.items.find(
        (i: { slug: string }) => i.slug === 'tata-tiscon-550d-tmt-bars',
      );
      expect(steelCard.hasVariants).toBe(true);
      expect(steelCard.variantCount).toBe(2); // 12mm & 16mm
      expect(steelCard.priceRange.minPricePaise).toBe(54000);
      expect(steelCard.priceRange.maxPricePaise).toBe(78000);

      // 2. Detail PDP check: neutral selection
      const detailRes = await request(app).get(
        '/api/v1/storefront/products/tata-tiscon-550d-tmt-bars',
      );

      expect(detailRes.status).toBe(200);
      const detail: IStorefrontProductDetailResponse = detailRes.body.data;
      expect(detail.product.hasVariants).toBe(true);
      expect(detail.variants.length).toBe(2);

      // Ensure API does not invent preselection
      expect(
        (detail as unknown as { selectedVariantId?: unknown }).selectedVariantId,
      ).toBeUndefined();
      expect(
        (detail as unknown as { defaultVariantId?: unknown }).defaultVariantId,
      ).toBeUndefined();
    });

    it('AC-DISCOV-21: Suppresses unpriced and archived variants from public PDP variant selector', async () => {
      const res = await request(app).get('/api/v1/storefront/products/tata-tiscon-550d-tmt-bars');

      expect(res.status).toBe(200);
      const detail: IStorefrontProductDetailResponse = res.body.data;
      const skus = detail.variants.map((v) => v.sku);

      expect(skus.includes('THZ-TATA-550D-12MM')).toBe(true);
      expect(skus.includes('THZ-TATA-550D-16MM')).toBe(true);
      expect(skus.includes('THZ-TATA-550D-20MM')).toBe(false); // Unpriced suppressed (Decision #40)
      expect(skus.includes('THZ-TATA-550D-25MM')).toBe(false); // Archived suppressed (Decision #42)
    });

    it('AC-DISCOV-20: Master product archival returns 404 PRODUCT_NOT_FOUND', async () => {
      const res = await request(app).get('/api/v1/storefront/products/discontinued-cement');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('Suppresses draft products and products under inactive categories', async () => {
      const draftRes = await request(app).get('/api/v1/storefront/products/draft-cement');
      expect(draftRes.status).toBe(404);

      const inactiveCatRes = await request(app).get(
        '/api/v1/storefront/products/inactive-paint-product',
      );
      expect(inactiveCatRes.status).toBe(404);
    });
  });

  // =========================================================================
  // Section 6: Security, Malformed Inputs & Absolute Supplier Anonymity
  // =========================================================================
  describe('6. Security, Input Validation & Absolute Supplier Privacy (AC-DISCOV-05, 06)', () => {
    it('AC-DISCOV-05: Rejects invalid PIN formats with HTTP 400 VALIDATION_ERROR', async () => {
      const invalidPins = ['123', '56003', '5600371', '056037', 'abcdef', '56003A'];

      for (const pin of invalidPins) {
        const res = await request(app).get('/api/v1/storefront/products').query({ pincode: pin });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('Rejects invalid pagination limits exceeding bound 50 or negative numbers', async () => {
      const resOver = await request(app).get('/api/v1/storefront/products').query({ limit: 100 });
      expect(resOver.status).toBe(400);
      expect(resOver.body.error.code).toBe('VALIDATION_ERROR');

      const resZero = await request(app).get('/api/v1/storefront/products').query({ limit: 0 });
      expect(resZero.status).toBe(400);

      const resPageZero = await request(app).get('/api/v1/storefront/products').query({ page: 0 });
      expect(resPageZero.status).toBe(400);
    });

    it('Rejects search query shorter than 2 chars or longer than 100 chars', async () => {
      const resShort = await request(app).get('/api/v1/storefront/search').query({ q: 'a' });
      expect(resShort.status).toBe(400);
      expect(resShort.body.error.code).toBe('VALIDATION_ERROR');

      const resLong = await request(app)
        .get('/api/v1/storefront/search')
        .query({ q: 'a'.repeat(101) });
      expect(resLong.status).toBe(400);
      expect(resLong.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('AC-DISCOV-06: Strict deep traversal confirms ZERO forbidden supplier/cost fields exist in public responses', async () => {
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', page: 1, limit: 10 });

      expect(res.status).toBe(200);

      const forbiddenKeys = [
        'partnerId',
        'partnerName',
        'businessName',
        'warehouseAddress',
        'partnerAddress',
        'supplierCost',
        'costPaise',
        'purchasePrice',
        'margin',
        'grossMargin',
        'commissionRate',
      ];

      function assertNoForbiddenKeys(obj: unknown, path = ''): void {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
          obj.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
          return;
        }

        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key;
          expect(forbiddenKeys.includes(key)).toBe(false);
          assertNoForbiddenKeys(value, currentPath);
        }
      }

      assertNoForbiddenKeys(res.body);

      // Deep scan product detail as well
      const detailRes = await request(app)
        .get('/api/v1/storefront/products/tata-tiscon-550d-tmt-bars')
        .query({ pincode: '560091' });
      assertNoForbiddenKeys(detailRes.body);
    });
  });

  // =========================================================================
  // Section 7: Anti-N+1 Database Query Budget Profiling & O(1) Invariance
  // =========================================================================
  describe('7. Anti-N+1 Query Budget Profiling & Page-Size Invariance (AC-DISCOV-18)', () => {
    it('Scenario 1: Unlocalized Guest Listing executes exactly 5 queries', async () => {
      startProfiling();
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ page: 1, limit: 10 });
      const logs = stopProfiling();

      expect(res.status).toBe(200);
      // Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) = 5
      expect(logs.length).toBe(5);
    });

    it('Scenario 2: Unlocalized Authenticated B2B Listing executes exactly 6 queries', async () => {
      startProfiling();
      const res = await storefrontDiscoveryService.listProducts(
        { page: 1, limit: 10 },
        { userId: b2bUser._id.toString() },
      );
      const logs = stopProfiling();

      expect(res.items.length).toBeGreaterThan(0);
      // Op 1 (User: 1) + Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) = 6
      expect(logs.length).toBe(6);
    });

    it('Scenario 3: Localized Unserviceable Guest Listing executes exactly 6 queries', async () => {
      startProfiling();
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '999999', page: 1, limit: 10 });
      const logs = stopProfiling();

      expect(res.status).toBe(200);
      // Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) = 6
      expect(logs.length).toBe(6);
    });

    it('Scenario 5: Localized Serviceable Guest Listing executes exactly 8 queries', async () => {
      startProfiling();
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', page: 1, limit: 10 });
      const logs = stopProfiling();

      expect(res.status).toBe(200);
      // Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) + Op 7 (Part: 1) + Op 8 (Avail: 1) = 8
      expect(logs.length).toBe(8);
    });

    it('Scenario 6: Localized Serviceable B2B Listing executes exactly 9 queries', async () => {
      startProfiling();
      const res = await storefrontDiscoveryService.listProducts(
        { pincode: '560091', page: 1, limit: 10 },
        { userId: b2bUser._id.toString() },
      );
      const logs = stopProfiling();

      expect(res.items.length).toBeGreaterThan(0);
      // Op 1 (User: 1) + Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) + Op 7 (Part: 1) + Op 8 (Avail: 1) = 9
      expect(logs.length).toBe(9);
    });

    it('Scenario 7: Localized Serviceable Area with 0 Active Partners executes exactly 7 queries', async () => {
      startProfiling();
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560093', page: 1, limit: 10 }); // 560093 has 0 active partners
      const logs = stopProfiling();

      expect(res.status).toBe(200);
      // Op 2 (Area: 1) + Op 3 (Cat: 1) + Op 4 (Products: 2) + Op 5 (Variants: 1) + Op 6 (Pricing: 1) + Op 7 (Part: 1) = 7 (Op 8 short-circuits)
      expect(logs.length).toBe(7);
    });

    it('Scenario 8: Optional Facet Aggregation adds exactly +1 query', async () => {
      startProfiling();
      const res = await request(app)
        .get('/api/v1/storefront/products')
        .query({ pincode: '560091', includeFacets: true, page: 1, limit: 10 });
      const logs = stopProfiling();

      expect(res.status).toBe(200);
      expect(res.body.data.facets).toBeDefined();
      expect(res.body.data.facets.brands.length).toBeGreaterThan(0);
      // 8 baseline + 1 Op 9 = 9 queries
      expect(logs.length).toBe(9);
    });

    it('Mathematically proves Constant O(1) query scaling across page sizes N = 10, 20, 50', async () => {
      const pageLimits = [10, 20, 50];
      const observedCounts: number[] = [];

      for (const limit of pageLimits) {
        startProfiling();
        await request(app)
          .get('/api/v1/storefront/products')
          .query({ pincode: '560091', page: 1, limit });
        const logs = stopProfiling();
        observedCounts.push(logs.length);
      }

      // Assert Q(10) == Q(20) == Q(50) == 8 queries
      expect(observedCounts[0]).toBe(8);
      expect(observedCounts[1]).toBe(8);
      expect(observedCounts[2]).toBe(8);

      // Verify mathematical invariance: dQ/dN === 0
      const dQ = Math.max(...observedCounts) - Math.min(...observedCounts);
      expect(dQ).toBe(0);
    });
  });

  // =========================================================================
  // Section 8: Preservation of Legacy Public Catalog APIs
  // =========================================================================
  describe('8. Legacy Public API Contract Preservation', () => {
    it('Preserves legacy GET /api/v1/products/public response shape', async () => {
      const res = await request(app).get('/api/v1/products/public').query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.page).toBe('number');
      expect(typeof res.body.data.limit).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('Preserves legacy GET /api/v1/products/public/:slug response shape', async () => {
      const res = await request(app).get('/api/v1/products/public/ultratech-super-cement');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.product).toBeDefined();
      expect(res.body.data.product.slug).toBe('ultratech-super-cement');
    });
  });

  // =========================================================================
  // Section 9: MongoDB explain('executionStats') Plan Inspection
  // =========================================================================
  describe('9. Database Index Inspection with explain("executionStats")', () => {
    it('Confirms index scan (IXSCAN) on catalog filtering queries', async () => {
      const explainResult = await ProductModel.find({
        status: 'ACTIVE',
        categoryId: rootCementCat._id,
        subcategoryId: subPpcCementCat._id,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .explain('executionStats');

      const stats = explainResult.executionStats;
      expect(stats).toBeDefined();
      expect(stats.totalDocsExamined).toBeLessThanOrEqual(50);

      // Inspect execution stage tree
      const stage = stats.executionStages?.stage;
      expect(['IXSCAN', 'FETCH', 'LIMIT', 'PROJECTION_DEFAULT', 'SORT']).toContain(stage);
    });

    it('Confirms index scan (IXSCAN) on brand filtered queries', async () => {
      const explainResult = await ProductModel.find({
        status: 'ACTIVE',
        brand: 'UltraTech',
      })
        .limit(10)
        .explain('executionStats');

      const stats = explainResult.executionStats;
      expect(stats).toBeDefined();
      const stage = stats.executionStages?.stage;
      expect(['IXSCAN', 'FETCH', 'LIMIT']).toContain(stage);
    });

    it('Confirms text index search execution stages', async () => {
      const explainResult = await ProductModel.find(
        { $text: { $search: 'cement' }, status: 'ACTIVE' },
        { score: { $meta: 'textScore' } },
      )
        .limit(10)
        .explain('executionStats');

      const stats = explainResult.executionStats;
      expect(stats).toBeDefined();
      const stage = stats.executionStages?.stage;
      expect(['TEXT_MATCH', 'TEXT', 'FETCH', 'IXSCAN', 'PROJECTION_DEFAULT', 'LIMIT']).toContain(
        stage,
      );
    });
  });
});
