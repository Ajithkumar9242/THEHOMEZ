import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import { UserModel, RoleModel, PhoneOtpModel, RefreshTokenModel } from '../src/models/index.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';

describe('Mongoose Authentication & Identity Models', () => {
  let isDbConnected = false;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      // Clean up test collections
      await UserModel.deleteMany({ phone: { $regex: /^\+91000/ } });
      await RoleModel.deleteMany({ code: { $regex: /^TEST_/ } });
      await PhoneOtpModel.deleteMany({ phone: { $regex: /^\+91000/ } });
      await RefreshTokenModel.deleteMany({ familyId: { $regex: /^test-family-/ } });
      await disconnectDatabase();
    }
  });

  describe('UserModel Schema & Compound Uniqueness', () => {
    it('declares the compound unique index on { phone: 1, userType: 1 }', () => {
      const indexes = UserModel.schema.indexes();
      const compoundPhoneUserType = indexes.find(
        ([fields, options]) =>
          fields.phone === 1 && fields.userType === 1 && options?.unique === true,
      );

      expect(compoundPhoneUserType).toBeDefined();
    });

    it('declares a sparse unique index on email', () => {
      const indexes = UserModel.schema.indexes();
      const emailIndex = indexes.find(
        ([fields, options]) =>
          fields.email === 1 && options?.unique === true && options?.sparse === true,
      );

      expect(emailIndex).toBeDefined();
    });

    it('validates E.164 phone format and rejects invalid numbers', async () => {
      const invalidUser = new UserModel({
        phone: 'invalid-non-e164',
        userType: UserType.CUSTOMER,
      });

      const error = invalidUser.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.phone).toBeDefined();
    });

    it('validates required fields', () => {
      const emptyUser = new UserModel({});
      const error = emptyUser.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.phone).toBeDefined();
      expect(error?.errors.userType).toBeDefined();
    });

    it('allows a valid user document with defaults', () => {
      const validUser = new UserModel({
        phone: '+919876543210',
        userType: UserType.CUSTOMER,
      });

      const error = validUser.validateSync();
      expect(error).toBeUndefined();
      expect(validUser.status).toBe(UserStatus.ACTIVE);
      expect(validUser.roles).toEqual([]);
    });

    it('enforces compound uniqueness across identities in live database', async () => {
      if (!isDbConnected) {
        return;
      }

      await UserModel.syncIndexes();

      const phone = '+910001112233';

      // Clean up prior runs
      await UserModel.deleteMany({ phone });

      // 1. Create CUSTOMER identity for phone
      const customer = await UserModel.create({
        phone,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
      });
      expect(customer._id).toBeDefined();

      // 2. Allow separate PARTNER identity for the SAME phone number
      const partner = await UserModel.create({
        phone,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: new mongoose.Types.ObjectId(),
      });
      expect(partner._id).toBeDefined();
      expect(partner._id.toString()).not.toBe(customer._id.toString());

      // 3. Reject duplicate identity for the identical (phone, userType) tuple
      await expect(
        UserModel.create({
          phone,
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
        }),
      ).rejects.toThrow();

      // Clean up
      await UserModel.deleteMany({ phone });
    });
  });

  describe('RoleModel Schema & RBAC Definitions', () => {
    it('declares a unique index on code', () => {
      const codePath = RoleModel.schema.path('code');
      expect((codePath as unknown as { options?: { unique?: boolean } })?.options?.unique).toBe(
        true,
      );
    });

    it('validates required role fields and transforms code to uppercase', () => {
      const role = new RoleModel({
        code: 'test_ops_lead',
        name: 'Test Operations Lead',
        userType: UserType.STAFF,
        permissions: [PermissionCode.ORDER_READ, PermissionCode.ORDER_CANCEL],
      });

      expect(role.code).toBe('TEST_OPS_LEAD');
      const error = role.validateSync();
      expect(error).toBeUndefined();
    });

    it('rejects invalid userType in Role', () => {
      const invalidRole = new RoleModel({
        code: 'TEST_INVALID',
        name: 'Invalid Role',
        userType: 'SUPER_HERO' as unknown as UserType,
      });

      const error = invalidRole.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors.userType).toBeDefined();
    });
  });

  describe('PhoneOtpModel Schema & Application-Level Lifecycle Checks', () => {
    it('declares compound lookup index and retention TTL index', () => {
      const indexes = PhoneOtpModel.schema.indexes();

      const ttlIndex = indexes.find(
        ([fields, options]) => fields.expiresAt === 1 && options?.expireAfterSeconds === 3600,
      );
      expect(ttlIndex).toBeDefined();

      const compoundLookup = indexes.find(
        ([fields]) => fields.phone === 1 && fields.userType === 1 && fields.isConsumed === 1,
      );
      expect(compoundLookup).toBeDefined();
    });

    it('enforces expiration checks in application logic', () => {
      const pastDate = new Date(Date.now() - 10000); // 10s ago
      const futureDate = new Date(Date.now() + 60000); // 60s in future

      const expiredOtp = new PhoneOtpModel({
        phone: '+919999988888',
        userType: UserType.CUSTOMER,
        hashedOtp: 'hash123',
        expiresAt: pastDate,
        cooldownUntil: pastDate,
      });

      expect(expiredOtp.isExpired()).toBe(true);
      expect(expiredOtp.canAttempt()).toBe(false);

      const activeOtp = new PhoneOtpModel({
        phone: '+919999988888',
        userType: UserType.CUSTOMER,
        hashedOtp: 'hash123',
        expiresAt: futureDate,
        cooldownUntil: pastDate,
      });

      expect(activeOtp.isExpired()).toBe(false);
      expect(activeOtp.canAttempt()).toBe(true);
    });

    it('enforces cooldown logic in application domain', () => {
      const now = new Date();
      const inCooldown = new Date(now.getTime() + 30000); // 30s in future

      const otp = new PhoneOtpModel({
        phone: '+919999988888',
        userType: UserType.CUSTOMER,
        hashedOtp: 'hash123',
        expiresAt: new Date(now.getTime() + 300000),
        cooldownUntil: inCooldown,
      });

      expect(otp.isCooldownActive(now)).toBe(true);
      expect(otp.isCooldownActive(new Date(now.getTime() + 35000))).toBe(false);
    });

    it('enforces attempt limits in application domain', () => {
      const otp = new PhoneOtpModel({
        phone: '+919999988888',
        userType: UserType.CUSTOMER,
        hashedOtp: 'hash123',
        expiresAt: new Date(Date.now() + 60000),
        cooldownUntil: new Date(),
        attempts: 3,
        maxAttempts: 3,
      });

      expect(otp.hasExceededAttempts()).toBe(true);
      expect(otp.canAttempt()).toBe(false);
    });
  });

  describe('RefreshTokenModel Schema & Reuse Detection Retention', () => {
    it('declares unique index on tokenHash', () => {
      const tokenHashPath = RefreshTokenModel.schema.path('tokenHash');
      expect(
        (tokenHashPath as unknown as { options?: { unique?: boolean } })?.options?.unique,
      ).toBe(true);
    });

    it('declares rotation family compound index', () => {
      const indexes = RefreshTokenModel.schema.indexes();
      const familyIndex = indexes.find(
        ([fields]) => fields.familyId === 1 && fields.isRevoked === 1,
      );
      expect(familyIndex).toBeDefined();
    });

    it('declares 30-day retention TTL index on expiresAt for reuse detection', () => {
      const indexes = RefreshTokenModel.schema.indexes();
      const retentionTtl = indexes.find(
        ([fields, options]) => fields.expiresAt === 1 && options?.expireAfterSeconds === 2592000,
      );
      expect(retentionTtl).toBeDefined();
    });

    it('evaluates isActive and isExpired lifecycle state', () => {
      const future = new Date(Date.now() + 86400000);
      const past = new Date(Date.now() - 1000);

      const activeToken = new RefreshTokenModel({
        tokenHash: 'sha256-hash-value-1',
        userId: new mongoose.Types.ObjectId(),
        userType: UserType.CUSTOMER,
        familyId: 'family-uuid-1',
        isRevoked: false,
        expiresAt: future,
      });
      expect(activeToken.isActive()).toBe(true);
      expect(activeToken.isExpired()).toBe(false);

      const revokedToken = new RefreshTokenModel({
        tokenHash: 'sha256-hash-value-2',
        userId: new mongoose.Types.ObjectId(),
        userType: UserType.CUSTOMER,
        familyId: 'family-uuid-2',
        isRevoked: true,
        revokedReason: 'ROTATED',
        expiresAt: future,
      });
      expect(revokedToken.isActive()).toBe(false);

      const expiredToken = new RefreshTokenModel({
        tokenHash: 'sha256-hash-value-3',
        userId: new mongoose.Types.ObjectId(),
        userType: UserType.CUSTOMER,
        familyId: 'family-uuid-3',
        isRevoked: false,
        expiresAt: past,
      });
      expect(expiredToken.isActive()).toBe(false);
      expect(expiredToken.isExpired()).toBe(true);
    });
  });
});
