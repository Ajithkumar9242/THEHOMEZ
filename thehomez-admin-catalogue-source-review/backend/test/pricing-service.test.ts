import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import {
  PricingService,
  PricingError,
  toPricingDto,
  toPriceHistoryDto,
} from '../src/services/pricing/index.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { UserModel } from '../src/models/user.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { UserType, UserStatus } from '@thehomez/shared-types';

describe('Milestone 4 Step 5: Substep 5.4 — PricingService Transactional Domain & History Tests', () => {
  const pricingService = new PricingService();

  let categoryId: Types.ObjectId;
  let serviceAreaId: Types.ObjectId;
  let inactiveServiceAreaId: Types.ObjectId;

  // Actors
  let adminUserId: Types.ObjectId; // CATALOG_MANAGER (has pricing:write & pricing:read)
  let unauthorizedStaffUserId: Types.ObjectId; // FINANCE_OFFICER (lacks pricing:write & pricing:read)
  let suspendedStaffUserId: Types.ObjectId;
  let customerUserId: Types.ObjectId;
  let partnerUserId: Types.ObjectId;

  // Products
  let standaloneProduct: IProductDocument;
  let multiVariantParent: IProductDocument;
  let childVariant1: IProductVariantDocument;
  let childVariant2: IProductVariantDocument;
  let foreignMultiVariantParent: IProductDocument;
  let foreignVariant: IProductVariantDocument;

  beforeAll(async () => {
    await connectDatabase();

    // 0. Seed RBAC roles
    const rbacService = new RbacService();
    await rbacService.seedDefaultRoles();

    // 1. Fixture: Category
    const category = await CategoryModel.create({
      code: `CAT_PS_${Date.now()}`,
      name: 'Pricing Service Category',
      slug: `pricing-service-cat-${Date.now()}`,
      isActive: true,
      displayOrder: 1,
    });
    categoryId = category._id;

    // 2. Fixture: Active Service Area with PIN 609201
    const serviceArea = await ServiceAreaModel.create({
      code: `SA_PS_ACT_${Date.now()}`,
      name: 'Pricing Service Area Active',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincodes: ['609201'],
      isActive: true,
    });
    serviceAreaId = serviceArea._id;

    // 3. Fixture: Inactive Service Area with PIN 609202
    const inactiveServiceArea = await ServiceAreaModel.create({
      code: `SA_PS_INACT_${Date.now()}`,
      name: 'Pricing Service Area Inactive',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincodes: ['609202'],
      isActive: false,
    });
    inactiveServiceAreaId = inactiveServiceArea._id;

    // 4. Fixture: Admin User (CATALOG_MANAGER - holds pricing:write and pricing:read)
    const adminUser = await UserModel.create({
      phone: `+9199999${Math.floor(10000 + Math.random() * 90000)}`,
      email: `admin-pricing-${Date.now()}@thehomez.in`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_MANAGER'],
    });
    adminUserId = adminUser._id;

    // 5. Fixture: Unauthorized Staff User (FINANCE_OFFICER - lacks pricing:write and pricing:read)
    const unauthStaff = await UserModel.create({
      phone: `+9188888${Math.floor(10000 + Math.random() * 90000)}`,
      email: `finance-pricing-${Date.now()}@thehomez.in`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['FINANCE_OFFICER'],
    });
    unauthorizedStaffUserId = unauthStaff._id;

    // 6. Fixture: Suspended Staff User
    const suspendedStaff = await UserModel.create({
      phone: `+9177777${Math.floor(10000 + Math.random() * 90000)}`,
      email: `suspended-pricing-${Date.now()}@thehomez.in`,
      userType: UserType.STAFF,
      status: UserStatus.SUSPENDED,
      roles: ['CATALOG_MANAGER'],
    });
    suspendedStaffUserId = suspendedStaff._id;

    // 7. Fixture: Customer User
    const customerUser = await UserModel.create({
      phone: `+9166666${Math.floor(10000 + Math.random() * 90000)}`,
      email: `customer-pricing-${Date.now()}@thehomez.in`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['B2B_CUSTOMER'],
    });
    customerUserId = customerUser._id;

    // 8. Fixture: Partner User
    const partnerUser = await UserModel.create({
      phone: `+9155555${Math.floor(10000 + Math.random() * 90000)}`,
      email: `partner-pricing-${Date.now()}@thehomez.in`,
      userType: UserType.PARTNER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    partnerUserId = partnerUser._id;

    // 9. Fixture: Standalone Product (Single SKU, hasVariants: false)
    standaloneProduct = await ProductModel.create({
      title: 'UltraTech OPC 53 Grade Cement',
      slug: `ultratech-opc-53-${Date.now()}`,
      brand: 'UltraTech Cement',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-OPC53-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    // 10. Fixture: Multi-Variant Parent Product (hasVariants: true, sku: null)
    multiVariantParent = await ProductModel.create({
      title: 'Tata Tiscon Fe 550D TMT Rebars',
      slug: `tata-tiscon-rebars-${Date.now()}`,
      brand: 'Tata Steel',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'BUNDLE',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    // Child Variants
    childVariant1 = await ProductVariantModel.create({
      productId: multiVariantParent._id,
      title: '12mm TMT Rebar Bundle',
      sku: `THZ-V-12MM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: new Map([['diameter', '12mm']]),
      unitCode: 'BUNDLE',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    childVariant2 = await ProductVariantModel.create({
      productId: multiVariantParent._id,
      title: '16mm TMT Rebar Bundle',
      sku: `THZ-V-16MM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: new Map([['diameter', '16mm']]),
      unitCode: 'BUNDLE',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    // Foreign Product & Variant
    foreignMultiVariantParent = await ProductModel.create({
      title: 'Foreign Parent Product',
      slug: `foreign-parent-${Date.now()}`,
      brand: 'Foreign',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'PIECE',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    foreignVariant = await ProductVariantModel.create({
      productId: foreignMultiVariantParent._id,
      title: 'Foreign Variant',
      sku: `THZ-V-FOREIGN-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: new Map([['type', 'special']]),
      unitCode: 'PIECE',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });
  });

  afterAll(async () => {
    const productIds = [
      standaloneProduct?._id,
      multiVariantParent?._id,
      foreignMultiVariantParent?._id,
    ].filter(Boolean);

    if (productIds.length > 0) {
      await ProductPricingModel.collection.deleteMany({
        productId: { $in: productIds },
      });
      await PriceHistoryModel.collection.deleteMany({
        productId: { $in: productIds },
      });
      await ProductVariantModel.collection.deleteMany({
        productId: { $in: productIds },
      });
      await ProductModel.collection.deleteMany({
        _id: { $in: productIds },
      });
    }

    if (categoryId) {
      await CategoryModel.collection.deleteOne({ _id: categoryId });
    }
    if (serviceAreaId) {
      await ServiceAreaModel.collection.deleteOne({ _id: serviceAreaId });
    }
    if (inactiveServiceAreaId) {
      await ServiceAreaModel.collection.deleteOne({ _id: inactiveServiceAreaId });
    }

    const userIds = [
      adminUserId,
      unauthorizedStaffUserId,
      suspendedStaffUserId,
      customerUserId,
      partnerUserId,
    ].filter(Boolean);
    if (userIds.length > 0) {
      await UserModel.collection.deleteMany({ _id: { $in: userIds } });
    }

    await disconnectDatabase();
  });

  // =========================================================================
  // 1. Authorization & Actor Identity Verification (Zero Client Trust)
  // =========================================================================
  describe('Actor Authorization & Role Verification', () => {
    it('rejects unauthenticated caller (null authContext) with HTTP 401 UNAUTHORIZED', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 38000,
            changeReason: 'Price update attempt',
          },
          null,
        );
        expect.unreachable('Should have rejected unauthenticated caller');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(401);
        expect(pErr.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects customer user calling price mutation with HTTP 403 FORBIDDEN', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 38000,
            changeReason: 'Customer attempting price write',
          },
          customerUserId.toString(),
        );
        expect.unreachable('Should have rejected customer user');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(403);
        expect(pErr.code).toBe('FORBIDDEN');
      }
    });

    it('rejects partner user calling price mutation with HTTP 403 FORBIDDEN', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 38000,
            changeReason: 'Partner attempting price write',
          },
          partnerUserId.toString(),
        );
        expect.unreachable('Should have rejected partner user');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(403);
        expect(pErr.code).toBe('FORBIDDEN');
      }
    });

    it('rejects staff user without pricing:write (FINANCE_OFFICER) with HTTP 403 FORBIDDEN', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 38000,
            changeReason: 'Finance staff attempting price write',
          },
          unauthorizedStaffUserId.toString(),
        );
        expect.unreachable('Should have rejected staff lacking pricing:write');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(403);
        expect(pErr.code).toBe('FORBIDDEN');
      }
    });

    it('rejects suspended staff user with HTTP 403 FORBIDDEN', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 38000,
            changeReason: 'Suspended staff attempting price write',
          },
          suspendedStaffUserId.toString(),
        );
        expect.unreachable('Should have rejected suspended staff');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(403);
        expect(pErr.code).toBe('FORBIDDEN');
      }
    });
  });

  // =========================================================================
  // 2. Standalone Product Transactional Creation & Updates
  // =========================================================================
  describe('Standalone Product Pricing Mutations', () => {
    it('creates initial standalone global pricing atomically with PriceHistory (action: CREATED)', async () => {
      const result = await pricingService.setStandalonePricing(
        standaloneProduct._id.toString(),
        {
          b2cPricePaise: 38000, // ₹380.00
          b2cMrpPaise: 42000, // ₹420.00
          b2bPricePaise: 35000, // ₹350.00
          b2bTiers: [
            { minQuantity: '20', pricePaise: 34000 },
            { minQuantity: '50', pricePaise: 33000 },
          ],
          changeReason: 'Initial catalogue global price setup',
        },
        adminUserId.toString(),
      );

      expect(result).toBeDefined();
      expect(result.productId).toBe(standaloneProduct._id.toString());
      expect(result.variantId).toBeNull();
      expect(result.serviceAreaId).toBeNull();
      expect(result.pricingScope).toBe('STANDALONE_GLOBAL');
      expect(result.b2cPricePaise).toBe(38000);
      expect(result.b2cMrpPaise).toBe(42000);
      expect(result.b2bPricePaise).toBe(35000);
      expect(result.b2bTiers).toHaveLength(2);
      expect(result.isActive).toBe(true);
      expect(result.version).toBe(1);

      // Verify audit history in MongoDB
      const historyDocs = await PriceHistoryModel.find({
        productId: standaloneProduct._id,
        variantId: null,
      });

      expect(historyDocs).toHaveLength(1);
      const h = historyDocs[0]!;
      expect(h.action).toBe('CREATED');
      expect(h.previousB2cPricePaise).toBeNull();
      expect(h.newB2cPricePaise).toBe(38000);
      expect(h.previousB2cMrpPaise).toBeNull();
      expect(h.newB2cMrpPaise).toBe(42000);
      expect(h.previousB2bPricePaise).toBeNull();
      expect(h.newB2bPricePaise).toBe(35000);
      expect(h.previousTiers).toHaveLength(0);
      expect(h.newTiers).toHaveLength(2);
      expect(h.changeReason).toBe('Initial catalogue global price setup');
      expect(h.changedBy.toString()).toBe(adminUserId.toString());
    });

    it('updates standalone global pricing atomically and increments version lock with PriceHistory (action: UPDATED)', async () => {
      const updated = await pricingService.setStandalonePricing(
        standaloneProduct._id.toString(),
        {
          b2cPricePaise: 39000, // ₹390.00
          b2cMrpPaise: 43000, // ₹430.00
          b2bPricePaise: 36000, // ₹360.00
          b2bTiers: [
            { minQuantity: '20', pricePaise: 35000 },
            { minQuantity: '50', pricePaise: 34000 },
          ],
          changeReason: 'Quarterly price revision due to inflation',
        },
        adminUserId.toString(),
      );

      expect(updated.b2cPricePaise).toBe(39000);
      expect(updated.version).toBe(2);

      // Verify second audit record in MongoDB
      const historyDocs = await PriceHistoryModel.find({
        productId: standaloneProduct._id,
        variantId: null,
      }).sort({ createdAt: -1 });

      expect(historyDocs).toHaveLength(2);
      const latestHistory = historyDocs[0]!;
      expect(latestHistory.action).toBe('UPDATED');
      expect(latestHistory.previousB2cPricePaise).toBe(38000);
      expect(latestHistory.newB2cPricePaise).toBe(39000);
      expect(latestHistory.previousB2bPricePaise).toBe(35000);
      expect(latestHistory.newB2bPricePaise).toBe(36000);
      expect(latestHistory.changeReason).toBe('Quarterly price revision due to inflation');
    });

    it('creates standalone regional pricing override (STANDALONE_REGIONAL) atomically', async () => {
      const regional = await pricingService.setStandalonePricing(
        standaloneProduct._id.toString(),
        {
          serviceAreaId: serviceAreaId.toString(),
          b2cPricePaise: 41000, // ₹410.00 in Chennai
          b2cMrpPaise: 45000,
          b2bPricePaise: 37000,
          b2bTiers: [{ minQuantity: '25', pricePaise: 35500 }],
          changeReason: 'Chennai regional transport cost override',
        },
        adminUserId.toString(),
      );

      expect(regional.pricingScope).toBe('STANDALONE_REGIONAL');
      expect(regional.serviceAreaId).toBe(serviceAreaId.toString());
      expect(regional.b2cPricePaise).toBe(41000);
      expect(regional.version).toBe(1);

      // Verify regional price history document
      const regHistory = await PriceHistoryModel.findOne({
        productId: standaloneProduct._id,
        serviceAreaId,
        action: 'CREATED',
      });
      expect(regHistory).toBeDefined();
      expect(regHistory?.pricingScope).toBe('STANDALONE_REGIONAL');
      expect(regHistory?.newB2cPricePaise).toBe(41000);
    });

    it('rejects creating regional pricing for an inactive service area with HTTP 400 SERVICE_AREA_INACTIVE', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            serviceAreaId: inactiveServiceAreaId.toString(),
            b2cPricePaise: 40000,
            changeReason: 'Attempting override on inactive area',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected inactive service area');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('SERVICE_AREA_INACTIVE');
      }
    });

    it('rejects setting standalone pricing on a multi-variant parent with HTTP 400 PARENT_CONTAINER_CANNOT_HAVE_PRICE', async () => {
      try {
        await pricingService.setStandalonePricing(
          multiVariantParent._id.toString(),
          {
            b2cPricePaise: 50000,
            changeReason: 'Invalid parent pricing attempt',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected parent pricing');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('PARENT_CONTAINER_CANNOT_HAVE_PRICE');
      }
    });
  });

  // =========================================================================
  // 3. Multi-Variant Product & Variant Pricing Mutations
  // =========================================================================
  describe('Variant Pricing Mutations', () => {
    it('creates variant global pricing (VARIANT_GLOBAL) atomically with PriceHistory', async () => {
      const result = await pricingService.setVariantPricing(
        multiVariantParent._id.toString(),
        childVariant1._id.toString(),
        {
          b2cPricePaise: 65000, // ₹650.00
          b2cMrpPaise: 70000,
          b2bPricePaise: 61000,
          b2bTiers: [{ minQuantity: '10', pricePaise: 59000 }],
          changeReason: 'Initial setup for 12mm rebar variant',
        },
        adminUserId.toString(),
      );

      expect(result.productId).toBe(multiVariantParent._id.toString());
      expect(result.variantId).toBe(childVariant1._id.toString());
      expect(result.pricingScope).toBe('VARIANT_GLOBAL');
      expect(result.b2cPricePaise).toBe(65000);
      expect(result.version).toBe(1);

      const history = await PriceHistoryModel.findOne({
        productId: multiVariantParent._id,
        variantId: childVariant1._id,
      });
      expect(history).toBeDefined();
      expect(history?.action).toBe('CREATED');
      expect(history?.newB2cPricePaise).toBe(65000);
    });

    it('creates variant regional pricing override (VARIANT_REGIONAL)', async () => {
      const regional = await pricingService.setVariantPricing(
        multiVariantParent._id.toString(),
        childVariant1._id.toString(),
        {
          serviceAreaId: serviceAreaId.toString(),
          b2cPricePaise: 68000,
          b2cMrpPaise: 72000,
          b2bPricePaise: 63000,
          changeReason: 'Chennai regional override for 12mm rebar',
        },
        adminUserId.toString(),
      );

      expect(regional.pricingScope).toBe('VARIANT_REGIONAL');
      expect(regional.serviceAreaId).toBe(serviceAreaId.toString());
      expect(regional.b2cPricePaise).toBe(68000);
      expect(regional.version).toBe(1);
    });

    it('rejects setting variant pricing on a standalone product with HTTP 400 SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE', async () => {
      try {
        await pricingService.setVariantPricing(
          standaloneProduct._id.toString(),
          childVariant1._id.toString(),
          {
            b2cPricePaise: 50000,
            changeReason: 'Invalid standalone variant pricing attempt',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected standalone product variant pricing');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE');
      }
    });

    it('rejects setting variant pricing when variant belongs to a foreign product with HTTP 400 VARIANT_DOES_NOT_BELONG_TO_PRODUCT', async () => {
      try {
        await pricingService.setVariantPricing(
          multiVariantParent._id.toString(),
          foreignVariant._id.toString(), // Belongs to foreignMultiVariantParent
          {
            b2cPricePaise: 50000,
            changeReason: 'Cross-product variant pricing attempt',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected cross-product variant mismatch');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('VARIANT_DOES_NOT_BELONG_TO_PRODUCT');
      }
    });
  });

  // =========================================================================
  // 4. Domain Validation Rules Enforcement
  // =========================================================================
  describe('Domain Rules Validation', () => {
    it('rejects b2cMrpPaise less than b2cPricePaise with HTTP 400 MRP_LESS_THAN_SELLING_PRICE', async () => {
      try {
        await pricingService.setVariantPricing(
          multiVariantParent._id.toString(),
          childVariant2._id.toString(),
          {
            b2cPricePaise: 70000,
            b2cMrpPaise: 65000, // MRP < Selling Price
            changeReason: 'Invalid MRP test',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected MRP < Selling Price');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('MRP_LESS_THAN_SELLING_PRICE');
      }
    });

    it('rejects tier minQuantity failing step increment formula with HTTP 400 TIER_QUANTITY_STEP_MISMATCH', async () => {
      // multiVariantParent has MOQ 5, Step 5. minQuantity 12 fails (5 + 5*n)
      try {
        await pricingService.setVariantPricing(
          multiVariantParent._id.toString(),
          childVariant2._id.toString(),
          {
            b2cPricePaise: 70000,
            b2bPricePaise: 65000,
            b2bTiers: [{ minQuantity: '12', pricePaise: 60000 }],
            changeReason: 'Step increment mismatch test',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected unaligned tier step');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('TIER_QUANTITY_STEP_MISMATCH');
      }
    });

    it('rejects empty or whitespace changeReason with HTTP 400 VALIDATION_ERROR', async () => {
      try {
        await pricingService.setVariantPricing(
          multiVariantParent._id.toString(),
          childVariant2._id.toString(),
          {
            b2cPricePaise: 70000,
            changeReason: '   ',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected whitespace changeReason');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // =========================================================================
  // 5. B2B Wholesale Exceeding B2C Retail Override (Decision #35)
  // =========================================================================
  describe('B2B Exceeding B2C Override Governance', () => {
    it('rejects b2bPricePaise > b2cPricePaise when allowB2bExceedsB2c is false with HTTP 400 B2B_PRICE_EXCEEDS_B2C', async () => {
      try {
        await pricingService.setVariantPricing(
          multiVariantParent._id.toString(),
          childVariant2._id.toString(),
          {
            b2cPricePaise: 50000,
            b2bPricePaise: 55000, // Wholesale > Retail
            allowB2bExceedsB2c: false,
            changeReason: 'Testing unauthorized wholesale inversion',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have rejected wholesale > retail without flag');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(400);
        expect(pErr.code).toBe('B2B_PRICE_EXCEEDS_B2C');
      }
    });

    it('allows b2bPricePaise > b2cPricePaise when allowB2bExceedsB2c is true and authorized staff executes', async () => {
      const result = await pricingService.setVariantPricing(
        multiVariantParent._id.toString(),
        childVariant2._id.toString(),
        {
          b2cPricePaise: 50000,
          b2bPricePaise: 55000,
          allowB2bExceedsB2c: true,
          changeReason: 'Temporary retail flash clearance sale authorized by Category Head',
        },
        adminUserId.toString(),
      );

      expect(result.b2cPricePaise).toBe(50000);
      expect(result.b2bPricePaise).toBe(55000);
      expect(result.version).toBe(1);

      const history = await PriceHistoryModel.findOne({
        productId: multiVariantParent._id,
        variantId: childVariant2._id,
      });
      expect(history?.changeReason).toContain('Temporary retail flash clearance sale');
    });
  });

  // =========================================================================
  // 6. Transactional Consistency & Rollback on History Failure
  // =========================================================================
  describe('Transactional Consistency & Rollback Protections', () => {
    it('rolls back price mutation completely if price history creation fails inside transaction', async () => {
      // Mock PriceHistoryModel.create to throw an intentional failure
      const originalCreate = PriceHistoryModel.create.bind(PriceHistoryModel);
      vi.spyOn(PriceHistoryModel, 'create').mockImplementationOnce(async () => {
        throw new Error('SIMULATED_HISTORY_WRITE_FAILURE');
      });

      // Attempt to update standalone global price
      await expect(
        pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 99999, // Should NOT be committed
            changeReason: 'Rollback test modification',
          },
          adminUserId.toString(),
        ),
      ).rejects.toThrow('SIMULATED_HISTORY_WRITE_FAILURE');

      // Verify that the pricing document in MongoDB still has previous price (39000), NOT 99999
      const priceDoc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
      });

      expect(priceDoc).toBeDefined();
      expect(priceDoc?.b2cPricePaise).toBe(39000);
      expect(priceDoc?.version).toBe(2); // Still at version 2, not incremented

      vi.restoreAllMocks();
      void originalCreate;
    });
  });

  // =========================================================================
  // 7. Optimistic Concurrency & Version Coordination Locks
  // =========================================================================
  describe('Optimistic Concurrency & Version Coordination Locks', () => {
    it('rejects update with mismatched expectedVersion with HTTP 409 PRICING_CONCURRENCY_CONFLICT', async () => {
      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 40000,
            changeReason: 'Stale version update attempt',
          },
          adminUserId.toString(),
          { expectedVersion: 999 }, // Current version is 2
        );
        expect.unreachable('Should have rejected version mismatch');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(409);
        expect(pErr.code).toBe('PRICING_CONCURRENCY_CONFLICT');
      }
    });

    it('simulates concurrent updates to the same pricing record: first succeeds, second aborts with HTTP 409', async () => {
      const currentDoc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
      });
      expect(currentDoc).toBeDefined();
      const currentVersion = currentDoc!.version;

      // First update with matching version
      const update1 = await pricingService.setStandalonePricing(
        standaloneProduct._id.toString(),
        {
          b2cPricePaise: 40500,
          changeReason: 'Concurrent update 1 wins',
        },
        adminUserId.toString(),
        { expectedVersion: currentVersion },
      );
      expect(update1.version).toBe(currentVersion + 1);

      // Second update using the now-stale version
      await expect(
        pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 40600,
            changeReason: 'Concurrent update 2 loses',
          },
          adminUserId.toString(),
          { expectedVersion: currentVersion }, // Now stale
        ),
      ).rejects.toThrow(PricingError);
    });
  });

  // =========================================================================
  // 8. Lifecycle Deactivation & Idempotency
  // =========================================================================
  describe('Lifecycle Deactivation & Idempotency', () => {
    it('first deactivation changes the record to inactive, increments version, and creates exactly one history entry', async () => {
      const priceDoc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        serviceAreaId, // Regional override
      });
      expect(priceDoc).toBeDefined();
      expect(priceDoc!.isActive).toBe(true);
      const initialVersion = priceDoc!.version;

      const deactivated = await pricingService.deactivatePricing(
        priceDoc!._id.toString(),
        'Decommissioning Chennai regional override',
        adminUserId.toString(),
      );

      expect(deactivated.isActive).toBe(false);
      expect(deactivated.version).toBe(initialVersion + 1);

      // Verify exactly 1 DEACTIVATED entry exists
      const deactHistory = await PriceHistoryModel.find({
        pricingId: priceDoc!._id,
        action: 'DEACTIVATED',
      });
      expect(deactHistory).toHaveLength(1);
      expect(deactHistory[0]!.changeReason).toBe('Decommissioning Chennai regional override');
    });

    it('second deactivation returns successfully without changing version, timestamps, or creating extra history (idempotent)', async () => {
      const priceDocBefore = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        serviceAreaId,
      });
      expect(priceDocBefore).toBeDefined();
      expect(priceDocBefore!.isActive).toBe(false);

      const countBefore = await PriceHistoryModel.countDocuments({
        pricingId: priceDocBefore!._id,
      });

      // Execute second deactivation call
      const secondDeactivated = await pricingService.deactivatePricing(
        priceDocBefore!._id.toString(),
        'Duplicate deactivation attempt with new reason',
        adminUserId.toString(),
      );

      expect(secondDeactivated.isActive).toBe(false);
      expect(secondDeactivated.version).toBe(priceDocBefore!.version);
      expect(secondDeactivated.updatedAt).toBe(priceDocBefore!.updatedAt.toISOString());
      expect(secondDeactivated.b2cPricePaise).toBe(priceDocBefore!.b2cPricePaise);

      // Verify no extra history entry was created
      const countAfter = await PriceHistoryModel.countDocuments({
        pricingId: priceDocBefore!._id,
      });
      expect(countAfter).toBe(countBefore);

      // Verify in MongoDB directly
      const priceDocAfter = await ProductPricingModel.findById(priceDocBefore!._id);
      expect(priceDocAfter!.version).toBe(priceDocBefore!.version);
      expect(priceDocAfter!.updatedAt.getTime()).toBe(priceDocBefore!.updatedAt.getTime());
    });

    it('returns HTTP 404 PRODUCT_NOT_PRICED for non-existent pricing record ID', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      await expect(
        pricingService.deactivatePricing(
          nonExistentId,
          'Deactivating non-existent record',
          adminUserId.toString(),
        ),
      ).rejects.toThrow(PricingError);

      try {
        await pricingService.deactivatePricing(
          nonExistentId,
          'Deactivating non-existent record',
          adminUserId.toString(),
        );
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(404);
        expect(pErr.code).toBe('PRODUCT_NOT_PRICED');
      }
    });

    it('rolls back both pricing mutation and history changes if deactivation history creation fails', async () => {
      // Create a dedicated active price doc to test failed deactivation rollback
      const tempPricing = await ProductPricingModel.create({
        productId: multiVariantParent._id,
        variantId: childVariant2._id,
        serviceAreaId: serviceAreaId,
        pricingScope: 'VARIANT_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 88000,
        b2cMrpPaise: 95000,
        b2bPricePaise: 85000,
        b2bTiers: [],
        isActive: true,
        version: 1,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      });

      // Spy on PriceHistoryModel.create to simulate failure
      const createSpy = vi.spyOn(PriceHistoryModel, 'create').mockImplementationOnce(async () => {
        throw new Error('SIMULATED_DEACTIVATION_HISTORY_FAILURE');
      });

      await expect(
        pricingService.deactivatePricing(
          tempPricing._id.toString(),
          'Deactivating with simulated failure',
          adminUserId.toString(),
        ),
      ).rejects.toThrow('SIMULATED_DEACTIVATION_HISTORY_FAILURE');

      createSpy.mockRestore();

      // Verify document remains ACTIVE and version remains 1 in MongoDB
      const docAfter = await ProductPricingModel.findById(tempPricing._id);
      expect(docAfter).toBeDefined();
      expect(docAfter!.isActive).toBe(true);
      expect(docAfter!.version).toBe(1);

      // Verify no DEACTIVATED history record was committed
      const historyEntries = await PriceHistoryModel.find({
        pricingId: tempPricing._id,
        action: 'DEACTIVATED',
      });
      expect(historyEntries).toHaveLength(0);

      // Cleanup temp doc
      await ProductPricingModel.collection.deleteOne({ _id: tempPricing._id });
    });

    it('rejects deactivation without changeReason with HTTP 400 VALIDATION_ERROR', async () => {
      const priceDoc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
      });
      expect(priceDoc).toBeDefined();

      await expect(
        pricingService.deactivatePricing(priceDoc!._id.toString(), '', adminUserId.toString()),
      ).rejects.toThrow(PricingError);
    });
  });

  // =========================================================================
  // 9. Administrative Inspection & Query Services
  // =========================================================================
  describe('Administrative Read Endpoints & Pagination', () => {
    it('retrieves standalone product pricing list for authorized admin', async () => {
      const list = await pricingService.getStandalonePricing(
        standaloneProduct._id.toString(),
        undefined,
        adminUserId.toString(),
      );

      expect(list.length).toBeGreaterThanOrEqual(1);
      const global = list.find((p) => p.pricingScope === 'STANDALONE_GLOBAL');
      expect(global).toBeDefined();
    });

    it('retrieves variant pricing list for authorized admin', async () => {
      const list = await pricingService.getVariantPricing(
        multiVariantParent._id.toString(),
        childVariant1._id.toString(),
        undefined,
        adminUserId.toString(),
      );

      expect(list.length).toBeGreaterThanOrEqual(1);
      const global = list.find((p) => p.pricingScope === 'VARIANT_GLOBAL');
      expect(global).toBeDefined();
    });

    it('retrieves single pricing record by ID', async () => {
      const priceDoc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
      });
      expect(priceDoc).toBeDefined();

      const item = await pricingService.getPricingById(
        priceDoc!._id.toString(),
        adminUserId.toString(),
      );
      expect(item.id).toBe(priceDoc!._id.toString());
      expect(item.b2cPricePaise).toBe(priceDoc!.b2cPricePaise);
    });

    it('retrieves paginated audit history for a product', async () => {
      const historyResult = await pricingService.getPricingHistory(
        {
          productId: standaloneProduct._id.toString(),
          page: 1,
          limit: 10,
        },
        adminUserId.toString(),
      );

      expect(historyResult.total).toBeGreaterThanOrEqual(2);
      expect(historyResult.items.length).toBeGreaterThanOrEqual(2);
      expect(historyResult.page).toBe(1);
      expect(historyResult.limit).toBe(10);
      expect(historyResult.totalPages).toBeGreaterThanOrEqual(1);

      // Items should be sorted newest first
      const first = historyResult.items[0]!;
      const second = historyResult.items[1]!;
      expect(new Date(first.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(second.createdAt).getTime(),
      );
    });

    it('rejects read requests from unauthorized users (CUSTOMER) with HTTP 403 FORBIDDEN', async () => {
      await expect(
        pricingService.getStandalonePricing(
          standaloneProduct._id.toString(),
          undefined,
          customerUserId.toString(),
        ),
      ).rejects.toThrow(PricingError);

      await expect(
        pricingService.getPricingHistory(
          { productId: standaloneProduct._id.toString() },
          customerUserId.toString(),
        ),
      ).rejects.toThrow(PricingError);
    });
  });

  // =========================================================================
  // 10. Concurrency Duplicate Safety & History Immutability Hardening
  // =========================================================================
  describe('Duplicate Scope Collision & Price History Immutability', () => {
    it('maps duplicate pricing scope unique index violations to HTTP 409 PRICING_ALREADY_EXISTS', async () => {
      // Simulate race condition where findOne in concurrent transaction returned null,
      // and ProductPricingModel.create() hits the partial unique index in MongoDB
      const findOneSpy = vi.spyOn(ProductPricingModel, 'findOne').mockReturnValueOnce({
        session: () => Promise.resolve(null),
      } as unknown as ReturnType<typeof ProductPricingModel.findOne>);

      try {
        await pricingService.setStandalonePricing(
          standaloneProduct._id.toString(),
          {
            b2cPricePaise: 42000,
            changeReason: 'Simulated concurrent duplicate insert',
          },
          adminUserId.toString(),
        );
        expect.unreachable('Should have thrown PRICING_ALREADY_EXISTS');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PricingError);
        const pErr = err as PricingError;
        expect(pErr.statusCode).toBe(409);
        expect(pErr.code).toBe('PRICING_ALREADY_EXISTS');
      } finally {
        findOneSpy.mockRestore();
      }
    });

    it('enforces append-only immutability on PriceHistoryModel (blocks updates and deletes)', async () => {
      const historyDoc = await PriceHistoryModel.findOne({
        productId: standaloneProduct._id,
      });
      expect(historyDoc).toBeDefined();

      // Attempting to update existing doc fails
      historyDoc!.changeReason = 'Malicious update attempt';
      await expect(historyDoc!.save()).rejects.toThrow('PRICE_HISTORY_IMMUTABLE');

      // Attempting query update fails
      await expect(
        PriceHistoryModel.updateOne({ _id: historyDoc!._id }, { $set: { changeReason: 'Hacked' } }),
      ).rejects.toThrow('PRICE_HISTORY_IMMUTABLE');

      // Attempting delete fails
      await expect(PriceHistoryModel.deleteOne({ _id: historyDoc!._id })).rejects.toThrow(
        'PRICE_HISTORY_IMMUTABLE',
      );
    });
  });

  // =========================================================================
  // 11. DTO Mappers & General Facade Delegation
  // =========================================================================
  describe('DTO Helpers & Unified Facade', () => {
    it('correctly maps Mongoose document to IProductPricing DTO with toPricingDto', async () => {
      const doc = await ProductPricingModel.findOne({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
      });
      expect(doc).toBeDefined();

      const dto = toPricingDto(doc!);
      expect(dto.id).toBe(doc!._id.toString());
      expect(dto.currency).toBe('INR');
      expect(typeof dto.createdAt).toBe('string');
      expect(typeof dto.updatedAt).toBe('string');
    });

    it('correctly maps Mongoose document to IPriceHistory DTO with toPriceHistoryDto', async () => {
      const doc = await PriceHistoryModel.findOne({
        productId: standaloneProduct._id,
      });
      expect(doc).toBeDefined();

      const dto = toPriceHistoryDto(doc!);
      expect(dto.id).toBe(doc!._id.toString());
      expect(dto.pricingId).toBe(doc!.pricingId.toString());
      expect(typeof dto.createdAt).toBe('string');
    });

    it('delegates calculateEffectivePrice to pricingEngine cleanly', async () => {
      const response = await pricingService.calculateEffectivePrice(
        {
          productId: standaloneProduct._id.toString(),
          quantity: '10',
        },
        null,
      );

      expect(response).toBeDefined();
      expect(response.customerSegment).toBe('B2C');
      expect(response.unitPricePaise).toBeGreaterThan(0);
      expect(response.subtotalPaise).toBeGreaterThan(0);
    });
  });
});
