import crypto from 'node:crypto';
import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import type { IAuthTokens } from '@thehomez/shared-types';
import { UserType, UserStatus } from '@thehomez/shared-types';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { AdminSessionModel, type IAdminSessionDocument } from '../../models/admin-session.model.js';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import { PartnerModel } from '../../models/partner.model.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/logger.js';

export const ADMIN_SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const ACTIVITY_UPDATE_THROTTLE_MS = 60 * 1000; // 1 minute

export class TokenError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'TOKEN_ERROR',
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface IAccessTokenPayload extends JwtPayload {
  sub: string;
  userType: UserType;
  roles: string[];
  partnerId?: string;
  customerId?: string;
  sessionId?: string;
}

export interface IMfaTokenPayload extends JwtPayload {
  sub: string;
  userType: UserType;
  purpose: 'mfa_setup' | 'mfa_verify';
  type: 'admin_mfa_challenge';
  jti?: string;
}

/**
 * Parses duration strings like '15m', '7d', '1h', '300s' into seconds.
 */
export function parseDurationToSeconds(durationStr: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(durationStr);
  if (!match) {
    return 900; // fallback 15 mins
  }
  const val = parseInt(match[1]!, 10);
  const unit = match[2];
  switch (unit) {
    case 's':
      return val;
    case 'm':
      return val * 60;
    case 'h':
      return val * 3600;
    case 'd':
      return val * 86400;
    default:
      return 900;
  }
}

/**
 * Computes SHA-256 hash of an opaque token string for safe database persistence.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class TokenService {
  /**
   * Signs a short-lived JWT access token for an authenticated user principal.
   * Keeps claims minimal (sub, userType, roles, partnerId, customerId).
   */
  public signAccessToken(user: IUserDocument, sessionId?: string): string {
    const config = getConfig();

    const payload: IAccessTokenPayload = {
      sub: user._id.toString(),
      userType: user.userType,
      roles: user.roles || [],
      ...(user.partnerId ? { partnerId: user.partnerId.toString() } : {}),
      ...(user.customerId ? { customerId: user.customerId.toString() } : {}),
      ...(sessionId ? { sessionId } : {}),
    };

    const options: SignOptions = {
      expiresIn: config.auth.jwt.accessExpiresIn as unknown as number, // jsonwebtoken accepts ms strings like '15m'
      algorithm: 'HS256',
    };

    return jwt.sign(payload, config.auth.jwt.accessSecret, options);
  }

  /**
   * Verifies and decodes a JWT access token.
   */
  public verifyAccessToken(token: string): IAccessTokenPayload {
    const config = getConfig();
    try {
      const decoded = jwt.verify(token, config.auth.jwt.accessSecret, {
        algorithms: ['HS256'],
      }) as IAccessTokenPayload;

      if (
        !decoded.sub ||
        !decoded.userType ||
        (decoded as Record<string, unknown>).type === 'admin_mfa_challenge'
      ) {
        throw new TokenError('Invalid access token payload claims', 'INVALID_ACCESS_TOKEN', 401);
      }

      return decoded;
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenError('Access token has expired', 'ACCESS_TOKEN_EXPIRED', 401);
      }
      if (err instanceof TokenError) {
        throw err;
      }
      throw new TokenError('Invalid or corrupted access token', 'INVALID_ACCESS_TOKEN', 401);
    }
  }

  /**
   * Signs a short-lived intermediate JWT MFA challenge token.
   * Valid for 10 minutes. Only usable on Admin MFA endpoints.
   */
  public signMfaToken(
    user: IUserDocument,
    purpose: 'mfa_setup' | 'mfa_verify',
    challengeId?: string,
  ): string {
    const config = getConfig();
    const jti = challengeId || crypto.randomUUID();
    const payload: IMfaTokenPayload = {
      sub: user._id.toString(),
      userType: user.userType,
      purpose,
      type: 'admin_mfa_challenge',
      jti,
    };
    return jwt.sign(payload, config.auth.jwt.accessSecret, {
      expiresIn: '10m',
      algorithm: 'HS256',
    });
  }

  /**
   * Verifies and decodes an intermediate JWT MFA challenge token.
   */
  public verifyMfaToken(
    token: string,
    expectedPurpose?: 'mfa_setup' | 'mfa_verify',
  ): IMfaTokenPayload {
    const config = getConfig();
    try {
      const decoded = jwt.verify(token, config.auth.jwt.accessSecret, {
        algorithms: ['HS256'],
      }) as IMfaTokenPayload;

      if (!decoded.sub || decoded.type !== 'admin_mfa_challenge') {
        throw new TokenError('Invalid MFA token payload', 'INVALID_MFA_TOKEN', 401);
      }

      if (expectedPurpose && decoded.purpose !== expectedPurpose) {
        throw new TokenError(
          `MFA token purpose mismatch. Expected ${expectedPurpose}`,
          'INVALID_MFA_TOKEN',
          401,
        );
      }

      return decoded;
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenError(
          'MFA session token has expired. Please sign in again.',
          'MFA_TOKEN_EXPIRED',
          401,
        );
      }
      if (err instanceof TokenError) {
        throw err;
      }
      throw new TokenError('Invalid or corrupted MFA session token', 'INVALID_MFA_TOKEN', 401);
    }
  }

  /**
   * Generates a new Token Pair (JWT Access Token + Opaque Refresh Token) and initiates a rotation family.
   */
  public async generateTokenPair(
    user: IUserDocument,
    context?: { userAgent?: string; ipAddress?: string },
    injectedNow?: Date,
  ): Promise<IAuthTokens> {
    const config = getConfig();
    const now = injectedNow || new Date();

    // 1. Generate new rotation family identifier (serves as sessionId for STAFF)
    const familyId = crypto.randomUUID();

    // 2. Generate opaque refresh token: familyId.32-bytes-base64url
    const randomSecret = crypto.randomBytes(32).toString('base64url');
    const rawRefreshToken = `${familyId}.${randomSecret}`;
    const tokenHash = hashToken(rawRefreshToken);

    const refreshTtlSeconds = parseDurationToSeconds(config.auth.refreshToken.expiresIn);
    let expiresAt = new Date(now.getTime() + refreshTtlSeconds * 1000);

    // 2b. For STAFF (Admin): Establish 24h absolute session lifetime and initial activity
    if (user.userType === UserType.STAFF) {
      const absoluteExpiresAt = new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_LIFETIME_MS);
      if (expiresAt.getTime() > absoluteExpiresAt.getTime()) {
        expiresAt = absoluteExpiresAt;
      }

      await AdminSessionModel.create({
        _id: familyId,
        userId: user._id,
        createdAt: now,
        absoluteExpiresAt,
        lastActivityAt: now,
        isRevoked: false,
        metadata: context,
      });
    }

    // 3. Persist hashed refresh token record
    await RefreshTokenModel.create({
      tokenHash,
      userId: user._id,
      userType: user.userType,
      familyId,
      isRevoked: false,
      expiresAt,
      metadata: context,
    });

    // 4. Sign JWT access token (includes sessionId for STAFF)
    const accessToken = this.signAccessToken(
      user,
      user.userType === UserType.STAFF ? familyId : undefined,
    );
    const accessTtlSeconds = parseDurationToSeconds(config.auth.jwt.accessExpiresIn);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: accessTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  /**
   * Performs Atomic Refresh Token Rotation with automatic Reuse Detection.
   *
   * If a previously rotated or revoked token is reused, the entire token family is immediately
   * revoked to neutralize compromised sessions.
   *
   * For Admin (STAFF) sessions, verifies that:
   * 1. Absolute session lifetime (24 hours) has not been exceeded.
   * 2. Idle inactivity timeout (30 minutes) has not been exceeded.
   * 3. Background refresh requests DO NOT reset the idle timer.
   * 4. Child refresh token expiration cannot exceed the original 24h absolute boundary.
   */
  public async rotateRefreshToken(
    rawRefreshToken: string,
    context?: { userAgent?: string; ipAddress?: string },
    injectedNow?: Date,
  ): Promise<IAuthTokens> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string' || !rawRefreshToken.includes('.')) {
      throw new TokenError('Invalid refresh token format', 'INVALID_REFRESH_TOKEN', 401);
    }

    const tokenHash = hashToken(rawRefreshToken.trim());
    const existingRecord = await RefreshTokenModel.findOne({ tokenHash });

    // Scenario 1: Token not found in database
    if (!existingRecord) {
      throw new TokenError('Refresh token not found or expired', 'REFRESH_TOKEN_NOT_FOUND', 401);
    }

    const now = injectedNow || new Date();

    // Scenario 2: REUSE DETECTION — Token was previously revoked/consumed!
    if (existingRecord.isRevoked) {
      // Invalidate the entire rotation family immediately to prevent unauthorized access
      await RefreshTokenModel.updateMany(
        { familyId: existingRecord.familyId, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedReason: 'REUSE_DETECTED',
            revokedAt: now,
          },
        },
      );

      if (existingRecord.userType === UserType.STAFF) {
        await AdminSessionModel.updateOne(
          { _id: existingRecord.familyId, isRevoked: false },
          {
            $set: {
              isRevoked: true,
              revokedReason: 'REUSE_DETECTED',
              revokedAt: now,
            },
          },
        );
      }

      logger.warn(
        {
          familyId: existingRecord.familyId,
          userId: existingRecord.userId.toString(),
          reason: existingRecord.revokedReason,
        },
        'SECURITY ALERT: Refresh token reuse detected! All tokens in family have been revoked',
      );

      throw new TokenError(
        'Invalid refresh token. Token reuse detected. Session revoked',
        'TOKEN_REUSE_DETECTED',
        401,
      );
    }

    // Scenario 3: Token is expired
    if (existingRecord.isExpired(now)) {
      await RefreshTokenModel.updateOne(
        { _id: existingRecord._id },
        { $set: { isRevoked: true, revokedReason: 'EXPIRED', revokedAt: now } },
      );
      if (existingRecord.userType === UserType.STAFF) {
        await AdminSessionModel.updateOne(
          { _id: existingRecord.familyId, isRevoked: false },
          { $set: { isRevoked: true, revokedReason: 'EXPIRED', revokedAt: now } },
        );
      }
      throw new TokenError('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED', 401);
    }

    // Scenario 4: User account status verification
    const user = await UserModel.findById(existingRecord.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      // Revoke entire family if user is deleted or suspended
      await RefreshTokenModel.updateMany(
        { familyId: existingRecord.familyId },
        { $set: { isRevoked: true, revokedReason: 'ACCOUNT_SUSPENDED', revokedAt: now } },
      );
      if (existingRecord.userType === UserType.STAFF) {
        await AdminSessionModel.updateOne(
          { _id: existingRecord.familyId },
          { $set: { isRevoked: true, revokedReason: 'ACCOUNT_SUSPENDED', revokedAt: now } },
        );
      }
      throw new TokenError(
        'User account is suspended or no longer exists',
        'ACCOUNT_NOT_ACTIVE',
        403,
      );
    }

    // Scenario 4b: Partner organization active status verification
    if (user.userType === UserType.PARTNER) {
      const partner = user.partnerId ? await PartnerModel.findById(user.partnerId) : null;
      if (!partner || partner.status !== 'ACTIVE') {
        await RefreshTokenModel.updateMany(
          { familyId: existingRecord.familyId },
          { $set: { isRevoked: true, revokedReason: 'SECURITY_RESET', revokedAt: now } },
        );
        throw new TokenError(
          partner
            ? `Partner organisation is ${partner.status.toLowerCase()}`
            : 'Partner organisation not found',
          'PARTNER_NOT_ACTIVE',
          403,
        );
      }
    }

    // Scenario 4c: Admin Absolute Lifetime (24h) & Idle Inactivity Timeout (30m) verification
    let adminSession: IAdminSessionDocument | null = null;
    if (user.userType === UserType.STAFF) {
      adminSession = await AdminSessionModel.findById(existingRecord.familyId);
      if (!adminSession) {
        throw new TokenError('Admin session not found', 'INVALID_SESSION', 401);
      }
      if (adminSession.isRevoked) {
        throw new TokenError('Admin session has been revoked', 'SESSION_REVOKED', 401);
      }

      // 1. Check absolute expiration: 24 hours from session creation
      if (adminSession.isAbsoluteExpired(now)) {
        await AdminSessionModel.updateOne(
          { _id: adminSession._id },
          { $set: { isRevoked: true, revokedReason: 'ABSOLUTE_TIMEOUT', revokedAt: now } },
        );
        await RefreshTokenModel.updateMany(
          { familyId: existingRecord.familyId, isRevoked: false },
          { $set: { isRevoked: true, revokedReason: 'ABSOLUTE_TIMEOUT', revokedAt: now } },
        );
        throw new TokenError(
          'Admin session has reached the 24-hour absolute lifetime limit',
          'ADMIN_SESSION_ABSOLUTE_TIMEOUT',
          401,
        );
      }

      // 2. Check idle inactivity timeout: 30 minutes without meaningful user activity
      if (adminSession.isIdleExpired(now, ADMIN_SESSION_IDLE_TIMEOUT_MS)) {
        await AdminSessionModel.updateOne(
          { _id: adminSession._id },
          { $set: { isRevoked: true, revokedReason: 'IDLE_TIMEOUT', revokedAt: now } },
        );
        await RefreshTokenModel.updateMany(
          { familyId: existingRecord.familyId, isRevoked: false },
          { $set: { isRevoked: true, revokedReason: 'IDLE_TIMEOUT', revokedAt: now } },
        );
        throw new TokenError(
          'Admin session has expired due to 30 minutes of inactivity',
          'ADMIN_SESSION_IDLE_TIMEOUT',
          401,
        );
      }

      // CRITICAL POLICY ENFORCEMENT:
      // Background refresh requests MUST NOT reset the idle timer!
      // adminSession.lastActivityAt is intentionally preserved as-is.
    }

    // Scenario 5: ATOMIC ROTATION
    const config = getConfig();
    const newRandom = crypto.randomBytes(32).toString('base64url');
    const newRawRefreshToken = `${existingRecord.familyId}.${newRandom}`;
    const newTokenHash = hashToken(newRawRefreshToken);

    // Atomically invalidate old token
    const updatedOldRecord = await RefreshTokenModel.findOneAndUpdate(
      { _id: existingRecord._id, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: 'ROTATED',
          revokedAt: now,
          replacedByTokenHash: newTokenHash,
        },
      },
      { new: true },
    );

    if (!updatedOldRecord) {
      // Concurrently rotated by a parallel request! Revoke family for safety
      await RefreshTokenModel.updateMany(
        { familyId: existingRecord.familyId },
        { $set: { isRevoked: true, revokedReason: 'REUSE_DETECTED', revokedAt: now } },
      );
      if (existingRecord.userType === UserType.STAFF) {
        await AdminSessionModel.updateOne(
          { _id: existingRecord.familyId },
          {
            $set: {
              isRevoked: true,
              revokedReason: 'CONCURRENT_ROTATION_CONFLICT',
              revokedAt: now,
            },
          },
        );
      }
      throw new TokenError(
        'Concurrent rotation conflict. Session revoked',
        'CONCURRENT_ROTATION_CONFLICT',
        409,
      );
    }

    // Issue child token in the same family
    const refreshTtlSeconds = parseDurationToSeconds(config.auth.refreshToken.expiresIn);
    let expiresAt = new Date(now.getTime() + refreshTtlSeconds * 1000);

    // Capping: child refresh token can NEVER extend past the session's absolute 24h expiration
    if (adminSession && expiresAt.getTime() > adminSession.absoluteExpiresAt.getTime()) {
      expiresAt = adminSession.absoluteExpiresAt;
    }

    await RefreshTokenModel.create({
      tokenHash: newTokenHash,
      userId: user._id,
      userType: user.userType,
      familyId: existingRecord.familyId,
      isRevoked: false,
      expiresAt,
      metadata: context,
    });

    // Issue fresh access token (including sessionId for STAFF)
    const accessToken = this.signAccessToken(
      user,
      user.userType === UserType.STAFF ? existingRecord.familyId : undefined,
    );
    const accessTtlSeconds = parseDurationToSeconds(config.auth.jwt.accessExpiresIn);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: accessTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  /**
   * Validates active status, absolute lifetime, and idle timeout for an Admin session.
   * Throws TokenError if expired, revoked, or invalid.
   */
  public async validateAdminSession(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<IAdminSessionDocument> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new TokenError('Admin session identifier missing', 'INVALID_SESSION', 401);
    }

    const session = await AdminSessionModel.findById(sessionId);
    if (!session) {
      throw new TokenError('Admin session not found', 'INVALID_SESSION', 401);
    }

    if (session.isRevoked) {
      throw new TokenError(
        `Admin session has been revoked (${session.revokedReason || 'REVOKED'})`,
        'SESSION_REVOKED',
        401,
      );
    }

    // Check 24-hour absolute expiration
    if (session.isAbsoluteExpired(now)) {
      await AdminSessionModel.updateOne(
        { _id: session._id, isRevoked: false },
        { $set: { isRevoked: true, revokedReason: 'ABSOLUTE_TIMEOUT', revokedAt: now } },
      );
      await RefreshTokenModel.updateMany(
        { familyId: sessionId, isRevoked: false },
        { $set: { isRevoked: true, revokedReason: 'ABSOLUTE_TIMEOUT', revokedAt: now } },
      );
      throw new TokenError(
        'Admin session has reached the 24-hour absolute lifetime limit',
        'ADMIN_SESSION_ABSOLUTE_TIMEOUT',
        401,
      );
    }

    // Check 30-minute idle inactivity timeout
    if (session.isIdleExpired(now, ADMIN_SESSION_IDLE_TIMEOUT_MS)) {
      await AdminSessionModel.updateOne(
        { _id: session._id, isRevoked: false },
        { $set: { isRevoked: true, revokedReason: 'IDLE_TIMEOUT', revokedAt: now } },
      );
      await RefreshTokenModel.updateMany(
        { familyId: sessionId, isRevoked: false },
        { $set: { isRevoked: true, revokedReason: 'IDLE_TIMEOUT', revokedAt: now } },
      );
      throw new TokenError(
        'Admin session has expired due to 30 minutes of inactivity',
        'ADMIN_SESSION_IDLE_TIMEOUT',
        401,
      );
    }

    return session;
  }

  /**
   * Records meaningful Admin user activity with safe 60-second throttling.
   * Avoids writing to MongoDB on every keystroke or rapid successive requests.
   */
  public async recordAdminActivity(
    sessionId: string,
    now: Date = new Date(),
    force: boolean = false,
  ): Promise<void> {
    if (!sessionId) return;

    if (force) {
      await AdminSessionModel.updateOne(
        { _id: sessionId, isRevoked: false },
        { $set: { lastActivityAt: now } },
      );
      return;
    }

    const throttleThreshold = new Date(now.getTime() - ACTIVITY_UPDATE_THROTTLE_MS);
    await AdminSessionModel.updateOne(
      {
        _id: sessionId,
        isRevoked: false,
        lastActivityAt: { $lt: throttleThreshold },
      },
      {
        $set: { lastActivityAt: now },
      },
    );
  }

  /**
   * Revokes a specific active refresh token upon user logout.
   * For Admin sessions, also marks the parent Admin session record revoked.
   */
  public async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      return;
    }
    const tokenHash = hashToken(rawRefreshToken.trim());
    const existing = await RefreshTokenModel.findOne({ tokenHash });
    if (existing) {
      await RefreshTokenModel.updateOne(
        { _id: existing._id, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedReason: 'LOGOUT',
            revokedAt: new Date(),
          },
        },
      );
      if (existing.userType === UserType.STAFF) {
        await AdminSessionModel.updateOne(
          { _id: existing.familyId, isRevoked: false },
          {
            $set: {
              isRevoked: true,
              revokedReason: 'LOGOUT',
              revokedAt: new Date(),
            },
          },
        );
      }
    }
  }

  /**
   * Revokes all active refresh tokens and sessions for a user across all devices.
   */
  public async revokeAllUserSessions(
    userId: string,
    reason: string = 'SECURITY_RESET',
  ): Promise<void> {
    const now = new Date();
    await RefreshTokenModel.updateMany(
      { userId, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: reason,
          revokedAt: now,
        },
      },
    );
    await AdminSessionModel.updateMany(
      { userId, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: reason,
          revokedAt: now,
        },
      },
    );
  }
}
