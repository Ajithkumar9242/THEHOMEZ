import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { PartnerAvailabilityHistoryModel } from '../src/models/partner-availability-history.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

describe('Milestone 4 Step 6: Subtask 6.4B — Partner Availability Express Routes & Middleware Integration', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Partners
  let partnerA: InstanceType<typeof PartnerModel>;
  let partnerB: InstanceType<typeof PartnerModel>;

  // Users & Tokens
  let partnerAUser: InstanceType<typeof UserModel>;
  let partnerAToken: string;

  let partnerAReadOnlyUser: InstanceType<typeof UserModel>;
  let partnerAReadOnlyToken: string;

  let partnerBUser: InstanceType<typeof UserModel>;
  let partnerBToken: string;

  let staffAdminUser: InstanceType<typeof UserModel>;
  let staffAdminToken: string;

  let staffNoPermUser: InstanceType<typeof UserModel>;
  let staffNoPermToken: string;

  let customerUser: InstanceType<typeof UserModel>;
  let customerToken: string;

  // Catalogue Fixtures
  let testCategory: InstanceType<typeof CategoryModel>;
  let activeServiceArea1: InstanceType<typeof ServiceAreaModel>;
  let activeServiceArea2: InstanceType<typeof ServiceAreaModel>;
  let standaloneProduct: InstanceType<typeof ProductModel>;
  let multiVariantProduct: InstanceType<typeof ProductModel>;
  let activeVariant1: InstanceType<typeof ProductVariantModel>;

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
      await PartnerProductModel.deleteMany({});
      await PartnerAvailabilityHistoryModel.collection.deleteMany({});
      await PartnerModel.deleteMany({
        $or: [
          { businessName: { $regex: /^TEST-RT-PARTNER-/ } },
          { phone: { $regex: /^\+919666/ } },
        ],
      });
      await ProductModel.deleteMany({ slug: { $regex: /^test-rt-/ } });
      await ProductVariantModel.deleteMany({});
      await ServiceAreaModel.deleteMany({ code: { $regex: /^TEST-RT-SA-/ } });
      await CategoryModel.deleteMany({ slug: { $regex: /^test-rt-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919777/ } });
      await RoleModel.deleteMany({ code: { $regex: /^TEST_RT_/ } });

      // 1. Service Areas
      activeServiceArea1 = await ServiceAreaModel.create({
        code: 'TEST-RT-SA-1',
        name: 'Bengaluru East',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560001', '560002'],
        isActive: true,
      });

      activeServiceArea2 = await ServiceAreaModel.create({
        code: 'TEST-RT-SA-2',
        name: 'Bengaluru North',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560003'],
        isActive: true,
      });

      // 2. Partners
      partnerA = await PartnerModel.create({
        businessName: 'TEST-RT-PARTNER-A',
        phone: '+919666000001',
        serviceAreaIds: [activeServiceArea1._id, activeServiceArea2._id],
        status: 'ACTIVE',
      });

      partnerB = await PartnerModel.create({
        businessName: 'TEST-RT-PARTNER-B',
        phone: '+919666000002',
        serviceAreaIds: [activeServiceArea1._id],
        status: 'ACTIVE',
      });

      // 3. Category & Products
      testCategory = await CategoryModel.create({
        name: 'Test RT Category',
        slug: 'test-rt-cat',
        isActive: true,
      });

      const dummyAdminId = new Types.ObjectId();
      const dummySubcatId = new Types.ObjectId();

      standaloneProduct = await ProductModel.create({
        title: 'UltraTech Cement RT Test',
        slug: 'test-rt-ultratech-cement',
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

      multiVariantProduct = await ProductModel.create({
        title: 'Kamdhenu Steel RT Test',
        slug: 'test-rt-kamdhenu-steel',
        brand: 'Kamdhenu',
        categoryId: testCategory._id,
        subcategoryId: dummySubcatId,
        hasVariants: true,
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: dummyAdminId,
        createdBy: dummyAdminId,
        updatedBy: dummyAdminId,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        maxOrderQuantity: '500',
        stepIncrement: '1',
      });

      activeVariant1 = await ProductVariantModel.create({
        productId: multiVariantProduct._id,
        title: 'Kamdhenu 8mm RT',
        sku: 'THZ-V-RT-8MM-001',
        status: 'ACTIVE',
        publishedAt: new Date(),
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        maxOrderQuantity: '500',
        stepIncrement: '1',
        attributes: { Diameter: '8mm' },
      });

      // 4. Roles
      await RoleModel.create([
        {
          code: 'TEST_RT_PARTNER_WRITE_ROLE',
          name: 'Partner Availability Writer',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [
            PermissionCode.PARTNER_AVAILABILITY_WRITE,
            PermissionCode.PARTNER_AVAILABILITY_READ,
          ],
        },
        {
          code: 'TEST_RT_PARTNER_READ_ROLE',
          name: 'Partner Availability Reader',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
        },
        {
          code: 'TEST_RT_STAFF_ADMIN_ROLE',
          name: 'Staff Admin Availability Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [
            PermissionCode.PARTNER_AVAILABILITY_WRITE,
            PermissionCode.PARTNER_AVAILABILITY_READ,
            PermissionCode.PARTNER_READ,
            PermissionCode.PARTNER_SUSPEND,
          ],
        },
        {
          code: 'TEST_RT_STAFF_NO_AVAIL_ROLE',
          name: 'Staff Without Availability Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
      ]);

      // 5. Users
      partnerAUser = await UserModel.create({
        phone: '+919777000001',
        email: 'partner-a-rt@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerA._id,
        roles: ['TEST_RT_PARTNER_WRITE_ROLE'],
      });
      partnerAToken = tokenService.signAccessToken(partnerAUser);

      partnerAReadOnlyUser = await UserModel.create({
        phone: '+919777000002',
        email: 'partner-a-ro-rt@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerA._id,
        roles: ['TEST_RT_PARTNER_READ_ROLE'],
      });
      partnerAReadOnlyToken = tokenService.signAccessToken(partnerAReadOnlyUser);

      partnerBUser = await UserModel.create({
        phone: '+919777000003',
        email: 'partner-b-rt@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerB._id,
        roles: ['TEST_RT_PARTNER_WRITE_ROLE'],
      });
      partnerBToken = tokenService.signAccessToken(partnerBUser);

      staffAdminUser = await UserModel.create({
        phone: '+919777000004',
        email: 'staff-admin-rt@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_RT_STAFF_ADMIN_ROLE'],
      });
      staffAdminToken = tokenService.signAccessToken(staffAdminUser);

      staffNoPermUser = await UserModel.create({
        phone: '+919777000005',
        email: 'staff-noperm-rt@thehomez.in',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_RT_STAFF_NO_AVAIL_ROLE'],
      });
      staffNoPermToken = tokenService.signAccessToken(staffNoPermUser);

      customerUser = await UserModel.create({
        phone: '+919777000006',
        email: 'customer-rt@thehomez.in',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      customerToken = tokenService.signAccessToken(customerUser);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await PartnerProductModel.deleteMany({});
      await PartnerAvailabilityHistoryModel.collection.deleteMany({});
      await PartnerModel.deleteMany({
        $or: [
          { businessName: { $regex: /^TEST-RT-PARTNER-/ } },
          { phone: { $regex: /^\+919666/ } },
        ],
      });
      await ProductModel.deleteMany({ slug: { $regex: /^test-rt-/ } });
      await ProductVariantModel.deleteMany({});
      await ServiceAreaModel.deleteMany({ code: { $regex: /^TEST-RT-SA-/ } });
      await CategoryModel.deleteMany({ slug: { $regex: /^test-rt-/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+919777/ } });
      await RoleModel.deleteMany({ code: { $regex: /^TEST_RT_/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (!isDbConnected) return;
    await PartnerProductModel.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
  });

  // ==========================================================================
  // 1. PUBLIC STOREFRONT AVAILABILITY LOOKUP
  // ==========================================================================
  describe('1. Public Storefront Availability Lookup', () => {
    it('allows public lookup without authentication (unlocalized browsing)', async () => {
      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(true);
      expect(res.body.data.isAvailable).toBeNull();
      expect(res.body.data.serviceAreaId).toBeNull();
      expect(res.body.data.minLeadTimeHours).toBeNull();
      expect(res.body.data.availablePartnerCount).toBeNull();
    });

    it('resolves localized availability with valid PIN and available partner', async () => {
      // Setup Partner A availability in SA1
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
          minLeadTimeHours: 4,
        });

      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
        pincode: '560001',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(false);
      expect(res.body.data.isAvailable).toBe(true);
      expect(res.body.data.serviceAreaId).toBe(activeServiceArea1._id.toString());
      expect(res.body.data.minLeadTimeHours).toBe(4);
      expect(res.body.data.availablePartnerCount).toBe(1);
    });

    it('returns unserviceable semantics when valid PIN maps to no service area (Decision #50)', async () => {
      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
        pincode: '999999', // Valid 6-digit PIN not in any service area
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(false);
      expect(res.body.data.isAvailable).toBe(false);
      expect(res.body.data.serviceAreaId).toBeNull();
      expect(res.body.data.minLeadTimeHours).toBeNull();
      expect(res.body.data.availablePartnerCount).toBe(0);
      expect(res.body.data.message).toBe('Delivery not available in this area');
    });

    it('rejects invalid PIN codes with 400 VALIDATION_ERROR', async () => {
      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
        pincode: '012345', // Leading zero invalid in India
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not expose partner identities, business names, or internal margins in public response', async () => {
      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
        pincode: '560001',
      });

      expect(res.status).toBe(200);
      const dataStr = JSON.stringify(res.body.data);
      expect(dataStr).not.toContain('TEST-RT-PARTNER');
      expect(dataStr).not.toContain(partnerA._id.toString());
      expect(dataStr).not.toContain('margin');
      expect(dataStr).not.toContain('commission');
    });
  });

  // ==========================================================================
  // 2. AUTHENTICATION & AUTHORIZATION (RBAC) ENFORCEMENT
  // ==========================================================================
  describe('2. Authentication & Authorization Enforcement', () => {
    it('rejects unauthenticated requests to protected endpoints with 401', async () => {
      const endpoints = [
        { method: 'get', url: '/api/v1/partner/availability' },
        { method: 'put', url: '/api/v1/partner/availability' },
        { method: 'post', url: '/api/v1/partner/availability/batch' },
        {
          method: 'get',
          url: `/api/v1/partner/availability/${new Types.ObjectId()}`,
        },
        {
          method: 'patch',
          url: `/api/v1/partner/availability/${new Types.ObjectId()}`,
        },
        {
          method: 'get',
          url: `/api/v1/partner/availability/${new Types.ObjectId()}/history`,
        },
        {
          method: 'get',
          url: `/api/v1/admin/partners/${partnerA._id}/availability`,
        },
        {
          method: 'patch',
          url: `/api/v1/admin/partners/${partnerA._id}/availability/${new Types.ObjectId()}`,
        },
      ];

      for (const ep of endpoints) {
        const method = ep.method as 'get' | 'put' | 'post' | 'patch';
        const res = await request(app)[method](ep.url).send({});
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects callers lacking PARTNER_AVAILABILITY_WRITE for mutation endpoints with 403', async () => {
      // partnerAReadOnlyToken only holds PARTNER_AVAILABILITY_READ
      const resPut = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAReadOnlyToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(resPut.status).toBe(403);
      expect(resPut.body.success).toBe(false);
      expect(resPut.body.error.code).toBe('FORBIDDEN');

      const resPatch = await request(app)
        .patch(`/api/v1/partner/availability/${new Types.ObjectId()}`)
        .set('Authorization', `Bearer ${partnerAReadOnlyToken}`)
        .send({
          isAvailable: false,
        });

      expect(resPatch.status).toBe(403);
      expect(resPatch.body.error.code).toBe('FORBIDDEN');

      const resBatch = await request(app)
        .post('/api/v1/partner/availability/batch')
        .set('Authorization', `Bearer ${partnerAReadOnlyToken}`)
        .send({
          items: [{ id: new Types.ObjectId().toString(), isAvailable: false }],
        });

      expect(resBatch.status).toBe(403);
      expect(resBatch.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects callers lacking PARTNER_AVAILABILITY_READ for read endpoints with 403', async () => {
      // staffNoPermToken lacks partner availability read permission
      const res = await request(app)
        .get('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${staffNoPermToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects customers from accessing partner availability endpoints with 403', async () => {
      const res = await request(app)
        .get('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ==========================================================================
  // 3. PARTNER TENANT ISOLATION & BOUNDARY GUARDS
  // ==========================================================================
  describe('3. Partner Tenant Isolation & Spoofing Defense', () => {
    it('prevents Partner A from viewing Partner B single record (404 zero data leak)', async () => {
      // Partner B creates an item
      const createRes = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerBToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      expect(createRes.status).toBe(201);
      const partnerBItemId = createRes.body.data.id;

      // Partner A attempts to read Partner B's item
      const readRes = await request(app)
        .get(`/api/v1/partner/availability/${partnerBItemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(readRes.status).toBe(404);
      expect(readRes.body.success).toBe(false);
      expect(readRes.body.error.code).toBe('PARTNER_PRODUCT_NOT_FOUND');
    });

    it('prevents Partner A from toggling Partner B single record (404 zero data leak)', async () => {
      const createRes = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerBToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      const partnerBItemId = createRes.body.data.id;

      const toggleRes = await request(app)
        .patch(`/api/v1/partner/availability/${partnerBItemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          isAvailable: false,
        });

      expect(toggleRes.status).toBe(404);
      expect(toggleRes.body.error.code).toBe('PARTNER_PRODUCT_NOT_FOUND');
    });

    it('rejects partner spoofing partnerId in query or params with 403 TENANT_MISMATCH', async () => {
      // Partner A attempts to spoof partnerId in query params on partner route
      const res = await request(app)
        .get(`/api/v1/partner/availability?partnerId=${partnerB._id}`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('scopes Partner listing exclusively to authenticated partner records', async () => {
      // Create record for Partner A
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Create record for Partner B
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerBToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Partner A lists records
      const listA = await request(app)
        .get('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(listA.status).toBe(200);
      expect(listA.body.data).toHaveLength(1);
      expect(listA.body.data[0].partnerId).toBe(partnerA._id.toString());
    });

    it('filters partner availability listing by productId parameter', async () => {
      // Create first record for Partner A with standaloneProduct
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Create second record for Partner A with multiVariantProduct and activeVariant1
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: multiVariantProduct._id.toString(),
          variantId: activeVariant1._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Filter by standaloneProduct
      const resMatch = await request(app)
        .get('/api/v1/partner/availability')
        .query({ productId: standaloneProduct._id.toString() })
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resMatch.status).toBe(200);
      expect(resMatch.body.data).toHaveLength(1);
      expect(resMatch.body.data[0].productId).toBe(standaloneProduct._id.toString());

      // Filter by multiVariantProduct
      const resVariantMatch = await request(app)
        .get('/api/v1/partner/availability')
        .query({ productId: multiVariantProduct._id.toString() })
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resVariantMatch.status).toBe(200);
      expect(resVariantMatch.body.data).toHaveLength(1);
      expect(resVariantMatch.body.data[0].productId).toBe(multiVariantProduct._id.toString());

      // Filter by non-existent product ID
      const resNoMatch = await request(app)
        .get('/api/v1/partner/availability')
        .query({ productId: new Types.ObjectId().toString() })
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(resNoMatch.status).toBe(200);
      expect(resNoMatch.body.data).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 4. ADMINISTRATIVE OVERSIGHT ROUTES (STAFF-ONLY AUTHORIZATION)
  // ==========================================================================
  describe('4. Administrative Oversight Routes (Staff-Only Authorization)', () => {
    it('allows authorized staff to inspect any partner availability declarations', async () => {
      // Partner A creates an item
      await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      // Staff admin inspects Partner A
      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerA._id}/availability`)
        .set('Authorization', `Bearer ${staffAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].partnerId).toBe(partnerA._id.toString());
    });

    it('allows authorized staff to execute emergency availability toggle', async () => {
      const createRes = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
          isAvailable: true,
        });

      const itemId = createRes.body.data.id;

      // Staff admin toggles availability
      const toggleRes = await request(app)
        .patch(`/api/v1/admin/partners/${partnerA._id}/availability/${itemId}`)
        .set('Authorization', `Bearer ${staffAdminToken}`)
        .send({
          isAvailable: false,
          reason: 'Emergency platform compliance intervention',
        });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.data.isAvailable).toBe(false);
    });

    it('strictly rejects staff without required permission code with 403 FORBIDDEN', async () => {
      const readRes = await request(app)
        .get(`/api/v1/admin/partners/${partnerA._id}/availability`)
        .set('Authorization', `Bearer ${staffNoPermToken}`);

      expect(readRes.status).toBe(403);
      expect(readRes.body.success).toBe(false);
      expect(readRes.body.error.code).toBe('FORBIDDEN');

      const patchRes = await request(app)
        .patch(`/api/v1/admin/partners/${partnerA._id}/availability/${new Types.ObjectId()}`)
        .set('Authorization', `Bearer ${staffNoPermToken}`)
        .send({ isAvailable: false });

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.success).toBe(false);
      expect(patchRes.body.error.code).toBe('FORBIDDEN');
    });

    it('strictly rejects PARTNER calling admin read with own partner ID with 403 FORBIDDEN', async () => {
      // Partner A has PARTNER_AVAILABILITY_READ permission and supplies own partnerId
      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerA._id}/availability`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('restricted to staff principals');
    });

    it('strictly rejects PARTNER calling admin read with another partner ID with 403 FORBIDDEN', async () => {
      // Partner A attempts to inspect Partner B via admin route
      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerB._id}/availability`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('restricted to staff principals');
    });

    it('strictly rejects PARTNER calling admin emergency toggle with 403 FORBIDDEN', async () => {
      const itemId = new Types.ObjectId().toString();

      // Partner A attempts admin toggle on own record
      const resOwn = await request(app)
        .patch(`/api/v1/admin/partners/${partnerA._id}/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isAvailable: false });

      expect(resOwn.status).toBe(403);
      expect(resOwn.body.success).toBe(false);
      expect(resOwn.body.error.code).toBe('FORBIDDEN');

      // Partner A attempts admin toggle on Partner B's record
      const resOther = await request(app)
        .patch(`/api/v1/admin/partners/${partnerB._id}/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ isAvailable: false });

      expect(resOther.status).toBe(403);
      expect(resOther.body.success).toBe(false);
      expect(resOther.body.error.code).toBe('FORBIDDEN');
    });

    it('strictly rejects CUSTOMER calling admin availability routes with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerA._id}/availability`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated access to admin routes with 401 UNAUTHORIZED', async () => {
      const getRes = await request(app).get(`/api/v1/admin/partners/${partnerA._id}/availability`);
      expect(getRes.status).toBe(401);
      expect(getRes.body.success).toBe(false);

      const patchRes = await request(app)
        .patch(`/api/v1/admin/partners/${partnerA._id}/availability/${new Types.ObjectId()}`)
        .send({ isAvailable: false });
      expect(patchRes.status).toBe(401);
      expect(patchRes.body.success).toBe(false);
    });

    it('guarantees public availability endpoint /public is not intercepted by /:id param route', async () => {
      const res = await request(app).get('/api/v1/partner/availability/public').query({
        productId: standaloneProduct._id.toString(),
      });

      // Does not require auth (public access), does not attempt to parse 'public' as an ObjectId
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availabilityUnknown).toBe(true);
    });
  });

  // ==========================================================================
  // 5. INPUT VALIDATION & ZERO-TRUST REJECTION
  // ==========================================================================
  describe('5. Input Validation & Zero-Trust Rejection', () => {
    it('rejects invalid ObjectId parameters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/partner/availability/not-a-valid-id')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('strictly rejects unknown / poisoned fields in PUT body', async () => {
      // 1. Client-injected price / discount rejected with 400 VALIDATION_ERROR (.strict())
      const poisonedPricingPayload = {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        price: 5000, // Centralized pricing tampering attempt
      };

      const resPrice = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send(poisonedPricingPayload);

      expect(resPrice.status).toBe(400);
      expect(resPrice.body.success).toBe(false);
      expect(resPrice.body.error.code).toBe('VALIDATION_ERROR');

      // 2. Conflicting partnerId rejected by partnerTenantGuard with 403 TENANT_MISMATCH
      const poisonedTenantPayload = {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        partnerId: partnerB._id.toString(), // Tenant mismatch
      };

      const resTenant = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send(poisonedTenantPayload);

      expect(resTenant.status).toBe(403);
      expect(resTenant.body.success).toBe(false);
      expect(resTenant.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('enforces batch bounds (min 1, max 100 items)', async () => {
      // Empty array
      const emptyRes = await request(app)
        .post('/api/v1/partner/availability/batch')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ items: [] });

      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.error.code).toBe('VALIDATION_ERROR');

      // 101 items
      const oversizedItems = Array.from({ length: 101 }, () => ({
        id: new Types.ObjectId().toString(),
        isAvailable: true,
      }));

      const oversizedRes = await request(app)
        .post('/api/v1/partner/availability/batch')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({ items: oversizedItems });

      expect(oversizedRes.status).toBe(400);
      expect(oversizedRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // 6. DOMAIN ERRORS & CONCURRENCY CONFLICTS
  // ==========================================================================
  describe('6. Domain Errors & Concurrency Handling', () => {
    it('returns 400 with stable domain error when linking standalone with variantId', async () => {
      const res = await request(app)
        .put('/api/v1/partner/availability')
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          productId: standaloneProduct._id.toString(),
          variantId: activeVariant1._id.toString(), // Prohibited on standalone
          serviceAreaId: activeServiceArea1._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY');
    });

    it('returns 409 CONCURRENT_MODIFICATION_CONFLICT when OCC version mismatches', async () => {
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

      // First toggle succeeds (bumps version)
      const toggle1 = await request(app)
        .patch(`/api/v1/partner/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          isAvailable: false,
          version: initialVersion,
        });

      expect(toggle1.status).toBe(200);

      // Second concurrent toggle submitting stale initialVersion fails with 409
      const toggle2 = await request(app)
        .patch(`/api/v1/partner/availability/${itemId}`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          isAvailable: true,
          version: initialVersion, // Stale!
        });

      expect(toggle2.status).toBe(409);
      expect(toggle2.body.success).toBe(false);
      expect(toggle2.body.error.code).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    });
  });

  // ==========================================================================
  // 7. ROUTE INTEGRATION & NON-COLLISION WITH EXISTING APIS
  // ==========================================================================
  describe('7. Route Integration & Non-Collision', () => {
    it('returns 404 ROUTE_NOT_FOUND for non-existent partner availability subpaths', async () => {
      const res = await request(app)
        .get('/api/v1/partner/availability/non-existent-subpath/xyz')
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('preserves existing catalogue and pricing endpoints without collision', async () => {
      // Verify pricing calculate endpoint remains operational
      const pricingRes = await request(app).post('/api/v1/pricing/calculate').send({
        productId: standaloneProduct._id.toString(),
        quantity: '1',
      });

      // Even if pricing not set up for this test product, it reaches pricing controller
      // and returns a valid pricing error (e.g. PRICING_NOT_FOUND), NOT 404 ROUTE_NOT_FOUND
      expect(pricingRes.body.error?.code).not.toBe('ROUTE_NOT_FOUND');

      // Verify public product list route remains operational
      const productRes = await request(app).get('/api/v1/products/public');

      expect(productRes.status).toBe(200);
      expect(productRes.body.success).toBe(true);
    });
  });
});
