import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Schema } from 'mongoose';
import express, { type Application } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  UserType,
  UserStatus,
  PermissionCode,
  type IAuthResponse,
  type IRefreshTokenResponse,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { PhoneOtpModel } from '../src/models/phone-otp.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { MockOtpProvider } from '../src/services/otp/mock-otp.provider.js';
import { TokenService } from '../src/services/token/token.service.js';
import { authenticate, partnerTenantGuard } from '../src/middleware/auth.middleware.js';
import { getConfig } from '../src/config/env.js';

// Schema for testing database-level partner tenant query enforcement
interface ITestPartnerOrder {
  title: string;
  partnerId: mongoose.Types.ObjectId;
}

const TestPartnerOrderSchema = new Schema<ITestPartnerOrder>({
  title: { type: String, required: true },
  partnerId: { type: Schema.Types.ObjectId, required: true },
});

const TestPartnerOrderModel =
  mongoose.models.TestPartnerOrder ||
  mongoose.model<ITestPartnerOrder>('TestPartnerOrder', TestPartnerOrderSchema);

describe('Step 7: Route Integration & Comprehensive Security Regression Suite', () => {
  let isDbConnected = false;
  let app: Application;
  let tenantApp: Application;
  let tokenService: TokenService;

  // Phone prefixes isolated with +9194444
  const multiIdentityPhone = '+919444400001';
  const customerOnlyPhone = '+919444400002';
  const partnerOnlyPhone = '+919444400003';
  const staffOnlyPhone = '+919444400004';
  const suspendedPhone = '+919444400005';
  const concurrentOtpPhone = '+919444400006';

  let partnerIdA: mongoose.Types.ObjectId;
  let partnerIdB: mongoose.Types.ObjectId;

  let existingPartnerUser: IUserDocument;
  let existingStaffAdminUser: IUserDocument;
  let existingStaffPlainUser: IUserDocument;
  let suspendedCustomerUser: IUserDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();

    if (isDbConnected) {
      // 1. Clean test-prefixed collections
      await UserModel.deleteMany({ phone: { $regex: /^\+9194444/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9194444/ } });
      await RoleModel.deleteMany({ code: { $in: ['SEC_TEST_ADMIN', 'SEC_TEST_STAFF_PLAIN'] } });
      await TestPartnerOrderModel.deleteMany({});

      // 2. Seed test roles
      await RoleModel.create([
        {
          code: 'SEC_TEST_ADMIN',
          name: 'Security Test Admin',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [
            PermissionCode.RBAC_MANAGE,
            PermissionCode.SETTINGS_WRITE,
            PermissionCode.CATALOG_READ,
          ],
        },
        {
          code: 'SEC_TEST_STAFF_PLAIN',
          name: 'Security Test Plain Staff',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
      ]);

      partnerIdA = new mongoose.Types.ObjectId();
      partnerIdB = new mongoose.Types.ObjectId();

      // 3. Pre-provision test accounts
      existingPartnerUser = await UserModel.create({
        phone: partnerOnlyPhone,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerIdA,
        roles: [],
      });

      existingStaffAdminUser = await UserModel.create({
        phone: staffOnlyPhone,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        email: 'sec.admin@thehomez.com',
        roles: ['SEC_TEST_ADMIN'],
      });

      existingStaffPlainUser = await UserModel.create({
        phone: '+919444400099',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        email: 'sec.plain@thehomez.com',
        roles: ['SEC_TEST_STAFF_PLAIN'],
      });

      suspendedCustomerUser = await UserModel.create({
        phone: suspendedPhone,
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
      });

      // 4. Seed partner orders for database-level query isolation test
      await TestPartnerOrderModel.create([
        { title: 'Partner A Cement Order', partnerId: partnerIdA },
        { title: 'Partner B Steel Order', partnerId: partnerIdB },
      ]);
    }

    // Initialize standard application instance
    app = createApp();

    // Initialize dedicated tenant test app to isolate tenant query routes
    tenantApp = express();
    tenantApp.use(express.json());
    tenantApp.get(
      '/api/v1/test/partner-orders/:orderId',
      authenticate,
      partnerTenantGuard,
      async (req, res, next) => {
        try {
          const order = await TestPartnerOrderModel.findOne({
            _id: req.params.orderId,
            ...req.partnerFilter,
          });

          if (!order) {
            res.status(404).json({
              success: false,
              error: {
                code: 'ORDER_NOT_FOUND',
                message: 'Order not found in authorized tenant scope',
                correlationId: req.correlationId,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }

          res.status(200).json({ success: true, data: order });
        } catch (err) {
          next(err);
        }
      },
    );
  });

  beforeEach(() => {
    MockOtpProvider.clearCapturedOtps();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9194444/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9194444/ } });
      await RoleModel.deleteMany({ code: { $in: ['SEC_TEST_ADMIN', 'SEC_TEST_STAFF_PLAIN'] } });
      await RefreshTokenModel.deleteMany({
        userId: {
          $in: [
            existingPartnerUser?._id,
            existingStaffAdminUser?._id,
            existingStaffPlainUser?._id,
            suspendedCustomerUser?._id,
          ],
        },
      });
      await TestPartnerOrderModel.deleteMany({});
      await disconnectDatabase();
    }
  });

  // =========================================================================
  // 1. COMPLETE AUTHENTICATION FLOW TESTS
  // =========================================================================
  describe('1. Complete Authentication Journey', () => {
    it('executes the complete 9-step customer authentication journey end-to-end', async () => {
      if (!isDbConnected) return;

      // Step 1: Request OTP
      const reqRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: customerOnlyPhone, userType: UserType.CUSTOMER });

      expect(reqRes.status).toBe(200);
      expect(reqRes.body.success).toBe(true);
      expect(reqRes.body.data.cooldownSeconds).toBe(60);

      // Step 2: Retrieve mock OTP via test-only capture mechanism
      const capturedOtp = MockOtpProvider.getLatestCapturedOtp(customerOnlyPhone);
      expect(capturedOtp).toBeDefined();
      expect(capturedOtp).toMatch(/^\d{6}$/);

      // Step 3: Verify OTP
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: customerOnlyPhone, otp: capturedOtp, userType: UserType.CUSTOMER });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);

      const authData: IAuthResponse = verifyRes.body.data;
      expect(authData.tokens.accessToken).toBeDefined();
      expect(authData.tokens.refreshToken).toBeDefined();

      // Step 4: Confirm CUSTOMER account creation in MongoDB
      const createdCustomer = await UserModel.findById(authData.user.id);
      expect(createdCustomer).toBeDefined();
      expect(createdCustomer?.phone).toBe(customerOnlyPhone);
      expect(createdCustomer?.userType).toBe(UserType.CUSTOMER);
      expect(createdCustomer?.status).toBe(UserStatus.ACTIVE);

      // Step 5: Access /auth/me with access token
      const meRes1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authData.tokens.accessToken}`);

      expect(meRes1.status).toBe(200);
      expect(meRes1.body.data.user.id).toBe(authData.user.id);
      expect(meRes1.body.data.user.phone).toBe(customerOnlyPhone);

      // Step 6: Refresh access and refresh tokens
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: authData.tokens.refreshToken });

      expect(refreshRes.status).toBe(200);
      const refreshData: IRefreshTokenResponse = refreshRes.body.data;
      const newAccessToken = refreshData.tokens.accessToken;
      const newRefreshToken = refreshData.tokens.refreshToken;

      expect(newAccessToken).toBeDefined();
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(authData.tokens.refreshToken);

      // Step 7: Access /auth/me with the new access token
      const meRes2 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`);

      expect(meRes2.status).toBe(200);
      expect(meRes2.body.data.user.id).toBe(authData.user.id);

      // Step 8: Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: newRefreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data.message).toBe('Successfully logged out');

      // Step 9: Confirm the revoked refresh token cannot be refreshed again
      const invalidRefreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: newRefreshToken });

      expect(invalidRefreshRes.status).toBe(401);
      expect(invalidRefreshRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('authenticates pre-provisioned PARTNER and returns partner-scoped identity', async () => {
      if (!isDbConnected) return;

      // 1. Request OTP
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: partnerOnlyPhone, userType: UserType.PARTNER });

      const otp = MockOtpProvider.getLatestCapturedOtp(partnerOnlyPhone);

      // 2. Verify OTP
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: partnerOnlyPhone, otp, userType: UserType.PARTNER });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(existingPartnerUser._id.toString());
      expect(res.body.data.user.userType).toBe(UserType.PARTNER);
      expect(res.body.data.user.partnerId).toBe(partnerIdA.toString());
    });

    it('authenticates pre-provisioned STAFF administrator and grants administrative role access', async () => {
      if (!isDbConnected) return;

      // 1. Request OTP
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: staffOnlyPhone, userType: UserType.STAFF });

      const otp = MockOtpProvider.getLatestCapturedOtp(staffOnlyPhone);

      // 2. Verify OTP
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: staffOnlyPhone, otp, userType: UserType.STAFF });

      expect(verifyRes.status).toBe(200);
      const token = verifyRes.body.data.tokens.accessToken;

      // 3. Access administrative discovery endpoint
      const rolesRes = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${token}`);

      expect(rolesRes.status).toBe(200);
      expect(rolesRes.body.success).toBe(true);
      expect(rolesRes.body.data.roles.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. IDENTITY ISOLATION & MULTI-IDENTITY RULES
  // =========================================================================
  describe('2. Multi-Identity Isolation', () => {
    let customerIdentity: IUserDocument;
    let partnerIdentity: IUserDocument;

    beforeAll(async () => {
      if (isDbConnected) {
        // Provision two separate accounts for the SAME normalized phone number
        customerIdentity = await UserModel.create({
          phone: multiIdentityPhone,
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
        });

        partnerIdentity = await UserModel.create({
          phone: multiIdentityPhone,
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: partnerIdA,
          roles: [],
        });
      }
    });

    it('confirms two distinct accounts coexist under identical phone number with unique IDs', async () => {
      if (!isDbConnected) return;

      expect(customerIdentity._id.toString()).not.toBe(partnerIdentity._id.toString());
      expect(customerIdentity.phone).toBe(partnerIdentity.phone);
      expect(customerIdentity.userType).toBe(UserType.CUSTOMER);
      expect(partnerIdentity.userType).toBe(UserType.PARTNER);
    });

    it('ensures OTP challenge for CUSTOMER identity cannot authenticate as PARTNER', async () => {
      if (!isDbConnected) return;

      // Request OTP for CUSTOMER
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: multiIdentityPhone, userType: UserType.CUSTOMER });

      const customerOtp = MockOtpProvider.getLatestCapturedOtp(multiIdentityPhone);
      expect(customerOtp).toBeDefined();

      // Attempt to verify with PARTNER userType
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: multiIdentityPhone, otp: customerOtp, userType: UserType.PARTNER });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('OTP_NOT_FOUND');
    });

    it('ensures partner without partnerId association cannot access partner-guarded tenant endpoints', async () => {
      if (!isDbConnected) return;

      const brokenPartner = await UserModel.create({
        phone: '+919444400088',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
      });

      const tokens = await tokenService.generateTokenPair(brokenPartner);

      // Attempt to access partner order
      const res = await request(tenantApp)
        .get(`/api/v1/test/partner-orders/${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PARTNER_CONTEXT_REQUIRED');
    });

    it('prohibits self-registration for non-provisioned PARTNER and STAFF accounts', async () => {
      if (!isDbConnected) return;

      const unprovisionedPhone = '+919444477777';

      // Anti-enumeration: returns 200 without dispatching
      const reqRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: unprovisionedPhone, userType: UserType.PARTNER });

      expect(reqRes.status).toBe(200);
      expect(MockOtpProvider.getLatestCapturedOtp(unprovisionedPhone)).toBeUndefined();

      // Attempting to verify any OTP code fails
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: unprovisionedPhone, otp: '123456', userType: UserType.PARTNER });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.error.code).toBe('OTP_NOT_FOUND');
    });

    it('prohibits suspended accounts from authenticating', async () => {
      if (!isDbConnected) return;

      // Anti-enumeration: returns 200 without challenge creation
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: suspendedPhone, userType: UserType.CUSTOMER });

      expect(MockOtpProvider.getLatestCapturedOtp(suspendedPhone)).toBeUndefined();

      // Verify attempt fails
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: suspendedPhone, otp: '123456', userType: UserType.CUSTOMER });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('OTP_NOT_FOUND');
    });

    it('prevents identity type escalation through request body tampering', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({
          phone: customerOnlyPhone,
          userType: UserType.CUSTOMER,
          escalatedUserType: UserType.STAFF,
          roles: ['SUPER_ADMIN'],
        });

      // Strict schema rejects unexpected keys with 400 VALIDATION_ERROR
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 3. OTP SECURITY REGRESSION
  // =========================================================================
  describe('3. OTP Security Regression', () => {
    it('rejects invalid OTP with remaining attempt countdown', async () => {
      if (!isDbConnected) return;

      const testPhone = '+919444400010';
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: testPhone, otp: '999999', userType: UserType.CUSTOMER });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_OTP');
      expect(res.body.error.message).toContain('attempt(s) remaining');
    });

    it('enforces maximum failed attempts and locks out OTP challenge after 3 failures', async () => {
      if (!isDbConnected) return;

      const testPhone = '+919444400011';
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      // 3 invalid attempts
      await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: testPhone, otp: '000001', userType: UserType.CUSTOMER });
      await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: testPhone, otp: '000002', userType: UserType.CUSTOMER });
      const lockoutRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: testPhone, otp: '000003', userType: UserType.CUSTOMER });

      expect(lockoutRes.status).toBe(429);
      expect(lockoutRes.body.error.code).toBe('MAX_ATTEMPTS_EXCEEDED');

      // Subsequent attempt with actual valid OTP is also rejected because challenge was consumed
      const validOtp = MockOtpProvider.getLatestCapturedOtp(testPhone);
      const postLockoutRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: testPhone, otp: validOtp, userType: UserType.CUSTOMER });
      expect(postLockoutRes.status).toBe(400);
      expect(postLockoutRes.body.error.code).toBe('OTP_NOT_FOUND');
    });

    it('enforces resend cooldown on successive OTP requests', async () => {
      if (!isDbConnected) return;

      const testPhone = '+919444400012';
      // First request
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      // Immediate second request
      const cooldownRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      expect(cooldownRes.status).toBe(429);
      expect(cooldownRes.body.error.code).toBe('COOLDOWN_ACTIVE');
    });

    it('guards against concurrent verification race conditions for the same OTP', async () => {
      if (!isDbConnected) return;

      const testPhone = concurrentOtpPhone;
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      const otp = MockOtpProvider.getLatestCapturedOtp(testPhone);

      // Fire 5 concurrent verification requests
      const verifyPromises = Array.from({ length: 5 }).map(() =>
        request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ phone: testPhone, otp, userType: UserType.CUSTOMER }),
      );

      const results = await Promise.all(verifyPromises);

      const successCount = results.filter((r) => r.status === 200).length;
      const failureCount = results.filter((r) => r.status === 400 || r.status === 409).length;

      // Exactly ONE request must succeed; 4 must be rejected
      expect(successCount).toBe(1);
      expect(failureCount).toBe(4);
    });

    it('verifies OTP values are NEVER stored in plaintext in MongoDB documents', async () => {
      if (!isDbConnected) return;

      const testPhone = '+919444400013';
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: testPhone, userType: UserType.CUSTOMER });

      const capturedOtp = MockOtpProvider.getLatestCapturedOtp(testPhone);
      expect(capturedOtp).toBeDefined();

      const otpDoc = await PhoneOtpModel.findOne({ phone: testPhone, isConsumed: false });
      expect(otpDoc).toBeDefined();

      // Document must have hashedOtp of 64 hex characters (HMAC-SHA256)
      expect(otpDoc?.hashedOtp).toMatch(/^[a-f0-9]{64}$/);
      expect(otpDoc?.hashedOtp).not.toBe(capturedOtp);

      // Raw plaintext OTP must not exist in any document field
      const docString = JSON.stringify(otpDoc?.toObject());
      expect(docString).not.toContain(capturedOtp);
    });
  });

  // =========================================================================
  // 4. REFRESH-TOKEN SECURITY REGRESSION
  // =========================================================================
  describe('4. Refresh Token Security & Family Reuse Detection', () => {
    it('executes atomic token rotation and tracks token lineage in MongoDB', async () => {
      if (!isDbConnected) return;

      const tokenPair = await tokenService.generateTokenPair(existingPartnerUser);
      const initialRecord = await RefreshTokenModel.findOne({
        tokenHash: cryptoHash(tokenPair.refreshToken),
      });
      expect(initialRecord).toBeDefined();

      // Rotate token
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokenPair.refreshToken });

      expect(res.status).toBe(200);
      const newRefreshToken = res.body.data.tokens.refreshToken;

      // Inspect old token record in MongoDB
      const oldDoc = await RefreshTokenModel.findOne({
        familyId: tokenPair.refreshToken.split('.')[0],
        revokedReason: 'ROTATED',
      });
      expect(oldDoc).toBeDefined();
      expect(oldDoc?.isRevoked).toBe(true);
      expect(oldDoc?.replacedByTokenHash).toBeDefined();

      // Inspect child token record in MongoDB
      const childDoc = await RefreshTokenModel.findOne({
        tokenHash: cryptoHash(newRefreshToken),
      });
      expect(childDoc).toBeDefined();
      expect(childDoc?.familyId).toBe(oldDoc?.familyId);
      expect(childDoc?.isRevoked).toBe(false);
    });

    it('triggers automatic family revocation when a rotated token is replayed', async () => {
      if (!isDbConnected) return;

      const tokenPair = await tokenService.generateTokenPair(existingPartnerUser);
      const familyId = tokenPair.refreshToken.split('.')[0];

      // 1. Legitimate first rotation
      const rotateRes1 = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokenPair.refreshToken });

      expect(rotateRes1.status).toBe(200);
      const childToken = rotateRes1.body.data.tokens.refreshToken;

      // 2. Attacker replays old rotated token
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokenPair.refreshToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // 3. Verify ALL tokens in the family have been immediately revoked in MongoDB
      const activeFamilyTokens = await RefreshTokenModel.find({
        familyId,
        isRevoked: false,
      });
      expect(activeFamilyTokens.length).toBe(0);

      // 4. Legitimate child token must now also be rejected
      const childRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: childToken });

      expect(childRes.status).toBe(401);
      expect(childRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('guards against concurrent refresh requests using atomic findOneAndUpdate', async () => {
      if (!isDbConnected) return;

      const tokenPair = await tokenService.generateTokenPair(existingPartnerUser);

      // Fire 3 simultaneous refresh requests using the exact same refresh token
      const promises = Array.from({ length: 3 }).map(() =>
        request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokenPair.refreshToken }),
      );

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 200).length;

      // At most one request can succeed in rotating the token
      expect(successCount).toBeLessThanOrEqual(1);
    });

    it('ensures tokens belonging to different users and families do not interfere', async () => {
      if (!isDbConnected) return;

      const tokensA = await tokenService.generateTokenPair(existingPartnerUser);
      const tokensB = await tokenService.generateTokenPair(existingStaffAdminUser);

      expect(tokensA.refreshToken.split('.')[0]).not.toBe(tokensB.refreshToken.split('.')[0]);

      // Revoking token A on logout must not affect token B
      await tokenService.revokeRefreshToken(tokensA.refreshToken);

      const rotatedB = await tokenService.rotateRefreshToken(tokensB.refreshToken);
      expect(rotatedB.accessToken).toBeDefined();
      expect(rotatedB.refreshToken).toBeDefined();
    });
  });

  // =========================================================================
  // 5. AUTHORIZATION & PARTNER TENANT ISOLATION REGRESSION
  // =========================================================================
  describe('5. Authorization & Partner Tenant Isolation', () => {
    it('rejects access when JWT access token is expired', async () => {
      const config = getConfig();

      // Sign token that expired 10 seconds ago
      const expiredToken = jwt.sign(
        { sub: existingStaffAdminUser._id.toString(), userType: UserType.STAFF, roles: [] },
        config.auth.jwt.accessSecret,
        { expiresIn: '-10s' },
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
    });

    it('rejects authenticated requests immediately if user is suspended in MongoDB', async () => {
      if (!isDbConnected) return;

      // Create an active user and generate token
      const volatileUser = await UserModel.create({
        phone: '+919444400030',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
      });

      const tokens = await tokenService.generateTokenPair(volatileUser);

      // Verify initial access
      const initialRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(initialRes.status).toBe(200);

      // Suspend user in MongoDB
      await UserModel.updateOne(
        { _id: volatileUser._id },
        { $set: { status: UserStatus.SUSPENDED } },
      );

      // Immediate subsequent request must fail without waiting for token expiry
      const postSuspendRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(postSuspendRes.status).toBe(401);
      expect(postSuspendRes.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('dynamically reflects permission removal from database without re-issuing JWT', async () => {
      if (!isDbConnected) return;

      await RoleModel.create({
        code: 'SEC_DYNAMIC_ROLE',
        name: 'Dynamic Role',
        userType: UserType.STAFF,
        permissions: [PermissionCode.RBAC_MANAGE],
      });

      const dynamicStaff = await UserModel.create({
        phone: '+919444400031',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SEC_DYNAMIC_ROLE'],
      });

      const tokens = await tokenService.generateTokenPair(dynamicStaff);

      // Has RBAC_MANAGE -> can access /roles
      const access1 = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(access1.status).toBe(200);

      // Administrator strips RBAC_MANAGE permission from database role
      await RoleModel.updateOne(
        { code: 'SEC_DYNAMIC_ROLE' },
        { $set: { permissions: [PermissionCode.CATALOG_READ] } },
      );

      // Immediate subsequent request with SAME token is rejected with 403
      const access2 = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(access2.status).toBe(403);
      expect(access2.body.error.code).toBe('FORBIDDEN');

      // Cleanup
      await RoleModel.deleteOne({ code: 'SEC_DYNAMIC_ROLE' });
      await UserModel.deleteOne({ _id: dynamicStaff._id });
    });

    it('denies staff members without RBAC_MANAGE permission from accessing /auth/roles', async () => {
      if (!isDbConnected) return;

      const plainStaffTokens = await tokenService.generateTokenPair(existingStaffPlainUser);

      const res = await request(app)
        .get('/api/v1/auth/roles')
        .set('Authorization', `Bearer ${plainStaffTokens.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('strictly enforces partner tenant scope at the DATABASE QUERY level', async () => {
      if (!isDbConnected) return;

      // Find Partner A's order and Partner B's order
      const orderA = await TestPartnerOrderModel.findOne({ partnerId: partnerIdA });
      const orderB = await TestPartnerOrderModel.findOne({ partnerId: partnerIdB });

      expect(orderA).toBeDefined();
      expect(orderB).toBeDefined();

      // Authenticate as Partner A
      const partnerATokens = await tokenService.generateTokenPair(existingPartnerUser);

      // 1. Partner A requests OWN order -> 200 OK
      const ownOrderRes = await request(tenantApp)
        .get(`/api/v1/test/partner-orders/${orderA?._id}`)
        .set('Authorization', `Bearer ${partnerATokens.accessToken}`);

      expect(ownOrderRes.status).toBe(200);
      expect(ownOrderRes.body.data.title).toBe('Partner A Cement Order');

      // 2. Partner A requests Partner B's order ID -> 404 ORDER_NOT_FOUND
      // Demonstrates that database query with req.partnerFilter safely isolates tenant data
      const otherOrderRes = await request(tenantApp)
        .get(`/api/v1/test/partner-orders/${orderB?._id}`)
        .set('Authorization', `Bearer ${partnerATokens.accessToken}`);

      expect(otherOrderRes.status).toBe(404);
      expect(otherOrderRes.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('rejects partner attempts to tamper with partnerId via query parameters', async () => {
      if (!isDbConnected) return;

      const partnerTokens = await tokenService.generateTokenPair(existingPartnerUser);

      // Partner A supplies partnerId of Partner B in query string
      const res = await request(tenantApp)
        .get(`/api/v1/test/partner-orders/${new mongoose.Types.ObjectId()}?partnerId=${partnerIdB}`)
        .set('Authorization', `Bearer ${partnerTokens.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
    });
  });

  // =========================================================================
  // 6. ERROR HANDLING, CORRELATION ID & SPOOFING REGRESSION
  // =========================================================================
  describe('6. Error Handling & Rate Limit Integrity', () => {
    it('propagates custom X-Correlation-Id header in responses and error bodies', async () => {
      const clientCorrelationId = 'client-cid-12345-abcde';

      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .set('X-Correlation-Id', clientCorrelationId)
        .send({ phone: 'invalid', userType: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.headers['x-correlation-id']).toBe(clientCorrelationId);
      expect(res.body.error.correlationId).toBe(clientCorrelationId);
      expect(res.body.error.timestamp).toBeDefined();
    });

    it('verifies fake X-Forwarded-For headers do NOT bypass rate limits when proxy is untrusted', async () => {
      const tightApp = express();
      tightApp.use(express.json());

      const { createAuthRateLimiter } =
        await import('../src/middleware/rate-limiter.middleware.js');
      const limiter = createAuthRateLimiter({ limit: 2, windowMs: 60 * 1000 });
      tightApp.post('/test/ip-limit', limiter, (_req, res) => res.json({ ok: true }));

      // Send 3 requests with DIFFERENT fake X-Forwarded-For headers
      const res1 = await request(tightApp)
        .post('/test/ip-limit')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({});
      const res2 = await request(tightApp)
        .post('/test/ip-limit')
        .set('X-Forwarded-For', '2.2.2.2')
        .send({});
      const res3 = await request(tightApp)
        .post('/test/ip-limit')
        .set('X-Forwarded-For', '3.3.3.3')
        .send({});

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      // Third request is rate-limited regardless of spoofed headers
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});

/**
 * Computes SHA-256 hash for raw refresh token to inspect database records in test assertions.
 */
function cryptoHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
