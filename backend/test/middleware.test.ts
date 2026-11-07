import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { authenticate, authorize, partnerTenantGuard } from '../src/middleware/auth.middleware.js';
import { createAuthRateLimiter } from '../src/middleware/rate-limiter.middleware.js';

describe('Middleware Pipeline — Authentication, Authorization, Tenant Guard & Rate Limiting', () => {
  let isDbConnected = false;
  let tokenService: TokenService;
  let testCustomer: IUserDocument;
  let testPartner: IUserDocument;
  let testStaff: IUserDocument;
  let partnerId: string;
  let testApp: Application;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();

    if (isDbConnected) {
      partnerId = new mongoose.Types.ObjectId().toString();

      // Seed test roles with isolated prefix to prevent race conditions across parallel test files
      await RoleModel.deleteMany({ code: { $in: ['MW_ROLE_CATALOG_ADMIN', 'MW_ROLE_READ_ONLY'] } });
      await RoleModel.create([
        {
          code: 'MW_ROLE_CATALOG_ADMIN',
          name: 'Catalog Admin',
          userType: UserType.STAFF,
          permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
        },
        {
          code: 'MW_ROLE_READ_ONLY',
          name: 'Read Only Staff',
          userType: UserType.STAFF,
          permissions: [PermissionCode.CATALOG_READ],
        },
      ]);

      // Seed test users
      await UserModel.deleteMany({
        phone: { $in: ['+919666611111', '+919666622222', '+919666633333'] },
      });
      testCustomer = await UserModel.create({
        phone: '+919666611111',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      testPartner = await UserModel.create({
        phone: '+919666622222',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: new mongoose.Types.ObjectId(partnerId),
        roles: [],
      });

      testStaff = await UserModel.create({
        phone: '+919666633333',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['MW_ROLE_READ_ONLY'],
      });
    }

    // Set up test Express application
    testApp = express();
    testApp.use(express.json());

    // Public rate-limited test route
    testApp.post(
      '/test/otp-request',
      createAuthRateLimiter({ windowMs: 60000, limit: 3 }),
      (req, res) => {
        res.status(200).json({ success: true, phone: req.body?.phone });
      },
    );

    // Protected endpoint: requires authentication only
    testApp.get('/test/protected/profile', authenticate, (req, res) => {
      res.status(200).json({ success: true, user: req.user });
    });

    // Guarded endpoint: requires single permission
    testApp.get(
      '/test/protected/catalog',
      authenticate,
      authorize(PermissionCode.CATALOG_READ),
      (_req, res) => {
        res.status(200).json({ success: true, access: 'catalog-read' });
      },
    );

    // Guarded endpoint: requires multiple permissions (ALL / AND semantics)
    testApp.post(
      '/test/protected/catalog',
      authenticate,
      authorize([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE], { mode: 'ALL' }),
      (_req, res) => {
        res.status(200).json({ success: true, access: 'catalog-write-granted' });
      },
    );

    // Guarded endpoint: requires ANY of multiple permissions (OR semantics)
    testApp.get(
      '/test/protected/audit-or-read',
      authenticate,
      authorize([PermissionCode.AUDIT_READ, PermissionCode.CATALOG_READ], { mode: 'ANY' }),
      (_req, res) => {
        res.status(200).json({ success: true, access: 'audit-or-catalog-read-granted' });
      },
    );

    // Partner tenant-isolated endpoint
    testApp.get('/test/partner/orders', authenticate, partnerTenantGuard, (req, res) => {
      res.status(200).json({
        success: true,
        partnerFilter: req.partnerFilter,
        queryParam: req.query?.partnerId,
      });
    });

    testApp.get(
      '/test/partner/resource/:partnerId',
      authenticate,
      partnerTenantGuard,
      (req, res) => {
        res.status(200).json({
          success: true,
          partnerFilter: req.partnerFilter,
          param: req.params.partnerId,
        });
      },
    );

    testApp.post('/test/partner/inventory', authenticate, partnerTenantGuard, (req, res) => {
      res.status(200).json({
        success: true,
        partnerFilter: req.partnerFilter,
        bodyPartnerId: req.body?.partnerId,
      });
    });
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9196666/ } });
      await RoleModel.deleteMany({ code: { $regex: /^MW_ROLE_/ } });
      await disconnectDatabase();
    }
  });

  describe('1. Authentication Middleware (authenticate)', () => {
    it('rejects request without Authorization header with HTTP 401', async () => {
      const res = await request(testApp).get('/test/protected/profile');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toContain('Authentication token is required');
    });

    it('rejects request with malformed Bearer header with HTTP 401', async () => {
      const res1 = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', 'Basic user:pass');

      expect(res1.status).toBe(401);
      expect(res1.body.error.code).toBe('MALFORMED_TOKEN');

      const res2 = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', 'Bearer ');

      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('MALFORMED_TOKEN');
    });

    it('rejects request with invalid signature with HTTP 401', async () => {
      const validToken = tokenService.signAccessToken(testCustomer);
      const tamperedToken = `${validToken.slice(0, -6)}xxxxxx`;

      const res = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('rejects expired access token with HTTP 401', async () => {
      const expiredToken = jwt.sign(
        { sub: testCustomer._id.toString(), userType: UserType.CUSTOMER, roles: [] },
        'dev_thehomez_jwt_access_secret_min_32_characters_1234!',
        { expiresIn: -10 },
      );

      const res = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
    });

    it('rejects authenticated request if user is suspended in the database', async () => {
      if (!isDbConnected) return;

      const suspendedUser = await UserModel.create({
        phone: '+919666644444',
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
      });

      const token = tokenService.signAccessToken(suspendedUser);

      const res = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
      expect(res.body.error.message).toContain('suspended');
    });

    it('rejects request if user account was deleted from the database', async () => {
      if (!isDbConnected) return;

      const tempUser = await UserModel.create({
        phone: '+919666655555',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
      });

      const token = tokenService.signAccessToken(tempUser);

      // Delete user from DB
      await UserModel.deleteOne({ _id: tempUser._id });

      const res = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('authenticates valid token, resolves fresh permissions, and attaches req.user', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(testStaff);

      const res = await request(testApp)
        .get('/test/protected/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe(testStaff._id.toString());
      expect(res.body.user.userType).toBe(UserType.STAFF);
      expect(res.body.user.permissions).toContain(PermissionCode.CATALOG_READ);
    });

    it('dynamically reflects database permission changes without re-issuing JWT', async () => {
      if (!isDbConnected) return;

      // Staff user starts with TEST_READ_ONLY (CATALOG_READ)
      const token = tokenService.signAccessToken(testStaff);

      // Verify cannot access write route
      const writeBefore = await request(testApp)
        .post('/test/protected/catalog')
        .set('Authorization', `Bearer ${token}`);
      expect(writeBefore.status).toBe(403);

      // Admin grants MW_ROLE_CATALOG_ADMIN in database
      await UserModel.updateOne(
        { _id: testStaff._id },
        { $set: { roles: ['MW_ROLE_CATALOG_ADMIN'] } },
      );

      // Same token now immediately has CATALOG_WRITE permission without re-issuing!
      const writeAfter = await request(testApp)
        .post('/test/protected/catalog')
        .set('Authorization', `Bearer ${token}`);

      expect(writeAfter.status).toBe(200);
      expect(writeAfter.body.access).toBe('catalog-write-granted');

      // Revert testStaff role
      await UserModel.updateOne({ _id: testStaff._id }, { $set: { roles: ['MW_ROLE_READ_ONLY'] } });
    });
  });

  describe('2. Authorization Middleware (authorize)', () => {
    it('permits access when user possesses required permission', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(testStaff);

      const res = await request(testApp)
        .get('/test/protected/catalog')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.access).toBe('catalog-read');
    });

    it('denies access with HTTP 403 when user lacks required permission', async () => {
      if (!isDbConnected) return;

      // Customer has no roles/permissions
      const customerToken = tokenService.signAccessToken(testCustomer);

      const res = await request(testApp)
        .get('/test/protected/catalog')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('insufficient permissions');
    });

    it('enforces multiple permissions with AND mode (mode: ALL)', async () => {
      if (!isDbConnected) return;

      // Staff with only CATALOG_READ cannot access route requiring both READ and WRITE
      const readOnlyToken = tokenService.signAccessToken(testStaff);

      const res = await request(testApp)
        .post('/test/protected/catalog')
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(res.status).toBe(403);
    });

    it('enforces multiple permissions with OR mode (mode: ANY)', async () => {
      if (!isDbConnected) return;

      // Staff with only CATALOG_READ can access route requiring AUDIT_READ OR CATALOG_READ
      const token = tokenService.signAccessToken(testStaff);

      const res = await request(testApp)
        .get('/test/protected/audit-or-read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.access).toBe('audit-or-catalog-read-granted');
    });

    it('ensures STAFF identity alone does NOT grant access without permission', async () => {
      if (!isDbConnected) return;

      // Create staff user with zero roles
      const bareStaff = await UserModel.create({
        phone: '+919666666666',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      const token = tokenService.signAccessToken(bareStaff);

      const res = await request(testApp)
        .get('/test/protected/catalog')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('3. Partner Tenant Isolation Guard (partnerTenantGuard)', () => {
    it('injects req.partnerFilter for authenticated partner identities', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(testPartner);

      const res = await request(testApp)
        .get('/test/partner/orders')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.partnerFilter).toEqual({ partnerId });
    });

    it('rejects mismatched client-supplied partnerId in query parameters with HTTP 403', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(testPartner);
      const foreignPartnerId = new mongoose.Types.ObjectId().toString();

      const res = await request(testApp)
        .get(`/test/partner/orders?partnerId=${foreignPartnerId}`)
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
      expect(res.body.error.message).toContain('query parameter partnerId does not match');
    });

    it('rejects mismatched client-supplied partnerId in route parameters with HTTP 403', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(testPartner);
      const foreignPartnerId = new mongoose.Types.ObjectId().toString();

      const res = await request(testApp)
        .get(`/test/partner/resource/${foreignPartnerId}`)
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
      expect(res.body.error.message).toContain('route parameter partnerId does not match');
    });

    it('rejects mismatched client-supplied partnerId in request body with HTTP 403', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(testPartner);
      const foreignPartnerId = new mongoose.Types.ObjectId().toString();

      const res = await request(testApp)
        .post('/test/partner/inventory')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ partnerId: foreignPartnerId, stock: 100 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
      expect(res.body.error.message).toContain('request body partnerId does not match');
    });

    it('allows matching client-supplied partnerId without error', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(testPartner);

      const res = await request(testApp)
        .post('/test/partner/inventory')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ partnerId, stock: 50 });

      expect(res.status).toBe(200);
      expect(res.body.partnerFilter).toEqual({ partnerId });
    });

    it('rejects partner user missing partnerId association with HTTP 403', async () => {
      if (!isDbConnected) return;

      const brokenPartner = await UserModel.create({
        phone: '+919666677777',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        // partnerId intentionally omitted
      });

      const token = tokenService.signAccessToken(brokenPartner);

      const res = await request(testApp)
        .get('/test/partner/orders')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PARTNER_CONTEXT_REQUIRED');
    });

    it('passes through for CUSTOMER and STAFF without imposing partner scoping', async () => {
      if (!isDbConnected) return;

      const staffToken = tokenService.signAccessToken(testStaff);

      const res = await request(testApp)
        .get('/test/partner/orders')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      // STAFF is not a partner, so partnerFilter is undefined
      expect(res.body.partnerFilter).toBeUndefined();
    });
  });

  describe('4. Rate Limiting Middleware (createAuthRateLimiter)', () => {
    it('allows requests within limit and enforces HTTP 429 when cap is exceeded', async () => {
      const phone = '9666688888';

      // Limit is configured as 3 in testApp
      const res1 = await request(testApp).post('/test/otp-request').send({ phone });
      expect(res1.status).toBe(200);

      const res2 = await request(testApp).post('/test/otp-request').send({ phone });
      expect(res2.status).toBe(200);

      const res3 = await request(testApp).post('/test/otp-request').send({ phone });
      expect(res3.status).toBe(200);

      // 4th request must be rate-limited
      const res4 = await request(testApp).post('/test/otp-request').send({ phone });
      expect(res4.status).toBe(429);
      expect(res4.body.success).toBe(false);
      expect(res4.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res4.body.error.message).toContain('Too many requests');
    });
  });
});
