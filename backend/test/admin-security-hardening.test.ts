import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

describe('Admin Security Hardening & RBAC Audit Integration Tests', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Principals
  let superAdminUser: IUserDocument;
  let superAdminToken: string;

  let catalogStaffUser: IUserDocument;
  let catalogStaffToken: string;

  let serviceAreaStaffUser: IUserDocument;
  let serviceAreaStaffToken: string;

  let unprivilegedStaffUser: IUserDocument;
  let unprivilegedStaffToken: string;

  let customerUser: IUserDocument;
  let customerToken: string;

  let partnerUser: IUserDocument;
  let partnerToken: string;

  const createdUserIds: Types.ObjectId[] = [];
  const createdRoleIds: Types.ObjectId[] = [];
  const createdPartnerIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    try {
      await connectDatabase(undefined, { serverSelectionTimeoutMS: 30000 });
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for admin security tests:', err);
      throw err;
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      // 1. Create Roles
      const seededRoles = await RoleModel.create([
        {
          code: 'TEST_SEC_SUPER_ADMIN',
          name: 'Security Test Super Admin Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: Object.values(PermissionCode),
        },
        {
          code: 'TEST_SEC_CATALOG_STAFF',
          name: 'Security Test Catalog Staff Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
        },
        {
          code: 'TEST_SEC_SERVICE_AREA_STAFF',
          name: 'Security Test Service Area Staff Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE],
        },
        {
          code: 'TEST_SEC_NO_PERM_STAFF',
          name: 'Security Test Unprivileged Staff Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [],
        },
      ]);
      createdRoleIds.push(...seededRoles.map((r) => r._id));

      // 1b. Create Partner Organization Fixture
      const testPartner = await PartnerModel.create({
        businessName: 'Security Test Partner Supplies',
        phone: '+919811000006',
        status: 'ACTIVE',
      });
      createdPartnerIds.push(testPartner._id);

      // 2. Create Users
      const createdUsers = await UserModel.create([
        {
          phone: '+919811000001',
          email: 'sec-superadmin@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_SEC_SUPER_ADMIN'],
        },
        {
          phone: '+919811000002',
          email: 'sec-catalog@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_SEC_CATALOG_STAFF'],
        },
        {
          phone: '+919811000003',
          email: 'sec-service-area@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_SEC_SERVICE_AREA_STAFF'],
        },
        {
          phone: '+919811000004',
          email: 'sec-unprivileged@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_SEC_NO_PERM_STAFF'],
        },
        {
          phone: '+919811000005',
          email: 'sec-customer@example.com',
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
        },
        {
          phone: '+919811000006',
          email: 'sec-partner@example.com',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: testPartner._id,
          roles: [],
        },
      ]);
      createdUserIds.push(...createdUsers.map((u) => u._id));

      superAdminUser = createdUsers[0]!;
      catalogStaffUser = createdUsers[1]!;
      serviceAreaStaffUser = createdUsers[2]!;
      unprivilegedStaffUser = createdUsers[3]!;
      customerUser = createdUsers[4]!;
      partnerUser = createdUsers[5]!;

      // Mock Admin Session verification and activity tracking for staff auth (C-12.3)
      vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
        async (sessionId: string) => {
          let matchedUserId = superAdminUser?._id;
          if (sessionId === 'session-catalog') matchedUserId = catalogStaffUser?._id;
          if (sessionId === 'session-service-area') matchedUserId = serviceAreaStaffUser?._id;
          if (sessionId === 'session-unprivileged') matchedUserId = unprivilegedStaffUser?._id;
          return {
            _id: sessionId,
            sessionId,
            userId: matchedUserId,
            status: 'ACTIVE',
            lastActivityAt: new Date(),
            absoluteExpiresAt: new Date(Date.now() + 86400000),
            isAbsoluteExpired: () => false,
            isIdleExpired: () => false,
            isActive: () => true,
          } as any;
        },
      );
      vi.spyOn(TokenService.prototype, 'recordAdminActivity').mockResolvedValue();

      // Tokens
      superAdminToken = tokenService.signAccessToken(superAdminUser, 'session-superadmin');
      catalogStaffToken = tokenService.signAccessToken(catalogStaffUser, 'session-catalog');
      serviceAreaStaffToken = tokenService.signAccessToken(
        serviceAreaStaffUser,
        'session-service-area',
      );
      unprivilegedStaffToken = tokenService.signAccessToken(
        unprivilegedStaffUser,
        'session-unprivileged',
      );
      customerToken = tokenService.signAccessToken(customerUser);
      partnerToken = tokenService.signAccessToken(partnerUser);
    }
  }, 60000);

  afterAll(async () => {
    if (isDbConnected) {
      if (createdUserIds.length > 0) {
        await UserModel.deleteMany({ _id: { $in: createdUserIds } });
      }
      if (createdRoleIds.length > 0) {
        await RoleModel.deleteMany({ _id: { $in: createdRoleIds } });
      }
      if (createdPartnerIds.length > 0) {
        await PartnerModel.deleteMany({ _id: { $in: createdPartnerIds } });
      }
      await disconnectDatabase();
    }
  }, 60000);

  // =========================================================================
  // 1. PRODUCT & VARIANT CATALOGUE ADMINISTRATIVE ROUTE GUARDS
  // =========================================================================
  describe('1. Product Catalogue Administrative Route Hardening', () => {
    it('GET /api/v1/products: unauthenticated request returns 401', async () => {
      const res = await request(app).get('/api/v1/products');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/products: Customer identity is rejected by staffOnlyGuard with 403', async () => {
      const res = await request(app)
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('GET /api/v1/products: Partner identity is rejected by staffOnlyGuard with 403', async () => {
      const res = await request(app)
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('GET /api/v1/products: Staff lacking CATALOG_READ is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${unprivilegedStaffToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/insufficient permissions/i);
    });

    it('GET /api/v1/products: Staff with CATALOG_READ is allowed (200)', async () => {
      const res = await request(app)
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${catalogStaffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/products: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ title: 'Hack Product' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/products: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ title: 'Hack Product' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/products: Staff lacking CATALOG_WRITE is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${unprivilegedStaffToken}`)
        .send({ title: 'Hack Product' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/products/:id/publish: Customer identity is rejected with 403', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/v1/products/${fakeId}/publish`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('DELETE /api/v1/products/:id: Customer identity is rejected with 403', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .delete(`/api/v1/products/${fakeId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/products/:productId/variants: Customer identity is rejected with 403', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/v1/products/${fakeId}/variants`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ title: 'Variant' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 2. UNITS OF MEASUREMENT ADMINISTRATIVE ROUTE GUARDS
  // =========================================================================
  describe('2. Units of Measurement Administrative Route Hardening', () => {
    it('PATCH /api/v1/units/:code: unauthenticated request returns 401', async () => {
      const res = await request(app).patch('/api/v1/units/BAG').send({ name: 'Tampered Bag' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('PATCH /api/v1/units/:code: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .patch('/api/v1/units/BAG')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Tampered Bag' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/v1/units/:code: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .patch('/api/v1/units/BAG')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ name: 'Tampered Bag' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/v1/units/:code: Staff lacking CATALOG_WRITE is rejected with 403', async () => {
      const res = await request(app)
        .patch('/api/v1/units/BAG')
        .set('Authorization', `Bearer ${unprivilegedStaffToken}`)
        .send({ name: 'Tampered Bag' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. SERVICE AREA ADMINISTRATIVE ROUTE GUARDS
  // =========================================================================
  describe('3. Service Area Administrative Route Hardening', () => {
    it('GET /api/v1/service-areas: unauthenticated request returns 401', async () => {
      const res = await request(app).get('/api/v1/service-areas');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/service-areas: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('GET /api/v1/service-areas: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/service-areas: Staff lacking SERVICE_AREA_READ is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${unprivilegedStaffToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/service-areas: Staff with SERVICE_AREA_READ is allowed (200)', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${serviceAreaStaffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/service-areas: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ code: 'HACK', name: 'Hack Area' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 4. PARTNER SERVICE AREA ASSIGNMENT ROUTE GUARDS
  // =========================================================================
  describe('4. Partner Assignment Route Hardening', () => {
    it('PUT /api/v1/partners/:partnerId/service-areas: unauthenticated returns 401', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/v1/partners/${fakeId}/service-areas`)
        .send({ serviceAreaIds: [new Types.ObjectId().toString()] });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('PUT /api/v1/partners/:partnerId/service-areas: Customer identity is rejected with 403', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/v1/partners/${fakeId}/service-areas`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ serviceAreaIds: [new Types.ObjectId().toString()] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PUT /api/v1/partners/:partnerId/service-areas: Partner identity is rejected with 403', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/v1/partners/${fakeId}/service-areas`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ serviceAreaIds: [new Types.ObjectId().toString()] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 5. AUTHENTICATION & RBAC ROLES DISCOVERY GUARDS
  // =========================================================================
  describe('5. Auth & RBAC Roles Route Hardening', () => {
    it('GET /api/v1/auth/roles: unauthenticated returns 401', async () => {
      const res = await request(app).get('/api/v1/auth/roles');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/auth/roles: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/auth/roles: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/auth/roles: Staff without RBAC_MANAGE is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${unprivilegedStaffToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/auth/roles: SuperAdmin with RBAC_MANAGE is allowed (200)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.roles)).toBe(true);
    });
  });

  // =========================================================================
  // 6. ADMIN DASHBOARD ROUTE GUARDS
  // =========================================================================
  describe('6. Admin Dashboard Route Hardening', () => {
    it('GET /api/v1/admin/dashboard/summary: unauthenticated returns 401', async () => {
      const res = await request(app).get('/api/v1/admin/dashboard/summary');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/admin/dashboard/summary: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/admin/dashboard/summary: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/admin/dashboard/summary: Staff identity succeeds (200)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 7. SUPER_ADMIN END-TO-END AUTHORIZATION ACROSS ALL ADMINISTRATIVE DOMAINS
  // =========================================================================
  describe('7. SUPER_ADMIN Full Platform Privilege Verification', () => {
    it('SUPER_ADMIN successfully accesses categories, products, service areas, customers, partners, and dashboard', async () => {
      const [dashRes, catRes, prodRes, saRes, custRes, partnerRes, rolesRes] = await Promise.all([
        request(app)
          .get('/api/v1/admin/dashboard/summary')
          .set('Authorization', `Bearer ${superAdminToken}`),
        request(app)
          .get('/api/v1/categories?includeInactive=true')
          .set('Authorization', `Bearer ${superAdminToken}`),
        request(app).get('/api/v1/products').set('Authorization', `Bearer ${superAdminToken}`),
        request(app).get('/api/v1/service-areas').set('Authorization', `Bearer ${superAdminToken}`),
        request(app)
          .get('/api/v1/admin/customers')
          .set('Authorization', `Bearer ${superAdminToken}`),
        request(app)
          .get('/api/v1/admin/partners')
          .set('Authorization', `Bearer ${superAdminToken}`),
        request(app).get('/api/v1/auth/roles').set('Authorization', `Bearer ${superAdminToken}`),
      ]);

      expect(dashRes.status).toBe(200);
      expect(catRes.status).toBe(200);
      expect(prodRes.status).toBe(200);
      expect(saRes.status).toBe(200);
      expect(custRes.status).toBe(200);
      expect(partnerRes.status).toBe(200);
      expect(rolesRes.status).toBe(200);
    });
  });
});
