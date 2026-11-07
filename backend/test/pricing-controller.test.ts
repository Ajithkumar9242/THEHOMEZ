import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

describe('Milestone 4 Step 5: Substep 5.6 — Pricing Controllers, Express Router & Security Integration', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Principals
  let pricingAdminUser: InstanceType<typeof UserModel>;
  let pricingAdminToken: string;

  let pricingViewerUser: InstanceType<typeof UserModel>;
  let pricingViewerToken: string;

  let noPricingStaffUser: InstanceType<typeof UserModel>;
  let noPricingStaffToken: string;

  let b2cCustomerUser: InstanceType<typeof UserModel>;
  let b2cCustomerToken: string;

  let b2bCustomerUser: InstanceType<typeof UserModel>;
  let b2bCustomerToken: string;

  let suspendedB2bCustomerUser: InstanceType<typeof UserModel>;
  let suspendedB2bCustomerToken: string;

  let partnerUser: InstanceType<typeof UserModel>;
  let partnerToken: string;

  // Fixtures
  let testCategory: InstanceType<typeof CategoryModel>;
  let activeServiceArea: InstanceType<typeof ServiceAreaModel>;
  let standaloneProduct: InstanceType<typeof ProductModel>;
  let multiVariantProduct: InstanceType<typeof ProductModel>;
  let activeVariant: InstanceType<typeof ProductVariantModel>;
  let _secondaryVariant: InstanceType<typeof ProductVariantModel>;
  let draftProduct: InstanceType<typeof ProductModel>;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable:', err);
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      await seedApprovedUnits();

      // Clean test collections
      await ProductPricingModel.deleteMany({});
      await PriceHistoryModel.collection.deleteMany({});
      await ProductModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });
      await ProductVariantModel.deleteMany({});
      await ServiceAreaModel.deleteMany({
        $or: [
          { code: { $regex: /^CTRL_TEST_/ } },
          { pincodes: { $in: ['600001', '600002', '600003'] } },
        ],
      });
      await CategoryModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919888/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CTRL_TEST_/ } });

      // Seed Roles
      await RoleModel.create([
        {
          code: 'CTRL_TEST_PRICING_ADMIN',
          name: 'Pricing Administrator Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [
            PermissionCode.PRICING_WRITE,
            PermissionCode.PRICING_READ,
            PermissionCode.CATALOG_READ,
          ],
        },
        {
          code: 'CTRL_TEST_PRICING_VIEWER',
          name: 'Pricing Viewer Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PRICING_READ],
        },
        {
          code: 'CTRL_TEST_NO_PRICING',
          name: 'Staff Without Pricing',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
      ]);

      // Seed Users
      pricingAdminUser = await UserModel.create({
        phone: '+919888000001',
        email: 'pricing-admin@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['CTRL_TEST_PRICING_ADMIN'],
      });
      pricingAdminToken = tokenService.signAccessToken(pricingAdminUser);

      pricingViewerUser = await UserModel.create({
        phone: '+919888000002',
        email: 'pricing-viewer@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['CTRL_TEST_PRICING_VIEWER'],
      });
      pricingViewerToken = tokenService.signAccessToken(pricingViewerUser);

      noPricingStaffUser = await UserModel.create({
        phone: '+919888000003',
        email: 'no-pricing-staff@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['CTRL_TEST_NO_PRICING'],
      });
      noPricingStaffToken = tokenService.signAccessToken(noPricingStaffUser);

      b2cCustomerUser = await UserModel.create({
        phone: '+919888000004',
        email: 'b2c-customer@thehomez.in',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      b2cCustomerToken = tokenService.signAccessToken(b2cCustomerUser);

      b2bCustomerUser = await UserModel.create({
        phone: '+919888000005',
        email: 'b2b-customer@thehomez.in',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: ['B2B_CUSTOMER'],
      });
      b2bCustomerToken = tokenService.signAccessToken(b2bCustomerUser);

      suspendedB2bCustomerUser = await UserModel.create({
        phone: '+919888000006',
        email: 'suspended-b2b@thehomez.in',
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
        roles: ['B2B_CUSTOMER'],
      });
      suspendedB2bCustomerToken = tokenService.signAccessToken(suspendedB2bCustomerUser);

      partnerUser = await UserModel.create({
        phone: '+919888000007',
        email: 'partner@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      partnerToken = tokenService.signAccessToken(partnerUser);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await ProductPricingModel.deleteMany({});
      await PriceHistoryModel.collection.deleteMany({});
      await ProductModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });
      await ProductVariantModel.deleteMany({});
      await ServiceAreaModel.deleteMany({
        $or: [
          { code: { $regex: /^CTRL_TEST_/ } },
          { pincodes: { $in: ['600001', '600002', '600003'] } },
        ],
      });
      await CategoryModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919888/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CTRL_TEST_/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (!isDbConnected) return;

    await ProductPricingModel.deleteMany({});
    await PriceHistoryModel.collection.deleteMany({});
    await ProductModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });
    await ProductVariantModel.deleteMany({});
    await ServiceAreaModel.deleteMany({
      $or: [
        { code: { $regex: /^CTRL_TEST_/ } },
        { pincodes: { $in: ['600001', '600002', '600003'] } },
      ],
    });
    await CategoryModel.deleteMany({ slug: { $regex: /^ctrl-test-/ } });

    // Seed Category
    testCategory = await CategoryModel.create({
      slug: `ctrl-test-cat-${Date.now()}`,
      name: 'Test Category',
      level: 0,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    // Seed Service Area (with pincode 600001)
    activeServiceArea = await ServiceAreaModel.create({
      code: `CTRL_TEST_MAA_${Date.now()}`,
      name: 'Chennai Central Zone',
      city: 'Chennai',
      state: 'Tamil Nadu',
      countryCode: 'IN',
      pincodes: ['600001', '600002', '600003'],
      isActive: true,
      version: 0,
    });

    // Seed Standalone Active Product
    standaloneProduct = await ProductModel.create({
      title: 'UltraTech OPC 53 Cement Bag 50kg',
      slug: `ctrl-test-cement-${Date.now()}`,
      brand: 'UltraTech',
      categoryId: testCategory._id,
      subcategoryId: testCategory._id,
      hasVariants: false,
      sku: `THZ-P-CEM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      createdBy: pricingAdminUser._id,
      updatedBy: pricingAdminUser._id,
      publishedBy: pricingAdminUser._id,
    });

    // Seed Multi-Variant Parent Product
    multiVariantProduct = await ProductModel.create({
      title: 'Tata Tiscon Fe 550D TMT Rebars',
      slug: `ctrl-test-rebars-${Date.now()}`,
      brand: 'Tata Tiscon',
      categoryId: testCategory._id,
      subcategoryId: testCategory._id,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      unitCode: 'TONNE',
      quantityPrecision: 3,
      minOrderQuantity: '1.000',
      stepIncrement: '0.500',
      createdBy: pricingAdminUser._id,
      updatedBy: pricingAdminUser._id,
      publishedBy: pricingAdminUser._id,
    });

    // Seed Child Variant 1
    activeVariant = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      title: '12mm Diameter Rebar',
      sku: `THZ-V-REBAR12-${Date.now()}`,
      attributes: new Map([['diameter', '12mm']]),
      unitCode: 'TONNE',
      quantityPrecision: 3,
      minOrderQuantity: '1.000',
      stepIncrement: '0.500',
      status: 'ACTIVE',
      publishedAt: new Date(),
      createdBy: pricingAdminUser._id,
      updatedBy: pricingAdminUser._id,
    });

    // Seed Child Variant 2 (different variant)
    _secondaryVariant = await ProductVariantModel.create({
      productId: multiVariantProduct._id,
      title: '16mm Diameter Rebar',
      sku: `THZ-V-REBAR16-${Date.now()}`,
      attributes: new Map([['diameter', '16mm']]),
      unitCode: 'TONNE',
      quantityPrecision: 3,
      minOrderQuantity: '1.000',
      stepIncrement: '0.500',
      status: 'ACTIVE',
      publishedAt: new Date(),
      createdBy: pricingAdminUser._id,
      updatedBy: pricingAdminUser._id,
    });

    // Seed Draft Product (Unpublished)
    draftProduct = await ProductModel.create({
      title: 'Draft Concrete Additive',
      slug: `ctrl-test-draft-${Date.now()}`,
      brand: 'Fosroc',
      categoryId: testCategory._id,
      subcategoryId: testCategory._id,
      hasVariants: false,
      sku: `THZ-P-DRAFT-${Date.now()}`,
      status: 'DRAFT',
      publishedAt: null,
      unitCode: 'LITRE',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '1',
      createdBy: pricingAdminUser._id,
      updatedBy: pricingAdminUser._id,
    });
  });

  // =========================================================================
  // 1. Standalone Product Pricing Management (PUT & GET /products/:id/pricing)
  // =========================================================================
  describe('Standalone Product Pricing Endpoints', () => {
    it('creates standalone global pricing with valid payload and PRICING_WRITE permission', async () => {
      const payload = {
        b2cPricePaise: 38000,
        b2cMrpPaise: 42000,
        b2bPricePaise: 35000,
        b2bTiers: [
          { minQuantity: '20', pricePaise: 34000 },
          { minQuantity: '50', pricePaise: 33000 },
        ],
        changeReason: 'Initial catalogue global price setup',
      };

      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pricing).toBeDefined();
      expect(res.body.data.pricing.productId).toBe(standaloneProduct._id.toString());
      expect(res.body.data.pricing.pricingScope).toBe('STANDALONE_GLOBAL');
      expect(res.body.data.pricing.b2cPricePaise).toBe(38000);
      expect(res.body.data.pricing.b2cMrpPaise).toBe(42000);
      expect(res.body.data.pricing.b2bPricePaise).toBe(35000);
      expect(res.body.data.pricing.b2bTiers).toHaveLength(2);
      expect(res.body.data.pricing.isActive).toBe(true);
      expect(res.body.data.pricing.version).toBe(1);

      // Verify PriceHistory was written with actor identity
      const history = await PriceHistoryModel.findOne({ pricingId: res.body.data.pricing.id });
      expect(history).not.toBeNull();
      expect(history?.action).toBe('CREATED');
      expect(history?.changedBy.toString()).toBe(pricingAdminUser._id.toString());
      expect(history?.changeReason).toBe('Initial catalogue global price setup');
    });

    it('updates standalone global pricing with expectedVersion coordination lock', async () => {
      // 1. Initial creation
      const setupRes = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 38000,
          changeReason: 'V1 setup',
        });
      expect(setupRes.status).toBe(200);
      expect(setupRes.body.data.pricing.version).toBe(1);

      // 2. Successful update with expectedVersion: 1
      const updateRes = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 39000,
          expectedVersion: 1,
          changeReason: 'V2 price revision',
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.pricing.version).toBe(2);
      expect(updateRes.body.data.pricing.b2cPricePaise).toBe(39000);

      // 3. Stale update with mismatched expectedVersion: 1 (current is 2) returns 409
      const conflictRes = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 40000,
          expectedVersion: 1, // Stale!
          changeReason: 'Conflicting revision attempt',
        });
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('PRICING_CONCURRENCY_CONFLICT');
    });

    it('creates standalone regional pricing with serviceAreaId override', async () => {
      const payload = {
        serviceAreaId: activeServiceArea._id.toString(),
        b2cPricePaise: 41000,
        changeReason: 'Chennai regional transport cost surcharge',
      };

      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.pricing.pricingScope).toBe('STANDALONE_REGIONAL');
      expect(res.body.data.pricing.serviceAreaId).toBe(activeServiceArea._id.toString());
      expect(res.body.data.pricing.b2cPricePaise).toBe(41000);
    });

    it('rejects pricing on multi-variant parent container product (PARENT_CONTAINER_CANNOT_HAVE_PRICE)', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${multiVariantProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 50000,
          changeReason: 'Invalid parent pricing',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARENT_CONTAINER_CANNOT_HAVE_PRICE');
    });

    it('retrieves standalone pricing records via GET /products/:id/pricing for authorized viewer', async () => {
      // Seed global and regional pricing
      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({ b2cPricePaise: 38000, changeReason: 'Global base' });

      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          serviceAreaId: activeServiceArea._id.toString(),
          b2cPricePaise: 41000,
          changeReason: 'Regional override',
        });

      // Query all pricing records
      const allRes = await request(app)
        .get(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingViewerToken}`);

      expect(allRes.status).toBe(200);
      expect(allRes.body.data.items).toHaveLength(2);

      // Query filtered by serviceAreaId
      const regionalRes = await request(app)
        .get(
          `/api/v1/products/${standaloneProduct._id}/pricing?serviceAreaId=${activeServiceArea._id}`,
        )
        .set('Authorization', `Bearer ${pricingViewerToken}`);

      expect(regionalRes.status).toBe(200);
      expect(regionalRes.body.data.items).toHaveLength(1);
      expect(regionalRes.body.data.items[0].pricingScope).toBe('STANDALONE_REGIONAL');
    });
  });

  // =========================================================================
  // 2. Variant Pricing Management (PUT & GET /products/:pId/variants/:vId/pricing)
  // =========================================================================
  describe('Variant Pricing Endpoints', () => {
    it('creates variant global pricing with valid payload', async () => {
      const payload = {
        b2cPricePaise: 6500000,
        b2cMrpPaise: 7000000,
        b2bPricePaise: 6100000,
        b2bTiers: [{ minQuantity: '2.000', pricePaise: 5900000 }],
        changeReason: 'Tata Tiscon 12mm rebar global pricing',
      };

      const res = await request(app)
        .put(`/api/v1/products/${multiVariantProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.pricing.pricingScope).toBe('VARIANT_GLOBAL');
      expect(res.body.data.pricing.productId).toBe(multiVariantProduct._id.toString());
      expect(res.body.data.pricing.variantId).toBe(activeVariant._id.toString());
      expect(res.body.data.pricing.b2cPricePaise).toBe(6500000);
    });

    it('creates variant regional pricing with serviceAreaId', async () => {
      const payload = {
        serviceAreaId: activeServiceArea._id.toString(),
        b2cPricePaise: 6700000,
        changeReason: 'Tata Tiscon 12mm rebar Chennai regional override',
      };

      const res = await request(app)
        .put(`/api/v1/products/${multiVariantProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.pricing.pricingScope).toBe('VARIANT_REGIONAL');
      expect(res.body.data.pricing.serviceAreaId).toBe(activeServiceArea._id.toString());
      expect(res.body.data.pricing.b2cPricePaise).toBe(6700000);
    });

    it('rejects variant pricing on standalone single product (SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE)', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 50000,
          changeReason: 'Invalid standalone variant pricing',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE');
    });

    it('rejects variant when variantId belongs to another product (VARIANT_DOES_NOT_BELONG_TO_PRODUCT)', async () => {
      // Create another product
      const foreignProduct = await ProductModel.create({
        title: 'Foreign Product',
        slug: `ctrl-test-foreign-${Date.now()}`,
        brand: 'Foreign',
        categoryId: testCategory._id,
        subcategoryId: testCategory._id,
        hasVariants: true,
        sku: null,
        status: 'ACTIVE',
        publishedAt: new Date(),
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '1.000',
        stepIncrement: '0.500',
        createdBy: pricingAdminUser._id,
        updatedBy: pricingAdminUser._id,
      });

      const res = await request(app)
        .put(`/api/v1/products/${foreignProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 6500000,
          changeReason: 'Mismatched variant test',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VARIANT_DOES_NOT_BELONG_TO_PRODUCT');
    });

    it('retrieves variant pricing records via GET /products/:pId/variants/:vId/pricing', async () => {
      await request(app)
        .put(`/api/v1/products/${multiVariantProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({ b2cPricePaise: 6500000, changeReason: 'Variant global' });

      const res = await request(app)
        .get(`/api/v1/products/${multiVariantProduct._id}/variants/${activeVariant._id}/pricing`)
        .set('Authorization', `Bearer ${pricingViewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].variantId).toBe(activeVariant._id.toString());
    });
  });

  // =========================================================================
  // 3. Pricing Audit History (GET /products/:id/pricing/history)
  // =========================================================================
  describe('Pricing Audit History Endpoint', () => {
    it('retrieves paginated audit history with correct ordering and changedBy actor', async () => {
      // Perform 2 mutations
      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({ b2cPricePaise: 38000, changeReason: 'Revision 1' });

      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({ b2cPricePaise: 39000, changeReason: 'Revision 2' });

      const res = await request(app)
        .get(`/api/v1/products/${standaloneProduct._id}/pricing/history?page=1&limit=10`)
        .set('Authorization', `Bearer ${pricingViewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(10);
      expect(res.body.data.items[0].newB2cPricePaise).toBe(39000);
      expect(res.body.data.items[0].changedBy).toBe(pricingAdminUser._id.toString());
      expect(res.body.data.items[1].newB2cPricePaise).toBe(38000);
    });
  });

  // =========================================================================
  // 4. Scope Drift Boundary: Pricing Deactivation Endpoint
  // =========================================================================
  describe('Scope Drift Boundary: Pricing Deactivation Endpoint', () => {
    it('confirms unapproved HTTP deactivation endpoint POST /api/v1/pricing/:id/deactivate is NOT exposed (returns 404 ROUTE_NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/pricing/67a700000000000000000010/deactivate`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          changeReason: 'Attempt to access de-mounted endpoint',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  // =========================================================================
  // 5. Authoritative Price Calculation (POST /api/v1/pricing/calculate)
  // =========================================================================
  describe('Authoritative Price Calculation Endpoint', () => {
    beforeEach(async () => {
      // Setup Standalone Global Price (B2C: 38000, B2B: 35000, Tiers: [20 -> 34000, 50 -> 33000])
      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          b2cPricePaise: 38000,
          b2cMrpPaise: 42000,
          b2bPricePaise: 35000,
          b2bTiers: [
            { minQuantity: '20', pricePaise: 34000 },
            { minQuantity: '50', pricePaise: 33000 },
          ],
          changeReason: 'Global base schedule',
        });

      // Setup Standalone Regional Price for Chennai 600001 (B2C: 41000, B2B: 37000, Tiers: [20 -> 36000])
      await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          serviceAreaId: activeServiceArea._id.toString(),
          b2cPricePaise: 41000,
          b2cMrpPaise: 45000,
          b2bPricePaise: 37000,
          b2bTiers: [{ minQuantity: '20', pricePaise: 36000 }],
          changeReason: 'Chennai regional schedule',
        });
    });

    it('calculates retail B2C price for anonymous public customer', async () => {
      const res = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        quantity: '10', // MOQ
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customerSegment).toBe('B2C');
      expect(res.body.data.pricingTierApplied).toBe('STANDARD_B2C');
      expect(res.body.data.unitPricePaise).toBe(38000);
      expect(res.body.data.subtotalPaise).toBe(380000); // 10 * 38000
      expect(res.body.data.savingsPaise).toBe(40000); // 10 * (42000 - 38000)
      expect(res.body.data.isServiceAreaOverride).toBe(false);
    });

    it('calculates retail B2C price for authenticated regular retail customer', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${b2cCustomerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          quantity: '25',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customerSegment).toBe('B2C');
      expect(res.body.data.unitPricePaise).toBe(38000);
      expect(res.body.data.subtotalPaise).toBe(950000); // 25 * 38000
    });

    it('calculates wholesale B2B price and applies volume tier for verified B2B contractor', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${b2bCustomerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          quantity: '25', // Qualifies for Tier 1 (minQuantity: 20)
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customerSegment).toBe('B2B');
      expect(res.body.data.pricingTierApplied).toBe('TIER_1');
      expect(res.body.data.tierMinQuantity).toBe('20');
      expect(res.body.data.unitPricePaise).toBe(34000);
      expect(res.body.data.subtotalPaise).toBe(850000); // 25 * 34000
      expect(res.body.data.savingsPaise).toBe(200000); // 25 * (42000 - 34000)
    });

    it('falls back to B2C retail rates for unverified customer account (Unverified B2B fallback)', async () => {
      // Unverified customer has ACTIVE status but lacks B2B_CUSTOMER role
      const res = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${b2cCustomerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          quantity: '25', // Would qualify for B2B tier 1 if verified
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customerSegment).toBe('B2C');
      expect(res.body.data.pricingTierApplied).toBe('STANDARD_B2C');
      expect(res.body.data.unitPricePaise).toBe(38000);
    });

    it('rejects suspended account token with 401 ACCOUNT_SUSPENDED at authentication boundary', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${suspendedB2bCustomerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          quantity: '25',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('resolves regional price override when deliveryPincode is serviceable (600001)', async () => {
      const res = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        deliveryPincode: '600001',
        quantity: '10',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.isServiceAreaOverride).toBe(true);
      expect(res.body.data.serviceAreaId).toBe(activeServiceArea._id.toString());
      expect(res.body.data.unitPricePaise).toBe(41000); // Regional B2C price
    });

    it('rejects unserviceable delivery PIN code (PINCODE_NOT_SERVICEABLE)', async () => {
      const res = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        deliveryPincode: '999999', // Non-existent area
        quantity: '10',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PINCODE_NOT_SERVICEABLE');
    });

    it('strictly rejects client injection of serviceAreaId, customerSegment, or price overrides', async () => {
      // 1. Attempted serviceAreaId injection
      const res1 = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea._id.toString(), // Strictly forbidden!
        quantity: '10',
      });
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe('VALIDATION_ERROR');

      // 2. Attempted customerSegment injection
      const res2 = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        customerSegment: 'B2B', // Strictly forbidden!
        quantity: '10',
      });
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('VALIDATION_ERROR');

      // 3. Attempted unitPricePaise injection
      const res3 = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        unitPricePaise: 100, // Strictly forbidden!
        quantity: '10',
      });
      expect(res3.status).toBe(400);
      expect(res3.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('conceals draft unpublished product from customers (404 PRODUCT_NOT_AVAILABLE) but allows admin preview', async () => {
      // Setup draft product price
      await request(app)
        .put(`/api/v1/products/${draftProduct._id}/pricing`)
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({ b2cPricePaise: 10000, changeReason: 'Draft product pricing' });

      // 1. Customer request receives 404
      const customerRes = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${b2cCustomerToken}`)
        .send({
          productId: draftProduct._id.toString(),
          quantity: '5',
        });
      expect(customerRes.status).toBe(404);
      expect(customerRes.body.error.code).toBe('PRODUCT_NOT_AVAILABLE');

      // 2. Admin request succeeds via catalog:read preview authorization
      const adminRes = await request(app)
        .post('/api/v1/pricing/calculate')
        .set('Authorization', `Bearer ${pricingAdminToken}`)
        .send({
          productId: draftProduct._id.toString(),
          quantity: '5',
        });
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.unitPricePaise).toBe(10000);
    });
  });

  // =========================================================================
  // 6. Security, RBAC & Boundary Tests
  // =========================================================================
  describe('Security, RBAC & Boundary Tests', () => {
    it('unauthenticated request to PUT /products/:id/pricing returns 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .send({ b2cPricePaise: 38000, changeReason: 'Unauth attempt' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('customer token on PUT /products/:id/pricing returns 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${b2cCustomerToken}`)
        .send({ b2cPricePaise: 38000, changeReason: 'Customer mutation attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('partner token on PUT /products/:id/pricing returns 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ b2cPricePaise: 38000, changeReason: 'Partner mutation attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('staff user lacking PRICING_WRITE permission returns 403 FORBIDDEN on PUT /pricing', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${noPricingStaffToken}`)
        .send({ b2cPricePaise: 38000, changeReason: 'Unauthorized staff attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('staff user lacking PRICING_READ permission returns 403 FORBIDDEN on GET /pricing', async () => {
      const res = await request(app)
        .get(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', `Bearer ${noPricingStaffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('staff user lacking PRICING_READ permission returns 403 FORBIDDEN on GET /pricing/history', async () => {
      const res = await request(app)
        .get(`/api/v1/products/${standaloneProduct._id}/pricing/history`)
        .set('Authorization', `Bearer ${noPricingStaffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('malformed or forged JWT returns 401 INVALID_ACCESS_TOKEN', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${standaloneProduct._id}/pricing`)
        .set('Authorization', 'Bearer forged.invalid.token')
        .send({ b2cPricePaise: 38000, changeReason: 'Forged token attempt' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  });
});
