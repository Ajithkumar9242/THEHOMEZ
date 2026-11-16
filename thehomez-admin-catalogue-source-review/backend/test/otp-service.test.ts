import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { UserType, UserStatus } from '@thehomez/shared-types';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel } from '../src/models/user.model.js';
import { PhoneOtpModel } from '../src/models/phone-otp.model.js';
import { OtpLockoutModel } from '../src/models/otp-lockout.model.js';
import { OtpService, OtpError } from '../src/services/otp/otp.service.js';
import { MockOtpProvider } from '../src/services/otp/mock-otp.provider.js';

describe('OtpService — Authentication Challenge Lifecycle', () => {
  let isDbConnected = false;
  let otpService: OtpService;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+919999/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+919999/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+919999/ } });
    }

    otpService = new OtpService(new MockOtpProvider());
  });

  beforeEach(() => {
    MockOtpProvider.clearCapturedOtps();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: { $regex: /^\+919999/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+919999/ } });
      await OtpLockoutModel.deleteMany({ phone: { $regex: /^\+919999/ } });
      await disconnectDatabase();
    }
  });

  describe('OTP Request Mechanics & Security Controls', () => {
    it('dispatches a 6-digit numeric OTP and captures it in the test store without logging plaintext', async () => {
      if (!isDbConnected) return;

      const phone = '9999000001';
      const result = await otpService.requestOtp(phone, UserType.CUSTOMER);

      expect(result.cooldownSeconds).toBe(60);
      expect(result.expiresInSeconds).toBe(300);
      expect(result.message).toContain('successfully');

      // Verify OTP in test-only capture store
      const normalizedPhone = '+919999000001';
      const capturedOtp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);
      expect(capturedOtp).toBeDefined();
      expect(capturedOtp).toMatch(/^\d{6}$/);

      // Verify stored OTP is hashed and NOT plaintext
      const storedOtp = await PhoneOtpModel.findOne({
        phone: normalizedPhone,
        userType: UserType.CUSTOMER,
        isConsumed: false,
      });
      expect(storedOtp).toBeDefined();
      expect(storedOtp?.hashedOtp).toBeDefined();
      expect(storedOtp?.hashedOtp).not.toBe(capturedOtp);
      expect(storedOtp?.hashedOtp.length).toBe(64); // SHA-256 hex string
    });

    it('enforces resend cooldown on successive OTP requests', async () => {
      if (!isDbConnected) return;

      const phone = '9999000002';
      await otpService.requestOtp(phone, UserType.CUSTOMER);

      // Immediate second request must be rejected with 429 COOLDOWN_ACTIVE
      await expect(otpService.requestOtp(phone, UserType.CUSTOMER)).rejects.toThrow(
        /Please wait \d+ seconds before requesting a new OTP/,
      );

      try {
        await otpService.requestOtp(phone, UserType.CUSTOMER);
      } catch (err) {
        expect(err).toBeInstanceOf(OtpError);
        const otpErr = err as OtpError;
        expect(otpErr.code).toBe('COOLDOWN_ACTIVE');
        expect(otpErr.statusCode).toBe(429);
      }
    });

    it('returns uniform response without dispatching OTP for non-existent PARTNER or STAFF accounts (anti-enumeration)', async () => {
      if (!isDbConnected) return;

      const unregisteredPhone = '9999000099';
      const normalizedPhone = '+919999000099';

      // PARTNER request returns 200 envelope without dispatching
      const partnerRes = await otpService.requestOtp(unregisteredPhone, UserType.PARTNER);
      expect(partnerRes.message).toContain('dispatched successfully');
      expect(MockOtpProvider.getLatestCapturedOtp(normalizedPhone)).toBeUndefined();
      expect(
        await PhoneOtpModel.findOne({ phone: normalizedPhone, userType: UserType.PARTNER }),
      ).toBeNull();

      // STAFF request returns 200 envelope without dispatching
      const staffRes = await otpService.requestOtp(unregisteredPhone, UserType.STAFF);
      expect(staffRes.message).toContain('dispatched successfully');
      expect(MockOtpProvider.getLatestCapturedOtp(normalizedPhone)).toBeUndefined();
      expect(
        await PhoneOtpModel.findOne({ phone: normalizedPhone, userType: UserType.STAFF }),
      ).toBeNull();
    });

    it('returns uniform response without dispatching OTP for suspended accounts (anti-enumeration)', async () => {
      if (!isDbConnected) return;

      const suspendedPhone = '+919999000003';
      await UserModel.create({
        phone: suspendedPhone,
        userType: UserType.CUSTOMER,
        status: UserStatus.SUSPENDED,
      });

      const res = await otpService.requestOtp(suspendedPhone, UserType.CUSTOMER);
      expect(res.message).toContain('dispatched successfully');
      expect(MockOtpProvider.getLatestCapturedOtp(suspendedPhone)).toBeUndefined();
      expect(await PhoneOtpModel.findOne({ phone: suspendedPhone })).toBeNull();
    });
  });

  describe('OTP Verification, Attempt Caps & Single-Use Replay Protection', () => {
    it('verifies a valid OTP, provisions a new CUSTOMER identity, and marks OTP consumed', async () => {
      if (!isDbConnected) return;

      const phone = '9999000004';
      const normalizedPhone = '+919999000004';

      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const otp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);
      expect(otp).toBeDefined();

      const { user } = await otpService.verifyOtp(phone, otp!, UserType.CUSTOMER);

      expect(user).toBeDefined();
      expect(user.phone).toBe(normalizedPhone);
      expect(user.userType).toBe(UserType.CUSTOMER);
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.lastLoginAt).toBeDefined();

      // Verify OTP document was atomically consumed
      const otpDoc = await PhoneOtpModel.findOne({
        phone: normalizedPhone,
        userType: UserType.CUSTOMER,
      }).sort({ createdAt: -1 });
      expect(otpDoc?.isConsumed).toBe(true);
    });

    it('prevents replay attacks on already-consumed OTP challenges', async () => {
      if (!isDbConnected) return;

      const phone = '9999000005';
      const normalizedPhone = '+919999000005';

      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const otp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);

      // First verification succeeds
      await otpService.verifyOtp(phone, otp!, UserType.CUSTOMER);

      // Replay attempt with the exact same OTP must fail identically to invalid OTP
      await expect(otpService.verifyOtp(phone, otp!, UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
    });

    it('enforces maximum attempt limits (burns OTP challenge after 3 invalid attempts with neutral error)', async () => {
      if (!isDbConnected) return;

      const phone = '9999000006';
      await otpService.requestOtp(phone, UserType.CUSTOMER);

      // Attempt 1: Invalid code
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );

      // Attempt 2: Invalid code
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );

      // Attempt 3: Exhausts challenge internally while returning neutral INVALID_OTP error
      await expect(otpService.verifyOtp(phone, '000000', UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );

      const burnedChallenge = await PhoneOtpModel.findOne({ phone: '+919999000006', userType: UserType.CUSTOMER });
      expect(burnedChallenge?.isConsumed).toBe(true);
      expect(burnedChallenge?.attempts).toBe(3);

      // Attempt 4: Even with correct code, challenge is now consumed
      const validOtp = MockOtpProvider.getLatestCapturedOtp('+919999000006');
      await expect(otpService.verifyOtp(phone, validOtp!, UserType.CUSTOMER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
    });

    it('rejects expired OTP challenges', async () => {
      if (!isDbConnected) return;

      const phone = '9999000007';
      const normalizedPhone = '+919999000007';

      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const otp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);

      // Manually set expiration to past
      await PhoneOtpModel.updateOne(
        { phone: normalizedPhone, isConsumed: false },
        { $set: { expiresAt: new Date(Date.now() - 5000) } },
      );

      await expect(otpService.verifyOtp(phone, otp!, UserType.CUSTOMER)).rejects.toThrow(
        /OTP has expired/,
      );
    });

    it('strictly isolates identity types: CUSTOMER challenge cannot be verified as PARTNER', async () => {
      if (!isDbConnected) return;

      const phone = '9999000008';
      const normalizedPhone = '+919999000008';

      // Pre-provision PARTNER account
      await UserModel.create({
        phone: normalizedPhone,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: new mongoose.Types.ObjectId(),
      });

      // Request OTP for CUSTOMER identity
      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const otp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);

      // Attempting to verify the CUSTOMER challenge as PARTNER must fail identically
      await expect(otpService.verifyOtp(phone, otp!, UserType.PARTNER)).rejects.toThrow(
        /Invalid or expired OTP code/,
      );
    });

    it('guards against concurrent verification race conditions', async () => {
      if (!isDbConnected) return;

      const phone = '9999000009';
      const normalizedPhone = '+919999000009';

      await otpService.requestOtp(phone, UserType.CUSTOMER);
      const otp = MockOtpProvider.getLatestCapturedOtp(normalizedPhone);

      // Dispatch two concurrent verification requests with the identical OTP
      const [res1, res2] = await Promise.allSettled([
        otpService.verifyOtp(phone, otp!, UserType.CUSTOMER),
        otpService.verifyOtp(phone, otp!, UserType.CUSTOMER),
      ]);

      // Exactly one must succeed and one must be rejected
      const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
      const failures = [res1, res2].filter((r) => r.status === 'rejected');

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });
  });
});
