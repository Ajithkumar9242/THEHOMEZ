import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import type { Application } from 'express';

describe('Milestone 4 Step 5.7: Catalogue Lifecycle Integration & Pricing Governance (Decisions #40–#45)', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Test Principals
  let catalogWriterUser: InstanceType<typeof UserModel>;
  let catalogWriterToken: string;

  let catalogPublisherUser: InstanceType<typeof UserModel>;
  let catalogPublisherToken: string;

  // Test Categories
  let testRootCategory: InstanceType<typeof CategoryModel>;
  let testSubcategory: InstanceType<typeof CategoryModel>;

  // Test Service Area
  let testServiceArea: InstanceType<typeof ServiceAreaModel>;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for integration testing:', err);
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      await seedApprovedUnits();
      await cleanDatabase();
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await cleanDatabase();
      await disconnectDatabase();
    }
  });

  async function cleanDatabase() {
    await ProductModel.deleteMany({ slug: { $regex: /^test-/ } });
    await ProductVariantModel.deleteMany({});
    await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-/ } });
    await ProductPricingModel.deleteMany({});
    await mongoose.connection.collection('price_history').deleteMany({});
    await CategoryModel.deleteMany({ slug: { $regex: /^test-/ } });
    await UserModel.deleteMany({ phone: { $regex: /^\+919666/ } });
    await RoleModel.deleteMany({ code: { $regex: /^LIFECYCLE_TEST_/ } });
    await ServiceAreaModel.deleteMany({ code: { $regex: /^TEST-SA-/ } });
  }

  beforeEach(async () => {
    if (!isDbConnected) return;

    await cleanDatabase();

    // 1. Seed Active Categories
    testRootCategory = await CategoryModel.create({
      slug: 'test-lifecycle-root',
      name: 'Test Lifecycle Root',
      level: 0,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    testSubcategory = await CategoryModel.create({
      slug: 'test-lifecycle-sub',
      name: 'Test Lifecycle Subcategory',
      parentId: testRootCategory._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    // 2. Seed Service Area
    testServiceArea = await ServiceAreaModel.create({
      name: 'Test Whitefield Bangalore',
      code: 'TEST-SA-BLR-01',
      city: 'Bangalore',
      state: 'Karnataka',
      pincodes: ['560066', '560067'],
      isActive: true,
    });

    // 3. Seed Roles & Principals
    await RoleModel.findOneAndUpdate(
      { code: 'LIFECYCLE_TEST_WRITER' },
      {
        code: 'LIFECYCLE_TEST_WRITER',
        name: 'Lifecycle Writer Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.PRICING_READ,
          PermissionCode.PRICING_WRITE,
        ],
      },
      { upsert: true, new: true },
    );

    await RoleModel.findOneAndUpdate(
      { code: 'LIFECYCLE_TEST_PUBLISHER' },
      {
        code: 'LIFECYCLE_TEST_PUBLISHER',
        name: 'Lifecycle Publisher Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.CATALOG_PUBLISH,
          PermissionCode.PRICING_READ,
          PermissionCode.PRICING_WRITE,
        ],
      },
      { upsert: true, new: true },
    );

    catalogWriterUser = (await UserModel.findOneAndUpdate(
      { phone: '+919666000001' },
      {
        phone: '+919666000001',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['LIFECYCLE_TEST_WRITER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    catalogPublisherUser = (await UserModel.findOneAndUpdate(
      { phone: '+919666000002' },
      {
        phone: '+919666000002',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['LIFECYCLE_TEST_PUBLISHER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    catalogWriterToken = tokenService.signAccessToken(catalogWriterUser);
    catalogPublisherToken = tokenService.signAccessToken(catalogPublisherUser);
  });

  // Helper to create a standalone draft product
  async function createStandaloneProduct(slug = 'test-standalone-1') {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Standalone Test Product',
        brand: 'TestBrand',
        slug,
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/standalone.webp'],
      });
    return res.body.data.product;
  }

  // Helper to create a multi-variant parent draft product
  async function createParentProduct(slug = 'test-parent-1') {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Multi-Variant Parent Product',
        brand: 'TestBrand',
        slug,
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/parent.webp'],
      });
    return res.body.data.product;
  }

  // Helper to seed active global pricing
  async function seedPricing(params: {
    productId: string | Types.ObjectId;
    variantId?: string | Types.ObjectId | null;
    serviceAreaId?: string | Types.ObjectId | null;
    scope: 'STANDALONE_GLOBAL' | 'VARIANT_GLOBAL' | 'STANDALONE_REGIONAL' | 'VARIANT_REGIONAL';
    b2cPricePaise: number;
    b2bPricePaise?: number;
    b2bTiers?: Array<{ minQuantity: string; pricePaise: number }>;
  }) {
    return await ProductPricingModel.create({
      productId: new Types.ObjectId(params.productId),
      variantId: params.variantId ? new Types.ObjectId(params.variantId) : null,
      serviceAreaId: params.serviceAreaId ? new Types.ObjectId(params.serviceAreaId) : null,
      pricingScope: params.scope,
      currency: 'INR',
      b2cPricePaise: params.b2cPricePaise,
      b2cMrpPaise: params.b2cPricePaise + 1000,
      b2bPricePaise:
        params.b2bPricePaise !== undefined
          ? params.b2bPricePaise
          : params.b2bTiers && params.b2bTiers.length > 0
            ? params.b2cPricePaise - 500
            : null,
      b2bTiers: params.b2bTiers || [],
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });
  }

  // =========================================================================
  // PART G.1 & G.2: Publication Pricing Gates (Decisions #40 & #45)
  // =========================================================================
  describe('Product Publication Pricing Gates', () => {
    it('G.1: Standalone product publication without active global B2C pricing rejected', async () => {
      const product = await createStandaloneProduct('test-unpriced-standalone');

      const res = await request(app)
        .post(`/api/v1/products/${product.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_PUBLISH_UNPRICED_PRODUCT');
    });

    it('G.2: Standalone product publication with regional-only pricing rejected', async () => {
      const product = await createStandaloneProduct('test-regional-only');

      await seedPricing({
        productId: product.id,
        serviceAreaId: testServiceArea._id,
        scope: 'STANDALONE_REGIONAL',
        b2cPricePaise: 45000,
      });

      const res = await request(app)
        .post(`/api/v1/products/${product.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_PUBLISH_UNPRICED_PRODUCT');
    });

    it('G.3: Standalone product publication with zero-price rejected (Decision #45)', async () => {
      const product = await createStandaloneProduct('test-zero-price');

      await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 0,
      });

      const res = await request(app)
        .post(`/api/v1/products/${product.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_PUBLISH_UNPRICED_PRODUCT');
    });

    it('G.4: Standalone product publication with valid positive global pricing succeeds', async () => {
      const product = await createStandaloneProduct('test-valid-publish');

      await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 50000,
      });

      const res = await request(app)
        .post(`/api/v1/products/${product.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.product.status).toBe('ACTIVE');
      expect(res.body.data.product.publishedAt).not.toBeNull();
    });

    it('G.5: Multi-variant parent publication requires active child variant with active global pricing', async () => {
      const parent = await createParentProduct('test-parent-gate');

      // 1. Parent with no variants
      const res1 = await request(app)
        .post(`/api/v1/products/${parent.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe('CANNOT_PUBLISH_PRODUCT');

      // 2. Add draft variant (unpriced)
      const varRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Draft Variant 1',
          attributes: { color: 'Red' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const variantId = varRes.body.data.variant.id;

      // Cannot publish parent with only draft variants
      const res2 = await request(app)
        .post(`/api/v1/products/${parent.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('CANNOT_PUBLISH_PRODUCT');

      // 3. Seed pricing for variant and activate it
      await seedPricing({
        productId: parent.id,
        variantId,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 75000,
      });

      const actRes = await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });
      expect(actRes.status).toBe(200);

      // Now parent publication succeeds!
      const res3 = await request(app)
        .post(`/api/v1/products/${parent.id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);
      expect(res3.status).toBe(200);
      expect(res3.body.data.product.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // PART G.3: Storefront Discovery Concealment (Decision #40)
  // =========================================================================
  describe('Storefront Discovery Pricing Guard', () => {
    it('Hides active standalone product without active global pricing from public listing and slug lookup', async () => {
      // Create product directly as active (e.g. from seed or DB) without pricing
      const product = await ProductModel.create({
        slug: 'test-unpriced-discovery',
        title: 'Unpriced Discovery Product',
        brand: 'DiscoveryBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: catalogPublisherUser._id,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Public listing should not include it
      const listRes = await request(app).get('/api/v1/products/public');
      expect(listRes.status).toBe(200);
      const slugs = listRes.body.data.items.map((i: { slug: string }) => i.slug);
      expect(slugs).not.toContain(product.slug);

      // Public slug lookup should return 404
      const slugRes = await request(app).get(`/api/v1/products/public/${product.slug}`);
      expect(slugRes.status).toBe(404);
      expect(slugRes.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('Exposes active multi-variant parent only if at least one variant is active and globally priced', async () => {
      const parent = await ProductModel.create({
        slug: 'test-parent-discovery',
        title: 'Discovery Parent Product',
        brand: 'DiscoveryBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: catalogPublisherUser._id,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // No active priced variant -> 404
      const slugRes1 = await request(app).get(`/api/v1/products/public/${parent.slug}`);
      expect(slugRes1.status).toBe(404);

      // Add active variant
      const variant = await ProductVariantModel.create({
        productId: parent._id,
        sku: 'THZ-V-TEST-DISC-01',
        title: 'Active Variant',
        attributes: new Map([['size', 'Small']]),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        status: 'ACTIVE',
        publishedAt: new Date(),
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Active variant without pricing -> still 404
      const slugRes2 = await request(app).get(`/api/v1/products/public/${parent.slug}`);
      expect(slugRes2.status).toBe(404);

      // Seed global pricing for variant
      await seedPricing({
        productId: parent._id,
        variantId: variant._id,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 30000,
      });

      // Now public slug lookup succeeds!
      const slugRes3 = await request(app).get(`/api/v1/products/public/${parent.slug}`);
      expect(slugRes3.status).toBe(200);
      expect(slugRes3.body.data.product.slug).toBe(parent.slug);
      expect(slugRes3.body.data.variants).toHaveLength(1);
    });
  });

  // =========================================================================
  // PART G.4: Variant Lifecycle Operations (Decisions #40 & #41)
  // =========================================================================
  describe('Variant Lifecycle Operations', () => {
    it('G.6: Direct ACTIVE variant creation rejected on POST /variants (Decision #41)', async () => {
      const parent = await createParentProduct('test-parent-v1');

      const res = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({
          title: 'Direct Active Variant',
          attributes: { size: 'Large' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          status: 'ACTIVE',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_CREATE_ACTIVE_VARIANT_WITHOUT_PRICING');
    });

    it('G.7 & G.8: Variant activation requires active global pricing, succeeds when priced', async () => {
      const parent = await createParentProduct('test-parent-v2');

      const varRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Draft Variant 2',
          attributes: { size: 'Medium' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const variantId = varRes.body.data.variant.id;

      // 1. Activation without pricing rejected
      const failAct = await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });

      expect(failAct.status).toBe(400);
      expect(failAct.body.error.code).toBe('CANNOT_ACTIVATE_UNPRICED_VARIANT');

      // 2. Seed active global pricing
      await seedPricing({
        productId: parent.id,
        variantId,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 65000,
      });

      // 3. Activation succeeds
      const passAct = await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });

      expect(passAct.status).toBe(200);
      expect(passAct.body.data.variant.status).toBe('ACTIVE');
      expect(passAct.body.data.variant.publishedAt).not.toBeNull();
    });

    it('G.9 & G.10: Temporary deactivation preserves pricing, reactivation verifies pricing', async () => {
      const parent = await createParentProduct('test-parent-v3');

      const varRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Deactivate Test Variant',
          attributes: { grade: 'A' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const variantId = varRes.body.data.variant.id;

      await seedPricing({
        productId: parent.id,
        variantId,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 40000,
      });

      // Activate
      await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });

      // Deactivate
      const deactRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants/${variantId}/deactivate`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(deactRes.status).toBe(200);
      expect(deactRes.body.data.variant.status).toBe('INACTIVE');

      // Verify pricing record is STILL active (temporary operational toggle does not deactivate pricing)
      const prAfterDeact = await ProductPricingModel.findOne({
        productId: parent.id,
        variantId,
      });
      expect(prAfterDeact?.isActive).toBe(true);

      // Reactivate -> verifies pricing and succeeds
      const reactRes = await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });

      expect(reactRes.status).toBe(200);
      expect(reactRes.body.data.variant.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // PART G.5: Archival Pricing Cascade & History Auditing (Decision #42)
  // =========================================================================
  describe('Archival Pricing Cascade & History Auditing', () => {
    it('G.11: Standalone product archival cascades pricing deactivation and appends DEACTIVATED history record', async () => {
      const product = await createStandaloneProduct('test-arch-standalone');

      const pricing = await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 80000,
      });

      // Archive product
      const archRes = await request(app)
        .post(`/api/v1/products/${product.id}/archive`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(archRes.status).toBe(200);
      expect(archRes.body.data.product.status).toBe('ARCHIVED');

      // Verify pricing record deactivated and version incremented
      const updatedPricing = await ProductPricingModel.findById(pricing._id);
      expect(updatedPricing?.isActive).toBe(false);
      expect(updatedPricing?.version).toBe(2);

      // Verify PriceHistoryModel appended immutable DEACTIVATED record
      const history = await PriceHistoryModel.find({
        pricingId: pricing._id,
        action: 'DEACTIVATED',
      });
      expect(history).toHaveLength(1);
      expect(history[0].changeReason).toContain('archived');
    });

    it('G.12: Variant archival cascades pricing deactivation and appends history record', async () => {
      const parent = await createParentProduct('test-arch-parent-v');

      const varRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Variant to Archive',
          attributes: { size: 'Standard' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const variantId = varRes.body.data.variant.id;

      const pricing = await seedPricing({
        productId: parent.id,
        variantId,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 95000,
      });

      // Archive variant
      const archRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants/${variantId}/archive`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(archRes.status).toBe(200);
      expect(archRes.body.data.variant.status).toBe('ARCHIVED');

      // Verify pricing record deactivated
      const updatedPricing = await ProductPricingModel.findById(pricing._id);
      expect(updatedPricing?.isActive).toBe(false);
      expect(updatedPricing?.version).toBe(2);

      // Verify history recorded
      const history = await PriceHistoryModel.find({
        pricingId: pricing._id,
        action: 'DEACTIVATED',
      });
      expect(history).toHaveLength(1);
      expect(history[0].changeReason).toContain('archived');
    });

    it('G.13: Multi-variant parent archival cascades to child variants and all associated pricing records', async () => {
      const parent = await createParentProduct('test-parent-cascade-arch');

      // Add two variants
      const v1Res = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Child 1',
          attributes: { style: 'Alpha' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const v2Res = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Child 2',
          attributes: { style: 'Beta' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });

      const p1 = await seedPricing({
        productId: parent.id,
        variantId: v1Res.body.data.variant.id,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 11000,
      });
      const p2 = await seedPricing({
        productId: parent.id,
        variantId: v2Res.body.data.variant.id,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 22000,
      });

      // Archive parent
      const archRes = await request(app)
        .post(`/api/v1/products/${parent.id}/archive`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(archRes.status).toBe(200);

      // Verify both variants are ARCHIVED
      const v1 = await ProductVariantModel.findById(v1Res.body.data.variant.id);
      const v2 = await ProductVariantModel.findById(v2Res.body.data.variant.id);
      expect(v1?.status).toBe('ARCHIVED');
      expect(v2?.status).toBe('ARCHIVED');

      // Verify both pricing records are deactivated with history
      const updatedP1 = await ProductPricingModel.findById(p1._id);
      const updatedP2 = await ProductPricingModel.findById(p2._id);
      expect(updatedP1?.isActive).toBe(false);
      expect(updatedP2?.isActive).toBe(false);

      const h1 = await PriceHistoryModel.find({ pricingId: p1._id, action: 'DEACTIVATED' });
      const h2 = await PriceHistoryModel.find({ pricingId: p2._id, action: 'DEACTIVATED' });
      expect(h1).toHaveLength(1);
      expect(h2).toHaveLength(1);
    });

    it('G.14: Repeated archival is idempotent (no duplicate history records or version increments)', async () => {
      const product = await createStandaloneProduct('test-arch-idempotent');

      const pricing = await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 50000,
      });

      // First archival
      await request(app)
        .post(`/api/v1/products/${product.id}/archive`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      const firstPricing = await ProductPricingModel.findById(pricing._id);
      expect(firstPricing?.version).toBe(2);

      const firstHistory = await PriceHistoryModel.find({ pricingId: pricing._id });
      expect(firstHistory).toHaveLength(1);

      // Second archival is idempotent and returns 200
      const secondArchRes = await request(app)
        .post(`/api/v1/products/${product.id}/archive`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(secondArchRes.status).toBe(200);

      // Verify pricing version and history records are unchanged
      const secondPricing = await ProductPricingModel.findById(pricing._id);
      expect(secondPricing?.version).toBe(2);

      const secondHistory = await PriceHistoryModel.find({ pricingId: pricing._id });
      expect(secondHistory).toHaveLength(1);
    });
  });

  // =========================================================================
  // PART G.6: Draft Product Disposal (Decision #43)
  // =========================================================================
  describe('Draft Product Disposal', () => {
    it('G.15 & G.16: Deleting unpublished DRAFT product deletes ProductPricing records but permanently preserves PriceHistory', async () => {
      const product = await createStandaloneProduct('test-draft-disposal');

      const pricing = await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 42000,
      });

      // Manually create an initial CREATED price history entry simulating previous mutation
      await PriceHistoryModel.create({
        pricingId: pricing._id,
        productId: new Types.ObjectId(product.id),
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'CREATED',
        newB2cPricePaise: 42000,
        changeReason: 'Initial price seed',
        changedBy: catalogWriterUser._id,
      });

      // Delete the draft product
      const delRes = await request(app)
        .delete(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`);

      expect(delRes.status).toBe(200);

      // Product is deleted
      const prodCheck = await ProductModel.findById(product.id);
      expect(prodCheck).toBeNull();

      // Pricing record is deleted (hard-deleted per Decision #43)
      const pricingCheck = await ProductPricingModel.findById(pricing._id);
      expect(pricingCheck).toBeNull();

      // PriceHistory records remain PERMANENTLY preserved and searchable
      const preservedHistory = await PriceHistoryModel.find({
        productId: new Types.ObjectId(product.id),
      });
      expect(preservedHistory).toHaveLength(1);
      expect(preservedHistory[0].action).toBe('CREATED');
      expect(preservedHistory[0].newB2cPricePaise).toBe(42000);
    });
  });

  // =========================================================================
  // PART G.7: Unit Configuration Mutations & Volume Tier Validity (Decision #44)
  // =========================================================================
  describe('Unit Mutations & B2B Tier Invariant Enforcement', () => {
    it('G.17: Reject unit configuration update on standalone product when existing B2B volume tiers are incompatible', async () => {
      const product = await createStandaloneProduct('test-unit-mutation');

      // Seed pricing with B2B volume tier minQuantity = '10' (valid for PIECE stepIncrement '1')
      await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 10000,
        b2bTiers: [
          { minQuantity: '10', pricePaise: 9000 },
          { minQuantity: '20', pricePaise: 8000 },
        ],
      });

      // Attempt to update unit configuration to stepIncrement: '3'
      // 10 is not minOrderQuantity ('1') + n * 3 (1, 4, 7, 10 -> 10 works! Let's choose stepIncrement '4' -> 1, 5, 9, 13 -> 10 violates step!)
      const updateRes = await request(app)
        .patch(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          stepIncrement: '4',
        });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.error.code).toBe('EXISTING_TIERS_INCOMPATIBLE_WITH_UNIT_CHANGE');
      expect(updateRes.body.error.message).toContain(
        'incompatible with updated unit configuration',
      );
    });

    it('G.17b: Reject unit configuration update on variant when existing B2B volume tiers are incompatible', async () => {
      const parent = await createParentProduct('test-variant-unit-mut');

      const varRes = await request(app)
        .post(`/api/v1/products/${parent.id}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          title: 'Variant Unit Mut',
          attributes: { size: 'Default' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });
      const variantId = varRes.body.data.variant.id;

      // Seed pricing with tier minQuantity = '10'
      await seedPricing({
        productId: parent.id,
        variantId,
        scope: 'VARIANT_GLOBAL',
        b2cPricePaise: 15000,
        b2bTiers: [{ minQuantity: '10', pricePaise: 13000 }],
      });

      // Update variant stepIncrement to '4' -> violates tier minQuantity '10'
      const updateRes = await request(app)
        .patch(`/api/v1/products/${parent.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          stepIncrement: '4',
        });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.error.code).toBe('EXISTING_TIERS_INCOMPATIBLE_WITH_UNIT_CHANGE');
    });

    it('Accepts unit configuration update when existing tiers remain fully compatible', async () => {
      const product = await createStandaloneProduct('test-compatible-unit-mut');

      // Tiers minQuantity = '5', '9' (compatible with MOQ: '1', step: '4' since 1+1*4=5, 1+2*4=9)
      await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 20000,
        b2bTiers: [
          { minQuantity: '5', pricePaise: 18000 },
          { minQuantity: '9', pricePaise: 16000 },
        ],
      });

      const updateRes = await request(app)
        .patch(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({
          stepIncrement: '4',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.product.stepIncrement).toBe('4');
    });
  });

  // =========================================================================
  // PART G.8: Cross-Domain Transactional Rollback
  // =========================================================================
  describe('Cross-Domain Transactional Rollback', () => {
    it('G.18: Rolls back both catalogue and pricing updates if a failure occurs within the transaction', async () => {
      const product = await createStandaloneProduct('test-rollback-prod');

      const pricing = await seedPricing({
        productId: product.id,
        scope: 'STANDALONE_GLOBAL',
        b2cPricePaise: 35000,
      });

      // Mock PriceHistoryModel.create to throw an intentional error during archival cascade
      const originalCreate = PriceHistoryModel.create.bind(PriceHistoryModel);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PriceHistoryModel as any).create = function () {
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      };

      try {
        const archRes = await request(app)
          .post(`/api/v1/products/${product.id}/archive`)
          .set('Authorization', `Bearer ${catalogWriterToken}`);

        expect(archRes.status).toBe(500);

        // Verify Product remains DRAFT (not ARCHIVED)
        const checkProd = await ProductModel.findById(product.id);
        expect(checkProd?.status).toBe('DRAFT');

        // Verify Pricing remains active and version remains 1 (not incremented)
        const checkPricing = await ProductPricingModel.findById(pricing._id);
        expect(checkPricing?.isActive).toBe(true);
        expect(checkPricing?.version).toBe(1);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (PriceHistoryModel as any).create = originalCreate;
      }
    });
  });
});
