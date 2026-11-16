import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { pricingEngineService, PricingError } from '../src/services/pricing/index.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { UserModel } from '../src/models/user.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

describe('Milestone 4 Step 5: Substep 5.3 — PricingEngineService Integration Tests', () => {
  let categoryId: Types.ObjectId;
  let serviceAreaId: Types.ObjectId;
  let b2cUserId: Types.ObjectId;
  let unverifiedB2bUserId: Types.ObjectId;
  let verifiedB2bUserId: Types.ObjectId;
  let revocableB2bUserId: Types.ObjectId;
  let suspendedB2bUserId: Types.ObjectId;
  let adminUserId: Types.ObjectId;
  let supportStaffUserId: Types.ObjectId;
  let partnerUserId: Types.ObjectId;

  // Products & Variants
  let standaloneActiveProduct: IProductDocument;
  let standaloneUntieredProduct: IProductDocument;
  let standaloneFractionalProduct: IProductDocument;
  let standaloneInactiveRegionalProduct: IProductDocument;
  let standaloneDeactivatedPricingProduct: IProductDocument;
  let multiVariantParentProduct: IProductDocument;
  let childVariantActive: IProductVariantDocument;
  let childVariantDraft: IProductVariantDocument;
  let draftProduct: IProductDocument;
  let unpricedProduct: IProductDocument;
  let foreignProduct: IProductDocument;

  beforeAll(async () => {
    await connectDatabase();

    // 0. Seed default system roles
    const rbacService = new RbacService();
    await rbacService.seedDefaultRoles();

    // 1. Fixture: Category
    const category = await CategoryModel.create({
      code: `CAT_PE_${Date.now()}`,
      name: 'Pricing Engine Category',
      slug: `pricing-engine-cat-${Date.now()}`,
      isActive: true,
      displayOrder: 1,
    });
    categoryId = category._id;

    // 2. Fixture: Service Area with unique PIN codes 609101, 609102
    const serviceArea = await ServiceAreaModel.create({
      code: `SA_PE_${Date.now()}`,
      name: 'Chennai Central Zone',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincodes: ['609101', '609102'],
      isActive: true,
    });
    serviceAreaId = serviceArea._id;

    // 3. Fixtures: Users
    const b2cUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['CUSTOMER'],
    });
    b2cUserId = b2cUser._id;

    const unverifiedB2bUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.CUSTOMER,
      status: UserStatus.PENDING_VERIFICATION,
      roles: ['CUSTOMER'],
    });
    unverifiedB2bUserId = unverifiedB2bUser._id;

    const verifiedB2bUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['CUSTOMER', 'B2B_CUSTOMER'],
    });
    verifiedB2bUserId = verifiedB2bUser._id;

    const revocableB2bUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['CUSTOMER', 'B2B_CUSTOMER'],
    });
    revocableB2bUserId = revocableB2bUser._id;

    const suspendedB2bUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.CUSTOMER,
      status: UserStatus.SUSPENDED,
      roles: ['CUSTOMER', 'B2B_CUSTOMER'],
    });
    suspendedB2bUserId = suspendedB2bUser._id;

    const adminUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_MANAGER'],
    });
    adminUserId = adminUser._id;

    const supportStaffUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['FINANCE_OFFICER'],
    });
    supportStaffUserId = supportStaffUser._id;

    const partnerUser = await UserModel.create({
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      userType: UserType.PARTNER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    partnerUserId = partnerUser._id;

    // 4. Fixture: Standalone Active Product (Cement Bags: MOQ=10, Max=1000, Step=5)
    standaloneActiveProduct = await ProductModel.create({
      title: 'UltraTech Super Cement 50kg',
      slug: `ultratech-super-${Date.now()}`,
      brand: 'UltraTech',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-ACTIVE-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '1000',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    // Standalone Global Price: B2C ₹380, MRP ₹420, B2B Base ₹350, Tiers at 100 bags (₹340) and 500 bags (₹325)
    await ProductPricingModel.create({
      productId: standaloneActiveProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 38000,
      b2cMrpPaise: 42000,
      b2bPricePaise: 35000,
      b2bTiers: [
        { minQuantity: '100', pricePaise: 34000 },
        { minQuantity: '500', pricePaise: 32500 },
      ],
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // Standalone Regional Price Override (Chennai 609101): B2C ₹390, MRP ₹430, B2B Base ₹360, Regional Tier at 200 bags (₹330)
    await ProductPricingModel.create({
      productId: standaloneActiveProduct._id,
      variantId: null,
      serviceAreaId,
      pricingScope: 'STANDALONE_REGIONAL',
      currency: 'INR',
      b2cPricePaise: 39000,
      b2cMrpPaise: 43000,
      b2bPricePaise: 36000,
      b2bTiers: [{ minQuantity: '200', pricePaise: 33000 }],
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 5. Fixture: Standalone Untiered Product (Only B2C price, b2bPricePaise: null)
    standaloneUntieredProduct = await ProductModel.create({
      title: 'Standard Paint Brush 2 Inch',
      slug: `paint-brush-${Date.now()}`,
      brand: 'Asian Paints',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-BRUSH-${Date.now()}`,
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

    await ProductPricingModel.create({
      productId: standaloneUntieredProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 1500, // ₹15.00
      b2cMrpPaise: 2000, // ₹20.00
      b2bPricePaise: null,
      b2bTiers: [],
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 6. Fixture: Standalone Fractional Product (Tonne, Precision 1, MOQ 0.5, Step 0.5)
    standaloneFractionalProduct = await ProductModel.create({
      title: 'Bulk River Sand',
      slug: `bulk-sand-${Date.now()}`,
      brand: 'Local Sand Yard',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-SAND-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'TONNE',
      quantityPrecision: 1,
      minOrderQuantity: '0.5',
      maxOrderQuantity: '50.0',
      stepIncrement: '0.5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    await ProductPricingModel.create({
      productId: standaloneFractionalProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 1001,
      b2cMrpPaise: 1200,
      b2bPricePaise: 900,
      b2bTiers: [],
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 7. Fixture: Standalone Product with Inactive Regional Override
    standaloneInactiveRegionalProduct = await ProductModel.create({
      title: 'Inactive Regional Brick Pallet',
      slug: `inactive-reg-brick-${Date.now()}`,
      brand: 'Local Bricks',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-INACT-REG-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'PIECE',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '10',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    // Global active price
    await ProductPricingModel.create({
      productId: standaloneInactiveRegionalProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 5000,
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // Regional INACTIVE price override
    await ProductPricingModel.create({
      productId: standaloneInactiveRegionalProduct._id,
      variantId: null,
      serviceAreaId,
      pricingScope: 'STANDALONE_REGIONAL',
      currency: 'INR',
      b2cPricePaise: 6000,
      isActive: false, // Explicitly inactive
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 8. Fixture: Standalone Product with Deactivated Global Price (isActive: false)
    standaloneDeactivatedPricingProduct = await ProductModel.create({
      title: 'Deactivated Price Mortar',
      slug: `deact-mortar-${Date.now()}`,
      brand: 'Local Mortar',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-DEACT-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    await ProductPricingModel.create({
      productId: standaloneDeactivatedPricingProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 25000,
      isActive: false, // Decommissioned price
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 9. Fixture: Multi-Variant Parent & Variants
    multiVariantParentProduct = await ProductModel.create({
      title: 'Fe 550D TMT Rebar (Multi-Variant Parent)',
      slug: `tmt-rebar-parent-${Date.now()}`,
      brand: 'Tata Tiscon',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    childVariantActive = await ProductVariantModel.create({
      productId: multiVariantParentProduct._id,
      title: '12mm TMT Rebar Bundle',
      sku: `THZ-V-12MM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: new Map([['diameter', '12mm']]),
      unitCode: 'BUNDLE',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '500',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });

    await ProductPricingModel.create({
      productId: multiVariantParentProduct._id,
      variantId: childVariantActive._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000, // ₹500
      b2cMrpPaise: 55000, // ₹550
      b2bPricePaise: 47000, // ₹470
      b2bTiers: [{ minQuantity: '100', pricePaise: 45000 }],
      isActive: true,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    childVariantDraft = await ProductVariantModel.create({
      productId: multiVariantParentProduct._id,
      title: '16mm TMT Rebar Bundle (Draft)',
      sku: `THZ-V-16MM-${Date.now()}`,
      status: 'DRAFT',
      publishedAt: null,
      attributes: new Map([['diameter', '16mm']]),
      unitCode: 'BUNDLE',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 10. Fixture: Draft Standalone Product
    draftProduct = await ProductModel.create({
      title: 'Draft Concrete Mixer',
      slug: `draft-mixer-${Date.now()}`,
      brand: 'Local',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-DRAFT-${Date.now()}`,
      status: 'DRAFT',
      publishedAt: null,
      unitCode: 'PIECE',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      createdBy: adminUserId,
      updatedBy: adminUserId,
    });

    // 11. Fixture: Unpriced Active Product
    unpricedProduct = await ProductModel.create({
      title: 'Unpriced Shovel',
      slug: `unpriced-shovel-${Date.now()}`,
      brand: 'Local Tools',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: false,
      sku: `THZ-P-UNPRICED-${Date.now()}`,
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

    // 12. Fixture: Foreign Multi-Variant Product for cross-ownership test
    foreignProduct = await ProductModel.create({
      title: 'Foreign Multi-Variant Product',
      slug: `foreign-prod-${Date.now()}`,
      brand: 'Other',
      categoryId,
      subcategoryId: categoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      createdBy: adminUserId,
      updatedBy: adminUserId,
      publishedBy: adminUserId,
    });
  });

  afterAll(async () => {
    // Teardown test artifacts
    const productIds = [
      standaloneActiveProduct?._id,
      standaloneUntieredProduct?._id,
      standaloneFractionalProduct?._id,
      standaloneInactiveRegionalProduct?._id,
      standaloneDeactivatedPricingProduct?._id,
      multiVariantParentProduct?._id,
      draftProduct?._id,
      unpricedProduct?._id,
      foreignProduct?._id,
    ].filter(Boolean);

    if (productIds.length > 0) {
      await ProductPricingModel.collection.deleteMany({
        productId: { $in: productIds },
      });
      await ProductModel.collection.deleteMany({
        _id: { $in: productIds },
      });
    }

    const variantIds = [childVariantActive?._id, childVariantDraft?._id].filter(Boolean);
    if (variantIds.length > 0) {
      await ProductVariantModel.collection.deleteMany({
        _id: { $in: variantIds },
      });
    }

    if (serviceAreaId) {
      await ServiceAreaModel.collection.deleteMany({ _id: serviceAreaId });
    }

    const userIds = [
      b2cUserId,
      unverifiedB2bUserId,
      verifiedB2bUserId,
      revocableB2bUserId,
      suspendedB2bUserId,
      adminUserId,
      supportStaffUserId,
      partnerUserId,
    ].filter(Boolean);

    if (userIds.length > 0) {
      await UserModel.collection.deleteMany({
        _id: { $in: userIds },
      });
    }

    if (categoryId) {
      await CategoryModel.collection.deleteMany({ _id: categoryId });
    }

    await disconnectDatabase();
  });

  describe('Domain 1: Zero Client Trust & Customer Segment Resolution', () => {
    it('discards client-supplied customerSegment and unitPrice claims (AC-PRICE-28)', async () => {
      // Unauthenticated caller attempts to claim B2B wholesale price
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '15',
          ...({ customerSegment: 'B2B', unitPrice: 100 } as Record<string, unknown>),
        },
        null,
      );

      expect(response.customerSegment).toBe('B2C');
      expect(response.unitPricePaise).toBe(38000); // Standard B2C price ₹380
      expect(response.pricingTierApplied).toBe('STANDARD_B2C');
    });

    it('returns B2C rates for unauthenticated public caller even for high quantity (AC-PRICE-29)', async () => {
      // Quantity 600 would qualify for Tier 2 wholesale, but unauthenticated gets B2C
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '600',
        },
        null,
      );

      expect(response.customerSegment).toBe('B2C');
      expect(response.unitPricePaise).toBe(38000); // B2C rate, NOT Tier 2 (32500)
      expect(response.pricingTierApplied).toBe('STANDARD_B2C');
      expect(response.subtotalPaise).toBe(38000 * 600);
    });

    it('returns B2C rates for unverified/pending B2B customer (AC-PRICE-30)', async () => {
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '150',
        },
        unverifiedB2bUserId.toString(),
      );

      expect(response.customerSegment).toBe('B2C');
      expect(response.unitPricePaise).toBe(38000);
      expect(response.pricingTierApplied).toBe('STANDARD_B2C');
    });

    it('returns B2C rates for suspended account even if holding B2B_CUSTOMER role', async () => {
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '150',
        },
        suspendedB2bUserId.toString(),
      );

      expect(response.customerSegment).toBe('B2C');
      expect(response.unitPricePaise).toBe(38000);
      expect(response.pricingTierApplied).toBe('STANDARD_B2C');
    });

    it('enforces instant revocation: drops to B2C immediately when B2B role removed in DB (AC-PRICE-31)', async () => {
      // Step 1: Active B2B customer receives wholesale pricing
      const beforeRevocation = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '15',
        },
        revocableB2bUserId.toString(),
      );
      expect(beforeRevocation.customerSegment).toBe('B2B');
      expect(beforeRevocation.unitPricePaise).toBe(35000); // Base B2B

      // Step 2: Revoke B2B_CUSTOMER role in database
      await UserModel.updateOne({ _id: revocableB2bUserId }, { $pull: { roles: 'B2B_CUSTOMER' } });

      // Step 3: Subsequent call immediately drops to B2C retail rates
      const afterRevocation = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '15',
        },
        revocableB2bUserId.toString(),
      );
      expect(afterRevocation.customerSegment).toBe('B2C');
      expect(afterRevocation.unitPricePaise).toBe(38000); // Retail B2C
      expect(afterRevocation.pricingTierApplied).toBe('STANDARD_B2C');
    });
  });

  describe('Domain 2: Verified B2B Wholesale Pricing & Volume Tiers', () => {
    it('returns base B2B wholesale price for quantity below Tier 1 (AC-PRICE-32)', async () => {
      // Quantity 80 is below Tier 1 (100 bags)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '80',
        },
        verifiedB2bUserId.toString(),
      );

      expect(response.customerSegment).toBe('B2B');
      expect(response.unitPricePaise).toBe(35000); // Base B2B price ₹350
      expect(response.pricingTierApplied).toBe('BASE_B2B');
      expect(response.tierMinQuantity).toBeNull();
      expect(response.subtotalPaise).toBe(35000 * 80);
    });

    it('matches Tier 1 when quantity qualifies for first volume slab (AC-PRICE-33)', async () => {
      // Quantity 150 bags >= 100 bags (Tier 1) but < 500 bags (Tier 2)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '150',
        },
        verifiedB2bUserId.toString(),
      );

      expect(response.customerSegment).toBe('B2B');
      expect(response.unitPricePaise).toBe(34000); // Tier 1 price ₹340
      expect(response.pricingTierApplied).toBe('TIER_1');
      expect(response.tierMinQuantity).toBe('100');
      expect(response.subtotalPaise).toBe(34000 * 150);
    });

    it('matches Tier 2 when quantity qualifies for highest volume slab (AC-PRICE-33)', async () => {
      // Quantity 600 bags >= 500 bags (Tier 2)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '600',
        },
        verifiedB2bUserId.toString(),
      );

      expect(response.customerSegment).toBe('B2B');
      expect(response.unitPricePaise).toBe(32500); // Tier 2 price ₹325
      expect(response.pricingTierApplied).toBe('TIER_2');
      expect(response.tierMinQuantity).toBe('500');
      expect(response.subtotalPaise).toBe(32500 * 600);
    });

    it('falls back to B2C base rate for verified B2B customer when product has no B2B price (AC-PRICE-34)', async () => {
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneUntieredProduct._id.toString(),
          quantity: '1',
        },
        verifiedB2bUserId.toString(),
      );

      // Verified B2B customer receives standard B2C price
      expect(response.customerSegment).toBe('B2B');
      expect(response.unitPricePaise).toBe(1500); // B2C price ₹15.00
      expect(response.pricingTierApplied).toBe('STANDARD_B2C');
      expect(response.tierMinQuantity).toBeNull();
    });
  });

  describe('Domain 3: Delivery PIN Serviceability & Regional Overrides', () => {
    it('resolves delivery PIN and applies regional price override (AC-PRICE-35)', async () => {
      // PIN 609101 is mapped to serviceAreaId (Chennai Zone)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          deliveryPincode: '609101',
          quantity: '15',
        },
        null,
      );

      expect(response.deliveryPincode).toBe('609101');
      expect(response.serviceAreaId).toBe(serviceAreaId.toString());
      expect(response.isServiceAreaOverride).toBe(true);
      expect(response.unitPricePaise).toBe(39000); // Regional B2C price ₹390 (vs global ₹380)
    });

    it('rejects unserviceable delivery PIN with PINCODE_NOT_SERVICEABLE (AC-PRICE-36)', async () => {
      await expect(
        pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            deliveryPincode: '999999', // Unknown PIN
            quantity: '15',
          },
          null,
        ),
      ).rejects.toThrowError(PricingError);

      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            deliveryPincode: '999999',
            quantity: '15',
          },
          null,
        );
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PINCODE_NOT_SERVICEABLE');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects malformed delivery PIN with INVALID_DELIVERY_PINCODE', async () => {
      const invalidPins = ['123', '012345', 'abcdef', '1234567'];
      for (const pin of invalidPins) {
        try {
          await pricingEngineService.calculateEffectivePrice(
            {
              productId: standaloneActiveProduct._id.toString(),
              deliveryPincode: pin,
              quantity: '15',
            },
            null,
          );
          expect.unreachable();
        } catch (err: unknown) {
          if (err instanceof PricingError) {
            expect(err.code).toBe('INVALID_DELIVERY_PINCODE');
            expect(err.statusCode).toBe(400);
          } else {
            throw err;
          }
        }
      }
    });

    it('rejects client-supplied serviceAreaId with CLIENT_SUPPLIED_SERVICE_AREA_FORBIDDEN (AC-PRICE-37)', async () => {
      await expect(
        pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '15',
            ...({ serviceAreaId: serviceAreaId.toString() } as Record<string, unknown>),
          },
          null,
        ),
      ).rejects.toThrowError(PricingError);

      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '15',
            ...({ serviceAreaId: serviceAreaId.toString() } as Record<string, unknown>),
          },
          null,
        );
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('CLIENT_SUPPLIED_SERVICE_AREA_FORBIDDEN');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('enforces atomic schedule replacement: regional tiers completely replace global (AC-PRICE-38)', async () => {
      // In Chennai Zone (609101), regional B2B has ONLY 1 tier at 200 bags (₹330).
      // Global has tiers at 100 bags (₹340) and 500 bags (₹325).
      // Under atomic replacement, quantity 150 bags should NOT inherit global Tier 1 (100 bags).
      // It should get Chennai Regional Base price (₹360).
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          deliveryPincode: '609101',
          quantity: '150',
        },
        verifiedB2bUserId.toString(),
      );

      expect(response.isServiceAreaOverride).toBe(true);
      expect(response.unitPricePaise).toBe(36000); // Regional Base price ₹360 (zero global tier inheritance)
      expect(response.pricingTierApplied).toBe('BASE_B2B');

      // Quantity 250 bags qualifies for the Chennai Regional Tier (>= 200 bags)
      const tierResponse = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          deliveryPincode: '609101',
          quantity: '250',
        },
        verifiedB2bUserId.toString(),
      );
      expect(tierResponse.unitPricePaise).toBe(33000); // Regional Tier price ₹330
      expect(tierResponse.pricingTierApplied).toBe('TIER_1');
    });

    it('falls back to global base pricing when PIN has no regional override (Decision #31)', async () => {
      // standaloneUntieredProduct has only global pricing (no Chennai override)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneUntieredProduct._id.toString(),
          deliveryPincode: '609101',
          quantity: '1',
        },
        null,
      );

      expect(response.deliveryPincode).toBe('609101');
      expect(response.isServiceAreaOverride).toBe(false); // Global fallback
      expect(response.unitPricePaise).toBe(1500); // Global B2C price
    });

    it('falls back to active global price when regional price override is inactive', async () => {
      // standaloneInactiveRegionalProduct has active global price (₹50) and inactive regional price (₹60)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneInactiveRegionalProduct._id.toString(),
          deliveryPincode: '609101',
          quantity: '10',
        },
        null,
      );

      expect(response.deliveryPincode).toBe('609101');
      expect(response.isServiceAreaOverride).toBe(false); // Fell back to global
      expect(response.unitPricePaise).toBe(5000); // Active global price ₹50, NOT inactive ₹60
    });

    it('rejects public calculation when global price record is inactive with PRODUCT_NOT_PRICED', async () => {
      // standaloneDeactivatedPricingProduct has only an inactive global price record (isActive: false)
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneDeactivatedPricingProduct._id.toString(),
            quantity: '1',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_PRICED');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });
  });

  describe('Domain 4: Product & Variant Lifecycle and Sellability', () => {
    it('rejects public calculation for draft product with PRODUCT_NOT_AVAILABLE (AC-PRICE-06)', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: draftProduct._id.toString(),
            quantity: '1',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('allows administrative preview of draft product with catalog:read permission', async () => {
      // Set draft pricing
      await ProductPricingModel.create({
        productId: draftProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 2500000,
        isActive: true,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      });

      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: draftProduct._id.toString(),
          quantity: '1',
        },
        {
          principal: {
            id: adminUserId.toString(),
            userType: UserType.STAFF,
            roles: ['CATALOG_MANAGER'],
            permissions: [PermissionCode.CATALOG_READ],
          },
        },
      );

      expect(response.unitPricePaise).toBe(2500000);
    });

    it('allows administrative preview by passing admin user ID directly', async () => {
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: draftProduct._id.toString(),
          quantity: '1',
        },
        adminUserId.toString(),
      );

      expect(response.unitPricePaise).toBe(2500000);
    });

    it('rejects unauthorized staff without catalog:read from previewing draft product', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: draftProduct._id.toString(),
            quantity: '1',
          },
          supportStaffUserId.toString(),
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('rejects customer from previewing draft product even if attempting to pass preview claims', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: draftProduct._id.toString(),
            quantity: '1',
          },
          b2cUserId.toString(),
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('rejects partner from previewing draft product', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: draftProduct._id.toString(),
            quantity: '1',
          },
          partnerUserId.toString(),
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('rejects calculation for active product with no pricing with PRODUCT_NOT_PRICED (AC-PRICE-07)', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: unpricedProduct._id.toString(),
            quantity: '1',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_PRICED');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('rejects direct parent container pricing without variantId (AC-PRICE-02)', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: multiVariantParentProduct._id.toString(),
            quantity: '10',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PARENT_CONTAINER_CANNOT_HAVE_PRICE');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects standalone product pricing with variantId (AC-PRICE-03)', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            variantId: childVariantActive._id.toString(),
            quantity: '10',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects variant belonging to another product with VARIANT_DOES_NOT_BELONG_TO_PRODUCT (AC-PRICE-05)', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: foreignProduct._id.toString(),
            variantId: childVariantActive._id.toString(),
            quantity: '10',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('VARIANT_DOES_NOT_BELONG_TO_PRODUCT');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects public calculation for draft variant with PRODUCT_NOT_AVAILABLE', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: multiVariantParentProduct._id.toString(),
            variantId: childVariantDraft._id.toString(),
            quantity: '10',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('PRODUCT_NOT_AVAILABLE');
          expect(err.statusCode).toBe(404);
        } else {
          throw err;
        }
      }
    });

    it('calculates price successfully for valid active child variant (AC-PRICE-04)', async () => {
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: multiVariantParentProduct._id.toString(),
          variantId: childVariantActive._id.toString(),
          quantity: '100',
        },
        verifiedB2bUserId.toString(),
      );

      expect(response.variantId).toBe(childVariantActive._id.toString());
      expect(response.unitPricePaise).toBe(45000); // Variant Tier 1 price ₹450
      expect(response.pricingTierApplied).toBe('TIER_1');
    });
  });

  describe('Domain 5: Exact Decimal Quantities & Physical Step Validation', () => {
    it('rejects quantity below MOQ with QUANTITY_BELOW_MINIMUM', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '5', // MOQ is 10
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('QUANTITY_BELOW_MINIMUM');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects quantity exceeding MaxOQ with QUANTITY_ABOVE_MAXIMUM', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '1005', // Max is 1000
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('QUANTITY_ABOVE_MAXIMUM');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects quantity violating step increment with QUANTITY_STEP_INVALID', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '12', // Step is 5 (valid: 10, 15, 20...)
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('QUANTITY_STEP_INVALID');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects fractional quantity on discrete unit with QUANTITY_MUST_BE_INTEGER', async () => {
      try {
        await pricingEngineService.calculateEffectivePrice(
          {
            productId: standaloneActiveProduct._id.toString(),
            quantity: '15.5',
          },
          null,
        );
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('QUANTITY_MUST_BE_INTEGER');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });
  });

  describe('Domain 6: Monetary Arithmetic, Commercial Rounding & Savings (Decision #32 & #39)', () => {
    it('performs exact BigInt HALF_UP rounding on fractional paise line subtotal (Decision #39)', async () => {
      // Unit price: 1001 paise (₹10.01)
      // Quantity: "0.5" tonnes (precision 1)
      // Raw multiplication: 1001 * 0.5 = 500.5 paise
      // HALF_UP commercial rounding -> 501 paise
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneFractionalProduct._id.toString(),
          quantity: '0.5',
        },
        null,
      );

      expect(response.unitPricePaise).toBe(1001);
      expect(response.subtotalPaise).toBe(501); // Deterministically rounded 500.5 -> 501
      expect(response.mrpSubtotalPaise).toBe(600); // 1200 * 0.5 = 600 paise
      expect(response.savingsPaise).toBe(99); // 600 - 501 = 99 paise
    });

    it('calculates customer monetary savings against MRP accurately', async () => {
      // UltraTech Cement: MRP 42000 paise (₹420), Selling 38000 paise (₹380)
      // Quantity: 10 bags
      // Subtotal: 380000 paise (₹3,800)
      // MRP Subtotal: 420000 paise (₹4,200)
      // Savings: 40000 paise (₹400)
      const response = await pricingEngineService.calculateEffectivePrice(
        {
          productId: standaloneActiveProduct._id.toString(),
          quantity: '10',
        },
        null,
      );

      expect(response.unitPricePaise).toBe(38000);
      expect(response.subtotalPaise).toBe(380000);
      expect(response.mrpSubtotalPaise).toBe(420000);
      expect(response.savingsPaise).toBe(40000);
    });
  });
});
