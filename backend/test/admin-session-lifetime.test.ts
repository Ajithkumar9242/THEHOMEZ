import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UserType, UserStatus } from '@thehomez/shared-types';
import {
  TokenService,
  TokenError,
  ADMIN_SESSION_ABSOLUTE_LIFETIME_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
} from '../src/services/token/token.service.js';
import { AdminSessionModel } from '../src/models/admin-session.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { authenticate } from '../src/middleware/auth.middleware.js';

describe('C-12.2: Admin Absolute Session Lifetime & Idle Timeout', () => {
  let tokenService: TokenService;
  const mockUserId = '507f191e810c19729de860ea';

  const mockStaffUser: any = {
    _id: { toString: () => mockUserId },
    phone: '+919876543210',
    email: 'admin@thehomez.com',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['STAFF_ADMIN'],
  };

  const mockCustomerUser: any = {
    _id: { toString: () => '507f191e810c19729de860eb' },
    phone: '+919999988888',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: ['CUSTOMER_DEFAULT'],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenService = new TokenService();
  });

  // -------------------------------------------------------------------------
  // Absolute Lifetime Tests (1 - 6)
  // -------------------------------------------------------------------------
  describe('Absolute Session Lifetime (24 hours)', () => {
    it('1. A new Admin session receives a 24-hour absolute expiry', async () => {
      const baseTime = new Date('2026-11-23T10:00:00.000Z');
      let createdSession: any = null;

      vi.spyOn(AdminSessionModel, 'create').mockImplementation(async (data: any) => {
        createdSession = data;
        return data as any;
      });
      vi.spyOn(RefreshTokenModel, 'create').mockResolvedValue({} as any);

      const tokens = await tokenService.generateTokenPair(mockStaffUser, undefined, baseTime);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(createdSession).toBeDefined();
      expect(createdSession.createdAt.getTime()).toBe(baseTime.getTime());
      expect(createdSession.absoluteExpiresAt.getTime()).toBe(
        baseTime.getTime() + ADMIN_SESSION_ABSOLUTE_LIFETIME_MS,
      );
      expect(createdSession.lastActivityAt.getTime()).toBe(baseTime.getTime());
      expect(createdSession.isRevoked).toBe(false);
    });

    it('2. Refresh rotation preserves the original absolute expiry', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const rotateTime = new Date('2026-11-23T10:20:00.000Z');
      const familyId = 'session-uuid-family-123';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: (now: Date) => now.getTime() >= absoluteExpiresAt.getTime(),
        isIdleExpired: () => false,
      };

      const mockRefreshTokenDoc: any = {
        _id: 'token-doc-1',
        tokenHash: 'hash-abc',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockRefreshTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(RefreshTokenModel, 'findOneAndUpdate').mockResolvedValue({
        ...mockRefreshTokenDoc,
        isRevoked: true,
      });

      let createdChildToken: any = null;
      vi.spyOn(RefreshTokenModel, 'create').mockImplementation(async (data: any) => {
        createdChildToken = data;
        return data as any;
      });

      const rotated = await tokenService.rotateRefreshToken(
        `${familyId}.secret123`,
        undefined,
        rotateTime,
      );

      expect(rotated.accessToken).toBeDefined();
      expect(rotated.refreshToken.startsWith(familyId)).toBe(true);
      // Absolute expiration was not changed
      expect(mockSession.absoluteExpiresAt.getTime()).toBe(absoluteExpiresAt.getTime());
    });

    it('3. Repeated refresh operations cannot extend the absolute lifetime', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-uuid-family-repeat';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: (now: Date) => now.getTime() >= absoluteExpiresAt.getTime(),
        isIdleExpired: () => false,
      };

      const mockTokenDoc: any = {
        _id: 'token-repeat',
        tokenHash: 'hash-repeat',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(RefreshTokenModel, 'findOneAndUpdate').mockResolvedValue({
        ...mockTokenDoc,
        isRevoked: true,
      });

      let childExpiresAt: Date | null = null;
      vi.spyOn(RefreshTokenModel, 'create').mockImplementation(async (data: any) => {
        childExpiresAt = data.expiresAt;
        return data as any;
      });

      // Rotate at T+23 hours
      const t23h = new Date(loginTime.getTime() + 23 * 60 * 60 * 1000);
      mockSession.lastActivityAt = t23h; // keep active
      await tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, t23h);

      // Child token expiresAt is capped by the absolute session boundary (cannot exceed absoluteExpiresAt)
      expect(childExpiresAt).toBeDefined();
      expect(childExpiresAt!.getTime()).toBeLessThanOrEqual(absoluteExpiresAt.getTime());
    });

    it('4. Refresh just before absolute expiry cannot extend the session', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-uuid-family-edge';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      // 1 minute before 24-hour expiration
      const justBefore = new Date(absoluteExpiresAt.getTime() - 60 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: justBefore,
        isRevoked: false,
        isAbsoluteExpired: (now: Date) => now.getTime() >= absoluteExpiresAt.getTime(),
        isIdleExpired: () => false,
      };

      const mockTokenDoc: any = {
        _id: 'token-edge',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(RefreshTokenModel, 'findOneAndUpdate').mockResolvedValue({
        ...mockTokenDoc,
        isRevoked: true,
      });

      let childExpiresAt: Date | null = null;
      vi.spyOn(RefreshTokenModel, 'create').mockImplementation(async (data: any) => {
        childExpiresAt = data.expiresAt;
        return data as any;
      });

      await tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, justBefore);

      // Even with 7-day default refresh TTL, child token is capped exactly at absoluteExpiresAt (1 min remaining)
      expect(childExpiresAt!.getTime()).toBe(absoluteExpiresAt.getTime());
    });

    it('5. Refresh after absolute expiry is rejected', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-uuid-family-expired';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);
      const afterExpiry = new Date(absoluteExpiresAt.getTime() + 1000); // 1 sec after 24h

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: (now: Date) => now.getTime() >= absoluteExpiresAt.getTime(),
        isIdleExpired: () => false,
      };

      const mockTokenDoc: any = {
        _id: 'token-exp',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({} as any);
      vi.spyOn(RefreshTokenModel, 'updateMany').mockResolvedValue({} as any);

      await expect(
        tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, afterExpiry),
      ).rejects.toThrow(TokenError);

      await expect(
        tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, afterExpiry),
      ).rejects.toMatchObject({
        code: 'ADMIN_SESSION_ABSOLUTE_TIMEOUT',
        statusCode: 401,
      });
    });

    it('6. An access JWT is rejected after absolute expiry even if its JWT exp has not elapsed', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-jwt-abs-test';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      // Sign an access token with sessionId
      const accessToken = tokenService.signAccessToken(mockStaffUser, familyId);

      const afterExpiry = new Date(absoluteExpiresAt.getTime() + 5000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: (now: Date) => now.getTime() >= absoluteExpiresAt.getTime(),
        isIdleExpired: () => false,
      };

      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({} as any);
      vi.spyOn(RefreshTokenModel, 'updateMany').mockResolvedValue({} as any);

      await expect(tokenService.validateAdminSession(familyId, afterExpiry)).rejects.toMatchObject({
        code: 'ADMIN_SESSION_ABSOLUTE_TIMEOUT',
        statusCode: 401,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Idle Timeout Tests (7 - 13)
  // -------------------------------------------------------------------------
  describe('Idle Inactivity Timeout (30 minutes)', () => {
    it('7. Meaningful Admin activity updates the last-activity timestamp', async () => {
      const sessionId = 'session-activity-update';
      const initialActivity = new Date('2026-11-23T10:00:00.000Z');
      const newActivity = new Date('2026-11-23T10:05:00.000Z');

      let updateFilter: any = null;
      let updateSet: any = null;

      vi.spyOn(AdminSessionModel, 'updateOne').mockImplementation(async (filter: any, set: any) => {
        updateFilter = filter;
        updateSet = set;
        return {} as any;
      });

      await tokenService.recordAdminActivity(sessionId, newActivity, false);

      expect(updateFilter._id).toBe(sessionId);
      expect(updateSet.$set.lastActivityAt.getTime()).toBe(newActivity.getTime());
    });

    it('8. Background refresh does not update last activity', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const refreshTime = new Date('2026-11-23T10:14:00.000Z');
      const familyId = 'session-bg-refresh';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime, // Initial activity at login
        isRevoked: false,
        isAbsoluteExpired: () => false,
        isIdleExpired: () => false,
      };

      const mockTokenDoc: any = {
        _id: 'token-bg',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(RefreshTokenModel, 'findOneAndUpdate').mockResolvedValue({
        ...mockTokenDoc,
        isRevoked: true,
      });
      vi.spyOn(RefreshTokenModel, 'create').mockResolvedValue({} as any);

      const sessionUpdateSpy = vi.spyOn(AdminSessionModel, 'updateOne');

      await tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, refreshTime);

      // Session lastActivityAt must NOT be updated during background refresh
      expect(sessionUpdateSpy).not.toHaveBeenCalled();
      expect(mockSession.lastActivityAt.getTime()).toBe(loginTime.getTime());
    });

    it('9. Background polling does not keep a session alive', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-polling';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: () => false,
        isIdleExpired: (now: Date) =>
          now.getTime() - loginTime.getTime() >= ADMIN_SESSION_IDLE_TIMEOUT_MS,
      };

      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(RbacService.prototype, 'resolveUserPrincipal').mockResolvedValue({
        id: mockUserId,
        userType: UserType.STAFF,
        roles: ['STAFF_ADMIN'],
        permissions: [],
      } as any);
      const recordSpy = vi.spyOn(TokenService.prototype, 'recordAdminActivity');

      // Middleware simulation with background request header
      const req: any = {
        headers: {
          authorization: `Bearer ${tokenService.signAccessToken(mockStaffUser, familyId)}`,
          'x-background-request': 'true',
        },
        path: '/api/v1/admin/notifications/poll',
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(TokenService.prototype, 'validateAdminSession').mockResolvedValue(mockSession);

      await authenticate(req, res, next);

      // Activity must NOT be updated by middleware for background request
      expect(next).toHaveBeenCalled();
      expect(recordSpy).not.toHaveBeenCalled();

      // Activity endpoint path is also excluded from middleware auto-tracking to prevent duplicate writes
      const actReq: any = {
        headers: {
          authorization: `Bearer ${tokenService.signAccessToken(mockStaffUser, familyId)}`,
        },
        path: '/api/v1/auth/admin/activity',
      };
      const actNext = vi.fn();
      await authenticate(actReq, res, actNext);
      expect(actNext).toHaveBeenCalled();
      expect(recordSpy).not.toHaveBeenCalled();
    });

    it('10. Refresh after 30 minutes of inactivity is rejected', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-idle-refresh-fail';
      const absoluteExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);
      const idleTime = new Date(loginTime.getTime() + 31 * 60 * 1000); // 31 minutes later without activity

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt,
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: () => false,
        isIdleExpired: (now: Date) =>
          now.getTime() - loginTime.getTime() >= ADMIN_SESSION_IDLE_TIMEOUT_MS,
      };

      const mockTokenDoc: any = {
        _id: 'token-idle',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: false,
        expiresAt: new Date(loginTime.getTime() + 7 * 86400 * 1000),
        isExpired: () => false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);
      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({} as any);
      vi.spyOn(RefreshTokenModel, 'updateMany').mockResolvedValue({} as any);

      await expect(
        tokenService.rotateRefreshToken(`${familyId}.secret`, undefined, idleTime),
      ).rejects.toMatchObject({
        code: 'ADMIN_SESSION_IDLE_TIMEOUT',
        statusCode: 401,
      });
    });

    it('11. Authenticated API requests after 30 minutes of inactivity are rejected', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-idle-api-fail';
      const idleTime = new Date(loginTime.getTime() + 30 * 60 * 1000 + 1000); // 30m 1s

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt: new Date(loginTime.getTime() + 24 * 60 * 60 * 1000),
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: () => false,
        isIdleExpired: (now: Date) =>
          now.getTime() - loginTime.getTime() >= ADMIN_SESSION_IDLE_TIMEOUT_MS,
      };

      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);
      vi.spyOn(AdminSessionModel, 'updateOne').mockResolvedValue({} as any);
      vi.spyOn(RefreshTokenModel, 'updateMany').mockResolvedValue({} as any);

      await expect(tokenService.validateAdminSession(familyId, idleTime)).rejects.toMatchObject({
        code: 'ADMIN_SESSION_IDLE_TIMEOUT',
        statusCode: 401,
      });
    });

    it('12. Activity just before the idle boundary behaves correctly', async () => {
      const loginTime = new Date('2026-11-23T10:00:00.000Z');
      const familyId = 'session-idle-boundary';
      // 29 minutes and 50 seconds (10 seconds before boundary)
      const justBeforeBoundary = new Date(loginTime.getTime() + 29 * 60 * 1000 + 50 * 1000);

      const mockSession: any = {
        _id: familyId,
        userId: mockStaffUser._id,
        createdAt: loginTime,
        absoluteExpiresAt: new Date(loginTime.getTime() + 24 * 60 * 60 * 1000),
        lastActivityAt: loginTime,
        isRevoked: false,
        isAbsoluteExpired: () => false,
        isIdleExpired: (now: Date) =>
          now.getTime() - loginTime.getTime() >= ADMIN_SESSION_IDLE_TIMEOUT_MS,
      };

      vi.spyOn(AdminSessionModel, 'findById').mockResolvedValue(mockSession);

      const validated = await tokenService.validateAdminSession(familyId, justBeforeBoundary);
      expect(validated._id).toBe(familyId);
      expect(validated.isRevoked).toBe(false);
    });

    it('13. Missing or invalid session metadata on STAFF token fails closed', async () => {
      // Create a token without sessionId claim
      const tokenWithoutSession = tokenService.signAccessToken(mockStaffUser);

      const req: any = {
        headers: { authorization: `Bearer ${tokenWithoutSession}` },
      };
      let responseStatus = 0;
      let responseBody: any = null;

      const res: any = {
        status: (code: number) => {
          responseStatus = code;
          return res;
        },
        json: (data: any) => {
          responseBody = data;
          return res;
        },
      };
      const next = vi.fn();

      vi.spyOn(UserModel, 'findById').mockResolvedValue(mockStaffUser);

      await authenticate(req, res, next);

      expect(responseStatus).toBe(401);
      expect(responseBody.error.code).toBe('INVALID_SESSION');
      expect(next).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Regression Tests (14 - 20)
  // -------------------------------------------------------------------------
  describe('Regression Safety Verification', () => {
    it('14. Customer and Partner authentication behavior remains unchanged', async () => {
      // Customer tokens do not create AdminSession records
      const adminSessionCreateSpy = vi.spyOn(AdminSessionModel, 'create');
      vi.spyOn(RefreshTokenModel, 'create').mockResolvedValue({} as any);

      const customerTokens = await tokenService.generateTokenPair(mockCustomerUser);

      expect(customerTokens.accessToken).toBeDefined();
      expect(customerTokens.refreshToken).toBeDefined();
      // Admin session model was never touched for customer
      expect(adminSessionCreateSpy).not.toHaveBeenCalled();

      // Customer JWT does NOT contain sessionId claim
      const decoded = tokenService.verifyAccessToken(customerTokens.accessToken);
      expect(decoded.sessionId).toBeUndefined();
      expect(decoded.userType).toBe(UserType.CUSTOMER);
    });

    it('15. Manual logout revokes both refresh token and Admin session', async () => {
      const familyId = 'logout-session-family';
      const rawRefreshToken = `${familyId}.secret-random`;

      const mockTokenDoc: any = {
        _id: 'token-logout',
        familyId,
        userType: UserType.STAFF,
        isRevoked: false,
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(mockTokenDoc);
      const refreshUpdateSpy = vi
        .spyOn(RefreshTokenModel, 'updateOne')
        .mockResolvedValue({} as any);
      const sessionUpdateSpy = vi
        .spyOn(AdminSessionModel, 'updateOne')
        .mockResolvedValue({} as any);

      await tokenService.revokeRefreshToken(rawRefreshToken);

      expect(refreshUpdateSpy).toHaveBeenCalledWith(
        { _id: 'token-logout', isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'LOGOUT' }),
        }),
      );
      expect(sessionUpdateSpy).toHaveBeenCalledWith(
        { _id: familyId, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'LOGOUT' }),
        }),
      );
    });

    it('16. Logout-all revokes all sessions and tokens for user', async () => {
      const refreshUpdateManySpy = vi
        .spyOn(RefreshTokenModel, 'updateMany')
        .mockResolvedValue({} as any);
      const sessionUpdateManySpy = vi
        .spyOn(AdminSessionModel, 'updateMany')
        .mockResolvedValue({} as any);

      await tokenService.revokeAllUserSessions(mockUserId, 'SECURITY_RESET');

      expect(refreshUpdateManySpy).toHaveBeenCalledWith(
        { userId: mockUserId, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'SECURITY_RESET' }),
        }),
      );
      expect(sessionUpdateManySpy).toHaveBeenCalledWith(
        { userId: mockUserId, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'SECURITY_RESET' }),
        }),
      );
    });

    it('17. Refresh token reuse detection revokes entire family and Admin session', async () => {
      const familyId = 'reuse-session-family';
      const rawRefreshToken = `${familyId}.secret-reused`;

      const revokedTokenDoc: any = {
        _id: 'token-reused',
        familyId,
        userId: mockStaffUser._id,
        userType: UserType.STAFF,
        isRevoked: true, // Already revoked!
        revokedReason: 'ROTATED',
      };

      vi.spyOn(RefreshTokenModel, 'findOne').mockResolvedValue(revokedTokenDoc);
      const refreshUpdateManySpy = vi
        .spyOn(RefreshTokenModel, 'updateMany')
        .mockResolvedValue({} as any);
      const sessionUpdateSpy = vi
        .spyOn(AdminSessionModel, 'updateOne')
        .mockResolvedValue({} as any);

      await expect(tokenService.rotateRefreshToken(rawRefreshToken)).rejects.toMatchObject({
        code: 'TOKEN_REUSE_DETECTED',
        statusCode: 401,
      });

      expect(refreshUpdateManySpy).toHaveBeenCalledWith(
        { familyId, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'REUSE_DETECTED' }),
        }),
      );
      expect(sessionUpdateSpy).toHaveBeenCalledWith(
        { _id: familyId, isRevoked: false },
        expect.objectContaining({
          $set: expect.objectContaining({ isRevoked: true, revokedReason: 'REUSE_DETECTED' }),
        }),
      );
    });
  });
});
