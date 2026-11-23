import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserStatus, UserType, PermissionCode } from '@thehomez/shared-types';
import { AuthController } from '../src/controllers/auth.controller.js';
import { UserModel } from '../src/models/user.model.js';
import { OtpService, OtpError } from '../src/services/otp/otp.service.js';
import { TokenService } from '../src/services/token/token.service.js';
import { TotpService } from '../src/services/auth/totp.service.js';
import type { RbacService } from '../src/services/rbac/rbac.service.js';
import { hashPassword } from '../src/services/auth/password.service.js';

const password = 'valid-admin-secure-password-123';
const passwordHash = await hashPassword(password);

function makeMockStaffUser(mfaEnabled = true, mfaSecret = 'JBSWY3DPEHPK3PXP') {
  const saveMock = vi.fn().mockResolvedValue(true);
  const challengeId = 'test-challenge-uuid-remediation';
  const totpService = new TotpService();
  const { hashedRecords } = totpService.generateBackupCodes(10);

  return {
    _id: { toString: () => '507f191e810c19729de860ea' },
    phone: '+919876543210',
    email: 'admin@gmail.com',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['STAFF_ADMIN'],
    passwordHash,
    mfaEnabled,
    mfaSecret,
    mfaPendingSecret: undefined,
    mfaPendingCreatedAt: new Date(),
    mfaCurrentChallengeId: challengeId,
    mfaLastTotpCounter: undefined,
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    mfaBackupCodes: hashedRecords,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: undefined,
    save: saveMock,
  };
}

function mockResponse() {
  let statusCode = 200;
  let payload: any = null;
  const cookies: Record<string, any> = {};

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      payload = data;
      return this;
    },
    cookie(name: string, value: any, options: any) {
      cookies[name] = { value, options };
      return this;
    },
  } as unknown as Response;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
    get cookies() {
      return cookies;
    },
  };
}

function createHarness(user: any) {
  const tokenService = new TokenService();
  const origSignMfa = tokenService.signMfaToken.bind(tokenService);
  vi.spyOn(tokenService, 'signMfaToken').mockImplementation((u: any, p: any, c?: string) => {
    const challengeId = c || user.mfaCurrentChallengeId || 'test-challenge-uuid-remediation';
    user.mfaCurrentChallengeId = challengeId;
    return origSignMfa(u, p, challengeId);
  });

  vi.spyOn(tokenService, 'generateTokenPair').mockResolvedValue({
    accessToken: 'test-admin-access-token',
    refreshToken: 'family-123.test-secret-456',
    expiresIn: 900,
    tokenType: 'Bearer',
  });
  const totpService = new TotpService();
  const rbacService = {
    getEffectivePermissions: vi.fn().mockResolvedValue([PermissionCode.CATALOG_READ]),
  } as unknown as RbacService;

  const controller = new AuthController(undefined, tokenService, rbacService, totpService);

  return { controller, tokenService, totpService, rbacService, user };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Admin Authentication Security Remediation (C-12.1)', () => {
  describe('A. SEC-REV-11 — Atomic Backup-Code Consumption & Concurrency', () => {
    it('allows only one request to succeed when two concurrent requests present the same backup code', async () => {
      const user = makeMockStaffUser(true);
      const { controller, tokenService, totpService } = createHarness(user);

      // Generate 10 codes and place plain code
      const { plainCodes, hashedRecords } = totpService.generateBackupCodes(10);
      user.mfaBackupCodes = hashedRecords;
      const targetCode = plainCodes[3]!;
      const targetHash = totpService.hashBackupCode(targetCode);

      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      // Simulate atomic conditional findOneAndUpdate: only the first call matching unused code succeeds
      let consumptionCount = 0;
      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (filter.mfaBackupCodes?.$elemMatch?.codeHash === targetHash) {
              if (consumptionCount === 0) {
                consumptionCount++;
                const rec = user.mfaBackupCodes.find((b: any) => b.codeHash === targetHash);
                if (rec) rec.usedAt = new Date();
                delete user.mfaCurrentChallengeId;
                return Promise.resolve(user);
              }
              // Second concurrent call sees code already used or challenge already consumed
              return Promise.resolve(null);
            }
            return Promise.resolve(null);
          }),
        } as any;
      });

      const res1 = mockResponse();
      const res2 = mockResponse();

      const req1 = controller.adminMfaVerifyBackup(
        { body: { mfaToken, backupCode: targetCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res1.res,
        vi.fn(),
      );

      const req2 = controller.adminMfaVerifyBackup(
        { body: { mfaToken, backupCode: targetCode }, headers: {}, ip: '127.0.0.2' } as Request,
        res2.res,
        vi.fn(),
      );

      await Promise.all([req1, req2]);

      const successCount = [res1, res2].filter((r) => r.statusCode === 200).length;
      const failCount = [res1, res2].filter((r) => r.statusCode === 401).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);
      expect([res1.payload, res2.payload]).toContainEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: expect.stringMatching(/INVALID_BACKUP_CODE|INVALID_MFA_TOKEN/),
          }),
        }),
      );
    });
  });

  describe('B. SEC-REV-04 — Prevent STAFF Phone-OTP Authentication Bypass', () => {
    it('rejects phone-OTP request when userType is STAFF with STAFF_OTP_DISABLED (403)', async () => {
      const otpService = new OtpService();

      await expect(
        otpService.requestOtp('+919876543210', UserType.STAFF),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'STAFF_OTP_DISABLED',
          statusCode: 403,
        }),
      );
    });

    it('rejects phone-OTP verification when userType is STAFF with STAFF_OTP_DISABLED (403)', async () => {
      const otpService = new OtpService();

      await expect(
        otpService.verifyOtp('+919876543210', '123456', UserType.STAFF),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'STAFF_OTP_DISABLED',
          statusCode: 403,
        }),
      );
    });

    it('preserves phone-OTP behavior for CUSTOMER and PARTNER userTypes', async () => {
      const otpService = new OtpService();

      // Does not throw STAFF_OTP_DISABLED for CUSTOMER
      try {
        await otpService.requestOtp('+919876543210', UserType.CUSTOMER);
      } catch (err: any) {
        expect(err.code).not.toBe('STAFF_OTP_DISABLED');
      }

      // Does not throw STAFF_OTP_DISABLED for PARTNER
      try {
        await otpService.requestOtp('+919876543210', UserType.PARTNER);
      } catch (err: any) {
        expect(err.code).not.toBe('STAFF_OTP_DISABLED');
      }
    });
  });

  describe('C. SEC-REV-08 — Prevent TOTP Replay', () => {
    it('accepts valid first TOTP use and persists accepted counter', async () => {
      const user = makeMockStaffUser(true);
      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const validCode = totpService.generateTotp(user.mfaSecret);
      const expectedCounter = Math.floor(Date.now() / 1000 / 30);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (update.$set) Object.assign(user, update.$set);
            return Promise.resolve(user);
          }),
        } as any;
      });

      const res = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(200);
      expect(res.payload.success).toBe(true);
      expect(user.mfaLastTotpCounter).toBe(expectedCounter);
    });

    it('rejects replay of the same TOTP counter within the valid time window', async () => {
      const user = makeMockStaffUser(true);
      const expectedCounter = Math.floor(Date.now() / 1000 / 30);
      user.mfaLastTotpCounter = expectedCounter; // Counter already consumed

      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const replayedCode = totpService.generateTotp(user.mfaSecret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const res = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: replayedCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(401);
      expect(res.payload.error.code).toBe('INVALID_TOTP_CODE');
      expect(user.mfaLastTotpCounter).toBe(expectedCounter); // Not advanced
    });

    it('accepts a strictly later valid counter', async () => {
      const user = makeMockStaffUser(true);
      const previousCounter = Math.floor(Date.now() / 1000 / 30) - 1;
      user.mfaLastTotpCounter = previousCounter;

      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const currentCode = totpService.generateTotp(user.mfaSecret);
      const currentCounter = Math.floor(Date.now() / 1000 / 30);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (update.$set) Object.assign(user, update.$set);
            return Promise.resolve(user);
          }),
        } as any;
      });

      const res = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: currentCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(200);
      expect(user.mfaLastTotpCounter).toBe(currentCounter);
    });

    it('prevents concurrent requests from both accepting the same TOTP counter', async () => {
      const user = makeMockStaffUser(true);
      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const validCode = totpService.generateTotp(user.mfaSecret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      let acceptedCount = 0;
      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (acceptedCount === 0) {
              acceptedCount++;
              if (update.$set) Object.assign(user, update.$set);
              delete user.mfaCurrentChallengeId;
              return Promise.resolve(user);
            }
            return Promise.resolve(null);
          }),
        } as any;
      });

      const res1 = mockResponse();
      const res2 = mockResponse();

      await Promise.all([
        controller.adminMfaVerify(
          { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
          res1.res,
          vi.fn(),
        ),
        controller.adminMfaVerify(
          { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.2' } as Request,
          res2.res,
          vi.fn(),
        ),
      ]);

      const successCount = [res1, res2].filter((r) => r.statusCode === 200).length;
      const failCount = [res1, res2].filter((r) => r.statusCode === 401).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);
    });

    it('does not advance stored counter on failed verification', async () => {
      const user = makeMockStaffUser(true);
      user.mfaLastTotpCounter = 100;
      const { controller, tokenService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const res = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: '000000' }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(401);
      expect(user.mfaLastTotpCounter).toBe(100);
    });
  });

  describe('D. SEC-REV-09 — Pending Enrollment Expiry & Already-Enrolled Guard', () => {
    it('rejects enrollment setup if MFA is already enrolled (400 MFA_ALREADY_ENROLLED)', async () => {
      const user = makeMockStaffUser(true); // mfaEnabled: true
      const { controller, tokenService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_setup');

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const res = mockResponse();
      await controller.adminMfaSetup(
        { body: { mfaToken }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.payload.error.code).toBe('MFA_ALREADY_ENROLLED');
    });

    it('rejects setup verification if pending enrollment has expired (>15 minutes)', async () => {
      const user = makeMockStaffUser(false);
      user.mfaPendingSecret = 'JBSWY3DPEHPK3PXP';
      // Created 16 minutes ago
      user.mfaPendingCreatedAt = new Date(Date.now() - 16 * 60 * 1000);

      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_setup');
      const validCode = totpService.generateTotp(user.mfaPendingSecret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const res = mockResponse();
      await controller.adminMfaVerifySetup(
        { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.payload.error.code).toBe('MFA_SETUP_EXPIRED');
      expect(user.mfaPendingSecret).toBeUndefined(); // Cleared safely
      expect(user.save).toHaveBeenCalled();
    });
  });

  describe('E. SEC-REV-14 — Challenge-Token Reuse Prevention', () => {
    it('prevents reusing an MFA challenge token once it has successfully issued a session', async () => {
      const user = makeMockStaffUser(true);
      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const validCode = totpService.generateTotp(user.mfaSecret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (filter.mfaCurrentChallengeId && filter.mfaCurrentChallengeId !== user.mfaCurrentChallengeId) {
              return Promise.resolve(null);
            }
            if (update.$unset?.mfaCurrentChallengeId) {
              delete user.mfaCurrentChallengeId;
            }
            if (update.$set) Object.assign(user, update.$set);
            return Promise.resolve(user);
          }),
        } as any;
      });

      // 1. First verification succeeds
      const res1 = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res1.res,
        vi.fn(),
      );
      expect(res1.statusCode).toBe(200);

      // 2. Second verification using same challenge token immediately fails
      const res2 = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res2.res,
        vi.fn(),
      );
      expect(res2.statusCode).toBe(401);
      expect(res2.payload.error.code).toBe('INVALID_MFA_TOKEN');
    });
  });

  describe('F. SEC-REV-16 — Account-Level MFA Lockout', () => {
    it('locks out the Admin account after 5 consecutive failed MFA attempts', async () => {
      const user = makeMockStaffUser(true);
      const { controller, tokenService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      vi.spyOn(UserModel, 'findByIdAndUpdate').mockImplementation((id: any, update: any) => {
        if (update.$inc?.mfaFailedAttempts) {
          user.mfaFailedAttempts = (user.mfaFailedAttempts || 0) + update.$inc.mfaFailedAttempts;
          if (user.mfaFailedAttempts >= 5) {
            user.mfaLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
          }
        }
        return Promise.resolve(user) as any;
      });

      // Execute 4 failed attempts from IP 1
      for (let i = 0; i < 4; i++) {
        const res = mockResponse();
        await controller.adminMfaVerify(
          { body: { mfaToken, code: '000000' }, headers: {}, ip: '1.2.3.4' } as Request,
          res.res,
          vi.fn(),
        );
        expect(res.statusCode).toBe(401);
      }

      // 5th failed attempt from different IP 2
      const res5 = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: '000000' }, headers: {}, ip: '5.6.7.8' } as Request,
        res5.res,
        vi.fn(),
      );
      expect(res5.statusCode).toBe(401);
      expect(user.mfaLockedUntil).toBeDefined();

      // 6th attempt is now locked out across all IPs (HTTP 429)
      const res6 = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: '000000' }, headers: {}, ip: '9.10.11.12' } as Request,
        res6.res,
        vi.fn(),
      );
      expect(res6.statusCode).toBe(429);
      expect(res6.payload.error.code).toBe('MFA_ACCOUNT_LOCKED');
    });

    it('clears lockout and allows authentication once lockout duration has elapsed', async () => {
      const user = makeMockStaffUser(true);
      // Lockout expired 1 second ago
      user.mfaLockedUntil = new Date(Date.now() - 1000);
      user.mfaFailedAttempts = 5;

      const { controller, tokenService, totpService } = createHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const validCode = totpService.generateTotp(user.mfaSecret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
        return {
          select: vi.fn().mockImplementation(() => {
            if (update.$set) Object.assign(user, update.$set);
            return Promise.resolve(user);
          }),
        } as any;
      });

      const res = mockResponse();
      await controller.adminMfaVerify(
        { body: { mfaToken, code: validCode }, headers: {}, ip: '127.0.0.1' } as Request,
        res.res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(200);
      expect(res.payload.success).toBe(true);
      expect(user.mfaLockedUntil).toBeNull();
      expect(user.mfaFailedAttempts).toBe(0);
    });
  });
});
