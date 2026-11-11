import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
import {
  REFRESH_COOKIE_NAME,
  getRefreshCookieOptions,
  clearRefreshTokenCookie,
} from '../src/services/token/cookie.utils.js';
import { getConfig } from '../src/config/env.js';
import { logger } from '../src/logger/logger.js';

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
      expect(burnRes.status).toBe(400);
      expect(burnRes.body.error.code).toBe('INVALID_OTP');

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

      // Second verification attempt with same OTP fails identically to invalid OTP
      const res2 = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, userType: UserType.CUSTOMER });
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('INVALID_OTP');
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

    it('returns indistinguishable 400 INVALID_OTP responses for nonexistent challenges vs invalid OTP codes', async () => {
      if (!isDbConnected) return;

      const activePhone = `${testPhoneBase}91001`;
      const missingStaffPhone = `${testPhoneBase}91002`;
      const suspendedCustomerPhone = `${testPhoneBase}91003`;

      await UserModel.create({
        phone: suspendedCustomerPhone,
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
      });

      // Active account requests a real challenge
      await request(app).post('/api/v1/auth/otp/request').send({ phone: activePhone, userType: UserType.CUSTOMER });
      // Nonexistent staff and suspended customer receive uniform 200 without DB challenge
      await request(app).post('/api/v1/auth/otp/request').send({ phone: missingStaffPhone, userType: UserType.STAFF });
      await request(app).post('/api/v1/auth/otp/request').send({ phone: suspendedCustomerPhone, userType: UserType.CUSTOMER });

      const wrongActiveRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: activePhone, otp: '000000', userType: UserType.CUSTOMER });

      const missingStaffRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: missingStaffPhone, otp: '000000', userType: UserType.STAFF });

      const suspendedRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: suspendedCustomerPhone, otp: '000000', userType: UserType.CUSTOMER });

      expect(wrongActiveRes.status).toBe(400);
      expect(missingStaffRes.status).toBe(400);
      expect(suspendedRes.status).toBe(400);

      expect(wrongActiveRes.body.error.code).toBe('INVALID_OTP');
      expect(missingStaffRes.body.error.code).toBe(wrongActiveRes.body.error.code);
      expect(suspendedRes.body.error.code).toBe(wrongActiveRes.body.error.code);

      expect(missingStaffRes.body.error.message).toBe(wrongActiveRes.body.error.message);
      expect(suspendedRes.body.error.message).toBe(wrongActiveRes.body.error.message);

      expect(wrongActiveRes.body.error.details).toBeUndefined();
      expect(missingStaffRes.body.error.details).toBeUndefined();
      expect(suspendedRes.body.error.details).toBeUndefined();
    });

    it('returns identical 400 INVALID_OTP on the 3rd (final) failed attempt while burning challenge and logging security warning', async () => {
      if (!isDbConnected) return;

      const isolatedApp = createApp();
      const activePhone = `${testPhoneBase}91004`;
      const missingStaffPhone = `${testPhoneBase}91005`;

      await PhoneOtpModel.deleteMany({ phone: { $in: [activePhone, missingStaffPhone] } });
      await OtpLockoutModel.deleteMany({ phone: { $in: [activePhone, missingStaffPhone] } });

      await request(isolatedApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: activePhone, userType: UserType.CUSTOMER });
      await request(isolatedApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: missingStaffPhone, userType: UserType.STAFF });

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        const activeResponses = [];
        const missingResponses = [];

        for (let attempt = 1; attempt <= 3; attempt++) {
          activeResponses.push(
            await request(isolatedApp)
              .post('/api/v1/auth/otp/verify')
              .send({ phone: activePhone, otp: '000000', userType: UserType.CUSTOMER }),
          );
          missingResponses.push(
            await request(isolatedApp)
              .post('/api/v1/auth/otp/verify')
              .send({ phone: missingStaffPhone, otp: '000000', userType: UserType.STAFF }),
          );
        }

        // All 3 attempts (including final 3rd attempt) must be externally indistinguishable
        for (let i = 0; i < 3; i++) {
          expect(activeResponses[i]?.status).toBe(400);
          expect(missingResponses[i]?.status).toBe(400);
          expect(activeResponses[i]?.body.error.code).toBe('INVALID_OTP');
          expect(missingResponses[i]?.body.error.code).toBe('INVALID_OTP');
          expect(activeResponses[i]?.body.error.message).toBe(
            missingResponses[i]?.body.error.message,
          );
          expect(activeResponses[i]?.body.error.details).toBeUndefined();
          expect(missingResponses[i]?.body.error.details).toBeUndefined();
        }

        // Internal challenge must still be burned after attempt 3 and lockout counter tracked
        const burnedChallenge = await PhoneOtpModel.findOne({
          phone: activePhone,
          userType: UserType.CUSTOMER,
        });
        expect(burnedChallenge?.isConsumed).toBe(true);
        expect(burnedChallenge?.attempts).toBe(3);

        const lockoutRecord = await OtpLockoutModel.findOne({
          phone: activePhone,
          userType: UserType.CUSTOMER,
        });
        expect(lockoutRecord?.failedAttempts).toBe(3);

        // Even the real OTP cannot be used once burned on attempt 3
        const validOtp = MockOtpProvider.getLatestCapturedOtp(activePhone);
        const replayValidRes = await request(isolatedApp)
          .post('/api/v1/auth/otp/verify')
          .send({ phone: activePhone, otp: validOtp, userType: UserType.CUSTOMER });
        expect(replayValidRes.status).toBe(400);
        expect(replayValidRes.body.error.code).toBe('INVALID_OTP');

        // Security warning log must be recorded for exhausted challenge invalidation
        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            userType: UserType.CUSTOMER,
            attempts: 3,
            maxAttempts: 3,
          }),
          'SECURITY: OTP challenge invalidated after maximum verification attempts reached',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('applies global IP rate limiting to POST /api/v1/auth/otp/verify across distinct phones', async () => {
      const prevLimit = process.env.OTP_IP_RATE_LIMIT_MAX_REQUESTS;
      process.env.OTP_IP_RATE_LIMIT_MAX_REQUESTS = '3';
      getConfig(true);

      try {
        const limitedApp = createApp();
        const responses = [];
        for (let i = 1; i <= 4; i++) {
          responses.push(
            await request(limitedApp)
              .post('/api/v1/auth/otp/verify')
              .send({
                phone: `${testPhoneBase}9200${i}`,
                otp: '123456',
                userType: UserType.STAFF,
              }),
          );
        }

        expect(responses[0]?.status).toBe(400);
        expect(responses[1]?.status).toBe(400);
        expect(responses[2]?.status).toBe(400);
        expect(responses[3]?.status).toBe(429);
        expect(responses[3]?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      } finally {
        if (prevLimit === undefined) {
          delete process.env.OTP_IP_RATE_LIMIT_MAX_REQUESTS;
        } else {
          process.env.OTP_IP_RATE_LIMIT_MAX_REQUESTS = prevLimit;
        }
        getConfig(true);
      }
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

  // =========================================================================
  // 15. HARDENED BROWSER REFRESH-TOKEN SUPPRESSION (SECOND PASS)
  // =========================================================================
  describe('15. Hardened Browser Refresh-Token Suppression', () => {
    it('suppresses refreshToken in JSON on otp/verify when only Origin header is present', async () => {
      if (!isDbConnected) return;

      const isolatedApp = createApp();
      const phone = `${testPhoneBase}93001`;
      await request(isolatedApp).post('/api/v1/auth/otp/request').send({ phone, userType: UserType.CUSTOMER });
      const otp = MockOtpProvider.getLatestCapturedOtp(phone);

      const res = await request(isolatedApp)
        .post('/api/v1/auth/otp/verify')
        .set('Origin', 'http://localhost:3000')
        .send({ phone, otp, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
    });

    it('suppresses refreshToken in JSON on otp/verify when browser User-Agent is present without Sec-Fetch or X-Auth-Transport', async () => {
      if (!isDbConnected) return;

      const isolatedApp = createApp();
      const phone = `${testPhoneBase}93002`;
      await request(isolatedApp).post('/api/v1/auth/otp/request').send({ phone, userType: UserType.CUSTOMER });
      const otp = MockOtpProvider.getLatestCapturedOtp(phone);

      const res = await request(isolatedApp)
        .post('/api/v1/auth/otp/verify')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36')
        .send({ phone, otp, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
    });

    it('cannot be tricked into returning refreshToken in JSON via X-Auth-Transport: body when browser headers are present', async () => {
      if (!isDbConnected) return;

      const isolatedApp = createApp();
      const phone = `${testPhoneBase}93003`;
      await request(isolatedApp).post('/api/v1/auth/otp/request').send({ phone, userType: UserType.CUSTOMER });
      const otp = MockOtpProvider.getLatestCapturedOtp(phone);

      const res = await request(isolatedApp)
        .post('/api/v1/auth/otp/verify')
        .set('Origin', 'http://localhost:3000')
        .set('X-Auth-Transport', 'body')
        .send({ phone, otp, userType: UserType.CUSTOMER });

      expect(res.status).toBe(200);
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
    });

    it('suppresses refreshToken in JSON on /refresh for browser requests even if body refreshToken is also sent', async () => {
      if (!isDbConnected) return;

      const isolatedApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);
      const res = await request(isolatedApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({ refreshToken: tokens.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
    });
  });

  // =========================================================================
  // 16. EXPLICIT CSRF PROTECTION ON /refresh AND /logout (SECOND PASS)
  // =========================================================================
  describe('16. Explicit CSRF Protection on Cookie Endpoints', () => {
    it('rejects cross-origin /refresh and /logout requests with untrusted Origin', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const refreshRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://evil.example.com')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(refreshRes.status).toBe(403);
      expect(refreshRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

      const logoutRes = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://evil.example.com')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(logoutRes.status).toBe(403);
      expect(logoutRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

      // Token remains valid (was not rotated or revoked by blocked CSRF request)
      const activeRecord = await RefreshTokenModel.findOne({
        familyId: tokens.refreshToken!.split('.')[0],
        isRevoked: false,
      });
      expect(activeRecord).not.toBeNull();
    });

    it('rejects same-site subdomain attacks even when SameSite=Strict cookie is attached', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const subdomainWithOrigin = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Sec-Fetch-Site', 'same-site')
        .set('Origin', 'https://untrusted-subdomain.thehomez.com')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(subdomainWithOrigin.status).toBe(403);
      expect(subdomainWithOrigin.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

      const subdomainWithoutOrigin = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Sec-Fetch-Site', 'same-site')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(subdomainWithoutOrigin.status).toBe(403);
      expect(subdomainWithoutOrigin.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    });

    it('rejects cross-site Fetch Metadata and form-encoded CSRF payloads on /refresh', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const crossSiteRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(crossSiteRes.status).toBe(403);
      expect(crossSiteRes.body.error.code).toBe('CSRF_VALIDATION_FAILED');

      const formCsrfRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send('');

      expect(formCsrfRes.status).toBe(403);
      expect(formCsrfRes.body.error.code).toBe('CSRF_VALIDATION_FAILED');

      const badRefererRes = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('Referer', 'https://attacker.com/csrf.html')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(badRefererRes.status).toBe(403);
      expect(badRefererRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    });

    it('allows legitimate Vite development proxy requests on /refresh and /logout', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const refreshRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Referer', 'http://localhost:3000/')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Sec-Fetch-Mode', 'cors')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.tokens.accessToken).toBeDefined();
      expect(refreshRes.body.data.tokens.refreshToken).toBeUndefined();
      expect(refreshRes.headers['set-cookie']).toBeDefined();

      // Extract rotated cookie value
      const setCookieHeader = refreshRes.headers['set-cookie'];
      const rawCookie = Array.isArray(setCookieHeader) ? setCookieHeader[0]! : String(setCookieHeader);
      const rotatedToken = rawCookie.split(';')[0]!.split('=')[1]!;

      const logoutRes = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:3000')
        .set('Referer', 'http://localhost:3000/')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Sec-Fetch-Mode', 'cors')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${rotatedToken}`)
        .send({});

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data.message).toBe('Successfully logged out');
    });

    it('rejects Origin: null on cookie-authenticated /refresh and /logout', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const refreshRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'null')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(refreshRes.status).toBe(403);
      expect(refreshRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

      const logoutRes = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('Origin', 'null')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(logoutRes.status).toBe(403);
      expect(logoutRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    });

    it('rejects multipart/form-data and text/plain Content-Types on cookie-authenticated /refresh and /logout', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const multipartRefresh = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Content-Type', 'multipart/form-data; boundary=----TheHomezCsrfBoundary')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send('');

      expect(multipartRefresh.status).toBe(403);
      expect(multipartRefresh.body.error.code).toBe('CSRF_VALIDATION_FAILED');

      const textRefresh = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Content-Type', 'text/plain')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send('refreshToken=ignored');

      expect(textRefresh.status).toBe(403);
      expect(textRefresh.body.error.code).toBe('CSRF_VALIDATION_FAILED');

      const textLogout = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:3000')
        .set('Content-Type', 'text/plain; charset=utf-8')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send('logout');

      expect(textLogout.status).toBe(403);
      expect(textLogout.body.error.code).toBe('CSRF_VALIDATION_FAILED');
    });

    it('rejects browser User-Agent missing Origin, Referer, and Sec-Fetch-Site when no cookie is present', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const res = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        )
        .send({ refreshToken: tokens.refreshToken });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED');
    });

    it('rejects spoofed X-Auth-Transport: cookie combined with untrusted Origin or cross-site Fetch Metadata', async () => {
      if (!isDbConnected) return;

      const csrfApp = createApp();
      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);

      const untrustedOriginRes = await request(csrfApp)
        .post('/api/v1/auth/refresh')
        .set('X-Auth-Transport', 'cookie')
        .set('Origin', 'https://evil.example.com')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(untrustedOriginRes.status).toBe(403);
      expect(untrustedOriginRes.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

      const crossSiteRes = await request(csrfApp)
        .post('/api/v1/auth/logout')
        .set('X-Auth-Transport', 'cookie')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`)
        .send({});

      expect(crossSiteRes.status).toBe(403);
      expect(crossSiteRes.body.error.code).toBe('CSRF_VALIDATION_FAILED');
    });
  });

  // =========================================================================
  // 17. OTP LOCKOUT RELIABILITY: EXPIRY, RESET, CONCURRENCY, NORMALIZATION
  // =========================================================================
  describe('17. OTP Lockout Reliability (Expiry, Reset, Concurrency, Normalization)', () => {
    it('recovers cleanly after 15-minute lockout expires and allows fresh OTP request & verification', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}94001`;
      await PhoneOtpModel.deleteMany({ phone });
      await OtpLockoutModel.deleteMany({ phone });

      // Trigger 5 failures across 2 challenges
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      for (let i = 0; i < 3; i++) {
        await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow();
      }
      await PhoneOtpModel.updateMany({ phone }, { $set: { cooldownUntil: new Date(Date.now() - 5000) } });
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow();
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow(/Account temporarily locked/);

      // Fast-forward lockout expiry & cooldown past 15 minutes
      const expiredTime = new Date(Date.now() - 16 * 60 * 1000);
      await OtpLockoutModel.updateOne(
        { phone, userType: UserType.CUSTOMER },
        { $set: { lockedUntil: new Date(Date.now() - 1000), lastFailedAt: expiredTime } },
      );
      await PhoneOtpModel.updateMany({ phone }, { $set: { cooldownUntil: new Date(Date.now() - 5000) } });

      // Recovery: requestOtp clears expired lockout and dispatches fresh OTP
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const validOtp = MockOtpProvider.getLatestCapturedOtp(phone);
      expect(validOtp).toBeDefined();

      const verified = await otpService.verifyOtp(phone, validOtp!, UserType.CUSTOMER);
      expect(verified.user.phone).toBe(phone);
      expect(await OtpLockoutModel.findOne({ phone, userType: UserType.CUSTOMER })).toBeNull();
    });

    it('resets cumulative failure count upon successful OTP verification', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}94002`;
      await PhoneOtpModel.deleteMany({ phone });
      await OtpLockoutModel.deleteMany({ phone });

      // 3 failures on Challenge 1
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      for (let i = 0; i < 3; i++) {
        await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow();
      }

      await PhoneOtpModel.updateMany({ phone }, { $set: { cooldownUntil: new Date(Date.now() - 5000) } });

      // 1 failure on Challenge 2 (4 cumulative), then succeed with valid OTP
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow();
      const validOtp = MockOtpProvider.getLatestCapturedOtp(phone);
      await otpService.verifyOtp(phone, validOtp!, UserType.CUSTOMER);

      // Lockout record must be deleted
      expect(await OtpLockoutModel.findOne({ phone, userType: UserType.CUSTOMER })).toBeNull();

      // Next challenge failure starts from 1, not 5
      await PhoneOtpModel.updateMany({ phone }, { $set: { cooldownUntil: new Date(Date.now() - 5000) } });
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
      const doc = await OtpLockoutModel.findOne({ phone, userType: UserType.CUSTOMER });
      expect(doc?.failedAttempts).toBe(1);
      expect(doc?.lockedUntil).toBeNull();
    });

    it('handles concurrent failed verifications without E11000 duplicate-key errors and protects login reset', async () => {
      if (!isDbConnected) return;

      const phone = `${testPhoneBase}94003`;
      await PhoneOtpModel.deleteMany({ phone });
      await OtpLockoutModel.deleteMany({ phone });

      // Concurrent first-time failures (no pre-existing OtpLockoutModel document)
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const concurrentWrong = await Promise.allSettled(
        Array.from({ length: 5 }).map(() => otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)),
      );

      // None should fail with E11000 or non-OtpError server errors
      for (const outcome of concurrentWrong) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(Error);
          expect((outcome.reason as Error).name).toBe('OtpError');
        }
      }

      // Challenge 1 has maxAttempts = 3, so exactly 3 attempts should have been counted
      const lockoutDoc = await OtpLockoutModel.findOne({ phone, userType: UserType.CUSTOMER });
      expect(lockoutDoc?.failedAttempts).toBe(3);

      // Verify concurrent valid + wrong attempt cannot recreate lockout doc after valid login succeeds
      const racePhone = `${testPhoneBase}94004`;
      await PhoneOtpModel.deleteMany({ phone: racePhone });
      await OtpLockoutModel.deleteMany({ phone: racePhone });
      await otpService.requestOtp(racePhone, UserType.CUSTOMER);
      const validOtp = MockOtpProvider.getLatestCapturedOtp(racePhone);

      const raceOutcomes = await Promise.allSettled([
        otpService.verifyOtp(racePhone, validOtp!, UserType.CUSTOMER),
        otpService.verifyOtp(racePhone, '000000', UserType.CUSTOMER),
        otpService.verifyOtp(racePhone, '111111', UserType.CUSTOMER),
      ]);
      const fulfilledCount = raceOutcomes.filter((r) => r.status === 'fulfilled').length;
      expect(fulfilledCount).toBe(1);
      expect(await OtpLockoutModel.findOne({ phone: racePhone, userType: UserType.CUSTOMER })).toBeNull();
    });

    it('prevents lockout bypass across different phone formatting variants (E.164 normalization)', async () => {
      if (!isDbConnected) return;

      const canonicalPhone = '+919777794005';
      const local10 = '9777794005';
      const leadingZero = '09777794005';
      await PhoneOtpModel.deleteMany({ phone: canonicalPhone });
      await OtpLockoutModel.deleteMany({ phone: canonicalPhone });

      // 3 failures using +91 E.164
      await otpService.requestOtp(canonicalPhone, UserType.CUSTOMER);
      for (let i = 0; i < 3; i++) {
        await expect(otpService.verifyOtp(canonicalPhone, '000000', UserType.CUSTOMER)).rejects.toThrow();
      }

      await PhoneOtpModel.updateMany(
        { phone: canonicalPhone },
        { $set: { cooldownUntil: new Date(Date.now() - 5000) } },
      );

      // Request with 10-digit format, fail twice using leading-zero and 10-digit formats -> locks canonical phone
      await otpService.requestOtp(local10, UserType.CUSTOMER);
      await expect(otpService.verifyOtp(leadingZero, '000000', UserType.CUSTOMER)).rejects.toThrow();
      await expect(otpService.verifyOtp(local10, '000000', UserType.CUSTOMER)).rejects.toThrow(
        /Account temporarily locked/,
      );
    });
  });

  // =========================================================================
  // 18. COOKIE MAXAGE DERIVATION & LOGOUT-ALL CLEARANCE (SECOND PASS)
  // =========================================================================
  describe('18. Cookie Configuration & Clearance Attributes', () => {
    it('derives cookie maxAge from configured refreshToken.expiresIn and enforces Secure in production', () => {
      const baseConfig = getConfig();
      const custom14d = {
        ...baseConfig,
        isProduction: true,
        auth: {
          ...baseConfig.auth,
          refreshToken: { expiresIn: '14d' },
        },
      };

      const opts14d = getRefreshCookieOptions(custom14d);
      expect(opts14d.maxAge).toBe(14 * 86400 * 1000);
      expect(opts14d.httpOnly).toBe(true);
      expect(opts14d.secure).toBe(true);
      expect(opts14d.sameSite).toBe('strict');
      expect(opts14d.path).toBe('/api/v1/auth');

      const clearedCalls: Array<{ name: string; options: Record<string, unknown> }> = [];
      const mockRes = {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCalls.push({ name, options });
        },
      } as unknown as express.Response;

      clearRefreshTokenCookie(mockRes, custom14d);
      expect(clearedCalls).toHaveLength(1);
      expect(clearedCalls[0]?.name).toBe(REFRESH_COOKIE_NAME);
      expect(clearedCalls[0]?.options).toEqual({
        path: '/api/v1/auth',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
      });
    });

    it('clears thz_refresh_token cookie on POST /api/v1/auth/logout-all', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);
      const res = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : String(cookies);
      expect(cookieStr).toContain(REFRESH_COOKIE_NAME);
      expect(cookieStr.toLowerCase()).toContain('path=/api/v1/auth');
      expect(
        cookieStr.includes('Max-Age=0') ||
          cookieStr.includes('Expires=Thu, 01 Jan 1970') ||
          cookieStr.includes('expires=Thu, 01 Jan 1970'),
      ).toBe(true);
    });

    it('clears malformed or empty thz_refresh_token cookies with matching attributes on POST /api/v1/auth/refresh 400 error', async () => {
      const cookieApp = createApp();

      const noDotRes = await request(cookieApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=malformed-without-dot`)
        .send({});

      expect(noDotRes.status).toBe(400);
      expect(noDotRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(noDotRes.body.error.message).toBe('Malformed refresh token format');

      const noDotCookies = noDotRes.headers['set-cookie'];
      expect(noDotCookies).toBeDefined();
      const noDotCookieStr = Array.isArray(noDotCookies)
        ? noDotCookies.join('; ')
        : String(noDotCookies);
      expect(noDotCookieStr).toContain(`${REFRESH_COOKIE_NAME}=`);
      expect(noDotCookieStr.toLowerCase()).toContain('path=/api/v1/auth');
      expect(noDotCookieStr.toLowerCase()).toContain('httponly');
      expect(noDotCookieStr.toLowerCase()).toContain('samesite=strict');
      expect(
        noDotCookieStr.includes('Max-Age=0') ||
          noDotCookieStr.includes('Expires=Thu, 01 Jan 1970') ||
          noDotCookieStr.includes('expires=Thu, 01 Jan 1970'),
      ).toBe(true);

      const emptyPartRes = await request(cookieApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=.missingfamily`)
        .send({});

      expect(emptyPartRes.status).toBe(400);
      expect(emptyPartRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(emptyPartRes.headers['set-cookie']).toBeDefined();
      const emptyPartCookieStr = Array.isArray(emptyPartRes.headers['set-cookie'])
        ? emptyPartRes.headers['set-cookie'].join('; ')
        : String(emptyPartRes.headers['set-cookie']);
      expect(emptyPartCookieStr).toContain(`${REFRESH_COOKIE_NAME}=`);
      expect(emptyPartCookieStr.toLowerCase()).toContain('path=/api/v1/auth');

      const emptyValueRes = await request(cookieApp)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=`)
        .send({});

      expect(emptyValueRes.status).toBe(400);
      expect(emptyValueRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(emptyValueRes.headers['set-cookie']).toBeDefined();
      const emptyValCookieStr = Array.isArray(emptyValueRes.headers['set-cookie'])
        ? emptyValueRes.headers['set-cookie'].join('; ')
        : String(emptyValueRes.headers['set-cookie']);
      expect(emptyValCookieStr).toContain(`${REFRESH_COOKIE_NAME}=`);
      expect(emptyValCookieStr.toLowerCase()).toContain('path=/api/v1/auth');
    });

    it('preserves non-browser validation behaviour without emitting cookie clear headers on malformed body refreshToken', async () => {
      if (!isDbConnected) return;

      const apiApp = createApp();

      const invalidBodyRes = await request(apiApp)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'plainstringwithoutdot' });

      expect(invalidBodyRes.status).toBe(400);
      expect(invalidBodyRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(invalidBodyRes.headers['set-cookie']).toBeUndefined();

      const tokens = await tokenService.generateTokenPair(preProvisionedCustomer);
      const validBodyRes = await request(apiApp)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(validBodyRes.status).toBe(200);
      expect(validBodyRes.body.data.tokens.accessToken).toBeDefined();
      expect(validBodyRes.body.data.tokens.refreshToken).toBeDefined();
    });
  });
});
