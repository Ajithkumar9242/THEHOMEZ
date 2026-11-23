import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserStatus, UserType, PermissionCode } from '@thehomez/shared-types';
import { AuthController } from '../src/controllers/auth.controller.js';
import { UserModel } from '../src/models/user.model.js';
import { hashPassword } from '../src/services/auth/password.service.js';
import { TokenService } from '../src/services/token/token.service.js';
import { TotpService } from '../src/services/auth/totp.service.js';
import type { RbacService } from '../src/services/rbac/rbac.service.js';

const password = 'valid-admin-secure-password-123';
const passwordHash = await hashPassword(password);

function makeMockStaffUser(mfaEnabled = false, mfaSecret?: string, backupCodes?: any[]) {
  const saveMock = vi.fn().mockResolvedValue(true);
  const challengeId = 'test-challenge-uuid-1234';
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
    mfaBackupCodes: backupCodes || [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: undefined,
    save: saveMock,
  };
}

function createTestHarness(user: any) {
  const tokenService = new TokenService();
  const origSignMfa = tokenService.signMfaToken.bind(tokenService);
  vi.spyOn(tokenService, 'signMfaToken').mockImplementation((u: any, p: any, c?: string) => {
    const challengeId = c || user.mfaCurrentChallengeId || 'test-challenge-uuid-1234';
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

  vi.spyOn(UserModel, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
    return {
      select: vi.fn().mockImplementation(() => {
        if (filter.mfaCurrentChallengeId && filter.mfaCurrentChallengeId !== user.mfaCurrentChallengeId) {
          return Promise.resolve(null);
        }
        if (filter.mfaBackupCodes?.$elemMatch) {
          const { codeHash } = filter.mfaBackupCodes.$elemMatch;
          const matched = user.mfaBackupCodes?.find((b: any) => b.codeHash === codeHash);
          if (!matched || matched.usedAt) {
            return Promise.resolve(null);
          }
          matched.usedAt = new Date();
        }
        if (typeof user.mfaLastTotpCounter === 'number' && update.$set?.mfaLastTotpCounter <= user.mfaLastTotpCounter) {
          return Promise.resolve(null);
        }
        if (update.$set) Object.assign(user, update.$set);
        if (update.$unset) {
          for (const k of Object.keys(update.$unset)) delete user[k];
        }
        return Promise.resolve(user);
      }),
    } as any;
  });

  vi.spyOn(UserModel, 'findByIdAndUpdate').mockImplementation((id: any, update: any) => {
    if (update.$inc?.mfaFailedAttempts) {
      user.mfaFailedAttempts = (user.mfaFailedAttempts || 0) + update.$inc.mfaFailedAttempts;
    }
    if (update.$set) Object.assign(user, update.$set);
    return Promise.resolve(user) as any;
  });

  const controller = new AuthController(undefined, tokenService, rbacService, totpService);

  return { controller, tokenService, totpService, rbacService, user };
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Admin Authentication & MFA (C-12.1)', () => {
  describe('adminLogin (Email/Password & Challenge Generation)', () => {
    it('returns 401 generic error when password does not match', async () => {
      const user = makeMockStaffUser();
      vi.spyOn(UserModel, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller } = createTestHarness(user);
      const m = mockResponse();

      await controller.adminLogin(
        {
          body: { email: 'admin@gmail.com', password: 'wrong-password-1234' },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.success).toBe(false);
      expect(m.payload.error.code).toBe('INVALID_CREDENTIALS');
      expect(m.payload.error.message).toBe('Invalid email or password.');
    });

    it('returns 401 generic error when staff account does not exist', async () => {
      vi.spyOn(UserModel, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(null),
      } as any);

      const { controller } = createTestHarness(null);
      const m = mockResponse();

      await controller.adminLogin(
        {
          body: { email: 'unknown@thehomez.com', password },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 generic error when staff account is suspended', async () => {
      const suspendedUser = makeMockStaffUser();
      suspendedUser.status = UserStatus.SUSPENDED;
      vi.spyOn(UserModel, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(suspendedUser),
      } as any);

      const { controller } = createTestHarness(suspendedUser);
      const m = mockResponse();

      await controller.adminLogin(
        {
          body: { email: 'admin@gmail.com', password },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('issues an mfa_setup challenge token for unenrolled Admin', async () => {
      const user = makeMockStaffUser(false);
      vi.spyOn(UserModel, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const m = mockResponse();

      await controller.adminLogin(
        {
          body: { email: 'admin@gmail.com', password },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.mfaRequired).toBe(true);
      expect(m.payload.data.mfaEnrolled).toBe(false);
      expect(m.payload.data.mfaToken).toBeDefined();

      const decoded = tokenService.verifyMfaToken(m.payload.data.mfaToken);
      expect(decoded.purpose).toBe('mfa_setup');
      expect(decoded.sub).toBe('507f191e810c19729de860ea');
    });

    it('issues an mfa_verify challenge token for enrolled Admin', async () => {
      const user = makeMockStaffUser(true, 'JBSWY3DPEHPK3PXP');
      vi.spyOn(UserModel, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const m = mockResponse();

      await controller.adminLogin(
        {
          body: { email: 'admin@gmail.com', password },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.mfaRequired).toBe(true);
      expect(m.payload.data.mfaEnrolled).toBe(true);

      const decoded = tokenService.verifyMfaToken(m.payload.data.mfaToken);
      expect(decoded.purpose).toBe('mfa_verify');
    });
  });

  describe('adminMfaSetup & adminMfaVerifySetup', () => {
    it('initiates MFA setup: generates Base32 secret, otpauth URI, and 10 backup codes', async () => {
      const user = makeMockStaffUser(false);
      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_setup');

      const m = mockResponse();

      await controller.adminMfaSetup(
        {
          body: { mfaToken },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.secret).toBeDefined();
      expect(m.payload.data.otpauthUri).toContain('otpauth://totp/');
      expect(m.payload.data.backupCodes).toHaveLength(10);
      expect(user.mfaPendingSecret).toBe(m.payload.data.secret);
      expect(user.mfaBackupCodes).toHaveLength(10);
      expect(user.save).toHaveBeenCalled();
    });

    it('rejects setup verification when TOTP code is incorrect', async () => {
      const user = makeMockStaffUser(false);
      user.mfaPendingSecret = 'JBSWY3DPEHPK3PXP';
      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_setup');

      const m = mockResponse();

      await controller.adminMfaVerifySetup(
        {
          body: { mfaToken, code: '000000' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.error.code).toBe('INVALID_TOTP_CODE');
      expect(user.mfaEnabled).toBe(false);
    });

    it('activates MFA and issues session tokens on valid setup verification', async () => {
      const user = makeMockStaffUser(false);
      const { controller, tokenService, totpService } = createTestHarness(user);

      const secret = totpService.generateSecret();
      user.mfaPendingSecret = secret;

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_setup');
      const validCode = totpService.generateTotp(secret);

      const m = mockResponse();

      await controller.adminMfaVerifySetup(
        {
          body: { mfaToken, code: validCode },
          headers: { 'x-auth-transport': 'cookie', 'x-client-type': 'browser' },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(user.mfaEnabled).toBe(true);
      expect(user.mfaSecret).toBe(secret);
      expect(user.mfaPendingSecret).toBeUndefined();
      expect(user.lastLoginAt).toBeDefined();

      // Session tokens issued
      expect(m.payload.data.tokens.accessToken).toBeDefined();
      expect(m.payload.data.user.roles).toContain('STAFF_ADMIN');
      expect(m.cookies['thz_refresh_token']).toBeDefined();
    });
  });

  describe('adminMfaVerify (Returning Admin TOTP Login)', () => {
    it('verifies TOTP code and logs in active staff', async () => {
      const totpService = new TotpService();
      const secret = totpService.generateSecret();
      const user = makeMockStaffUser(true, secret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const validCode = totpService.generateTotp(secret);

      const m = mockResponse();

      await controller.adminMfaVerify(
        {
          body: { mfaToken, code: validCode },
          headers: { 'x-auth-transport': 'cookie', 'x-client-type': 'browser' },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.tokens.accessToken).toBeDefined();
      expect(m.cookies['thz_refresh_token']).toBeDefined();
    });

    it('rejects invalid TOTP code for returning admin', async () => {
      const totpService = new TotpService();
      const secret = totpService.generateSecret();
      const user = makeMockStaffUser(true, secret);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');

      const m = mockResponse();

      await controller.adminMfaVerify(
        {
          body: { mfaToken, code: '111111' },
          headers: {},
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.error.code).toBe('INVALID_TOTP_CODE');
    });
  });

  describe('adminMfaVerifyBackup (Backup Code Recovery Flow)', () => {
    it('allows login via unused backup code and marks it used', async () => {
      const totpService = new TotpService();
      const { plainCodes, hashedRecords } = totpService.generateBackupCodes(10);
      const user = makeMockStaffUser(true, 'JBSWY3DPEHPK3PXP', hashedRecords);

      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller, tokenService } = createTestHarness(user);
      const mfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');

      const codeToUse = plainCodes[2]!;
      const m = mockResponse();

      await controller.adminMfaVerifyBackup(
        {
          body: { mfaToken, backupCode: codeToUse },
          headers: {},
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as Request,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.tokens.accessToken).toBeDefined();
      expect(user.mfaBackupCodes[2].usedAt).toBeDefined();

      // 1. Attempting to reuse the same challenge token fails (SEC-REV-14)
      const reusedTokenAttempt = mockResponse();
      await controller.adminMfaVerifyBackup(
        {
          body: { mfaToken, backupCode: codeToUse },
          headers: {},
        } as Request,
        reusedTokenAttempt.res,
        vi.fn(),
      );
      expect(reusedTokenAttempt.statusCode).toBe(401);
      expect(reusedTokenAttempt.payload.error.code).toBe('INVALID_MFA_TOKEN');

      // 2. Attempting to use the already consumed backup code with a fresh challenge token fails (SEC-REV-11)
      const freshMfaToken = tokenService.signMfaToken(user as any, 'mfa_verify');
      const secondAttempt = mockResponse();
      await controller.adminMfaVerifyBackup(
        {
          body: { mfaToken: freshMfaToken, backupCode: codeToUse },
          headers: {},
        } as Request,
        secondAttempt.res,
        vi.fn(),
      );

      expect(secondAttempt.statusCode).toBe(401);
      expect(secondAttempt.payload.error.code).toBe('INVALID_BACKUP_CODE');
    });
  });

  describe('adminRegenerateBackupCodes', () => {
    it('regenerates 10 new backup codes when staff confirms current password', async () => {
      const user = makeMockStaffUser(true);
      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller } = createTestHarness(user);
      const m = mockResponse();

      await controller.adminRegenerateBackupCodes(
        {
          user: { id: '507f191e810c19729de860ea', userType: UserType.STAFF },
          body: { password },
        } as any,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(200);
      expect(m.payload.success).toBe(true);
      expect(m.payload.data.backupCodes).toHaveLength(10);
      expect(user.mfaBackupCodes).toHaveLength(10);
      expect(user.save).toHaveBeenCalled();
    });

    it('rejects backup code regeneration if password confirmation fails', async () => {
      const user = makeMockStaffUser(true);
      vi.spyOn(UserModel, 'findById').mockReturnValue({
        select: vi.fn().mockResolvedValue(user),
      } as any);

      const { controller } = createTestHarness(user);
      const m = mockResponse();

      await controller.adminRegenerateBackupCodes(
        {
          user: { id: '507f191e810c19729de860ea', userType: UserType.STAFF },
          body: { password: 'wrong-password' },
        } as any,
        m.res,
        vi.fn(),
      );

      expect(m.statusCode).toBe(401);
      expect(m.payload.error.code).toBe('INVALID_CREDENTIALS');
    });
  });
});
