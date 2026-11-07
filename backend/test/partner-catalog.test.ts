import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { withTransaction } from '../src/database/transaction.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { PartnerAvailabilityHistoryModel } from '../src/models/partner-availability-history.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { PartnerAvailabilityService } from '../src/services/partner-availability/index.js';
import { productService } from '../src/services/catalog/product.service.js';
import { productVariantService } from '../src/services/catalog/product-variant.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

const availabilityService = new PartnerAvailabilityService();

/**
 * Milestone 4, Step 6.5B: Consolidated Partner Availability Acceptance Test Suite
 *
 * Authoritative end-to-end verification covering all 28 acceptance criteria (AC-AVAIL-01 to AC-AVAIL-28),
 * missing HTTP edge cases, ACID archival lifecycle cascades, and database index plans on MongoDB rs0.
 */
describe('Milestone 4 Step 6.5B: Partner Availability Acceptance Test Suite', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Actors & Principals
  let partnerA: InstanceType<typeof PartnerModel>;
  let partnerB: InstanceType<typeof PartnerModel>;
  let suspendedPartner: InstanceType<typeof PartnerModel>;

  let partnerAUser: InstanceType<typeof UserModel>;
  let partnerAToken: string;

  let partnerAReadOnlyUser: InstanceType<typeof UserModel>;
  let partnerAReadOnlyToken: string;

  let partnerBUser: InstanceType<typeof UserModel>;
  let partnerBToken: string;

  let suspendedPartnerUser: InstanceType<typeof UserModel>;
  let suspendedPartnerToken: string;

  let staffAdminUser: InstanceType<typeof UserModel>;
  let staffAdminToken: string;

  let customerUser: InstanceType<typeof UserModel>;
  let customerToken: string;

  // Catalogue Fixtures
  let testCategory: InstanceType<typeof CategoryModel>;
  let activeServiceArea1: InstanceType<typeof ServiceAreaModel>;
  let activeServiceArea2: InstanceType<typeof ServiceAreaModel>;
  let inactiveServiceArea: InstanceType<typeof ServiceAreaModel>;

  let standaloneProduct: InstanceType<typeof ProductModel>;
  let multiVariantProduct: InstanceType<typeof ProductModel>;
  let activeVariant1: InstanceType<typeof ProductVariantModel>;
  let activeVariant2: InstanceType<typeof ProductVariantModel>;

  let unrelatedProduct: InstanceType<typeof ProductModel>;
  let unrelatedVariant: InstanceType<typeof ProductVariantModel>;

  async function cleanDatabase() {
    await PartnerProductModel.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
    await PartnerModel.deleteMany({
      $or: [{ businessName: { $regex: /^TEST-CT-PARTNER-/ } }, { phone: { $regex: /^\+919333/ } }],
    });
    await ProductModel.deleteMany({ slug: { $regex: /^test-ct-/ } });
    await ProductVariantModel.deleteMany({ sku: { $regex: /^TEST-CT-/ } });
    await SkuRegistryModel.deleteMany({ sku: { $regex: /^TEST-CT-/ } });
    await ProductPricingModel.deleteMany({});
    await PriceHistoryModel.collection.deleteMany({});
    await ServiceAreaModel.deleteMany({
      $or: [
        { code: { $regex: /^TEST-CT-SA-/ } },
        { pincodes: { $in: ['560071', '560072', '560073', '560074'] } },
      ],
    });
    await CategoryModel.deleteMany({ slug: { $regex: /^test-ct-/ } });
    await UserModel.deleteMany({ phone: { $regex: /^\+919333/ } });
    await RoleModel.deleteMany({ code: { $regex: /^TEST_CT_/ } });
  }

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB replica set connection unavailable:', err);
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      await seedApprovedUnits();
      await cleanDatabase();

      // 1. Service Areas
      activeServiceArea1 = await ServiceAreaModel.create({
        code: 'TEST-CT-SA-1',
        name: 'Bengaluru Core South',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560071', '560072'],
        isActive: true,
      });

      activeServiceArea2 = await ServiceAreaModel.create({
        code: 'TEST-CT-SA-2',
        name: 'Bengaluru Core North',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560073'],
        isActive: true,
      });

      inactiveServiceArea = await ServiceAreaModel.create({
        code: 'TEST-CT-SA-INACTIVE',
        name: 'Bengaluru Inactive Zone',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560074'],
        isActive: false,
      });

      // 2. Partners
      partnerA = await PartnerModel.create({
        businessName: 'TEST-CT-PARTNER-A',
        phone: '+919333000001',
        serviceAreaIds: [activeServiceArea1._id, inactiveServiceArea._id],
        status: 'ACTIVE',
      });

      partnerB = await PartnerModel.create({
        businessName: 'TEST-CT-PARTNER-B',
        phone: '+919333000002',
        serviceAreaIds: [activeServiceArea1._id, activeServiceArea2._id],
        status: 'ACTIVE',
      });

      suspendedPartner = await PartnerModel.create({
        businessName: 'TEST-CT-PARTNER-SUSPENDED',
        phone: '+919333000003',
        serviceAreaIds: [activeServiceArea1._id],
        status: 'SUSPENDED',
      });

      // 3. Category & Taxonomy
      testCategory = await CategoryModel.create({
        name: 'Acceptance Suite Category',
        slug: 'test-ct-cat',
        isActive: true,
      });

      const dummySubcatId = new Types.ObjectId();
      const dummyAdminId = new Types.ObjectId();

      // 4. Products & Variants
      standaloneProduct = await ProductModel.create({
        title: 'UltraTech Cement CT Standalone',
        slug: 'test-ct-standalone-cement',
        brand: 'UltraTech',
        categoryId: testCategory._id,
        subcategoryId: dummySubcatId,
        hasVariants: false,
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: dummyAdminId,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        maxOrderQuantity: '100',
        stepIncrement: '1',
      });

      await ProductPricingModel.create({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        b2cMrpPaise: 42000,
        isActive: true,
        version: 1,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      multiVariantProduct = await ProductModel.create({
        title: 'Tata Tiscon CT Multi-Variant',
        slug: 'test-ct-multivar-steel',
        brand: 'Tata Tiscon',
        categoryId: testCategory._id,
        subcategoryId: dummySubcatId,
        hasVariants: true,
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: dummyAdminId,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      activeVariant1 = await ProductVariantModel.create({
        productId: multiVariantProduct._id,
        sku: 'TEST-CT-SKU-TATA-10MM',
        title: 'Tata Tiscon 10mm TMT Bar',
        status: 'ACTIVE',
        publishedAt: new Date(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        attributes: { Diameter: '10mm' },
        version: 0,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      await ProductPricingModel.create({
        productId: multiVariantProduct._id,
        variantId: activeVariant1._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 55000,
        b2cMrpPaise: 60000,
        isActive: true,
        version: 1,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      activeVariant2 = await ProductVariantModel.create({
        productId: multiVariantProduct._id,
        sku: 'TEST-CT-SKU-TATA-12MM',
        title: 'Tata Tiscon 12mm TMT Bar',
        status: 'ACTIVE',
        publishedAt: new Date(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        attributes: { Diameter: '12mm' },
        version: 0,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      await ProductPricingModel.create({
        productId: multiVariantProduct._id,
        variantId: activeVariant2._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 65000,
        b2cMrpPaise: 70000,
        isActive: true,
        version: 1,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      // Unrelated product & variant (for cross-parent mismatch testing)
      unrelatedProduct = await ProductModel.create({
        title: 'Astral Pipes CT Multi-Variant',
        slug: 'test-ct-unrelated-prod',
        brand: 'Astral',
        categoryId: testCategory._id,
        subcategoryId: dummySubcatId,
        hasVariants: true,
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: dummyAdminId,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      unrelatedVariant = await ProductVariantModel.create({
        productId: unrelatedProduct._id,
        sku: 'TEST-CT-SKU-ASTRAL-1INCH',
        title: 'Astral CPVC Pipe 1 Inch',
        status: 'ACTIVE',
        publishedAt: new Date(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        attributes: { Size: '1 Inch' },
        version: 0,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      await ProductPricingModel.create({
        productId: unrelatedProduct._id,
        variantId: unrelatedVariant._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 25000,
        b2cMrpPaise: 30000,
        isActive: true,
        version: 1,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
      });

      // 5. Roles
      await RoleModel.create([
        {
          code: 'TEST_CT_PARTNER_WRITE_ROLE',
          name: 'Partner Availability Writer Role',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [
            PermissionCode.PARTNER_AVAILABILITY_WRITE,
            PermissionCode.PARTNER_AVAILABILITY_READ,
          ],
        },
        {
          code: 'TEST_CT_PARTNER_READ_ROLE',
          name: 'Partner Availability Reader Role',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
        },
        {
          code: 'TEST_CT_STAFF_ADMIN_ROLE',
          name: 'Staff Admin Full Availability Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [
            PermissionCode.PARTNER_AVAILABILITY_WRITE,
            PermissionCode.PARTNER_AVAILABILITY_READ,
            PermissionCode.PARTNER_READ,
            PermissionCode.PARTNER_SUSPEND,
            PermissionCode.CATALOG_WRITE,
            PermissionCode.CATALOG_PUBLISH,
          ],
        },
      ]);

      // 6. Users & Signed JWTs
      partnerAUser = await UserModel.create({
        phone: '+919333000001',
        email: 'partner-a-ct@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerA._id,
        roles: ['TEST_CT_PARTNER_WRITE_ROLE'],
      });
      partnerAToken = tokenService.signAccessToken(partnerAUser);

      partnerAReadOnlyUser = await UserModel.create({
        phone: '+919333000002',
        email: 'partner-a-ro-ct@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerA._id,
        roles: ['TEST_CT_PARTNER_READ_ROLE'],
      });
      partnerAReadOnlyToken = tokenService.signAccessToken(partnerAReadOnlyUser);

      partnerBUser = await UserModel.create({
        phone: '+919333000004',
        email: 'partner-b-ct@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerB._id,
        roles: ['TEST_CT_PARTNER_WRITE_ROLE'],
      });
      partnerBToken = tokenService.signAccessToken(partnerBUser);

      suspendedPartnerUser = await UserModel.create({
        phone: '+919333000005',
        email: 'partner-susp-ct@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: suspendedPartner._id,
        roles: ['TEST_CT_PARTNER_WRITE_ROLE'],
      });
      suspendedPartnerToken = tokenService.signAccessToken(suspendedPartnerUser);

      staffAdminUser = await UserModel.create({
        phone: '+919333000006',
        email: 'staff-admin-ct@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_CT_STAFF_ADMIN_ROLE'],
      });
      staffAdminToken = tokenService.signAccessToken(staffAdminUser);

      customerUser = await UserModel.create({
        phone: '+919333000007',
        email: 'customer-ct@thehomez.in',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      customerToken = tokenService.signAccessToken(customerUser);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await cleanDatabase();
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (!isDbConnected) return;
    await PartnerProductModel.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
  });

  // ============================================================================
  // SECTION 1: Tenant Isolation & Dynamic RBAC (AC-AVAIL-01 to AC-AVAIL-06)
  // ============================================================================
  describe('Section 1: Tenant Isolation & Dynamic RBAC (AC-AVAIL-01 to AC-AVAIL-06)', () => {
    it('AC-AVAIL-01: Cross-tenant availability read isolation returns 404', async () => {
      // Seed availability for Partner B
      const partnerBItem = await PartnerProductModel.create({
        partnerId: partnerB._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        version: 0,
        createdBy: partnerBUser._id,
        updatedBy: partnerBUser._id,
      });

      // Partner A attempts reading Partner B item
      const res = await request(app)
        .get(`/api/v1/partner/availability/${partnerBItem._id}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PARTNER_PRODUCT_NOT_FOUND');
    });

    it('AC-AVAIL-02: Cross-tenant availability mutation isolation returns 404', async () => {
      const partnerBItem = await PartnerProductModel.create({
        partnerId: partnerB._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        version: 0,
        createdBy: partnerBUser._id,
        updatedBy: partnerBUser._id,
      });

      // Partner A attempts patching Partner B item
      const res = await request(app)
        .patch(`/api/v1/partner/availability/${partnerBItem._id}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isAvailable: false, version: 0 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_PRODUCT_NOT_FOUND');

      // Assert Partner B record remains completely untouched
      const untouched = await PartnerProductModel.findById(partnerBItem._id);
      expect(untouched?.isAvailable).toBe(true);
      expect(untouched?.version).toBe(0);
    });

    it('AC-AVAIL-03: Route parameter tenant spoofing defense returns 403 TENANT_MISMATCH', async () => {
      // Partner A injects ?partnerId=PartnerB
      const resQuery = await request(app)
        .get(`/api/v1/partner/availability?partnerId=${partnerB._id}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resQuery.status).toBe(403);
      expect(resQuery.body.error.code).toBe('TENANT_MISMATCH');

      // Partner A injects partnerId in PUT body
      const resBody = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          partnerId: partnerB._id.toString(),
          isAvailable: true,
        });

      expect(resBody.status).toBe(403);
      expect(resBody.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('AC-AVAIL-04: Dedicated write permission enforcement rejects unauthorized users with 403', async () => {
      // Partner with only READ permission attempts write
      const resReadOnly = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAReadOnlyToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(resReadOnly.status).toBe(403);
      expect(resReadOnly.body.error.code).toBe('FORBIDDEN');

      // Customer attempts availability mutation
      const resCustomer = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(resCustomer.status).toBe(403);
      expect(resCustomer.body.error.code).toBe('FORBIDDEN');
    });

    it('AC-AVAIL-05: Platform-wide catalog write prohibition rejects partner JWT with 403 (HTTP)', async () => {
      // Partner user attempts POST /api/v1/products (requires CATALOG_WRITE)
      const resCreate = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          title: 'Partner Injected Product',
          slug: 'test-ct-partner-injected',
          brand: 'MaliciousBrand',
          categoryId: testCategory._id.toString(),
          hasVariants: false,
          unitCode: 'BAG',
        });

      expect(resCreate.status).toBe(403);
      expect(resCreate.body.success).toBe(false);
      expect(resCreate.body.error.code).toBe('FORBIDDEN');

      // Partner user attempts POST /api/v1/products/:id/archive (requires CATALOG_WRITE)
      const resArchive = await request(app)
        .post(`/api/v1/products/${standaloneProduct._id}/archive`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resArchive.status).toBe(403);
      expect(resArchive.body.error.code).toBe('FORBIDDEN');
    });

    it('AC-AVAIL-06: Administrative cross-tenant inspection allows authorized staff to inspect partner declarations', async () => {
      // Seed availability for Partner A
      await PartnerProductModel.create({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        version: 0,
        createdBy: partnerAUser._id,
        updatedBy: partnerAUser._id,
      });

      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerA._id}/availability`)
        .set('Authorization', `Bearer ${staffAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].partnerId).toBe(partnerA._id.toString());
      expect(res.body.data[0].isAvailable).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 2: Service Area Assignment & Partner Status (AC-AVAIL-07 to AC-AVAIL-11)
  // ============================================================================
  describe('Section 2: Service Area Assignment & Partner Status (AC-AVAIL-07 to AC-AVAIL-11)', () => {
    it('AC-AVAIL-07: Availability in assigned active service area succeeds with 201 Created', async () => {
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
          minLeadTimeHours: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isAvailable).toBe(true);
      expect(res.body.data.minLeadTimeHours).toBe(4);
      expect(res.body.data.partnerId).toBe(partnerA._id.toString());

      // Assert persisted in database
      const saved = await PartnerProductModel.findOne({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(saved).not.toBeNull();
      expect(saved?.isAvailable).toBe(true);
    });

    it('AC-AVAIL-08: Availability in unassigned service area rejected over HTTP with 400', async () => {
      // Partner A is not assigned to activeServiceArea2
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea2._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER');

      // Database remains clean
      const count = await PartnerProductModel.countDocuments({
        partnerId: partnerA._id,
        serviceAreaId: activeServiceArea2._id,
      });
      expect(count).toBe(0);
    });

    it('AC-AVAIL-09: Inactive service area rejected over HTTP with 400', async () => {
      // inactiveServiceArea is in partnerA.serviceAreaIds, but isActive is false
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: inactiveServiceArea._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_AREA_NOT_ACTIVE');

      const count = await PartnerProductModel.countDocuments({
        partnerId: partnerA._id,
        serviceAreaId: inactiveServiceArea._id,
      });
      expect(count).toBe(0);
    });

    it('AC-AVAIL-10: Suspended partner write rejected over HTTP with 400', async () => {
      // suspendedPartner has status === 'SUSPENDED'
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${suspendedPartnerToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PARTNER_NOT_ACTIVE');
    });

    it('AC-AVAIL-11: Suspended partner suppressed from storefront resolution over HTTP', async () => {
      // 1. Partner A links availability in SA1 (pincode: 560001)
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Public storefront resolves active availability
      const resBefore = await request(app).get('/api/v1/partner/availability/public').query({
        pincode: '560071',
        productId: standaloneProduct._id.toString(),
      });

      expect(resBefore.status).toBe(200);
      expect(resBefore.body.data.isAvailable).toBe(true);
      expect(resBefore.body.data.availablePartnerCount).toBe(1);

      // 2. Suspend Partner A account
      await PartnerModel.findByIdAndUpdate(partnerA._id, { status: 'SUSPENDED' });

      try {
        // 3. Storefront query immediately reflects unserviceable status without database rewrites
        const resAfter = await request(app).get('/api/v1/partner/availability/public').query({
          pincode: '560071',
          productId: standaloneProduct._id.toString(),
        });

        expect(resAfter.status).toBe(200);
        expect(resAfter.body.data.isAvailable).toBe(false);
        expect(resAfter.body.data.availablePartnerCount).toBe(0);
        expect(resAfter.body.data.availabilityUnknown).toBe(false);

        // Verify PartnerProduct record was not rewritten
        const rawRecord = await PartnerProductModel.findOne({
          partnerId: partnerA._id,
          productId: standaloneProduct._id,
        });
        expect(rawRecord?.isAvailable).toBe(true);
      } finally {
        // Restore Partner A status to ACTIVE
        await PartnerModel.findByIdAndUpdate(partnerA._id, { status: 'ACTIVE' });
      }
    });
  });

  // ============================================================================
  // SECTION 3: Sellable SKU & Product Lifecycle Integration (AC-AVAIL-12 to AC-AVAIL-17)
  // ============================================================================
  describe('Section 3: Sellable SKU & Product Lifecycle Integration (AC-AVAIL-12 to AC-AVAIL-17)', () => {
    it('AC-AVAIL-12: Standalone product availability linking succeeds with 201 Created', async () => {
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          variantId: null,
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.variantId).toBeNull();
      expect(res.body.data.isAvailable).toBe(true);
    });

    it('AC-AVAIL-13: Parent container availability rejected over HTTP with 400', async () => {
      // multiVariantProduct has hasVariants: true -> cannot receive availability without variantId
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: null,
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY');
    });

    it('AC-AVAIL-14: Standalone variant prohibition rejected over HTTP with 400', async () => {
      // standaloneProduct has hasVariants: false -> cannot supply variantId
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY');
    });

    it('AC-AVAIL-15: Valid child variant configuration succeeds with 201 Created', async () => {
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.productId).toBe(multiVariantProduct._id.toString());
      expect(res.body.data.variantId).toBe(activeVariant1._id.toString());
      expect(res.body.data.isAvailable).toBe(true);
    });

    it('AC-AVAIL-16: Variant-parent mismatch rejected over HTTP with 400', async () => {
      // unrelatedVariant belongs to unrelatedProduct, not multiVariantProduct
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: unrelatedVariant._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VARIANT_DOES_NOT_BELONG_TO_PRODUCT');
    });

    // ==========================================================================
    // AC-AVAIL-17: Master product & variant archival cascade integration tests
    // ==========================================================================
    describe('AC-AVAIL-17 Archival Lifecycle Integration', () => {
      it('AC-AVAIL-17A: Master product archival deactivates all active child availability with single audit entry', async () => {
        // 1. Create a dedicated multi-variant product with 2 variants
        const adminId = staffAdminUser._id;
        const archProduct = await ProductModel.create({
          title: 'Steel Bars Archival Test',
          slug: 'test-ct-arch-prod-a',
          brand: 'ArchivalBrand',
          categoryId: testCategory._id,
          subcategoryId: new Types.ObjectId(),
          hasVariants: true,
          status: 'ACTIVE',
          publishedAt: new Date(),
          publishedBy: adminId,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const var1 = await ProductVariantModel.create({
          productId: archProduct._id,
          sku: 'TEST-CT-SKU-ARCH-A1',
          title: 'Variant Arch A1',
          status: 'ACTIVE',
          publishedAt: new Date(),
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          attributes: { Grade: 'Fe500' },
          version: 0,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const var2 = await ProductVariantModel.create({
          productId: archProduct._id,
          sku: 'TEST-CT-SKU-ARCH-A2',
          title: 'Variant Arch A2',
          status: 'ACTIVE',
          publishedAt: new Date(),
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          attributes: { Grade: 'Fe550' },
          version: 0,
          createdBy: adminId,
          updatedBy: adminId,
        });

        // Seed availability:
        // Partner A var1: isAvailable = true
        // Partner B var1: isAvailable = true
        // Partner A var2: isAvailable = false (already-unavailable!)
        const ppA1 = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: archProduct._id,
          variantId: var1._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const ppB1 = await PartnerProductModel.create({
          partnerId: partnerB._id,
          productId: archProduct._id,
          variantId: var1._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const ppA2 = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: archProduct._id,
          variantId: var2._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: false,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        // 2. Perform product archival via ProductService
        const archived = await productService.archiveProduct(
          archProduct._id.toString(),
          adminId.toString(),
        );

        // Product & variants are ARCHIVED
        expect(archived.status).toBe('ARCHIVED');
        const checkVar1 = await ProductVariantModel.findById(var1._id);
        const checkVar2 = await ProductVariantModel.findById(var2._id);
        expect(checkVar1?.status).toBe('ARCHIVED');
        expect(checkVar2?.status).toBe('ARCHIVED');

        // All previously active availability records are now false
        const checkPPA1 = await PartnerProductModel.findById(ppA1._id);
        const checkPPB1 = await PartnerProductModel.findById(ppB1._id);
        expect(checkPPA1?.isAvailable).toBe(false);
        expect(checkPPA1?.version).toBe(2);
        expect(checkPPB1?.isAvailable).toBe(false);
        expect(checkPPB1?.version).toBe(2);

        // Already-unavailable record was not modified unnecessarily (version remains 1)
        const checkPPA2 = await PartnerProductModel.findById(ppA2._id);
        expect(checkPPA2?.isAvailable).toBe(false);
        expect(checkPPA2?.version).toBe(1);

        // Exactly one history entry per deactivated record
        const historyA1 = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: ppA1._id,
        });
        const historyB1 = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: ppB1._id,
        });
        const historyA2 = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: ppA2._id,
        });

        expect(historyA1).toHaveLength(1);
        expect(historyA1[0].previousState).toBe(true);
        expect(historyA1[0].newState).toBe(false);
        expect(historyA1[0].reason).toBe('Product archived: cascade availability deactivation');

        expect(historyB1).toHaveLength(1);
        expect(historyB1[0].previousState).toBe(true);
        expect(historyB1[0].newState).toBe(false);

        // Already unavailable had 0 new history entries
        expect(historyA2).toHaveLength(0);
      });

      it('AC-AVAIL-17B: Individual variant archival affects only the selected variant', async () => {
        const adminId = staffAdminUser._id;
        const archProduct = await ProductModel.create({
          title: 'Pipes Archival Test B',
          slug: 'test-ct-arch-prod-b',
          brand: 'ArchivalBrand',
          categoryId: testCategory._id,
          subcategoryId: new Types.ObjectId(),
          hasVariants: true,
          status: 'ACTIVE',
          publishedAt: new Date(),
          publishedBy: adminId,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const targetVar = await ProductVariantModel.create({
          productId: archProduct._id,
          sku: 'TEST-CT-SKU-ARCH-B-TARGET',
          title: 'Target Variant B',
          status: 'ACTIVE',
          publishedAt: new Date(),
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          attributes: { Spec: 'Target' },
          version: 0,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const siblingVar = await ProductVariantModel.create({
          productId: archProduct._id,
          sku: 'TEST-CT-SKU-ARCH-B-SIBLING',
          title: 'Sibling Variant B',
          status: 'ACTIVE',
          publishedAt: new Date(),
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          attributes: { Spec: 'Sibling' },
          version: 0,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const ppTarget = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: archProduct._id,
          variantId: targetVar._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const ppSibling = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: archProduct._id,
          variantId: siblingVar._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        // Archive only targetVar
        const archivedVariant = await productVariantService.archiveVariant(
          archProduct._id.toString(),
          targetVar._id.toString(),
          adminId.toString(),
        );

        expect(archivedVariant.status).toBe('ARCHIVED');

        // Parent and sibling remain ACTIVE
        const parentCheck = await ProductModel.findById(archProduct._id);
        const siblingCheck = await ProductVariantModel.findById(siblingVar._id);
        expect(parentCheck?.status).toBe('ACTIVE');
        expect(siblingCheck?.status).toBe('ACTIVE');

        // Target variant availability is deactivated
        const ppTargetCheck = await PartnerProductModel.findById(ppTarget._id);
        expect(ppTargetCheck?.isAvailable).toBe(false);
        expect(ppTargetCheck?.version).toBe(2);

        // Sibling availability remains intact
        const ppSiblingCheck = await PartnerProductModel.findById(ppSibling._id);
        expect(ppSiblingCheck?.isAvailable).toBe(true);
        expect(ppSiblingCheck?.version).toBe(1);

        // Correct history recorded only for target
        const targetHistories = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: ppTarget._id,
        });
        const siblingHistories = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: ppSibling._id,
        });
        expect(targetHistories).toHaveLength(1);
        expect(targetHistories[0].reason).toBe(
          'Variant archived: cascade availability deactivation',
        );
        expect(siblingHistories).toHaveLength(0);
      });

      it('AC-AVAIL-17C: Atomic rollback cleanly reverts product, variant, pricing, availability, and history on failure', async () => {
        const adminId = staffAdminUser._id;
        const rbProduct = await ProductModel.create({
          title: 'Rollback Master Product',
          slug: 'test-ct-arch-rollback-prod',
          brand: 'RollbackBrand',
          categoryId: testCategory._id,
          subcategoryId: new Types.ObjectId(),
          hasVariants: true,
          status: 'ACTIVE',
          publishedAt: new Date(),
          publishedBy: adminId,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const rbVariant = await ProductVariantModel.create({
          productId: rbProduct._id,
          sku: 'TEST-CT-SKU-RB-VAR',
          title: 'Rollback Variant',
          status: 'ACTIVE',
          publishedAt: new Date(),
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
          attributes: { Size: 'RB-1' },
          version: 0,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const rbPricing = await ProductPricingModel.create({
          productId: rbProduct._id,
          variantId: rbVariant._id,
          serviceAreaId: null,
          pricingScope: 'VARIANT_GLOBAL',
          currency: 'INR',
          b2cPricePaise: 40000,
          b2cMrpPaise: 45000,
          isActive: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const rbAvailability = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: rbProduct._id,
          variantId: rbVariant._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        const initialHistoryCount = await PartnerAvailabilityHistoryModel.countDocuments({
          partnerProductId: rbAvailability._id,
        });
        expect(initialHistoryCount).toBe(0);

        // Execute managed transaction with simulated failure post-availability deactivation
        await expect(
          withTransaction(async (session) => {
            // 1. Mutate product
            await ProductModel.updateOne(
              { _id: rbProduct._id },
              { $set: { status: 'ARCHIVED' } },
              { session },
            );

            // 2. Mutate variant
            await ProductVariantModel.updateOne(
              { _id: rbVariant._id },
              { $set: { status: 'ARCHIVED' } },
              { session },
            );

            // 3. Mutate pricing
            await ProductPricingModel.updateOne(
              { _id: rbPricing._id },
              { $set: { isActive: false } },
              { session },
            );

            // 4. Cascade availability deactivation inside the transaction session
            await availabilityService.deactivateAvailabilityForProduct(
              rbProduct._id.toString(),
              adminId.toString(),
              session,
            );

            // 5. Injected simulated transaction abort before commit
            throw new Error('SIMULATED_TRANSACTION_FAILURE_POST_DEACTIVATION');
          }),
        ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE_POST_DEACTIVATION');

        // Assert all 5 collections in MongoDB rs0 completely rolled back
        const checkProduct = await ProductModel.findById(rbProduct._id);
        const checkVariant = await ProductVariantModel.findById(rbVariant._id);
        const checkPricing = await ProductPricingModel.findById(rbPricing._id);
        const checkAvailability = await PartnerProductModel.findById(rbAvailability._id);
        const postHistoryCount = await PartnerAvailabilityHistoryModel.countDocuments({
          partnerProductId: rbAvailability._id,
        });

        expect(checkProduct?.status).toBe('ACTIVE');
        expect(checkVariant?.status).toBe('ACTIVE');
        expect(checkPricing?.isActive).toBe(true);
        expect(checkAvailability?.isAvailable).toBe(true);
        expect(checkAvailability?.version).toBe(1);
        expect(postHistoryCount).toBe(0);
      });

      it('AC-AVAIL-17D: Archival idempotency creates no duplicate history records on repeated execution', async () => {
        const adminId = staffAdminUser._id;
        const archProduct = await ProductModel.create({
          title: 'Idempotency Test Product',
          slug: 'test-ct-arch-idempotent-prod',
          brand: 'IdempotentBrand',
          categoryId: testCategory._id,
          subcategoryId: new Types.ObjectId(),
          hasVariants: false,
          status: 'ACTIVE',
          publishedAt: new Date(),
          publishedBy: adminId,
          createdBy: adminId,
          updatedBy: adminId,
          unitCode: 'BAG',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        });

        const pp = await PartnerProductModel.create({
          partnerId: partnerA._id,
          productId: archProduct._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          version: 1,
          createdBy: adminId,
          updatedBy: adminId,
        });

        // First archival
        await productService.archiveProduct(archProduct._id.toString(), adminId.toString());

        const historiesAfterFirst = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: pp._id,
        });
        expect(historiesAfterFirst).toHaveLength(1);

        // Repeat archival on already archived product
        await productService.archiveProduct(archProduct._id.toString(), adminId.toString());

        const historiesAfterSecond = await PartnerAvailabilityHistoryModel.find({
          partnerProductId: pp._id,
        });
        expect(historiesAfterSecond).toHaveLength(1);
      });
    });
  });

  // ============================================================================
  // SECTION 4: Concurrency, Partial Uniqueness & Batch Transactions (AC-AVAIL-18 to AC-AVAIL-21)
  // ============================================================================
  describe('Section 4: Concurrency, Partial Uniqueness & Batch Transactions (AC-AVAIL-18 to AC-AVAIL-21)', () => {
    it('AC-AVAIL-18: Standalone partial unique index enforcement handles duplicate PUT idempotently', async () => {
      // First PUT creates the record
      const res1 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          variantId: null,
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
          minLeadTimeHours: 2,
        });

      expect(res1.status).toBe(201);

      // Second PUT for same partner + standalone product + service area updates existing record
      const res2 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          variantId: null,
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
          minLeadTimeHours: 6,
        });

      expect(res2.status).toBe(200);

      // Assert exactly 1 record exists in database
      const records = await PartnerProductModel.find({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(records).toHaveLength(1);
      expect(records[0].minLeadTimeHours).toBe(6);
    });

    it('AC-AVAIL-19: Variant partial unique index enforcement handles duplicate PUT idempotently', async () => {
      // First PUT creates variant availability
      const res1 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
          minLeadTimeHours: 3,
        });

      expect(res1.status).toBe(201);

      // Second PUT updates existing record
      const res2 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: false,
          minLeadTimeHours: 5,
        });

      expect(res2.status).toBe(200);

      const records = await PartnerProductModel.find({
        partnerId: partnerA._id,
        productId: multiVariantProduct._id,
        variantId: activeVariant1._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(records).toHaveLength(1);
      expect(records[0].isAvailable).toBe(false);
      expect(records[0].minLeadTimeHours).toBe(5);
    });

    it('AC-AVAIL-20: Optimistic concurrency conflict detection rejects outdated version with 409', async () => {
      const createRes = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      const itemId = createRes.body.data.id;
      const initialVersion = createRes.body.data.version;

      // Request 1: succeeds with initialVersion
      const res1 = await request(app)
        .patch(`/api/v1/partner/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isAvailable: false, version: initialVersion });

      expect(res1.status).toBe(200);
      expect(res1.body.data.version).toBe(initialVersion + 1);

      // Request 2: concurrently submits original initialVersion -> rejected with 409
      const res2 = await request(app)
        .patch(`/api/v1/partner/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isAvailable: true, version: initialVersion });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    });

    it('AC-AVAIL-21: Batch failure causes no partial writes over HTTP', async () => {
      // 1. Create two items belonging to Partner A
      const create1 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      const create2 = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Create an item belonging to Partner B
      const createB = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerBToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      const itemA1Id = create1.body.data.id;
      const itemA2Id = create2.body.data.id;
      const itemBId = createB.body.data.id;

      // 2. Partner A sends a batch of 3 items: Item 1 & 2 are valid, Item 3 belongs to Partner B!
      const res = await request(app)
        .post('/api/v1/partner/availability/batch')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          items: [
            { id: itemA1Id, isAvailable: false },
            { id: itemA2Id, isAvailable: false },
            { id: itemBId, isAvailable: false }, // Cross-tenant unauthorized ID!
          ],
        });

      // Entire batch is rejected
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_PRODUCT_NOT_FOUND');

      // 3. Verify atomic rollback: neither itemA1 nor itemA2 was updated
      const checkA1 = await PartnerProductModel.findById(itemA1Id);
      const checkA2 = await PartnerProductModel.findById(itemA2Id);
      expect(checkA1?.isAvailable).toBe(true);
      expect(checkA2?.isAvailable).toBe(true);

      // Verify zero history entries were committed for this batch mutation
      const histories = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: { $in: [new Types.ObjectId(itemA1Id), new Types.ObjectId(itemA2Id)] },
        previousState: true,
      });
      expect(histories).toHaveLength(0);
    });
  });

  // ============================================================================
  // SECTION 5: State Transition Audit History (AC-AVAIL-22 to AC-AVAIL-24)
  // ============================================================================
  describe('Section 5: State Transition Audit History (AC-AVAIL-22 to AC-AVAIL-24)', () => {
    it('AC-AVAIL-22: Initial availability creation writes history record with previousState: null', async () => {
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(res.status).toBe(201);
      const itemId = res.body.data.id;

      const histories = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: new Types.ObjectId(itemId),
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].previousState).toBeNull();
      expect(histories[0].newState).toBe(true);
      expect(histories[0].partnerId.toString()).toBe(partnerA._id.toString());
      expect(histories[0].changedBy.toString()).toBe(partnerAUser._id.toString());
    });

    it('AC-AVAIL-23: Availability toggle logs operational state transition with reason', async () => {
      const item = await PartnerProductModel.create({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        version: 1,
        createdBy: partnerAUser._id,
        updatedBy: partnerAUser._id,
      });

      const res = await request(app)
        .patch(`/api/v1/partner/availability/${item._id}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          isAvailable: false,
          reason: 'Temporary warehouse stock-out',
          version: 1,
        });

      expect(res.status).toBe(200);

      const histories = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: item._id,
      }).sort({ createdAt: -1 });

      expect(histories).toHaveLength(1);
      expect(histories[0].previousState).toBe(true);
      expect(histories[0].newState).toBe(false);
      expect(histories[0].reason).toBe('Temporary warehouse stock-out');
    });

    it('AC-AVAIL-24: Audit record immutability blocks direct modifications and deletions', async () => {
      const historyEntry = await PartnerAvailabilityHistoryModel.create({
        partnerProductId: new Types.ObjectId(),
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        previousState: true,
        newState: false,
        reason: 'Initial test entry',
        changedBy: partnerAUser._id,
      });

      // Attempt document save modification
      historyEntry.reason = 'Tampered reason';
      await expect(historyEntry.save()).rejects.toThrow('PARTNER_AVAILABILITY_HISTORY_IMMUTABLE');

      // Attempt query-level update
      await expect(
        PartnerAvailabilityHistoryModel.updateOne(
          { _id: historyEntry._id },
          { $set: { reason: 'Tampered via updateOne' } },
        ),
      ).rejects.toThrow('PARTNER_AVAILABILITY_HISTORY_IMMUTABLE');

      // Attempt query-level delete
      await expect(
        PartnerAvailabilityHistoryModel.deleteOne({ _id: historyEntry._id }),
      ).rejects.toThrow('PARTNER_AVAILABILITY_HISTORY_IMMUTABLE');
    });
  });

  // ============================================================================
  // SECTION 6: Public Storefront Discovery & Unknown Semantics (AC-AVAIL-25 to AC-AVAIL-28)
  // ============================================================================
  describe('Section 6: Public Storefront Discovery & Unknown Semantics (AC-AVAIL-25 to AC-AVAIL-28)', () => {
    it('AC-AVAIL-25: Unlocalized browsing returns unknown semantics', async () => {
      // Query without delivery PIN
      const res = await request(app)
        .get('/api/v1/partner/availability/public')
        .query({ productId: standaloneProduct._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(true);
      expect(res.body.data.isAvailable).toBeNull();
      expect(res.body.data.serviceAreaId).toBeNull();
      expect(res.body.data.minLeadTimeHours).toBeNull();
      expect(res.body.data.availablePartnerCount).toBeNull();
    });

    it('AC-AVAIL-26: Hyperlocal resolution with valid PIN resolves active partner availability', async () => {
      await PartnerProductModel.create({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 3,
        version: 1,
        createdBy: partnerAUser._id,
        updatedBy: partnerAUser._id,
      });

      const res = await request(app).get('/api/v1/partner/availability/public').query({
        pincode: '560071',
        productId: standaloneProduct._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(false);
      expect(res.body.data.isAvailable).toBe(true);
      expect(res.body.data.serviceAreaId).toBe(activeServiceArea1._id.toString());
      expect(res.body.data.minLeadTimeHours).toBe(3);
      expect(res.body.data.availablePartnerCount).toBe(1);
    });

    it('AC-AVAIL-27: Multi-partner availability aggregation returns true if at least one partner is available (HTTP)', async () => {
      // Partner A serves SA1 with isAvailable: false
      await PartnerProductModel.create({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: false,
        minLeadTimeHours: 12,
        version: 1,
        createdBy: partnerAUser._id,
        updatedBy: partnerAUser._id,
      });

      // Partner B serves SA1 with isAvailable: true
      await PartnerProductModel.create({
        partnerId: partnerB._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 4,
        version: 1,
        createdBy: partnerBUser._id,
        updatedBy: partnerBUser._id,
      });

      const res = await request(app).get('/api/v1/partner/availability/public').query({
        pincode: '560071',
        productId: standaloneProduct._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.data.availabilityUnknown).toBe(false);
      expect(res.body.data.isAvailable).toBe(true);
      expect(res.body.data.availablePartnerCount).toBe(1);
      expect(res.body.data.minLeadTimeHours).toBe(4);
    });

    it('AC-AVAIL-28: Public anonymity & privacy preservation contains zero partner identity or pricing fields', async () => {
      await PartnerProductModel.create({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 2,
        version: 1,
        createdBy: partnerAUser._id,
        updatedBy: partnerAUser._id,
      });

      const res = await request(app).get('/api/v1/partner/availability/public').query({
        pincode: '560071',
        productId: standaloneProduct._id.toString(),
      });

      expect(res.status).toBe(200);
      const dataKeys = Object.keys(res.body.data);

      // Verify strict response contract
      expect(dataKeys).toEqual(
        expect.arrayContaining([
          'productId',
          'variantId',
          'serviceAreaId',
          'isAvailable',
          'availabilityUnknown',
          'minLeadTimeHours',
          'availablePartnerCount',
        ]),
      );

      // Assert zero internal or partner-identifying fields leak
      expect(res.body.data).not.toHaveProperty('partnerId');
      expect(res.body.data).not.toHaveProperty('partnerIds');
      expect(res.body.data).not.toHaveProperty('businessName');
      expect(res.body.data).not.toHaveProperty('b2cPricePaise');
      expect(res.body.data).not.toHaveProperty('margin');
      expect(res.body.data).not.toHaveProperty('vendorMargin');
    });
  });

  // ============================================================================
  // SECTION 7: Performance Verification & MongoDB Query Plan Assertions
  // ============================================================================
  describe('Section 7: Performance Verification & Real MongoDB Index-Plan Assertions', () => {
    interface IExplainPlan {
      queryPlanner?: {
        winningPlan?: {
          indexName?: string;
          inputStage?: {
            indexName?: string;
            inputStage?: {
              indexName?: string;
            };
          };
        };
      };
    }

    function extractWinningPlanIndexName(plan: unknown): string | undefined {
      const typedPlan = plan as IExplainPlan;
      const wp = typedPlan?.queryPlanner?.winningPlan;
      if (!wp) return undefined;
      if (wp.indexName) return wp.indexName;
      if (wp.inputStage?.indexName) return wp.inputStage.indexName;
      if (wp.inputStage?.inputStage?.indexName) return wp.inputStage.inputStage.indexName;
      return undefined;
    }

    it('verifies all approved partial unique and supporting indexes exist on partner_products', async () => {
      const indexes = await PartnerProductModel.collection.indexes();
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain('unique_partner_standalone_product_service_area');
      expect(indexNames).toContain('unique_partner_variant_product_service_area');
      expect(indexNames).toContain('idx_service_area_product_availability');
      expect(indexNames).toContain('idx_partner_service_area_availability');

      // Verify partialFilterExpressions on unique indexes
      const standaloneIdx = indexes.find(
        (i) => i.name === 'unique_partner_standalone_product_service_area',
      );
      expect(standaloneIdx?.partialFilterExpression).toEqual({ variantId: null });

      const variantIdx = indexes.find(
        (i) => i.name === 'unique_partner_variant_product_service_area',
      );
      expect(variantIdx?.partialFilterExpression).toEqual({
        variantId: { $type: 'objectId' },
      });
    });

    it('asserts Storefront Availability Query uses index idx_service_area_product_availability', async () => {
      const plan = await PartnerProductModel.find({
        partnerId: { $in: [partnerA._id, partnerB._id] },
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
      })
        .select('partnerId minLeadTimeHours')
        .explain('executionStats');

      const usedIndex = extractWinningPlanIndexName(plan);
      expect(usedIndex).toBe('idx_service_area_product_availability');
    });

    it('asserts Partner Inventory Query uses index idx_partner_service_area_availability', async () => {
      const plan = await PartnerProductModel.find({
        partnerId: partnerA._id,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
      }).explain('executionStats');

      const usedIndex = extractWinningPlanIndexName(plan);
      expect(usedIndex).toBe('idx_partner_service_area_availability');
    });

    it('asserts Chronological Audit History Query uses index idx_history_partner_product_created', async () => {
      const plan = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: new Types.ObjectId(),
      })
        .sort({ createdAt: -1 })
        .explain('executionStats');

      const usedIndex = extractWinningPlanIndexName(plan);
      expect(usedIndex).toBe('idx_history_partner_product_created');
    });
  });
});
