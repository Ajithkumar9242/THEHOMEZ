import crypto from 'node:crypto';
import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import type { IAuthTokens, UserType } from '@thehomez/shared-types';
import { UserStatus } from '@thehomez/shared-types';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/logger.js';

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
  public signAccessToken(user: IUserDocument): string {
    const config = getConfig();

    const payload: IAccessTokenPayload = {
      sub: user._id.toString(),
      userType: user.userType,
      roles: user.roles || [],
      ...(user.partnerId ? { partnerId: user.partnerId.toString() } : {}),
      ...(user.customerId ? { customerId: user.customerId.toString() } : {}),
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

      if (!decoded.sub || !decoded.userType) {
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
   * Generates a new Token Pair (JWT Access Token + Opaque Refresh Token) and initiates a rotation family.
   */
  public async generateTokenPair(
    user: IUserDocument,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<IAuthTokens> {
    const config = getConfig();

    // 1. Generate new rotation family identifier
    const familyId = crypto.randomUUID();

    // 2. Generate opaque refresh token: familyId.32-bytes-base64url
    const randomSecret = crypto.randomBytes(32).toString('base64url');
    const rawRefreshToken = `${familyId}.${randomSecret}`;
    const tokenHash = hashToken(rawRefreshToken);

    const refreshTtlSeconds = parseDurationToSeconds(config.auth.refreshToken.expiresIn);
    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

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

    // 4. Sign JWT access token
    const accessToken = this.signAccessToken(user);
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
   */
  public async rotateRefreshToken(
    rawRefreshToken: string,
    context?: { userAgent?: string; ipAddress?: string },
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

    // Scenario 2: REUSE DETECTION — Token was previously revoked/consumed!
    if (existingRecord.isRevoked) {
      // Invalidate the entire rotation family immediately to prevent unauthorized access
      await RefreshTokenModel.updateMany(
        { familyId: existingRecord.familyId, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedReason: 'REUSE_DETECTED',
            revokedAt: new Date(),
          },
        },
      );

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
    const now = new Date();
    if (existingRecord.isExpired(now)) {
      await RefreshTokenModel.updateOne(
        { _id: existingRecord._id },
        { $set: { isRevoked: true, revokedReason: 'EXPIRED', revokedAt: now } },
      );
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
      throw new TokenError(
        'User account is suspended or no longer exists',
        'ACCOUNT_NOT_ACTIVE',
        403,
      );
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
      throw new TokenError(
        'Concurrent rotation conflict. Session revoked',
        'CONCURRENT_ROTATION_CONFLICT',
        409,
      );
    }

    // Issue child token in the same family
    const refreshTtlSeconds = parseDurationToSeconds(config.auth.refreshToken.expiresIn);
    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

    await RefreshTokenModel.create({
      tokenHash: newTokenHash,
      userId: user._id,
      userType: user.userType,
      familyId: existingRecord.familyId,
      isRevoked: false,
      expiresAt,
      metadata: context,
    });

    // Issue fresh access token
    const accessToken = this.signAccessToken(user);
    const accessTtlSeconds = parseDurationToSeconds(config.auth.jwt.accessExpiresIn);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: accessTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  /**
   * Revokes a specific active refresh token upon user logout.
   */
  public async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      return;
    }
    const tokenHash = hashToken(rawRefreshToken.trim());
    await RefreshTokenModel.updateOne(
      { tokenHash, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: 'LOGOUT',
          revokedAt: new Date(),
        },
      },
    );
  }

  /**
   * Revokes all active refresh tokens for a user across all devices (e.g. on password reset or account freeze).
   */
  public async revokeAllUserSessions(
    userId: string,
    reason: string = 'SECURITY_RESET',
  ): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedReason: reason,
          revokedAt: new Date(),
        },
      },
    );
  }
}
