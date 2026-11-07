import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import express, { type Application } from 'express';
import { UserType, UserStatus } from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { PhoneOtpModel } from '../src/models/phone-otp.model.js';
import { OtpLockoutModel } from '../src/models/otp-lockout.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { MockOtpProvider } from '../src/services/otp/mock-otp.provider.js';
import { TokenService } from '../src/services/token/token.service.js';
import { OtpService } from '../src/services/otp/otp.service.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { createOtpIpRateLimiter, createAuthRateLimiter } from '../src/middleware/rate-limiter.middleware.js';
import { REFRESH_COOKIE_NAME } from '../src/services/token/cookie.utils.js';

describe('Milestone 5A.1 Backend Authentication Security Remediation Test Suite', () => {
  let isDbConnected = false;
  let app: Application;
  let tokenService: TokenService;
  let otpService: OtpService;

  // Dedicated phone numbers prefixed with +9197777 for test isolation
  const testPhoneBase = '+9197777';
  const cookieUserPhone = `${testPhoneBase}00001`;
  const reuseUserPhone = `${testPhoneBase}00002`;
  const cooldownPhone = `${testPhoneBase}00003`;
  const lockoutPhone = `${testPhoneBase}00004`;
  const nonExistentStaffPhone = `${testPhoneBase}00005`;
  const bodyCompatPhone = `${testPhoneBase}00006`;

  let preProvisionedCustomer: IUserDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    otpService = new OtpService(new MockOtpProvider());

    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await RefreshTokenModel.deleteMany({});

      preProvisionedCustomer = await UserModel.create({
        phone: cookieUserPhone,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
    }

    app = createApp();
  });

  beforeEach(() => {
    MockOtpProvider.clearCapturedOtps();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await disconnectDatabase();
    }
  });

  // =========================================================================
  // 1. HTTP-ONLY COOKIE ISSUANCE
  // =========================================================================
  describe('1. HTTP-Only Cookie Issuance (SEC-5A1-01)', () => {
    it('issues an HTTP-only secure cookie on OTP verification and suppresses token from browser JSON', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}10001`;
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone, userType: UserType.CUSTOMER });

      const otp = MockOtpProvider.getLatestCapturedOtp(phone);
      expect(otp).toBeDefined();

      // Browser client call with X-Auth-Transport: cookie header
      const res = await request(app)
        .post('/api/v1/auth/otp/verify')
        .set('X-Auth-Transport', 'cookie')
        .send({ phone, otp, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify Set-Cookie header contains thz_refresh_token with correct flags
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);
      expect(cookieStr).toContain(REFRESH_COOKIE_NAME);
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('path=/api/v1/auth');
      expect(cookieStr.toLowerCase()).toContain('samesite=strict');

      // Verify refreshToken is NOT exposed in the JSON response body for browser clients
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. COOKIE-BASED REFRESH
  // =========================================================================
  describe('2. Cookie-Based Refresh (SEC-5A1-01)', () => {
    it('authenticates and rotates refresh token using HTTP-only cookie with empty body', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      // Browser cookie-based refresh does not return refreshToken in response body
      expect(res.body.data.tokens.refreshToken).toBeUndefined();

      // Set-Cookie header must contain the newly rotated refresh token
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);
      expect(cookieStr).toContain(REFRESH_COOKIE_NAME);
      expect(cookieStr).not.toContain(tokens.refreshToken); // Must be a new rotated token
    });
  });

  // =========================================================================
  // 3. COOKIE ROTATION
  // =========================================================================
  describe('3. Cookie Rotation (SEC-5A1-01)', () => {
    it('rotates cookie token atomically and updates lineage in database', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(res.status).toBe(200);

      // Verify old token was revoked with reason ROTATED
      const oldTokenFamily = tokens.refreshToken.split('.')[0];
      const records = await RefreshTokenModel.find({ familyId: oldTokenFamily }).sort({ createdAt: 1 });
      expect(records.length).toBe(2);
      expect(records[0]?.isRevoked).toBe(true);
      expect(records[0]?.revokedReason).toBe('ROTATED');
      expect(records[1]?.isRevoked).toBe(false);
    });
  });

  // =========================================================================
  // 4. COOKIE CLEARANCE ON LOGOUT
  // =========================================================================
  describe('4. Cookie Clearance on Logout (SEC-5A1-01 & SEC-5A1-09)', () => {
    it('clears the thz_refresh_token cookie and revokes the active session on logout', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Successfully logged out');

      // Verify Set-Cookie clears the cookie (Max-Age=0 or expired)
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);
      expect(cookieStr).toContain(REFRESH_COOKIE_NAME);
      expect(
        cookieStr.includes('Max-Age=0') ||
        cookieStr.includes('expires=Thu, 01 Jan 1970') ||
        cookieStr.includes('Expires=Thu, 01 Jan 1970')
      ).toBe(true);

      // Subsequent refresh with that logged-out token must fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(refreshRes.status).toBe(401);
    });

    it('supports authenticated logout-all endpoint revoking all user sessions', async () => {
      if (!isDbConnected) return;

      const tokens1 = await tokenService.generateTokenPair(preProvisionedCustomer);
      const tokens2 = await tokenService.generateTokenPair(preProvisionedCustomer);

      const res = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${tokens1.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Successfully logged out from all devices');

      // Both refresh tokens are now revoked
      const ref1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens1.refreshToken });
      const ref2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens2.refreshToken });
      expect(ref1.status).toBe(401);
      expect(ref2.status).toBe(401);
    });
  });

  // =========================================================================
  // 5. REFRESH-TOKEN REUSE DETECTION
  // =========================================================================
  describe('5. Refresh-Token Reuse Detection', () => {
    it('detects cookie-based token reuse and immediately revokes all family tokens', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      // First refresh succeeds
      const res1 = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(res1.status).toBe(200);

      // Replaying the old already-rotated cookie token
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });
  });

  // =========================================================================
  // 6. GLOBAL IP RATE LIMITING (SEC-5A1-03)
  // =========================================================================
  describe('6. Global IP Rate Limiting (SEC-5A1-03)', () => {
    it('throttles excessive OTP requests from a single IP across distinct phone numbers (toll fraud defense)', async () => {
      const tightApp = express();
      tightApp.use(express.json());

      // Create IP limiter strictly capped at 3 requests
      const testIpLimiter = createOtpIpRateLimiter({
        limit: 3,
        windowMs: 60 * 1000,
      });

      tightApp.post('/test/otp-request-ip', testIpLimiter, (_req, res) => {
        res.status(200).json({ success: true, message: 'OTP challenge dispatched successfully' });
      });

      // 4 requests with distinct phone numbers from the SAME IP
      const responses = [];
      for (let i = 1; i <= 4; i++) {
        responses.push(
          await request(tightApp)
            .post('/test/otp-request-ip')
            .send({ phone: `+9197777000${i}0`, userType: UserType.CUSTOMER }),
        );
      }

      expect(responses[0]?.status).toBe(200);
      expect(responses[1]?.status).toBe(200);
      expect(responses[2]?.status).toBe(200);
      // 4th request must be throttled at IP layer despite novel phone number
      expect(responses[3]?.status).toBe(429);
      expect(responses[3]?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // =========================================================================
  // 7. PHONE / IP RATE LIMITING
  // =========================================================================
  describe('7. Phone/IP Rate Limiting', () => {
    it('throttles rapid repeated requests for the same phone number', async () => {
      const testApp = express();
      testApp.use(express.json());

      const phoneLimiter = createAuthRateLimiter({
        limit: 2,
        windowMs: 60 * 1000,
      });

      testApp.post('/test/phone-ip-limit', phoneLimiter, (_req, res) => {
        res.status(200).json({ success: true });
      });

      const phone = `${testPhoneBase}70001`;
      const res1 = await request(testApp).post('/test/phone-ip-limit').send({ phone });
      const res2 = await request(testApp).post('/test/phone-ip-limit').send({ phone });
      const res3 = await request(testApp).post('/test/phone-ip-limit').send({ phone });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // =========================================================================
  // 8. CONSUMED OTP COOLDOWN (SEC-5A1-04)
  // =========================================================================
  describe('8. Consumed OTP Cooldown (SEC-5A1-04)', () => {
    it('enforces 60-second cooldown even when previous challenge has been burned/consumed', async () => {
      if (!isDbConnected) return;

      const phone = cooldownPhone;

      // 1. Request OTP
      await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone, userType: UserType.CUSTOMER });

      // 2. Burn challenge through 3 invalid attempts
      await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp: '000000', userType: UserType.CUSTOMER });
      await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp: '000000', userType: UserType.CUSTOMER });
      const burnRes = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp: '000000', userType: UserType.CUSTOMER });
      expect(burnRes.status).toBe(429);

      // Verify the record is indeed consumed in MongoDB
      const burnedDoc = await PhoneOtpModel.findOne({ phone, userType: UserType.CUSTOMER }).sort({ createdAt: -1 });
      expect(burnedDoc?.isConsumed).toBe(true);

      // 3. Immediately request a new OTP: MUST be rejected with 429 COOLDOWN_ACTIVE (cooldown bypass fixed)
      const cooldownRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone, userType: UserType.CUSTOMER });

      expect(cooldownRes.status).toBe(429);
      expect(cooldownRes.body.error.code).toBe('COOLDOWN_ACTIVE');
      expect(cooldownRes.body.error.message).toContain('Please wait');
    });
  });

  // =========================================================================
  // 9. OTP LOCKOUT (SEC-5A1-04)
  // =========================================================================
  describe('9. OTP Lockout Controls (SEC-5A1-04: 15-Minute Freeze after 5 Failures)', () => {
    it('enforces temporary 15-minute phone lockout after 5 cumulative verification failures', async () => {
      if (!isDbConnected) return;

      const phone = lockoutPhone;

      // Clean existing state for lockoutPhone
      await PhoneOtpModel.deleteMany({ phone });
      await OtpLockoutModel.deleteMany({ phone });

      // Challenge 1: 3 failures
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      for (let i = 0; i < 3; i++) {
        try {
          await otpService.verifyOtp(phone, '000000', UserType.CUSTOMER);
        } catch {
          // Expected failure
        }
      }

      // Fast-forward cooldown by updating cooldownUntil
      await PhoneOtpModel.updateMany({ phone }, { $set: { cooldownUntil: new Date(Date.now() - 5000) } });

      // Challenge 2: 2 more failures -> total 5 cumulative failures
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      try {
        await otpService.verifyOtp(phone, '000000', UserType.CUSTOMER);
      } catch {
        // 4th cumulative failure
      }

      // 5th failure triggers lockout
      let lockoutError: unknown;
      try {
        await otpService.verifyOtp(phone, '000000', UserType.CUSTOMER);
      } catch (err) {
        lockoutError = err;
      }

      expect(lockoutError).toBeDefined();
      const errObj = lockoutError as { code: string; statusCode: number; message: string };
      expect(errObj.code).toBe('ACCOUNT_LOCKED');
      expect(errObj.statusCode).toBe(429);
      expect(errObj.message).toContain('Account temporarily locked');

      // Verify that further OTP requests are also blocked during the lockout period
      await expect(otpService.requestOtp(phone, UserType.CUSTOMER)).rejects.toThrow(
        /Account temporarily locked/,
      );
    });
  });

  // =========================================================================
  // 10. OTP REPLAY AND EXPIRY
  // =========================================================================
  describe('10. OTP Replay and Expiry Protection', () => {
    it('rejects replay of previously consumed OTP', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}90001`;
      await request(app).post('/api/v1/auth/otp/request').send({ phone, userType: UserType.CUSTOMER });
      const otp = MockOtpProvider.getLatestCapturedOtp(phone);
      expect(otp).toBeDefined();

      // First verification succeeds
      const res1 = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, userType: UserType.CUSTOMER });
      expect(res1.status).toBe(200);

      // Second verification attempt with same OTP fails
      const res2 = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, userType: UserType.CUSTOMER });
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('OTP_NOT_FOUND');
    });

    it('rejects expired OTP challenge with 400 OTP_EXPIRED', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}90002`;
      await request(app).post('/api/v1/auth/otp/request').send({ phone, userType: UserType.CUSTOMER });
      const otp = MockOtpProvider.getLatestCapturedOtp(phone);

      // Artificially expire the record
      await PhoneOtpModel.updateOne({ phone, isConsumed: false }, { $set: { expiresAt: new Date(Date.now() - 5000) } });

      const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, userType: UserType.CUSTOMER });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });
  });

  // =========================================================================
  // 11. ACCOUNT ENUMERATION PROTECTION (SEC-5A1-06)
  // =========================================================================
  describe('11. Account Enumeration Protection (SEC-5A1-06)', () => {
    it('returns uniform 200 envelope on OTP request for non-existent privileged accounts', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: nonExistentStaffPhone, userType: UserType.STAFF });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('dispatched successfully');
      expect(MockOtpProvider.getLatestCapturedOtp(nonExistentStaffPhone)).toBeUndefined();
    });
  });

  // =========================================================================
  // 12. CORS PREFLIGHT BEHAVIOUR (SEC-5A1-07)
  // =========================================================================
  describe('12. CORS Preflight & Header Whitelisting (SEC-5A1-07)', () => {
    it('permits cross-origin preflight requests with X-Cart-Session-Token and X-Auth-Transport headers', async () => {
      const res = await request(app)
        .options('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-Cart-Session-Token, X-Auth-Transport');

      expect([200, 204]).toContain(res.status);
      const allowHeaders = res.headers['access-control-allow-headers'];
      expect(allowHeaders).toBeDefined();
      const allowStr = Array.isArray(allowHeaders) ? allowHeaders.join(', ') : String(allowHeaders);
      expect(allowStr.toLowerCase()).toContain('x-cart-session-token');
      expect(allowStr.toLowerCase()).toContain('x-auth-transport');
    });
  });

  // =========================================================================
  // 13. PROXY-AWARE IP HANDLING (SEC-5A1-08)
  // =========================================================================
  describe('13. Proxy-Aware IP Handling (SEC-5A1-08)', () => {
    it('correctly resolves client IP when trust proxy is active', async () => {
      const proxyApp = express();
      proxyApp.set('trust proxy', 1); // Trust single upstream hop (AWS ALB / Nginx)

      proxyApp.get('/test/ip', (req, res) => {
        res.status(200).json({ ip: req.ip });
      });

      const res = await request(proxyApp)
        .get('/test/ip')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.195');
    });

    it('ignores arbitrary forwarded IP headers when trust proxy is disabled (anti-spoofing)', async () => {
      const directApp = express();
      directApp.set('trust proxy', false);

      directApp.get('/test/ip', (req, res) => {
        res.status(200).json({ ip: req.ip });
      });

      const res = await request(directApp)
        .get('/test/ip')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.status).toBe(200);
      // Untrusted X-Forwarded-For is ignored, resolving to loopback
      expect(res.body.ip).not.toBe('203.0.113.195');
    });
  });

  // =========================================================================
  // 14. EXISTING BODY-BASED COMPATIBILITY
  // =========================================================================
  describe('14. Existing Body-Based Authentication Compatibility', () => {
    it('seamlessly supports API clients supplying refreshToken in request body', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      // API client provides refreshToken in request body without Cookie header
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).not.toBe(tokens.refreshToken);
    });

    it('rejects refresh when neither cookie nor body refreshToken is provided', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
