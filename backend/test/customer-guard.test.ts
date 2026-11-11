import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  UserType,
  UserStatus,
  PermissionCode,
  COMMERCE_ERROR_CODES,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { getConfig } from '../src/config/env.js';
import {
  authenticate,
  optionalAuthenticate,
  requireCustomerPrincipal,
  enforceOptionalCustomerPrincipal,
} from '../src/middleware/auth.middleware.js';

describe('Stage 0B: Customer Commerce Security Foundation (Customer Principal Guard & CORS)', () => {
  let isDbConnected = false;
  let tokenService: TokenService;
  let productionApp: Application;
  let testApp: Application;

  let activeCustomerA: IUserDocument;
  let activeCustomerB: IUserDocument;
  let suspendedCustomer: IUserDocument;
  let pendingCustomer: IUserDocument;
  let activePartner: IUserDocument;
  let activeAdminStaff: IUserDocument;

  const testPhonePrefix = '+9192222';
  const rolePrefix = 'CG_TEST_';

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    productionApp = createApp();

    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9192222/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CG_TEST_/ } });

      await RoleModel.create([
        {
          code: `${rolePrefix}SUPER_ADMIN`,
          name: 'Test Super Admin',
          userType: UserType.STAFF,
          permissions: [
            PermissionCode.RBAC_MANAGE,
            PermissionCode.CATALOG_READ,
            PermissionCode.CATALOG_WRITE,
            PermissionCode.SETTINGS_WRITE,
          ],
        },
        {
          code: `${rolePrefix}B2B_TIER`,
          name: 'Test B2B Customer Role',
          userType: UserType.CUSTOMER,
          permissions: [],
        },
      ]);

      activeCustomerA = await UserModel.create({
        phone: `${testPhonePrefix}00001`,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      activeCustomerB = await UserModel.create({
        phone: `${testPhonePrefix}00002`,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      suspendedCustomer = await UserModel.create({
        phone: `${testPhonePrefix}00003`,
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
        roles: [],
      });

      pendingCustomer = await UserModel.create({
        phone: `${testPhonePrefix}00004`,
        userType: UserType.CUSTOMER,
        status: UserStatus.PENDING_VERIFICATION,
        roles: [],
      });

      activePartner = await UserModel.create({
        phone: `${testPhonePrefix}00005`,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: new mongoose.Types.ObjectId(),
        roles: [],
      });

      activeAdminStaff = await UserModel.create({
        phone: `${testPhonePrefix}00006`,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: [`${rolePrefix}SUPER_ADMIN`],
      });
    }

    // Isolated test Express app exercising middleware without introducing commerce routes
    testApp = express();
    testApp.use(express.json());

    testApp.get(
      '/test/customer/protected',
      authenticate,
      requireCustomerPrincipal,
      (req, res) => {
        res.status(200).json({
          success: true,
          user: req.user,
          customerFilter: req.customerFilter,
        });
      },
    );

    testApp.post(
      '/test/customer/protected',
      authenticate,
      requireCustomerPrincipal,
      (req, res) => {
        res.status(200).json({
          success: true,
          userId: req.user?.id,
          customerFilter: req.customerFilter,
        });
      },
    );

    testApp.get(
      '/test/customer/protected/:userId',
      authenticate,
      requireCustomerPrincipal,
      (req, res) => {
        res.status(200).json({
          success: true,
          userId: req.user?.id,
          customerFilter: req.customerFilter,
        });
      },
    );

    // Direct guard invocation without prior authenticate middleware
    testApp.get('/test/customer/guard-only', requireCustomerPrincipal, (req, res) => {
      res.status(200).json({ success: true, user: req.user });
    });

    // Simulates pre-populated req.user (e.g. stale roles or spoofed userType) before requireCustomerPrincipal
    testApp.get(
      '/test/customer/pre-populated',
      (req, _res, next) => {
        const claimedId = req.headers['x-test-principal-id'];
        if (typeof claimedId === 'string') {
          req.user = {
            id: claimedId,
            userType: UserType.CUSTOMER,
            roles: [],
            permissions: [],
          };
        }
        next();
      },
      requireCustomerPrincipal,
      (req, res) => {
        res.status(200).json({
          success: true,
          user: req.user,
          customerFilter: req.customerFilter,
        });
      },
    );

    // Guest-capable optional customer route
    testApp.get(
      '/test/customer/optional',
      optionalAuthenticate,
      enforceOptionalCustomerPrincipal,
      (req, res) => {
        res.status(200).json({
          success: true,
          isGuest: !req.user,
          user: req.user ?? null,
          customerFilter: req.customerFilter ?? null,
        });
      },
    );
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9192222/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CG_TEST_/ } });
      await disconnectDatabase();
    }
  });

  describe('1. Valid Active Customer', () => {
    it('allows authenticated active CUSTOMER and attaches DB-verified principal and customerFilter', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(activeCustomerA);

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe(activeCustomerA._id.toString());
      expect(res.body.user.userType).toBe(UserType.CUSTOMER);
      expect(res.body.customerFilter).toEqual({ userId: activeCustomerA._id.toString() });
    });

    it('reloads current customer roles from MongoDB dynamically', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(activeCustomerA);

      await UserModel.updateOne(
        { _id: activeCustomerA._id },
        { $set: { roles: ['B2B_CUSTOMER'] } },
      );

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.roles).toContain('B2B_CUSTOMER');

      // Restore original roles
      await UserModel.updateOne({ _id: activeCustomerA._id }, { $set: { roles: [] } });
    });

    it('allows anonymous guest requests and active customer requests on enforceOptionalCustomerPrincipal', async () => {
      if (!isDbConnected) return;

      const guestRes = await request(testApp).get('/test/customer/optional');
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.isGuest).toBe(true);
      expect(guestRes.body.user).toBeNull();
      expect(guestRes.body.customerFilter).toBeNull();

      const customerToken = tokenService.signAccessToken(activeCustomerA);
      const authRes = await request(testApp)
        .get('/test/customer/optional')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(authRes.status).toBe(200);
      expect(authRes.body.isGuest).toBe(false);
      expect(authRes.body.user.id).toBe(activeCustomerA._id.toString());
      expect(authRes.body.customerFilter).toEqual({ userId: activeCustomerA._id.toString() });
    });
  });

  describe('2. Missing Authentication', () => {
    it('rejects unauthenticated request without Authorization header with HTTP 401', async () => {
      const res = await request(testApp).get('/test/customer/protected');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects direct requireCustomerPrincipal invocation when req.user is missing with HTTP 401', async () => {
      const res = await request(testApp).get('/test/customer/guard-only');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects malformed or tampered Bearer tokens with HTTP 401', async () => {
      if (!isDbConnected) return;

      const validToken = tokenService.signAccessToken(activeCustomerA);
      const tampered = `${validToken.slice(0, -5)}zzzzz`;

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${tampered}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  });

  describe('3. Inactive Customer Rejection', () => {
    it('rejects SUSPENDED customer token with HTTP 401 ACCOUNT_NOT_ACTIVE', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(suspendedCustomer);

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects PENDING_VERIFICATION customer token with HTTP 401 ACCOUNT_NOT_ACTIVE', async () => {
      if (!isDbConnected) return;

      const token = tokenService.signAccessToken(pendingCustomer);

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects customer suspended in DB even when req.user was already attached', async () => {
      if (!isDbConnected) return;

      const res = await request(testApp)
        .get('/test/customer/pre-populated')
        .set('x-test-principal-id', suspendedCustomer._id.toString());

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects deleted customer account when req.user points to a non-existent user', async () => {
      if (!isDbConnected) return;

      const nonexistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(testApp)
        .get('/test/customer/pre-populated')
        .set('x-test-principal-id', nonexistentId);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('4. Partner & Admin Rejection', () => {
    it('rejects PARTNER principal attempting a customer route with HTTP 403 CUSTOMER_IDENTITY_REQUIRED', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(activePartner);

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${partnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects STAFF/Admin principal attempting a customer route with HTTP 403 CUSTOMER_IDENTITY_REQUIRED', async () => {
      if (!isDbConnected) return;

      const adminToken = tokenService.signAccessToken(activeAdminStaff);

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects PARTNER and STAFF principals on optional-auth customer routes with HTTP 403', async () => {
      if (!isDbConnected) return;

      const partnerToken = tokenService.signAccessToken(activePartner);
      const partnerRes = await request(testApp)
        .get('/test/customer/optional')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(partnerRes.status).toBe(403);
      expect(partnerRes.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);

      const adminToken = tokenService.signAccessToken(activeAdminStaff);
      const adminRes = await request(testApp)
        .get('/test/customer/optional')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(403);
      expect(adminRes.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });
  });

  describe('5. Spoofed User Identity Protection', () => {
    it('rejects client-supplied mismatched userId in request body with HTTP 403', async () => {
      if (!isDbConnected) return;

      const tokenA = tokenService.signAccessToken(activeCustomerA);

      const res = await request(testApp)
        .post('/test/customer/protected')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ userId: activeCustomerB._id.toString() });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('rejects client-supplied mismatched userId in query parameters with HTTP 403', async () => {
      if (!isDbConnected) return;

      const tokenA = tokenService.signAccessToken(activeCustomerA);

      const res = await request(testApp)
        .get(`/test/customer/protected?userId=${activeCustomerB._id.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('rejects client-supplied mismatched userId in route parameters with HTTP 403', async () => {
      if (!isDbConnected) return;

      const tokenA = tokenService.signAccessToken(activeCustomerA);

      const res = await request(testApp)
        .get(`/test/customer/protected/${activeCustomerB._id.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('rejects spoofed x-user-id header and client-supplied customerId with HTTP 403', async () => {
      if (!isDbConnected) return;

      const tokenA = tokenService.signAccessToken(activeCustomerA);

      const headerSpoofRes = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-user-id', activeCustomerB._id.toString());

      expect(headerSpoofRes.status).toBe(403);
      expect(headerSpoofRes.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');

      const customerIdSpoofRes = await request(testApp)
        .post('/test/customer/protected')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ customerId: activeCustomerB._id.toString() });

      expect(customerIdSpoofRes.status).toBe(403);
      expect(customerIdSpoofRes.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('rejects unauthenticated caller supplying userId on optional customer route with HTTP 403', async () => {
      if (!isDbConnected) return;

      const res = await request(testApp).get(
        `/test/customer/optional?userId=${activeCustomerA._id.toString()}`,
      );

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('rejects spoofed req.user claiming CUSTOMER when DB record is PARTNER or STAFF', async () => {
      if (!isDbConnected) return;

      const partnerSpoofRes = await request(testApp)
        .get('/test/customer/pre-populated')
        .set('x-test-principal-id', activePartner._id.toString());

      expect(partnerSpoofRes.status).toBe(403);
      expect(partnerSpoofRes.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);

      const staffSpoofRes = await request(testApp)
        .get('/test/customer/pre-populated')
        .set('x-test-principal-id', activeAdminStaff._id.toString());

      expect(staffSpoofRes.status).toBe(403);
      expect(staffSpoofRes.body.error.code).toBe(COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects forged JWT claiming CUSTOMER userType for a PARTNER database account', async () => {
      if (!isDbConnected) return;

      const config = getConfig();
      const forgedJwt = jwt.sign(
        {
          sub: activePartner._id.toString(),
          userType: UserType.CUSTOMER,
          roles: [],
        },
        config.auth.jwt.accessSecret,
        { expiresIn: '5m', algorithm: 'HS256' },
      );

      const res = await request(testApp)
        .get('/test/customer/protected')
        .set('Authorization', `Bearer ${forgedJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('IDENTITY_MISMATCH');
    });
  });

  describe('6. CORS Idempotency-Key & Existing Header Preservation', () => {
    it('allows Idempotency-Key alongside existing commerce and auth headers in CORS preflight', async () => {
      const origin = 'http://localhost:3000';

      const res = await request(productionApp)
        .options('/api/v1/health')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'Idempotency-Key, X-Cart-Session-Token, Authorization, Content-Type',
        );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');

      const allowedHeaders = String(res.headers['access-control-allow-headers'] || '')
        .split(',')
        .map((h) => h.trim().toLowerCase());

      expect(allowedHeaders).toContain('idempotency-key');
      expect(allowedHeaders).toContain('x-cart-session-token');
      expect(allowedHeaders).toContain('authorization');
      expect(allowedHeaders).toContain('content-type');
      expect(allowedHeaders).toContain('x-correlation-id');
      expect(allowedHeaders).toContain('x-request-id');
      expect(allowedHeaders).toContain('x-auth-transport');
      expect(allowedHeaders).toContain('x-client-type');
      expect(allowedHeaders).toContain('x-requested-with');
    });

    it('rejects untrusted origins by omitting Access-Control-Allow-Origin', async () => {
      const res = await request(productionApp)
        .options('/api/v1/health')
        .set('Origin', 'https://untrusted-attacker.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Idempotency-Key');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
