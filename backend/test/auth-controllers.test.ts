import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import express, { type Application } from 'express';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { PhoneOtpModel } from '../src/models/phone-otp.model.js';
import { OtpLockoutModel } from '../src/models/otp-lockout.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { MockOtpProvider } from '../src/services/otp/mock-otp.provider.js';
import { TokenService } from '../src/services/token/token.service.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { OtpService } from '../src/services/otp/otp.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { roleAssignmentSchema } from '../src/routes/auth.schemas.js';
import type { IOtpProvider } from '../src/services/otp/otp-provider.interface.js';

describe('Auth Routes & Controllers — Step 6 Endpoints & Contracts', () => {
  let isDbConnected = false;
  let app: Application;
  let tokenService: TokenService;
  let rbacService: RbacService;

  // Test phone numbers isolated with prefix +9195555
  const customerPhone = '+919555500001';
  const partnerPhone = '+919555500002';
  const staffPhone = '+919555500003';
  const nonExistentPhone = '+919555599999';

  let preProvisionedPartner: IUserDocument;
  let preProvisionedStaff: IUserDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    rbacService = new RbacService();

    if (isDbConnected) {
      // Clean up previous test artifacts
      await UserModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await RoleModel.deleteMany({ code: 'AUTH_CTRL_ADMIN' });

      // Create isolated test role with RBAC_MANAGE permission
      await RoleModel.create({
        code: 'AUTH_CTRL_ADMIN',
        name: 'Auth Controller Administrator',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.RBAC_MANAGE, PermissionCode.CATALOG_READ],
      });

      // Create pre-provisioned Partner account
      preProvisionedPartner = await UserModel.create({
        phone: partnerPhone,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: new mongoose.Types.ObjectId(),
        roles: [],
      });

      // Create pre-provisioned Staff account with AUTH_CTRL_ADMIN role (has RBAC_MANAGE)
      preProvisionedStaff = await UserModel.create({
        phone: staffPhone,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        email: 'staff.admin@thehomez.com',
        roles: ['AUTH_CTRL_ADMIN'],
      });
    }

    // Standard application instance
    app = createApp();
  });

  beforeEach(() => {
    MockOtpProvider.clearCapturedOtps();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+9195555/ } });
      await RoleModel.deleteMany({ code: 'AUTH_CTRL_ADMIN' });
      await RefreshTokenModel.deleteMany({
        userId: { $in: [preProvisionedPartner?._id, preProvisionedStaff?._id] },
      });
      await disconnectDatabase();
    }
  });

  describe('1. Request Payload Validation & Strict Field Controls', () => {
    it('rejects invalid or malformed phone numbers with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '12345', userType: UserType.CUSTOMER });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
      expect(res.body.error.details[0].field).toBe('phone');
    });

    it('rejects invalid userType with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '9555500001', userType: 'INVALID_TYPE' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('userType');
    });

    it('rejects OTP verification when OTP is not 6 digits', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: '9555500001', otp: '1234', userType: UserType.CUSTOMER });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('otp');
    });

    it('strictly rejects client-supplied privilege fields (roles, permissions, userId)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({
          phone: '9555500001',
          userType: UserType.CUSTOMER,
          roles: ['SUPER_ADMIN'],
          permissions: ['ALL'],
          userId: 'attacker-id',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed refresh token with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'plainstringwithoutdot' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('refreshToken');
    });

    it('rejects root-level array payloads with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send([{ phone: '9555500001', userType: UserType.CUSTOMER }]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects array inputs where scalar string is expected', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: ['9555500001'], userType: UserType.CUSTOMER });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('phone');
    });

    it('rejects oversized array payloads in unexpected fields (DoS mitigation)', async () => {
      const oversizedArray = new Array(2000).fill('UNAUTHORIZED_INPUT');
      const res = await request(app).post('/api/v1/auth/otp/request').send({
        phone: '9555500001',
        userType: UserType.CUSTOMER,
        unexpectedCollection: oversizedArray,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('strictly enforces max bounds on bounded array schemas (GHSA-mrhx-c7xc-m3w5)', () => {
      // Valid bounded collection <= 50
      const validPayload = { roles: ['SUPER_ADMIN', 'OPS_MANAGER'] };
      const parsed = roleAssignmentSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);

      // Oversized collection exceeding max limit (51 items)
      const oversizedRoles = new Array(51).fill('ROLE_CUSTOM');
      const invalidResult = roleAssignmentSchema.safeParse({ roles: oversizedRoles });
      expect(invalidResult.success).toBe(false);
      if (!invalidResult.success) {
        expect(invalidResult.error.issues[0].message).toContain('must not exceed 50 entries');
      }
    });
  });

  describe('2. OTP Request & SMS Provider Delivery Handling', () => {
    it('successfully requests OTP for customer and returns IOtpRequestResponse', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: customerPhone, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cooldownSeconds).toBe(60);
      expect(res.body.data.expiresInSeconds).toBe(300);
      expect(res.body.data.message).toContain('dispatched successfully');

      // Verify OTP in test capture store
      const captured = MockOtpProvider.getLatestCapturedOtp(customerPhone);
      expect(captured).toBeDefined();
      expect(captured).toMatch(/^\d{6}$/);
    });

    it('handles SMS provider delivery failure safely without leaving usable challenges', async () => {
      if (!isDbConnected) return;

      // Create a failing provider
      const failingProvider: IOtpProvider = {
        sendOtp: async () => {
          throw new Error('SMS Gateway Connection Timeout');
        },
      };

      const customOtpService = new OtpService(failingProvider);
      const customController = new AuthController(customOtpService, tokenService, rbacService);
      const failingApp = express();
      failingApp.use(express.json());
      failingApp.use('/api/v1/auth', createAuthRouter(customController));

      const testFailPhone = '+919555588888';
      const res = await request(failingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testFailPhone, userType: UserType.CUSTOMER });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('OTP_DELIVERY_FAILED');

      // Verify NO active challenge record was left behind in MongoDB
      const leftover = await PhoneOtpModel.findOne({ phone: testFailPhone });
      expect(leftover).toBeNull();
    });
  });

  describe('3. Customer Self-Provisioning via OTP Verification', () => {
    it('verifies valid OTP, provisions new CUSTOMER account, and issues tokens and safe profile', async () => {
      if (!isDbConnected) return;

      const newCustomerPhone = '+919555511111';

      // 1. Request OTP
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: newCustomerPhone, userType: UserType.CUSTOMER });

      const otp = MockOtpProvider.getLatestCapturedOtp(newCustomerPhone);
      expect(otp).toBeDefined();

      // 2. Verify OTP
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: newCustomerPhone, otp, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { tokens, user } = res.body.data;
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(900); // 15 mins default

      expect(user.id).toBeDefined();
      expect(user.phone).toBe(newCustomerPhone);
      expect(user.userType).toBe(UserType.CUSTOMER);
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.roles).toEqual([]);
      expect(user.permissions).toEqual([]);

      // Security Check: internal fields must not be exposed
      expect((user as unknown as Record<string, unknown>)._id).toBeUndefined();
      expect((user as unknown as Record<string, unknown>).__v).toBeUndefined();
      expect((user as unknown as Record<string, unknown>).hashedOtp).toBeUndefined();
    });
  });

  describe('4. Partner & Staff Pre-Provisioning Rules', () => {
    it('returns uniform response without dispatching OTP for non-existent PARTNER account (anti-enumeration)', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: nonExistentPhone, userType: UserType.PARTNER });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(MockOtpProvider.getLatestCapturedOtp(nonExistentPhone)).toBeUndefined();
      expect(
        await PhoneOtpModel.findOne({ phone: nonExistentPhone, userType: UserType.PARTNER }),
      ).toBeNull();
    });

    it('returns uniform response without dispatching OTP for non-existent STAFF account (anti-enumeration)', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: nonExistentPhone, userType: UserType.STAFF });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(MockOtpProvider.getLatestCapturedOtp(nonExistentPhone)).toBeUndefined();
      expect(
        await PhoneOtpModel.findOne({ phone: nonExistentPhone, userType: UserType.STAFF }),
      ).toBeNull();
    });

    it('allows OTP request and verification for pre-provisioned PARTNER account', async () => {
      if (!isDbConnected) return;

      // 1. Request OTP for partner
      const reqRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: partnerPhone, userType: UserType.PARTNER });

      expect(reqRes.status).toBe(200);

      const otp = MockOtpProvider.getLatestCapturedOtp(partnerPhone);
      expect(otp).toBeDefined();

      // 2. Verify OTP
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: partnerPhone, otp, userType: UserType.PARTNER });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.user.id).toBe(preProvisionedPartner._id.toString());
      expect(verifyRes.body.data.user.userType).toBe(UserType.PARTNER);
      expect(verifyRes.body.data.user.partnerId).toBe(preProvisionedPartner.partnerId?.toString());
    });
  });

  describe('5. Token Refresh & Logout Lifecycle', () => {
    it('rotates a valid refresh token atomically and returns new token pair', async () => {
      if (!isDbConnected) return;

      // Generate initial token pair for partner
      const initialTokens = await tokenService.generateTokenPair(preProvisionedPartner);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialTokens.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).not.toBe(initialTokens.refreshToken);
    });

    it('detects refresh token reuse and immediately invalidates family with 401 TOKEN_REUSE_DETECTED', async () => {
      if (!isDbConnected) return;

      const initialTokens = await tokenService.generateTokenPair(preProvisionedPartner);

      // First rotation succeeds
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialTokens.refreshToken });

      // Replaying the old already-rotated refresh token
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialTokens.refreshToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.success).toBe(false);
      expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('safely revokes refresh token on logout', async () => {
      if (!isDbConnected) return;

      const initialTokens = await tokenService.generateTokenPair(preProvisionedPartner);

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: initialTokens.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Successfully logged out');

      // Attempting to refresh using the logged-out token should fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initialTokens.refreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });

  describe('6. User Profile (/api/v1/auth/me)', () => {
    it('rejects unauthenticated request to /auth/me with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns authenticated user profile and dynamically queries permissions', async () => {
      if (!isDbConnected) return;

      const staffTokens = await tokenService.generateTokenPair(preProvisionedStaff);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${staffTokens.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const user = res.body.data.user;
      expect(user.id).toBe(preProvisionedStaff._id.toString());
      expect(user.phone).toBe(staffPhone);
      expect(user.email).toBe('staff.admin@thehomez.com');
      expect(user.userType).toBe(UserType.STAFF);
      expect(user.roles).toContain('AUTH_CTRL_ADMIN');
      // AUTH_CTRL_ADMIN role includes RBAC_MANAGE
      expect(user.permissions).toContain(PermissionCode.RBAC_MANAGE);
    });
  });

  describe('7. Administrative Role Discovery (/api/v1/auth/roles)', () => {
    it('rejects unauthenticated access with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/auth/roles');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-privileged customer access with HTTP 403 FORBIDDEN', async () => {
      if (!isDbConnected) return;

      // Create a customer user without RBAC_MANAGE
      const customer = await UserModel.create({
        phone: '+919555544444',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      const customerTokens = await tokenService.generateTokenPair(customer);

      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${customerTokens.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns role templates for staff administrator with RBAC_MANAGE permission', async () => {
      if (!isDbConnected) return;

      const staffTokens = await tokenService.generateTokenPair(preProvisionedStaff);

      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${staffTokens.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.roles)).toBe(true);
      expect(res.body.data.roles.length).toBeGreaterThan(0);

      const adminRole = res.body.data.roles.find(
        (r: { code: string }) => r.code === 'AUTH_CTRL_ADMIN',
      );
      expect(adminRole).toBeDefined();
      expect(adminRole.permissions).toContain(PermissionCode.RBAC_MANAGE);

      // Verify internal mongoose fields are not leaked
      expect(adminRole._id).toBeUndefined();
      expect(adminRole.__v).toBeUndefined();
    });
  });

  describe('8. Rate Limiter Application & Standard Error Envelope', () => {
    it('rate limits excessive requests and returns standardized RATE_LIMIT_EXCEEDED error', async () => {
      const tightApp = express();
      tightApp.use(express.json());

      const { createAuthRateLimiter } =
        await import('../src/middleware/rate-limiter.middleware.js');
      const tightLimiter = createAuthRateLimiter({
        limit: 3,
        windowMs: 60 * 1000,
      });

      tightApp.post('/test/tight-limit', tightLimiter, (_req, res) => {
        res.status(200).json({ success: true });
      });

      // Send 5 rapid requests to exceed limit of 3
      const responses = [];
      for (let i = 0; i < 5; i++) {
        responses.push(await request(tightApp).post('/test/tight-limit').send({}));
      }

      const rateLimited = responses.find((r) => r.status === 429);
      expect(rateLimited).toBeDefined();
      expect(rateLimited?.body.success).toBe(false);
      expect(rateLimited?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(rateLimited?.body.error.message).toContain('Too many requests');
    });

    it('ensures all error responses adhere to IApiErrorResponse structure', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: 'invalid', userType: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.code).toBe('string');
      expect(typeof res.body.error.message).toBe('string');
      expect(typeof res.body.error.timestamp).toBe('string');
    });
  });
});
