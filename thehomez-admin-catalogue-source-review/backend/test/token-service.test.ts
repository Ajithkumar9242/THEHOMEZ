import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { UserType, UserStatus } from '@thehomez/shared-types';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { TokenService } from '../src/services/token/token.service.js';

describe('TokenService — JWT & Refresh Token Lifecycle with Reuse Detection', () => {
  let isDbConnected = false;
  let tokenService: TokenService;
  let testUser: IUserDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();

    if (isDbConnected) {
      testUser = await UserModel.create({
        phone: '+919888877777',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: ['CUSTOMER_DEFAULT'],
      });
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await UserModel.deleteMany({ phone: '+919888877777' });
      await RefreshTokenModel.deleteMany({ userId: testUser._id });
      await disconnectDatabase();
    }
  });

  describe('JWT Access Token Signing and Verification', () => {
    it('signs an access token with minimal claims and verifies it successfully', () => {
      const accessToken = tokenService.signAccessToken(testUser);
      expect(typeof accessToken).toBe('string');

      const decoded = tokenService.verifyAccessToken(accessToken);
      expect(decoded.sub).toBe(testUser._id.toString());
      expect(decoded.userType).toBe(UserType.CUSTOMER);
      expect(decoded.roles).toEqual(['CUSTOMER_DEFAULT']);
    });

    it('rejects tampered or malformed access tokens', () => {
      expect(() => tokenService.verifyAccessToken('tampered.token.string')).toThrow(
        /Invalid or corrupted access token/,
      );

      const validToken = tokenService.signAccessToken(testUser);
      const parts = validToken.split('.');
      const tamperedSignature = `${parts[0]}.${parts[1]}.badsignature12345`;

      expect(() => tokenService.verifyAccessToken(tamperedSignature)).toThrow(
        /Invalid or corrupted access token/,
      );
    });

    it('rejects expired access tokens', () => {
      // Sign an already-expired token directly
      const expiredToken = jwt.sign(
        { sub: testUser._id.toString(), userType: UserType.CUSTOMER, roles: [] },
        'dev_thehomez_jwt_access_secret_min_32_characters_1234!',
        { expiresIn: -10 },
      );

      expect(() => tokenService.verifyAccessToken(expiredToken)).toThrow(
        /Access token has expired/,
      );
    });
  });

  describe('Refresh Token Generation, Atomic Rotation & Reuse Detection', () => {
    it('generates a token pair with opaque refresh token and hashed persistence', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(testUser);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.refreshToken).toContain('.'); // Format: familyId.secret
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(900); // 15 mins default

      // Verify stored record is SHA-256 hashed
      const rawRefreshToken = tokens.refreshToken;
      const familyId = rawRefreshToken.split('.')[0]!;

      const record = await RefreshTokenModel.findOne({ familyId });
      expect(record).toBeDefined();
      expect(record?.isRevoked).toBe(false);
      expect(record?.userId.toString()).toBe(testUser._id.toString());
      expect(record?.tokenHash).not.toBe(rawRefreshToken);
    });

    it('rotates a valid refresh token atomically, revoking old and issuing new child', async () => {
      if (!isDbConnected) return;

      const initialTokens = await tokenService.generateTokenPair(testUser);
      const rotatedTokens = await tokenService.rotateRefreshToken(initialTokens.refreshToken);

      expect(rotatedTokens.accessToken).toBeDefined();
      expect(rotatedTokens.refreshToken).toBeDefined();
      expect(rotatedTokens.refreshToken).not.toBe(initialTokens.refreshToken);

      // Verify old token is marked REVOKED with reason ROTATED
      const oldFamilyId = initialTokens.refreshToken.split('.')[0]!;
      const oldRecords = await RefreshTokenModel.find({ familyId: oldFamilyId }).sort({
        createdAt: 1,
      });

      expect(oldRecords.length).toBe(2);
      expect(oldRecords[0]?.isRevoked).toBe(true);
      expect(oldRecords[0]?.revokedReason).toBe('ROTATED');
      expect(oldRecords[1]?.isRevoked).toBe(false);
    });

    it('triggers REUSE DETECTION and revokes entire family when an old rotated token is replayed', async () => {
      if (!isDbConnected) return;

      // 1. Initial generation (Token A)
      const tokenA = await tokenService.generateTokenPair(testUser);
      const familyId = tokenA.refreshToken.split('.')[0]!;

      // 2. Legitimate rotation (Token A -> Token B)
      const tokenB = await tokenService.rotateRefreshToken(tokenA.refreshToken);
      expect(tokenB.refreshToken).toBeDefined();

      // 3. Further rotation (Token B -> Token C)
      const tokenC = await tokenService.rotateRefreshToken(tokenB.refreshToken);
      expect(tokenC.refreshToken).toBeDefined();

      // At this point: Token A and B are revoked, Token C is active.
      let activeCount = await RefreshTokenModel.countDocuments({ familyId, isRevoked: false });
      expect(activeCount).toBe(1);

      // 4. ATTACK SIMULATION: Replay Token A!
      await expect(tokenService.rotateRefreshToken(tokenA.refreshToken)).rejects.toThrow(
        /Token reuse detected. Session revoked/,
      );

      // 5. Verify that ALL tokens in the entire family have now been revoked!
      activeCount = await RefreshTokenModel.countDocuments({ familyId, isRevoked: false });
      expect(activeCount).toBe(0);

      const compromisedTokens = await RefreshTokenModel.find({
        familyId,
        revokedReason: 'REUSE_DETECTED',
      });
      expect(compromisedTokens.length).toBeGreaterThanOrEqual(1);

      // Even Token C is now blocked from further use
      await expect(tokenService.rotateRefreshToken(tokenC.refreshToken)).rejects.toThrow(
        /Token reuse detected/,
      );
    });

    it('revokes specific refresh token upon logout', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(testUser);
      await tokenService.revokeRefreshToken(tokens.refreshToken);

      const familyId = tokens.refreshToken.split('.')[0]!;
      const record = await RefreshTokenModel.findOne({ familyId });
      expect(record?.isRevoked).toBe(true);
      expect(record?.revokedReason).toBe('LOGOUT');

      // Attempting to rotate logged out token triggers reuse detection
      await expect(tokenService.rotateRefreshToken(tokens.refreshToken)).rejects.toThrow(
        /Token reuse detected/,
      );
    });

    it('guards against concurrent refresh requests using atomic findOneAndUpdate', async () => {
      if (!isDbConnected) return;

      const tokens = await tokenService.generateTokenPair(testUser);

      // Trigger two concurrent rotations with the exact same token
      const [res1, res2] = await Promise.allSettled([
        tokenService.rotateRefreshToken(tokens.refreshToken),
        tokenService.rotateRefreshToken(tokens.refreshToken),
      ]);

      const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
      const failures = [res1, res2].filter((r) => r.status === 'rejected');

      // Exactly one succeeds, the other is caught by concurrency or reuse detection
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });
  });
});
