import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import type { Application } from 'express';

describe('Milestone 4 Step 3: Master Product Catalogue, Product Variants, SKU Registry & Lifecycle Governance', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Test Principals
  let catalogWriterUser: InstanceType<typeof UserModel>;
  let catalogWriterToken: string;

  let catalogPublisherUser: InstanceType<typeof UserModel>;
  let catalogPublisherToken: string;

  let catalogReadOnlyUser: InstanceType<typeof UserModel>;
  let _catalogReadOnlyToken: string;

  let unauthorizedUser: InstanceType<typeof UserModel>;
  let _unauthorizedToken: string;

  // Test Categories
  let testRootCategory: InstanceType<typeof CategoryModel>;
  let testSubcategory: InstanceType<typeof CategoryModel>;
  let inactiveRootCategory: InstanceType<typeof CategoryModel>;
  let inactiveSubcategory: InstanceType<typeof CategoryModel>;

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
      await ProductModel.deleteMany({ slug: { $regex: /^test-/ } });
      await ProductVariantModel.deleteMany({});
      await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-/ } });
      await ProductPricingModel.deleteMany({});
      await mongoose.connection.collection('price_history').deleteMany({});
      await CategoryModel.deleteMany({ slug: { $regex: /^test-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919444/ } });
      await RoleModel.deleteMany({ code: { $regex: /^PROD_TEST_/ } });
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await ProductModel.deleteMany({ slug: { $regex: /^test-/ } });
      await ProductVariantModel.deleteMany({});
      await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-/ } });
      await ProductPricingModel.deleteMany({});
      await mongoose.connection.collection('price_history').deleteMany({});
      await CategoryModel.deleteMany({ slug: { $regex: /^test-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919444/ } });
      await RoleModel.deleteMany({ code: { $regex: /^PROD_TEST_/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (!isDbConnected) return;

    // Clean test products, variants, registry, and categories
    await ProductModel.deleteMany({ slug: { $regex: /^test-/ } });
    await ProductVariantModel.deleteMany({});
    await SkuRegistryModel.deleteMany({});
    await ProductPricingModel.deleteMany({});
    await mongoose.connection.collection('price_history').deleteMany({});
    await CategoryModel.deleteMany({ slug: { $regex: /^test-/ } });

    // Seed Active Categories
    testRootCategory = await CategoryModel.create({
      slug: 'test-civil-materials',
      name: 'Test Civil Materials',
      level: 0,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    testSubcategory = await CategoryModel.create({
      slug: 'test-cement-sub',
      name: 'Test Cement Subcategory',
      parentId: testRootCategory._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    // Seed Inactive Categories
    inactiveRootCategory = await CategoryModel.create({
      slug: 'test-inactive-root',
      name: 'Test Inactive Root',
      level: 0,
      displayOrder: 2,
      isActive: false,
      version: 0,
    });

    inactiveSubcategory = await CategoryModel.create({
      slug: 'test-inactive-sub',
      name: 'Test Inactive Sub',
      parentId: inactiveRootCategory._id,
      level: 1,
      displayOrder: 1,
      isActive: false,
      version: 0,
    });

    // 1. Catalog Writer Role (CATALOG_READ, CATALOG_WRITE)
    await RoleModel.findOneAndUpdate(
      { code: 'PROD_TEST_WRITER' },
      {
        code: 'PROD_TEST_WRITER',
        name: 'Catalog Writer Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
      },
      { upsert: true, new: true },
    );
    catalogWriterUser = (await UserModel.findOneAndUpdate(
      { phone: '+919444000001' },
      {
        phone: '+919444000001',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['PROD_TEST_WRITER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;
    catalogWriterToken = tokenService.signAccessToken(catalogWriterUser);

    // 2. Catalog Publisher Role (CATALOG_READ, CATALOG_WRITE, CATALOG_PUBLISH)
    await RoleModel.findOneAndUpdate(
      { code: 'PROD_TEST_PUBLISHER' },
      {
        code: 'PROD_TEST_PUBLISHER',
        name: 'Catalog Publisher Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.CATALOG_PUBLISH,
        ],
      },
      { upsert: true, new: true },
    );
    catalogPublisherUser = (await UserModel.findOneAndUpdate(
      { phone: '+919444000002' },
      {
        phone: '+919444000002',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['PROD_TEST_PUBLISHER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;
    catalogPublisherToken = tokenService.signAccessToken(catalogPublisherUser);

    // 3. Catalog Read-Only Role (CATALOG_READ)
    await RoleModel.findOneAndUpdate(
      { code: 'PROD_TEST_RO' },
      {
        code: 'PROD_TEST_RO',
        name: 'Catalog Read Only Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ],
      },
      { upsert: true, new: true },
    );
    catalogReadOnlyUser = (await UserModel.findOneAndUpdate(
      { phone: '+919444000003' },
      {
        phone: '+919444000003',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['PROD_TEST_RO'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;
    _catalogReadOnlyToken = tokenService.signAccessToken(catalogReadOnlyUser);

    // 4. Unauthorized User
    await RoleModel.findOneAndUpdate(
      { code: 'PROD_TEST_NONE' },
      {
        code: 'PROD_TEST_NONE',
        name: 'Unauthorized Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [],
      },
      { upsert: true, new: true },
    );
    unauthorizedUser = (await UserModel.findOneAndUpdate(
      { phone: '+919444000004' },
      {
        phone: '+919444000004',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['PROD_TEST_NONE'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;
    _unauthorizedToken = tokenService.signAccessToken(unauthorizedUser);
  });

  // =========================================================================
  // DOMAIN 1: Product Creation & Permissions (AC-PROD-01 to AC-PROD-07)
  // =========================================================================

  it('AC-PROD-01: Draft Creation with Auto-Generated SKU reserves SKU with status RESERVED', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'UltraTech Super Cement 50kg',
        brand: 'UltraTech',
        slug: 'test-ultratech-cement-50kg',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        images: ['https://assets.thehomez.in/products/cement.webp'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product.status).toBe('DRAFT');
    expect(res.body.data.product.publishedAt).toBeNull();
    expect(res.body.data.product.sku).toMatch(/^THZ-P-[A-Z0-9]+-[A-Z0-9]+$/);

    const registryRecord = await SkuRegistryModel.findOne({ sku: res.body.data.product.sku });
    expect(registryRecord).not.toBeNull();
    expect(registryRecord?.status).toBe('RESERVED');
    expect(registryRecord?.entityType).toBe('PRODUCT');
    expect(registryRecord?.entityId.toString()).toBe(res.body.data.product.id);
  });

  it('AC-PROD-02: Draft Creation with Manual Valid SKU reserves custom SKU', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Tata Tiscon 12mm Rebar',
        brand: 'Tata Tiscon',
        slug: 'test-tata-tiscon-12mm',
        sku: 'THZ-STEEL-TIS-12MM',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.product.sku).toBe('THZ-STEEL-TIS-12MM');

    const registryRecord = await SkuRegistryModel.findOne({ sku: 'THZ-STEEL-TIS-12MM' });
    expect(registryRecord).not.toBeNull();
    expect(registryRecord?.status).toBe('RESERVED');
  });

  it('AC-PROD-03: Direct Publication Gate rejects writer without catalog:publish with HTTP 403', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Unpublished Direct Attempt',
        brand: 'ACC',
        slug: 'test-acc-cement',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        publish: true,
        images: ['https://assets.thehomez.in/products/acc.webp'],
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_PUBLISH_WITHOUT_PERMISSION');
  });

  it('AC-PROD-04: Single Actor Dual-Permission Convenience directly publishes product and records publishedAt', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Ambuja Kawach Cement 50kg',
        brand: 'Ambuja',
        slug: 'test-ambuja-cement',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        publish: true,
        images: ['https://assets.thehomez.in/products/ambuja.webp'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.product.status).toBe('ACTIVE');
    expect(res.body.data.product.publishedAt).not.toBeNull();
    expect(res.body.data.product.publishedBy).toBe(catalogPublisherUser._id.toString());

    const registryRecord = await SkuRegistryModel.findOne({ sku: res.body.data.product.sku });
    expect(registryRecord?.status).toBe('ASSIGNED');
  });

  it('AC-PROD-05: Multi-variant container has sku null and zero registry SKUs', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Jindal Panther TMT Steel Bars',
        brand: 'Jindal',
        slug: 'test-jindal-tmt-container',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.product.hasVariants).toBe(true);
    expect(res.body.data.product.sku).toBeNull();

    const count = await SkuRegistryModel.countDocuments({ productId: res.body.data.product.id });
    expect(count).toBe(0);
  });

  it('AC-PROD-06: Brand attribute is mandatory and indexed', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Brandless Product',
        slug: 'test-no-brand',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-PROD-07: Specifications schema rejects duplicate keys with differing casing', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Duplicate Spec Product',
        brand: 'Birla',
        slug: 'test-duplicate-spec',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        specifications: {
          Grade: 'OPC 53',
          grade: 'PPC',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_SPECIFICATION_KEY');
  });

  // =========================================================================
  // DOMAIN 2: Catalogue-Wide SKU Uniqueness & Replacement (AC-PROD-08 to AC-PROD-13)
  // =========================================================================

  it('AC-PROD-08: Catalogue-Wide SKU Uniqueness prevents Variant from taking Product SKU', async () => {
    // 1. Create product with specific SKU
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Shared SKU Product',
        brand: 'BrandA',
        slug: 'test-shared-sku-product',
        sku: 'THZ-SHARED-SKU-01',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    // 2. Create multi-variant container
    const containerRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Multi-variant Steel Container',
        brand: 'BrandB',
        slug: 'test-steel-container-08',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    // 3. Attempt to add variant with the Product SKU
    const variantRes = await request(app)
      .post(`/api/v1/products/${containerRes.body.data.product.id}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant colliding with Product SKU',
        sku: 'THZ-SHARED-SKU-01',
        attributes: { size: '10mm' },
      });

    expect(variantRes.status).toBe(409);
    expect(variantRes.body.error.code).toBe('VARIANT_SKU_EXISTS');
  });

  it('AC-PROD-09: Case-insensitive SKU uniqueness rejects lowercase colliding SKU', async () => {
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Case SKU Product',
        brand: 'BrandC',
        slug: 'test-case-sku-product',
        sku: 'THZ-CASE-TEST-01',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    const collideRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Colliding Case SKU',
        brand: 'BrandD',
        slug: 'test-case-collide',
        sku: 'thz-case-test-01', // lowercase
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    expect(collideRes.status).toBe(409);
    expect(collideRes.body.error.code).toBe('PRODUCT_SKU_EXISTS');
  });

  it('AC-PROD-10: Concurrent creation collision safety ensures exactly 1 succeeds and 4 fail 409', async () => {
    const payload = {
      title: 'Concurrent Product',
      brand: 'FastBrand',
      sku: 'THZ-CONCURRENT-01',
      categoryId: testRootCategory._id.toString(),
      subcategoryId: testSubcategory._id.toString(),
    };

    const requests = Array.from({ length: 5 }, (_, i) =>
      request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ ...payload, slug: `test-concurrent-slug-${i}` }),
    );

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(4);

    const registryRecords = await SkuRegistryModel.find({ normalizedSku: 'THZ-CONCURRENT-01' });
    expect(registryRecords.length).toBe(1);
  });

  it('AC-PROD-11: SKU Immutability Gate rejects modifying SKU of published product with HTTP 400', async () => {
    // 1. Create and publish product
    const pubRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Immutable SKU Product',
        brand: 'BrandE',
        slug: 'test-immutable-sku',
        sku: 'THZ-IMMUTABLE-01',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        publish: true,
        images: ['https://assets.thehomez.in/img.webp'],
      });

    const productId = pubRes.body.data.product.id;

    // 2. Attempt to patch SKU
    const patchRes = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ sku: 'THZ-IMMUTABLE-NEW' });

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error.code).toBe('IMMUTABLE_SKU_MODIFICATION');
  });

  it('AC-PROD-12: In-Place Atomic SKU Replacement updates draft reservation without breaking ownership', async () => {
    // 1. Create draft product
    const createRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Draft Replacement Product',
        brand: 'BrandF',
        slug: 'test-draft-replace',
        sku: 'THZ-DRAFT-ORIGINAL',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    const productId = createRes.body.data.product.id;

    // 2. Patch SKU to new value
    const patchRes = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ sku: 'THZ-DRAFT-REPLACED' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.product.sku).toBe('THZ-DRAFT-REPLACED');

    // 3. Verify registry record was updated in place
    const oldRecord = await SkuRegistryModel.findOne({ sku: 'THZ-DRAFT-ORIGINAL' });
    expect(oldRecord).toBeNull();

    const newRecord = await SkuRegistryModel.findOne({ sku: 'THZ-DRAFT-REPLACED' });
    expect(newRecord).not.toBeNull();
    expect(newRecord?.entityId.toString()).toBe(productId);
    expect(newRecord?.status).toBe('RESERVED');
  });

  it('AC-PROD-13: SKU Reservation on Archival updates status to ARCHIVED and keeps SKU reserved', async () => {
    const createRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Product to Archive',
        brand: 'BrandG',
        slug: 'test-to-archive-13',
        sku: 'THZ-ARCHIVE-TEST-01',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    const productId = createRes.body.data.product.id;

    // Archive product
    const archRes = await request(app)
      .post(`/api/v1/products/${productId}/archive`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(archRes.status).toBe(200);
    expect(archRes.body.data.product.status).toBe('ARCHIVED');

    const reg = await SkuRegistryModel.findOne({ sku: 'THZ-ARCHIVE-TEST-01' });
    expect(reg?.status).toBe('ARCHIVED');

    // Attempt to register same SKU
    const reUseRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Reuse Attempt',
        brand: 'BrandG',
        slug: 'test-reuse-attempt',
        sku: 'THZ-ARCHIVE-TEST-01',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    expect(reUseRes.status).toBe(409);
    expect(reUseRes.body.error.code).toBe('PRODUCT_SKU_EXISTS');
  });

  // =========================================================================
  // DOMAIN 3: Product Variants & Parent Coordination (AC-PROD-14 to AC-PROD-19)
  // =========================================================================

  it('AC-PROD-14: Variant Creation acquires parent lock and reserves variant SKU', async () => {
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Steel Parent Container',
        brand: 'Tata',
        slug: 'test-steel-parent-14',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    const parentId = parentRes.body.data.product.id;
    const initialVersion = parentRes.body.data.product.version;

    const variantRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: '12mm Diameter - 12m Length',
        attributes: { diameter: '12mm', length: '12m' },
        images: ['https://assets.thehomez.in/variant1.webp'],
      });

    expect(variantRes.status).toBe(201);
    expect(variantRes.body.data.variant.productId).toBe(parentId);
    expect(variantRes.body.data.variant.sku).toMatch(/^THZ-V-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(variantRes.body.data.variant.status).toBe('DRAFT');

    const updatedParent = await ProductModel.findById(parentId);
    expect(updatedParent?.version).toBe(initialVersion + 1);
  });

  it('AC-PROD-15: Variant Prohibition on Single Products returns HTTP 400', async () => {
    const singleProductRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Single Item Bag',
        brand: 'Birla',
        slug: 'test-single-item-15',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
      });

    const res = await request(app)
      .post(`/api/v1/products/${singleProductRes.body.data.product.id}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Invalid Variant',
        attributes: { weight: '50kg' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_ADD_VARIANT_TO_NON_VARIANT_PRODUCT');
  });

  it('AC-PROD-16: Canonical Attribute Duplicate Prevention rejects identical key-value combinations', async () => {
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant Attributes Container',
        brand: 'BrandH',
        slug: 'test-variant-attr-container',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    const parentId = parentRes.body.data.product.id;

    // Add first variant
    await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant 1',
        attributes: { diameter: '12mm', length: '12m' },
      });

    // Attempt second variant with inverted keys
    const dupRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant 2 Duplicate',
        attributes: { length: '12m', diameter: '12mm' },
      });

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_VARIANT_ATTRIBUTES');
  });

  it('AC-PROD-17: Variant Activation requires catalog:publish, sets publishedAt and ASSIGNED in registry', async () => {
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Activation Parent',
        brand: 'Tata',
        slug: 'test-activation-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
      });

    const parentId = parentRes.body.data.product.id;

    // Add draft variant
    const varRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Draft Variant',
        attributes: { size: '16mm' },
      });

    const variantId = varRes.body.data.variant.id;

    // Attempt activation with only catalog:write -> 403
    const failRes = await request(app)
      .patch(`/api/v1/products/${parentId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ status: 'ACTIVE' });

    expect(failRes.status).toBe(403);
    expect(failRes.body.error.code).toBe('CANNOT_ACTIVATE_VARIANT_WITHOUT_PERMISSION');

    // Seed active global pricing for variant before activation (Decisions #40 & #45)
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(parentId),
      variantId: new mongoose.Types.ObjectId(variantId),
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    // Activate with catalog:publish -> 200
    const passRes = await request(app)
      .patch(`/api/v1/products/${parentId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({ status: 'ACTIVE' });

    expect(passRes.status).toBe(200);
    expect(passRes.body.data.variant.status).toBe('ACTIVE');
    expect(passRes.body.data.variant.publishedAt).not.toBeNull();

    const reg = await SkuRegistryModel.findOne({ entityId: variantId });
    expect(reg?.status).toBe('ASSIGNED');
  });

  it('AC-PROD-18: Atomic Parent Archival cascades ARCHIVED status to child variants and retains publishedAt', async () => {
    // 1. Create parent container
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Cascade Archive Parent',
        brand: 'Tata',
        slug: 'test-cascade-archive',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Add variant and publish it
    const varRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant to be archived',
        attributes: { size: '20mm' },
      });

    const variantId = varRes.body.data.variant.id;

    // Seed active global pricing for variant before activation
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(parentId),
      variantId: new mongoose.Types.ObjectId(variantId),
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    await request(app)
      .patch(`/api/v1/products/${parentId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({ status: 'ACTIVE' });

    const activeVariant = await ProductVariantModel.findById(variantId);
    const originalPublishedAt = activeVariant?.publishedAt;
    expect(originalPublishedAt).not.toBeNull();

    // 3. Archive parent
    const archRes = await request(app)
      .post(`/api/v1/products/${parentId}/archive`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(archRes.status).toBe(200);

    const updatedVariant = await ProductVariantModel.findById(variantId);
    expect(updatedVariant?.status).toBe('ARCHIVED');
    expect(updatedVariant?.publishedAt?.toISOString()).toBe(originalPublishedAt?.toISOString());

    const reg = await SkuRegistryModel.findOne({ entityId: variantId });
    expect(reg?.status).toBe('ARCHIVED');
  });

  it('AC-PROD-19: Maximum Variant Limit of 50 is strictly enforced', async () => {
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Max Variant Parent',
        brand: 'BrandI',
        slug: 'test-max-variants',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    const parentId = parentRes.body.data.product.id;

    // Directly seed 50 variants
    const bulkVariants = Array.from({ length: 50 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(parentId),
      sku: `THZ-V-TEST-BULK-${i}`,
      title: `Variant ${i}`,
      status: 'DRAFT',
      attributes: { index: `${i}` },
      images: [],
      publishedAt: null,
    }));
    await ProductVariantModel.insertMany(bulkVariants);

    // Attempt to add 51st variant
    const overRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Variant 51 Overflow',
        attributes: { index: '51' },
      });

    expect(overRes.status).toBe(400);
    expect(overRes.body.error.code).toBe('MAX_VARIANTS_EXCEEDED');
  });

  // =========================================================================
  // DOMAIN 4: Category Concurrency & Reconciled Rules (AC-PROD-20 to AC-PROD-25)
  // =========================================================================

  it('AC-PROD-20: Drafting under Inactive Category is permitted', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Draft Under Inactive Category',
        brand: 'BrandJ',
        slug: 'test-draft-inactive-cat',
        categoryId: inactiveRootCategory._id.toString(),
        subcategoryId: inactiveSubcategory._id.toString(),
        hasVariants: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.product.status).toBe('DRAFT');
  });

  it('AC-PROD-21: Mandatory Category Hierarchy Validation rejects mismatched parents', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Mismatched Category Product',
        brand: 'BrandK',
        slug: 'test-mismatch-cat',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: inactiveSubcategory._id.toString(), // belongs to inactiveRootCategory
        hasVariants: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CATEGORY_RELATION');
  });

  it('AC-PROD-22: Inactive Category Publication Guard rejects publication with HTTP 400 CATEGORY_INACTIVE', async () => {
    // 1. Create draft under inactive category
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Inactive Cat Product',
        brand: 'BrandL',
        slug: 'test-inactive-cat-pub',
        categoryId: inactiveRootCategory._id.toString(),
        subcategoryId: inactiveSubcategory._id.toString(),
        hasVariants: false,
        images: ['https://assets.thehomez.in/img.webp'],
      });

    const productId = draftRes.body.data.product.id;

    // 2. Attempt to publish
    const pubRes = await request(app)
      .post(`/api/v1/products/${productId}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('CATEGORY_INACTIVE');
  });

  it('AC-PROD-23: Category deactivation vs product publication concurrency guarantees zero inconsistent state', async () => {
    // Product under active category
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Race Condition Product',
        brand: 'BrandM',
        slug: 'test-race-product',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/img.webp'],
      });

    const productId = draftRes.body.data.product.id;

    // Seed active global pricing before publication
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(productId),
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    // Concurrent deactivation and publication
    const [deactRes, pubRes] = await Promise.all([
      request(app)
        .patch(`/api/v1/categories/${testRootCategory._id}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ isActive: false }),
      request(app)
        .post(`/api/v1/products/${productId}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`),
    ]);

    expect(deactRes.status).toBe(200);

    // Guaranteed mutual exclusion: either publication committed before deactivation,
    // or deactivation committed first causing publication to abort with CATEGORY_INACTIVE.
    if (pubRes.status === 200) {
      const finalProduct = await ProductModel.findById(productId);
      expect(finalProduct?.status).toBe('ACTIVE');
    } else {
      expect(pubRes.status).toBe(400);
      expect(pubRes.body.error.code).toBe('CATEGORY_INACTIVE');
      const finalProduct = await ProductModel.findById(productId);
      expect(finalProduct?.status).toBe('DRAFT');
    }
  });

  it('AC-PROD-24: Category Deletion is blocked with HTTP 400 CATEGORY_HAS_PRODUCTS when referenced by products', async () => {
    // Create product referencing testSubcategory
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Referencing Product',
        brand: 'BrandN',
        slug: 'test-ref-product-24',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
      });

    // Attempt to delete subcategory
    const delRes = await request(app)
      .delete(`/api/v1/categories/${testSubcategory._id}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(delRes.status).toBe(400);
    expect(delRes.body.error.code).toBe('CATEGORY_HAS_PRODUCTS');
  });

  it('AC-PROD-25: Category Soft-Deactivation Reference Preservation keeps all product records intact', async () => {
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Preserved Product',
        brand: 'BrandO',
        slug: 'test-preserved-product',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
      });

    const productId = prodRes.body.data.product.id;

    // Soft-deactivate category
    await request(app)
      .patch(`/api/v1/categories/${testRootCategory._id}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ isActive: false });

    const productInDb = await ProductModel.findById(productId);
    expect(productInDb).not.toBeNull();
    expect(productInDb?.categoryId.toString()).toBe(testRootCategory._id.toString());
  });

  // =========================================================================
  // DOMAIN 5: Product Lifecycle & Restricted Deletion (AC-PROD-26 to AC-PROD-32)
  // =========================================================================

  it('AC-PROD-26: Publication Readiness Gate rejects missing images or multi-variant product with zero active variants', async () => {
    // 1. Single product with missing images
    const p1 = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'No Images Product',
        brand: 'BrandP',
        slug: 'test-no-images-product',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        images: [],
      });

    const pub1 = await request(app)
      .post(`/api/v1/products/${p1.body.data.product.id}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pub1.status).toBe(400);
    expect(pub1.body.error.code).toBe('CANNOT_PUBLISH_PRODUCT');

    // 2. Multi-variant product with zero active variants
    const p2 = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Multi-variant Zero Active',
        brand: 'BrandQ',
        slug: 'test-zero-active-variants',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        images: ['https://assets.thehomez.in/p2.webp'],
      });

    const pub2 = await request(app)
      .post(`/api/v1/products/${p2.body.data.product.id}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pub2.status).toBe(400);
    expect(pub2.body.error.code).toBe('CANNOT_PUBLISH_PRODUCT');
  });

  it('AC-PROD-27: Maker/Checker Audit Stamp Verification populates publishedBy and preserves publishedAt upon deactivation', async () => {
    // Writer creates draft
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Maker Checker Item',
        brand: 'BrandR',
        slug: 'test-maker-checker',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/mc.webp'],
      });

    const productId = draftRes.body.data.product.id;

    // Seed active global pricing before publication
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(productId),
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    // Checker (Publisher) publishes
    const pubRes = await request(app)
      .post(`/api/v1/products/${productId}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pubRes.status).toBe(200);
    expect(pubRes.body.data.product.createdBy).toBe(catalogWriterUser._id.toString());
    expect(pubRes.body.data.product.publishedBy).toBe(catalogPublisherUser._id.toString());
    const initialPublishedAt = pubRes.body.data.product.publishedAt;
    expect(initialPublishedAt).not.toBeNull();

    // Deactivate
    const deactRes = await request(app)
      .post(`/api/v1/products/${productId}/deactivate`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(deactRes.status).toBe(200);
    expect(deactRes.body.data.product.status).toBe('INACTIVE');
    expect(deactRes.body.data.product.publishedAt).toBe(initialPublishedAt);
  });

  it('AC-PROD-28: Strict Draft Deletion Eligibility rejects deleting entities that are not unpublished DRAFTs', async () => {
    // 1. Published and deactivated product cannot be deleted
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Published to Inactive Item',
        brand: 'BrandS',
        slug: 'test-pub-to-inactive',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        publish: true,
        images: ['https://assets.thehomez.in/img.webp'],
      });

    const productId = prodRes.body.data.product.id;

    await request(app)
      .post(`/api/v1/products/${productId}/deactivate`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    const delRes = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(delRes.status).toBe(400);
    expect(delRes.body.error.code).toBe('CANNOT_DELETE_PUBLISHED_PRODUCT');
  });

  it('AC-PROD-29: Strict Dual-Condition Child Variant Verification rejects parent deletion if any child fails status DRAFT && publishedAt null', async () => {
    // Create draft parent container
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Draft Parent with Published Child',
        brand: 'BrandT',
        slug: 'test-parent-with-pub-child',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
      });

    const parentId = parentRes.body.data.product.id;

    // Add variant and activate it
    const varRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Child Variant',
        attributes: { size: '32mm' },
      });

    const variantId = varRes.body.data.variant.id;

    // Seed active global pricing for variant before activation
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(parentId),
      variantId: new mongoose.Types.ObjectId(variantId),
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    await request(app)
      .patch(`/api/v1/products/${parentId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({ status: 'ACTIVE' });

    // Attempt to delete parent -> rejected
    const delRes = await request(app)
      .delete(`/api/v1/products/${parentId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(delRes.status).toBe(400);
    expect(delRes.body.error.code).toBe('CANNOT_DELETE_PARENT_WITH_PUBLISHED_VARIANTS');
  });

  it('AC-PROD-30: Restricted Draft Parent Deletion deletes verified draft children and cleans matching RESERVED SKUs', async () => {
    // 1. Create draft parent
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Pure Draft Parent',
        brand: 'BrandU',
        slug: 'test-pure-draft-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Add two draft variants
    const v1 = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ title: 'V1', attributes: { size: '10mm' } });

    const v2 = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ title: 'V2', attributes: { size: '12mm' } });

    const v1Sku = v1.body.data.variant.sku;
    const v2Sku = v2.body.data.variant.sku;

    // Verify registry has 2 reserved SKUs
    expect(await SkuRegistryModel.countDocuments({ productId: parentId })).toBe(2);

    // 3. Delete draft parent
    const delRes = await request(app)
      .delete(`/api/v1/products/${parentId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    expect(delRes.status).toBe(200);

    // Assert parent and variants deleted
    expect(await ProductModel.findById(parentId)).toBeNull();
    expect(await ProductVariantModel.find({ productId: parentId })).toHaveLength(0);

    // Assert exact SKU reservations released
    expect(await SkuRegistryModel.findOne({ sku: v1Sku })).toBeNull();
    expect(await SkuRegistryModel.findOne({ sku: v2Sku })).toBeNull();
  });

  it('AC-PROD-31: Parent-Variant Coordination Lock covers race conditions safely', async () => {
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Coordination Race Parent',
        brand: 'BrandV',
        slug: 'test-race-parent-31',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
      });

    const parentId = parentRes.body.data.product.id;

    // Concurrently delete parent and create variant under it
    const [_delRes, _varRes] = await Promise.all([
      request(app)
        .delete(`/api/v1/products/${parentId}`)
        .set('Authorization', `Bearer ${catalogWriterToken}`),
      request(app)
        .post(`/api/v1/products/${parentId}/variants`)
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ title: 'Race Variant', attributes: { size: '16mm' } }),
    ]);

    // One operation commits, the other adapts:
    // If deletion won: varRes fails with 404 PRODUCT_NOT_FOUND.
    // If variant creation won: delRes cleans up the variant or succeeds.
    // In ALL cases, no orphaned variant under a non-existent parent!
    const remainingVariants = await ProductVariantModel.find({ productId: parentId });
    const remainingParent = await ProductModel.findById(parentId);

    if (!remainingParent) {
      expect(remainingVariants).toHaveLength(0);
    }
  });

  it('AC-PROD-32: Terminal Archived State prevents re-activating or publishing archived product', async () => {
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Archived Product',
        brand: 'BrandW',
        slug: 'test-terminal-archived',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
      });

    const productId = prodRes.body.data.product.id;

    // Archive it
    await request(app)
      .post(`/api/v1/products/${productId}/archive`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    // Attempt to publish
    const pubRes = await request(app)
      .post(`/api/v1/products/${productId}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('INVALID_PRODUCT_STATE_TRANSITION');
  });

  // =========================================================================
  // DOMAIN 6: Public Discovery & Visibility Isolation (AC-PROD-33 to AC-PROD-35)
  // =========================================================================

  it('AC-PROD-33: Public Discovery Filtering strictly returns only ACTIVE products in active categories', async () => {
    // 1. Active product under active category
    const pubProdRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Public Active Product',
        brand: 'PublicBrand',
        slug: 'test-public-active',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        publish: true,
        images: ['https://assets.thehomez.in/active.webp'],
      });

    const pubProdId = pubProdRes.body.data.product.id;
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(pubProdId),
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    // 2. Draft product under active category
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Public Draft Product',
        brand: 'DraftBrand',
        slug: 'test-public-draft',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    const res = await request(app).get('/api/v1/products/public');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const slugs = res.body.data.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('test-public-active');
    expect(slugs).not.toContain('test-public-draft');
  });

  it('AC-PROD-34: Public Variant Discovery Guard conceals child variants when parent is INACTIVE', async () => {
    // 1. Create parent container and publish it
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Guard Parent Product',
        brand: 'GuardBrand',
        slug: 'test-guard-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/guard.webp'],
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Add draft child variant (Decision #41: cannot create active directly)
    const varRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Guard Child Variant',
        attributes: { size: '10mm' },
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
      });

    const variantId = varRes.body.data.variant.id;

    // Seed active global pricing for variant before activation (Decisions #40 & #45)
    await ProductPricingModel.create({
      productId: new mongoose.Types.ObjectId(parentId),
      variantId: new mongoose.Types.ObjectId(variantId),
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      currency: 'INR',
      b2cPricePaise: 50000,
      isActive: true,
      version: 1,
      createdBy: catalogPublisherUser._id,
      updatedBy: catalogPublisherUser._id,
    });

    // Activate variant
    await request(app)
      .patch(`/api/v1/products/${parentId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({ status: 'ACTIVE' });

    // Publish parent
    await request(app)
      .post(`/api/v1/products/${parentId}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    // Verify discoverable publicly
    const pubRes1 = await request(app).get('/api/v1/products/public/test-guard-parent');
    expect(pubRes1.status).toBe(200);
    expect(pubRes1.body.data.variants).toHaveLength(1);

    // Deactivate parent
    await request(app)
      .post(`/api/v1/products/${parentId}/deactivate`)
      .set('Authorization', `Bearer ${catalogWriterToken}`);

    // Verify public lookup returns 404
    const pubRes2 = await request(app).get('/api/v1/products/public/test-guard-parent');
    expect(pubRes2.status).toBe(404);
  });

  it('AC-PROD-35: Public Slug Lookup Isolation returns HTTP 404 for draft, inactive or archived items', async () => {
    // Create draft product
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Isolated Draft Product',
        brand: 'IsoBrand',
        slug: 'test-isolated-draft',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
      });

    const res = await request(app).get('/api/v1/products/public/test-isolated-draft');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});
