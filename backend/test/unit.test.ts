import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UnitModel } from '../src/models/unit.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { unitService, productService } from '../src/services/index.js';
import {
  UserType,
  UserStatus,
  PermissionCode,
  ExactDecimalQuantity,
  validateCanonicalDecimalString,
} from '@thehomez/shared-types';
import type { Application } from 'express';

describe('Milestone 4 Step 4: Construction Units, Quantity Rules & Validation Governance', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Test Principals
  let catalogWriterUser: InstanceType<typeof UserModel>;
  let catalogWriterToken: string;

  let catalogPublisherUser: InstanceType<typeof UserModel>;
  let catalogPublisherToken: string;

  let catalogReadOnlyUser: InstanceType<typeof UserModel>;
  let catalogReadOnlyToken: string;

  let unauthorizedUser: InstanceType<typeof UserModel>;
  let unauthorizedToken: string;

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
      // 1. Initial cleanup
      await UnitModel.deleteMany({});
      await seedApprovedUnits();
      await UnitModel.syncIndexes();

      await ProductVariantModel.deleteMany({});
      await ProductModel.deleteMany({ slug: { $regex: /^unit-test-/ } });
      await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-UNIT-/ } });
      await CategoryModel.deleteMany({ slug: { $regex: /^unit-cat-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919555/ } });
      await RoleModel.deleteMany({ code: { $regex: /^UNIT_TEST_/ } });

      // 2. Roles Setup
      const writerRole = await RoleModel.create({
        code: 'UNIT_TEST_WRITER',
        name: 'Unit Test Writer',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
      });

      const publisherRole = await RoleModel.create({
        code: 'UNIT_TEST_PUBLISHER',
        name: 'Unit Test Publisher',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.CATALOG_PUBLISH,
        ],
      });

      const readOnlyRole = await RoleModel.create({
        code: 'UNIT_TEST_READONLY',
        name: 'Unit Test ReadOnly',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ],
      });

      const customerRole = await RoleModel.create({
        code: 'UNIT_TEST_CUSTOMER',
        name: 'Unit Test Customer',
        userType: UserType.CUSTOMER,
        isSystemManaged: false,
        permissions: [],
      });

      // 3. Users Setup
      catalogWriterUser = await UserModel.create({
        phone: '+919555000001',
        isPhoneVerified: true,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: [writerRole.code],
      });
      catalogWriterUser.permissions = [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE];
      catalogWriterToken = tokenService.signAccessToken(catalogWriterUser);

      catalogPublisherUser = await UserModel.create({
        phone: '+919555000002',
        isPhoneVerified: true,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: [publisherRole.code],
      });
      catalogPublisherUser.permissions = [
        PermissionCode.CATALOG_READ,
        PermissionCode.CATALOG_WRITE,
        PermissionCode.CATALOG_PUBLISH,
      ];
      catalogPublisherToken = tokenService.signAccessToken(catalogPublisherUser);

      catalogReadOnlyUser = await UserModel.create({
        phone: '+919555000003',
        isPhoneVerified: true,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: [readOnlyRole.code],
      });
      catalogReadOnlyUser.permissions = [PermissionCode.CATALOG_READ];
      catalogReadOnlyToken = tokenService.signAccessToken(catalogReadOnlyUser);

      unauthorizedUser = await UserModel.create({
        phone: '+919555000004',
        isPhoneVerified: true,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [customerRole.code],
      });
      unauthorizedUser.permissions = [];
      unauthorizedToken = tokenService.signAccessToken(unauthorizedUser);

      // 4. Setup Hierarchical Categories
      testRootCategory = await CategoryModel.create({
        name: 'Structural Materials',
        slug: 'unit-cat-structural',
        level: 0,
        parentId: null,
        isActive: true,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      testSubcategory = await CategoryModel.create({
        name: 'TMT Steel Bars',
        slug: 'unit-cat-tmt-steel',
        level: 1,
        parentId: testRootCategory._id,
        isActive: true,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      inactiveRootCategory = await CategoryModel.create({
        name: 'Inactive Root Category',
        slug: 'unit-cat-inactive-root',
        level: 0,
        parentId: null,
        isActive: false,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      inactiveSubcategory = await CategoryModel.create({
        name: 'Inactive Subcategory',
        slug: 'unit-cat-inactive-sub',
        level: 1,
        parentId: inactiveRootCategory._id,
        isActive: false,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await ProductVariantModel.deleteMany({});
      await ProductModel.deleteMany({ slug: { $regex: /^unit-test-/ } });
      await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-UNIT-/ } });
      await CategoryModel.deleteMany({ slug: { $regex: /^unit-cat-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919555/ } });
      await RoleModel.deleteMany({ code: { $regex: /^UNIT_TEST_/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (!isDbConnected) return;

    // Fast, lightweight reset of ephemeral products/variants created during tests
    await ProductVariantModel.deleteMany({});
    await ProductModel.deleteMany({ slug: { $regex: /^unit-test-/ } });
    await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-UNIT-/ } });

    // Ensure core units are active and default precision ceilings intact
    await UnitModel.updateMany(
      { isSystem: true },
      {
        $set: {
          isActive: true,
        },
      },
    );
    await UnitModel.updateOne({ code: 'TONNE' }, { $set: { allowedMaxPrecision: 3 } });
    await UnitModel.updateOne({ code: 'KG' }, { $set: { allowedMaxPrecision: 3 } });
    await UnitModel.updateOne({ code: 'BAG' }, { $set: { allowedMaxPrecision: 0 } });
  });

  // =========================================================================
  // DOMAIN 1: Unit Master Discovery, Seeding & Governance (AC-UNIT-01 to AC-UNIT-07)
  // =========================================================================

  it('AC-UNIT-01: Idempotent Core Unit Seeding', async () => {
    const res = await request(app).get('/api/v1/units');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(9);

    const codes = res.body.data.map((u: { code: string }) => u.code).sort();
    const approvedCodes = [
      'BAG',
      'BOX',
      'BUNDLE',
      'CFT',
      'KG',
      'METRE',
      'PIECE',
      'SQ_FT',
      'TONNE',
    ].sort();
    expect(codes).toEqual(approvedCodes);

    // Re-run seed (must be strictly idempotent without duplicate keys)
    const seedResult = await seedApprovedUnits();
    expect(seedResult.upsertedCount).toBe(0);
    expect(seedResult.matchedCount).toBe(9);
    const count = await UnitModel.countDocuments();
    expect(count).toBe(9);
  });

  it('AC-UNIT-02: Deferred Custom Unit Creation Gate', async () => {
    const res = await request(app)
      .post('/api/v1/units')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        code: 'YARD',
        name: 'Cubic Yard',
        symbol: 'yd3',
        singularLabel: 'Yard',
        pluralLabel: 'Yards',
        classification: 'VOLUME',
        isDiscrete: false,
        allowedMaxPrecision: 2,
      });

    // Custom unit creation deferred -> route not mounted
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('AC-UNIT-03: Unit Master Metadata Update', async () => {
    const updateRes = await request(app)
      .patch('/api/v1/units/BAG')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        name: 'Commercial Cement Bag',
        description: 'Standard commercial packaging for dry mix cementitious materials',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Commercial Cement Bag');
    expect(updateRes.body.data.description).toBe(
      'Standard commercial packaging for dry mix cementitious materials',
    );
  });

  it('AC-UNIT-04: Unit Master Immutable Fields Gate', async () => {
    const res = await request(app)
      .patch('/api/v1/units/TONNE')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        code: 'TONNE_MUTATED',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_IMMUTABLE_UNIT_FIELD');
  });

  describe('AC-UNIT-05: Controlled Precision Ceiling Governance', () => {
    it('AC-UNIT-05.1: Lowering ceiling succeeds when all relevant active entities use an allowed precision', async () => {
      // Create an active product with precision 2 under TONNE (allowedMaxPrecision is 3)
      await ProductModel.create({
        slug: 'unit-test-prec-allowed',
        title: 'Precision Allowed Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-PREC-ALLOW-01',
        status: 'ACTIVE',
        images: ['https://assets.thehomez.in/guard.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.10',
        publishedAt: new Date(),
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Lowering allowedMaxPrecision to 2 must succeed
      const res = await request(app)
        .patch('/api/v1/units/TONNE')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ allowedMaxPrecision: 2 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.allowedMaxPrecision).toBe(2);

      // Verify in DB
      const updatedUnit = await UnitModel.findOne({ code: 'TONNE' });
      expect(updatedUnit?.allowedMaxPrecision).toBe(2);
    });

    it('AC-UNIT-05.2: Lowering ceiling is blocked when an active product exceeds the proposed ceiling', async () => {
      // Create an active product with precision 3 under TONNE
      await ProductModel.create({
        slug: 'unit-test-precision-guard',
        title: 'Precision Guard Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-PREC-01',
        status: 'ACTIVE',
        images: ['https://assets.thehomez.in/guard.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: new Date(),
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Attempt to lower allowedMaxPrecision to 2 must fail
      const res = await request(app)
        .patch('/api/v1/units/TONNE')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ allowedMaxPrecision: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRECISION_IN_USE_BY_PRODUCTS');
    });

    it('AC-UNIT-05.3: Lowering ceiling is blocked when an active variant exceeds the proposed ceiling', async () => {
      // Create multi-variant parent container
      const parent = await ProductModel.create({
        slug: 'unit-test-prec-variant-parent',
        title: 'Precision Variant Parent',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: true,
        sku: null,
        status: 'ACTIVE',
        images: ['https://assets.thehomez.in/guard.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.10',
        publishedAt: new Date(),
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Create an active variant with precision 3
      await ProductVariantModel.create({
        productId: parent._id,
        sku: 'THZ-UNIT-V-PREC-01',
        title: 'Active Variant 3-Decimals',
        status: 'ACTIVE',
        attributes: { size: 'Fine Granular' },
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: new Date(),
      });

      // Attempt to lower allowedMaxPrecision to 2 must fail
      const res = await request(app)
        .patch('/api/v1/units/TONNE')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ allowedMaxPrecision: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRECISION_IN_USE_BY_PRODUCTS');
    });

    it('AC-UNIT-05.4: An unconfigured or draft product with excessive precision does not unnecessarily block a reduction', async () => {
      // Create a DRAFT product with precision 3 under TONNE (publishedAt is null)
      await ProductModel.create({
        slug: 'unit-test-draft-prec-03',
        title: 'Draft Precision 3 Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-DRAFT-PREC-03',
        status: 'DRAFT',
        images: ['https://assets.thehomez.in/draft.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: null,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Lowering allowedMaxPrecision to 2 must succeed because the product is an unpublished DRAFT
      const res = await request(app)
        .patch('/api/v1/units/TONNE')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ allowedMaxPrecision: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data.allowedMaxPrecision).toBe(2);
    });

    it('AC-UNIT-05.5: Draft product cannot subsequently be published with now-invalid precision', async () => {
      // 1. Create draft product with precision 3
      const draft = await ProductModel.create({
        slug: 'unit-test-draft-pub-reject',
        title: 'Draft Pub Reject Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-DRAFT-PUB-01',
        status: 'DRAFT',
        images: ['https://assets.thehomez.in/draft.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: null,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // 2. Reduce TONNE allowedMaxPrecision to 2
      await UnitModel.updateOne({ code: 'TONNE' }, { $set: { allowedMaxPrecision: 2 } });

      // 3. Attempt to publish the draft product
      const pubRes = await request(app)
        .post(`/api/v1/products/${draft._id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(pubRes.status).toBe(400);
      expect(pubRes.body.error.code).toBe('PRECISION_EXCEEDS_UNIT_MAXIMUM');

      // Verify product remained DRAFT
      const prodInDb = await ProductModel.findById(draft._id);
      expect(prodInDb?.status).toBe('DRAFT');
    });

    it('AC-UNIT-05.6: Previously published inactive entities block reduction and cannot bypass validation when reactivated', async () => {
      // 1. Create a previously published product that is currently INACTIVE with precision 3
      const inactiveProduct = await ProductModel.create({
        slug: 'unit-test-inactive-published',
        title: 'Inactive Previously Published Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-INACT-PUB-01',
        status: 'INACTIVE',
        images: ['https://assets.thehomez.in/img.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: new Date(Date.now() - 86400000), // published yesterday
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // 2. Attempt to lower allowedMaxPrecision to 2 must be blocked because this entity can be reactivated
      const res = await request(app)
        .patch('/api/v1/units/TONNE')
        .set('Authorization', `Bearer ${catalogWriterToken}`)
        .send({ allowedMaxPrecision: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRECISION_IN_USE_BY_PRODUCTS');

      // 3. Also verify: if the unit precision was set to 2, reactivating this product is rejected
      await UnitModel.updateOne({ code: 'TONNE' }, { $set: { allowedMaxPrecision: 2 } });
      const reactivateRes = await request(app)
        .post(`/api/v1/products/${inactiveProduct._id}/publish`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`);

      expect(reactivateRes.status).toBe(400);
      expect(reactivateRes.body.error.code).toBe('PRECISION_EXCEEDS_UNIT_MAXIMUM');
    });

    it('AC-UNIT-05.7: Variant publication and activation enforce the current unit ceiling', async () => {
      // 1. Lower TONNE ceiling to 2
      await UnitModel.updateOne({ code: 'TONNE' }, { $set: { allowedMaxPrecision: 2 } });

      // 2. Create multi-variant parent
      const parent = await ProductModel.create({
        slug: 'unit-test-variant-ceil-parent',
        title: 'Ceiling Test Parent',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: true,
        sku: null,
        status: 'ACTIVE',
        images: ['https://assets.thehomez.in/parent.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.10',
        publishedAt: new Date(),
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // 3. Create draft variant with precision 3 directly in DB
      const draftVariant = await ProductVariantModel.create({
        productId: parent._id,
        sku: 'THZ-UNIT-V-DRAFT-01',
        title: 'Draft Variant with Precision 3',
        status: 'DRAFT',
        attributes: { grade: 'Fe550D' },
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: null,
      });

      // 4. Attempt to activate variant via PATCH
      const actRes = await request(app)
        .patch(`/api/v1/products/${parent._id}/variants/${draftVariant._id}`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({ status: 'ACTIVE' });

      expect(actRes.status).toBe(400);
      expect(actRes.body.error.code).toBe('PRECISION_EXCEEDS_UNIT_MAXIMUM');
    });

    it('AC-UNIT-05.8: Unit and publication concurrency cannot create an invalid published state', async () => {
      // Draft product with precision 3 under TONNE (allowedMaxPrecision is 3)
      const draftProduct = await ProductModel.create({
        slug: 'unit-test-concurrent-race',
        title: 'Concurrent Race Product',
        brand: 'GuardBrand',
        categoryId: testRootCategory._id,
        subcategoryId: testSubcategory._id,
        hasVariants: false,
        sku: 'THZ-UNIT-RACE-01',
        status: 'DRAFT',
        images: ['https://assets.thehomez.in/race.webp'],
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.005',
        stepIncrement: '0.001',
        publishedAt: null,
        createdBy: catalogWriterUser._id,
        updatedBy: catalogWriterUser._id,
        version: 0,
      });

      // Concurrently run unit ceiling reduction to 2 and product publication
      await Promise.allSettled([
        unitService.updateUnit('TONNE', { allowedMaxPrecision: 2 }),
        productService.publishProduct(
          draftProduct._id.toString(),
          catalogPublisherUser._id.toString(),
        ),
      ]);

      // Invariant Check: It is impossible for the product to be ACTIVE while the unit ceiling is 2
      const refreshedUnit = await UnitModel.findOne({ code: 'TONNE' });
      const refreshedProduct = await ProductModel.findById(draftProduct._id);

      if (refreshedProduct?.status === 'ACTIVE') {
        // If product publication committed, unit reduction must have been blocked
        expect(refreshedUnit?.allowedMaxPrecision).toBe(3);
      } else {
        // If unit reduction succeeded, product publication must have failed
        expect(refreshedProduct?.status).toBe('DRAFT');
        expect(refreshedUnit?.allowedMaxPrecision).toBe(2);
      }
    });
  });

  it('AC-UNIT-06: Unit Deactivation Protection Gate', async () => {
    // 1. Create an active product depending on BAG
    await ProductModel.create({
      slug: 'unit-test-deactivation-guard',
      title: 'Deactivation Guard Cement',
      brand: 'GuardCement',
      categoryId: testRootCategory._id,
      subcategoryId: testSubcategory._id,
      hasVariants: false,
      sku: 'THZ-UNIT-DEACT-01',
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/deact.webp'],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      publishedAt: new Date(),
      createdBy: catalogWriterUser._id,
      updatedBy: catalogWriterUser._id,
      version: 0,
    });

    // 2. Attempt to deactivate BAG -> blocked
    const res = await request(app)
      .patch('/api/v1/units/BAG')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        isActive: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNIT_IN_USE_BY_ACTIVE_PRODUCTS');
  });

  it('AC-UNIT-07: Administrative Unit Mutation RBAC', async () => {
    const res = await request(app)
      .patch('/api/v1/units/BAG')
      .set('Authorization', `Bearer ${unauthorizedToken}`)
      .send({ name: 'Hacked Bag' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // =========================================================================
  // DOMAIN 2: Canonical Decimal String Storage & Deterministic Arithmetic (AC-UNIT-08 to AC-UNIT-12)
  // =========================================================================

  it('AC-UNIT-08: Discrete Unit Precision Invariant', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Discrete Invalid Precision Item',
        brand: 'DiscreteBrand',
        slug: 'unit-test-discrete-invalid',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 2, // Discrete unit cannot have decimal precision
        minOrderQuantity: '1.00',
        stepIncrement: '1.00',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION');
  });

  it('AC-UNIT-09: Canonical Decimal String Regex Validation', () => {
    // Valid canonical decimal strings
    expect(validateCanonicalDecimalString('0')).toBe(true);
    expect(validateCanonicalDecimalString('12')).toBe(true);
    expect(validateCanonicalDecimalString('0.5')).toBe(true);
    expect(validateCanonicalDecimalString('1250.750')).toBe(true);

    // Invalid non-canonical formats
    expect(() => validateCanonicalDecimalString('1e3')).toThrow();
    expect(() => validateCanonicalDecimalString('015')).toThrow();
    expect(() => validateCanonicalDecimalString('12.')).toThrow();
    expect(() => validateCanonicalDecimalString('-5')).toThrow();
    expect(() => validateCanonicalDecimalString('+10')).toThrow();
    expect(() => validateCanonicalDecimalString('abc')).toThrow();
  });

  it('AC-UNIT-10: Maximum String Length Guard', () => {
    const valid15 = '99999999999.999'; // 15 chars
    expect(valid15.length).toBe(15);
    expect(validateCanonicalDecimalString(valid15)).toBe(true);

    const invalid16 = '999999999999.999'; // 16 chars
    expect(invalid16.length).toBe(16);
    expect(() => validateCanonicalDecimalString(invalid16)).toThrow();
  });

  it('AC-UNIT-11: Exact Bounded Decimal Precision', () => {
    // Valid precision
    expect(ExactDecimalQuantity.validatePrecision('12.50', 2)).toBe(true);

    // Strictly rejected without floating-point rounding
    expect(ExactDecimalQuantity.validatePrecision('12.505', 2)).toBe(false);
    expect(() => ExactDecimalQuantity.toScaledBigInt('12.505', 2)).toThrow();
  });

  it('AC-UNIT-12: MongoDB Decimal String Persistence', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'BSON String Verified Product',
        brand: 'BsonBrand',
        slug: 'unit-test-bson-string',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '12',
        maxOrderQuantity: '500',
        stepIncrement: '5',
      });

    expect(res.status).toBe(201);
    const id = res.body.data.product.id;

    // Direct raw collection query
    const rawDoc = await ProductModel.collection.findOne({ _id: new Types.ObjectId(id) });
    expect(rawDoc).not.toBeNull();
    expect(typeof rawDoc?.minOrderQuantity).toBe('string');
    expect(rawDoc?.minOrderQuantity).toBe('12');
    expect(typeof rawDoc?.maxOrderQuantity).toBe('string');
    expect(rawDoc?.maxOrderQuantity).toBe('500');
    expect(typeof rawDoc?.stepIncrement).toBe('string');
    expect(rawDoc?.stepIncrement).toBe('5');
  });

  // =========================================================================
  // DOMAIN 3: Minimum-Anchored Quantity Increments (AC-UNIT-13 to AC-UNIT-17)
  // =========================================================================

  it('AC-UNIT-13: Minimum Order Quantity Floor', () => {
    const constraints = {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '12',
      maxOrderQuantity: '500',
      stepIncrement: '5',
    };

    // Submitting 10 when MOQ is 12
    const res = ExactDecimalQuantity.validate('10', constraints);
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('QUANTITY_BELOW_MINIMUM');
  });

  it('AC-UNIT-14: Maximum Order Quantity Ceiling', () => {
    const constraints = {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '12',
      maxOrderQuantity: '500',
      stepIncrement: '5',
    };

    // Submitting 501 when MaxOQ is 500
    const res = ExactDecimalQuantity.validate('501', constraints);
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('QUANTITY_ABOVE_MAXIMUM');
  });

  it('AC-UNIT-15: Minimum-Anchored Increment Calculation', () => {
    const constraints = {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '12',
      maxOrderQuantity: '500',
      stepIncrement: '5',
    };

    // 12 + 0*5 = 12 -> valid
    expect(ExactDecimalQuantity.validate('12', constraints).isValid).toBe(true);
    // 12 + 1*5 = 17 -> valid
    expect(ExactDecimalQuantity.validate('17', constraints).isValid).toBe(true);
    // 12 + 2*5 = 22 -> valid
    expect(ExactDecimalQuantity.validate('22', constraints).isValid).toBe(true);
    // 12 + 3*5 = 27 -> valid
    expect(ExactDecimalQuantity.validate('27', constraints).isValid).toBe(true);

    // 15, 20, 25 are multiples of 5, but do not satisfy 12 + 5n -> invalid
    expect(ExactDecimalQuantity.validate('15', constraints).errorCode).toBe(
      'QUANTITY_STEP_INVALID',
    );
    expect(ExactDecimalQuantity.validate('20', constraints).errorCode).toBe(
      'QUANTITY_STEP_INVALID',
    );
    expect(ExactDecimalQuantity.validate('25', constraints).errorCode).toBe(
      'QUANTITY_STEP_INVALID',
    );
  });

  it('AC-UNIT-16: Continuous Decimal Minimum-Anchored Step', () => {
    const constraints = {
      unitCode: 'TONNE',
      quantityPrecision: 2,
      minOrderQuantity: '0.50',
      maxOrderQuantity: '50.00',
      stepIncrement: '0.05',
    };

    // Valid increments: 0.50, 0.55, 0.60, 1.25
    expect(ExactDecimalQuantity.validate('0.50', constraints).isValid).toBe(true);
    expect(ExactDecimalQuantity.validate('0.55', constraints).isValid).toBe(true);
    expect(ExactDecimalQuantity.validate('0.60', constraints).isValid).toBe(true);
    expect(ExactDecimalQuantity.validate('1.25', constraints).isValid).toBe(true);

    // Invalid step: 0.52 is not 0.50 + 0.05n
    const res = ExactDecimalQuantity.validate('0.52', constraints);
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('QUANTITY_STEP_INVALID');
  });

  it('AC-UNIT-17: Upper Bound MaxOQ Alignment Independence', () => {
    const constraints = {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '22',
      stepIncrement: '5',
    };

    // 10, 15, 20 are valid
    expect(ExactDecimalQuantity.validate('10', constraints).isValid).toBe(true);
    expect(ExactDecimalQuantity.validate('15', constraints).isValid).toBe(true);
    expect(ExactDecimalQuantity.validate('20', constraints).isValid).toBe(true);

    // 22 is ceiling but not 10 + 5n -> invalid
    const res = ExactDecimalQuantity.validate('22', constraints);
    expect(res.isValid).toBe(false);
    expect(res.errorCode).toBe('QUANTITY_STEP_INVALID');
  });

  // =========================================================================
  // DOMAIN 4: Universal Conversion & Dimensional Safety (AC-UNIT-18 to AC-UNIT-22)
  // =========================================================================

  it('AC-UNIT-18: Fixed Metric Conversion — Tonne to Kg', async () => {
    const res1 = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'TONNE',
      toUnit: 'KG',
      quantity: '1.500',
    });

    expect(res1.status).toBe(200);
    expect(res1.body.data.sourceQuantity).toBe('1.500');
    expect(res1.body.data.convertedQuantity).toBe('1500.000');
    expect(res1.body.data.formatted).toBe('1,500 KG');

    const res2 = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'TONNE',
      toUnit: 'KG',
      quantity: '2.500',
    });

    expect(res2.status).toBe(200);
    expect(res2.body.data.convertedQuantity).toBe('2500.000');
  });

  it('AC-UNIT-19: Fixed Metric Conversion — Kg to Tonne', async () => {
    const res1 = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'KG',
      toUnit: 'TONNE',
      quantity: '250.000',
    });

    expect(res1.status).toBe(200);
    expect(res1.body.data.convertedQuantity).toBe('0.250');
    expect(res1.body.data.formatted).toBe('0.250 TONNE');

    const res2 = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'KG',
      toUnit: 'TONNE',
      quantity: '2500.000',
    });

    expect(res2.status).toBe(200);
    expect(res2.body.data.convertedQuantity).toBe('2.500');
  });

  it('AC-UNIT-20: Cross-Dimensional Rejection — Mass to Volume', async () => {
    const res = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'KG', // MASS
      toUnit: 'CFT', // VOLUME
      quantity: '100',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CROSS_DIMENSIONAL_CONVERSION');
    expect(res.body.error.message).toContain('prohibited without material density');
  });

  it('AC-UNIT-21: Cross-Dimensional Rejection — Area to Length', async () => {
    const res = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'SQ_FT', // AREA
      toUnit: 'METRE', // LENGTH
      quantity: '100',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CROSS_DIMENSIONAL_CONVERSION');
  });

  it('AC-UNIT-22: Undefined Packaging Conversion Guard', async () => {
    const res = await request(app).post('/api/v1/units/convert').send({
      fromUnit: 'BOX',
      toUnit: 'PIECE',
      quantity: '5',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_UNIT_CONVERSION');
  });

  // =========================================================================
  // DOMAIN 5: Product Migration, Publication Gates & Variant Snapshot Inheritance (AC-UNIT-23 to AC-UNIT-29)
  // =========================================================================

  it('AC-UNIT-23: Unconfigured Draft Creation Allowance', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Unconfigured Draft Product',
        brand: 'DraftBrand',
        slug: 'unit-test-unconfigured-draft',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        images: ['https://assets.thehomez.in/unconf-draft.webp'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.product.status).toBe('DRAFT');
    expect(res.body.data.product.unitCode).toBeNull();
  });

  it('AC-UNIT-24: Publication Gate Rejection for Unconfigured Units', async () => {
    // 1. Create draft without unit fields
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Draft Lacking Unit Config',
        brand: 'GateBrand',
        slug: 'unit-test-pub-gate-unconf',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        images: ['https://assets.thehomez.in/gate.webp'],
      });

    const productId = draftRes.body.data.product.id;

    // 2. Attempt publication -> rejected
    const pubRes = await request(app)
      .post(`/api/v1/products/${productId}/publish`)
      .set('Authorization', `Bearer ${catalogPublisherToken}`);

    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('CANNOT_PUBLISH_UNCONFIGURED_UNIT');
  });

  it('AC-UNIT-25: Variant One-Time Snapshot Inheritance', async () => {
    // 1. Create parent container with default unit configuration
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'TMT Steel Rod Parent',
        brand: 'SteelCo',
        slug: 'unit-test-steel-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        stepIncrement: '0.05',
        images: ['https://assets.thehomez.in/steel.webp'],
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Create child variant without specifying unit configuration
    const variantRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: '12mm TMT Bar',
        attributes: { diameter: '12mm' },
      });

    expect(variantRes.status).toBe(201);
    expect(variantRes.body.data.variant.unitCode).toBe('TONNE');
    expect(variantRes.body.data.variant.quantityPrecision).toBe(2);
    expect(variantRes.body.data.variant.minOrderQuantity).toBe('0.50');
    expect(variantRes.body.data.variant.stepIncrement).toBe('0.05');
  });

  it('AC-UNIT-26: Decoupled Variant Immunity from Parent Mutations', async () => {
    // 1. Create parent with BAG defaults
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Immunity Parent Product',
        brand: 'ImmunityBrand',
        slug: 'unit-test-immunity-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        stepIncrement: '5',
        images: ['https://assets.thehomez.in/immunity.webp'],
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Create child variant inheriting BAG snapshot
    const variantRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Child Variant 50kg',
        attributes: { weight: '50kg' },
      });

    const variantId = variantRes.body.data.variant.id;
    expect(variantRes.body.data.variant.minOrderQuantity).toBe('10');

    // 3. Mutate parent default ordering rules
    await request(app)
      .patch(`/api/v1/products/${parentId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        minOrderQuantity: '50',
        stepIncrement: '10',
      });

    // 4. Assert child variant document remains unaffected (immunity verified)
    const freshVariant = await ProductVariantModel.findById(variantId);
    expect(freshVariant?.minOrderQuantity).toBe('10');
    expect(freshVariant?.stepIncrement).toBe('5');
  });

  it('AC-UNIT-27: Variant-Specific Explicit Override', async () => {
    // 1. Create parent container with METRE defaults
    const parentRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Cable Conduit Parent',
        brand: 'ConduitBrand',
        slug: 'unit-test-conduit-parent',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'METRE',
        quantityPrecision: 2,
        minOrderQuantity: '10.00',
        stepIncrement: '5.00',
        images: ['https://assets.thehomez.in/conduit.webp'],
      });

    const parentId = parentRes.body.data.product.id;

    // 2. Create child variant overriding with BUNDLE packaging
    const variantRes = await request(app)
      .post(`/api/v1/products/${parentId}/variants`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Bundled Pack (10 x 3m)',
        attributes: { packaging: 'bundle' },
        unitCode: 'BUNDLE',
        quantityPrecision: 0,
        minOrderQuantity: '2',
        maxOrderQuantity: '20',
        stepIncrement: '1',
      });

    expect(variantRes.status).toBe(201);
    expect(variantRes.body.data.variant.unitCode).toBe('BUNDLE');
    expect(variantRes.body.data.variant.quantityPrecision).toBe(0);
    expect(variantRes.body.data.variant.minOrderQuantity).toBe('2');
  });

  it('AC-UNIT-28: Post-Publication Measurement Identity Immutability', async () => {
    // 1. Create and publish product
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Published Immutability Product',
        brand: 'TMT Brand',
        slug: 'unit-test-pub-immutable',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '1.00',
        stepIncrement: '0.50',
        publish: true,
        images: ['https://assets.thehomez.in/published.webp'],
      });

    const productId = prodRes.body.data.product.id;

    // 2. Attempt to mutate unitCode -> 400 IMMUTABLE_UNIT_MODIFICATION
    const patchUnitRes = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ unitCode: 'KG' });

    expect(patchUnitRes.status).toBe(400);
    expect(patchUnitRes.body.error.code).toBe('IMMUTABLE_UNIT_MODIFICATION');

    // 3. Attempt to mutate quantityPrecision -> 400 IMMUTABLE_UNIT_MODIFICATION
    const patchPrecRes = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({ quantityPrecision: 3 });

    expect(patchPrecRes.status).toBe(400);
    expect(patchPrecRes.body.error.code).toBe('IMMUTABLE_UNIT_MODIFICATION');
  });

  it('AC-UNIT-29: Post-Publication Safe Ordering Bounds Tuning', async () => {
    // 1. Create and publish product
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Published Ordering Adjustment Item',
        brand: 'AdjBrand',
        slug: 'unit-test-ordering-adj',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        maxOrderQuantity: '100',
        stepIncrement: '5',
        publish: true,
        images: ['https://assets.thehomez.in/adj.webp'],
      });

    const productId = prodRes.body.data.product.id;

    // 2. Adjust MOQ and Step Increment (permitted post-publication)
    const patchRes = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        minOrderQuantity: '20',
        stepIncrement: '10',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.product.minOrderQuantity).toBe('20');
    expect(patchRes.body.data.product.stepIncrement).toBe('10');
  });

  // =========================================================================
  // DOMAIN 6: Quantity Validation Endpoint Security (AC-UNIT-30 to AC-UNIT-33)
  // =========================================================================

  it('AC-UNIT-30: Public Validation of Active Product', async () => {
    // 1. Create and publish active product
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Active Public Validated Item',
        brand: 'PublicBrand',
        slug: 'unit-test-public-val-item',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        stepIncrement: '5',
        publish: true,
        images: ['https://assets.thehomez.in/public-val.webp'],
      });

    const productId = prodRes.body.data.product.id;

    // 2. Public validation
    const res = await request(app).post('/api/v1/units/validate-quantity').send({
      productId,
      quantity: '20', // 10 + 2*5 = 20
    });

    expect(res.status).toBe(200);
    expect(res.body.data.isValid).toBe(true);
    expect(res.body.data.unitCode).toBe('BAG');
    expect(res.body.data.constraints.minOrderQuantity).toBe('10');
  });

  it('AC-UNIT-31: Public Information Leakage Prevention for Drafts', async () => {
    // 1. Create draft product
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Secret Draft Item',
        brand: 'SecretBrand',
        slug: 'unit-test-secret-draft',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '5',
        stepIncrement: '1',
      });

    const draftId = draftRes.body.data.product.id;

    // 2. Public validation attempt without token -> returns 404
    const res = await request(app).post('/api/v1/units/validate-quantity').send({
      productId: draftId,
      quantity: '5',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');

    // 3. Active product under inactive category hierarchy also returns 404
    const hiddenProd = await ProductModel.create({
      slug: 'unit-test-inactive-cat-item',
      title: 'Hidden Inactive Item',
      brand: 'HiddenBrand',
      categoryId: inactiveRootCategory._id,
      subcategoryId: inactiveSubcategory._id,
      hasVariants: false,
      sku: 'THZ-UNIT-HIDDEN-02',
      status: 'ACTIVE',
      images: ['https://assets.thehomez.in/hidden.webp'],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '1',
      stepIncrement: '1',
      publishedAt: new Date(),
      createdBy: catalogWriterUser._id,
      updatedBy: catalogWriterUser._id,
      version: 0,
    });

    const hiddenRes = await request(app).post('/api/v1/units/validate-quantity').send({
      productId: hiddenProd._id.toString(),
      quantity: '5',
    });

    expect(hiddenRes.status).toBe(404);
    expect(hiddenRes.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('AC-UNIT-32: Administrative Validation of Draft Products', async () => {
    // 1. Create draft product
    const draftRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogWriterToken}`)
      .send({
        title: 'Admin Audited Draft',
        brand: 'AuditBrand',
        slug: 'unit-test-audit-draft',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        stepIncrement: '5',
      });

    const draftId = draftRes.body.data.product.id;

    // 2. Staff with CATALOG_READ validates draft product -> 200 OK
    const res = await request(app)
      .post('/api/v1/units/validate-quantity')
      .set('Authorization', `Bearer ${catalogReadOnlyToken}`)
      .send({
        productId: draftId,
        quantity: '15',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.isValid).toBe(true);
    expect(res.body.data.unitCode).toBe('BAG');
  });

  it('AC-UNIT-33: Commercial Isolation Gate', async () => {
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${catalogPublisherToken}`)
      .send({
        title: 'Decoupled Civil Item',
        brand: 'CivilBrand',
        slug: 'unit-test-decoupled-item',
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'CFT',
        quantityPrecision: 2,
        minOrderQuantity: '10.00',
        maxOrderQuantity: '500.00',
        stepIncrement: '5.00',
        publish: true,
        images: ['https://assets.thehomez.in/civil.webp'],
      });

    const productId = prodRes.body.data.product.id;

    const res = await request(app).post('/api/v1/units/validate-quantity').send({
      productId,
      quantity: '25.00',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isValid).toBe(true);

    // Verify zero commercial fields leaked in response data
    const data = res.body.data;
    expect(data.price).toBeUndefined();
    expect(data.stock).toBeUndefined();
    expect(data.cartId).toBeUndefined();
    expect(data.inventoryAvailable).toBeUndefined();
    expect(data.taxes).toBeUndefined();
  });
});
