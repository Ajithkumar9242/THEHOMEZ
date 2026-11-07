import crypto from 'node:crypto';
import { UserType, UserStatus, type IOtpRequestResponse } from '@thehomez/shared-types';
import { PhoneOtpModel } from '../../models/phone-otp.model.js';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import { getConfig } from '../../config/env.js';
import { normalizePhoneNumber } from '../phone.utils.js';
import type { IOtpProvider } from './otp-provider.interface.js';
import { MockOtpProvider } from './mock-otp.provider.js';
import { Msg91OtpProvider } from './msg91-otp.provider.js';

export class OtpError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'OTP_ERROR',
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OtpError';
  }
}

/**
 * Computes timing-safe equality comparison of two hexadecimal strings.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates an HMAC-SHA256 digest of an OTP string using the pepper secret.
 */
export function hashOtp(otp: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(otp).digest('hex');
}

export class OtpService {
  private readonly provider: IOtpProvider;

  constructor(customProvider?: IOtpProvider) {
    if (customProvider) {
      this.provider = customProvider;
    } else {
      const config = getConfig();
      if (config.auth.otp.provider === 'msg91') {
        this.provider = new Msg91OtpProvider();
      } else {
        this.provider = new MockOtpProvider();
      }
    }
  }

  /**
   * Dispatches a 6-digit numeric OTP challenge for a phone + identity tuple.
   */
  public async requestOtp(
    rawPhone: string,
    userType: UserType,
    correlationId?: string,
  ): Promise<IOtpRequestResponse> {
    const config = getConfig();
    const phone = normalizePhoneNumber(rawPhone);

    // 1. Identity Pre-conditions Check (Anti-Enumeration Protection)
    // Customer self-registration allows non-existent accounts; Partner and Staff require pre-provisioning.
    // Suspended accounts or unprovisioned privileged accounts must NOT receive OTP challenges,
    // but the API must return a uniform response envelope to prevent account enumeration.
    if (userType === UserType.PARTNER || userType === UserType.STAFF) {
      const existingUser = await UserModel.findOne({ phone, userType });
      if (!existingUser || existingUser.status !== UserStatus.ACTIVE) {
        return {
          cooldownSeconds: config.auth.otp.resendCooldownSeconds,
          expiresInSeconds: config.auth.otp.ttlSeconds,
          message: 'OTP challenge dispatched successfully',
        };
      }
    } else if (userType === UserType.CUSTOMER) {
      const existingCustomer = await UserModel.findOne({ phone, userType });
      if (existingCustomer && existingCustomer.status !== UserStatus.ACTIVE) {
        return {
          cooldownSeconds: config.auth.otp.resendCooldownSeconds,
          expiresInSeconds: config.auth.otp.ttlSeconds,
          message: 'OTP challenge dispatched successfully',
        };
      }
    }

    const now = new Date();

    // 2. Check Cooldown on Existing Active OTP Challenge
    const existingOtp = await PhoneOtpModel.findOne({
      phone,
      userType,
      isConsumed: false,
    }).sort({ createdAt: -1 });

    if (existingOtp && existingOtp.isCooldownActive(now)) {
      const remainingSecs = Math.max(
        1,
        Math.ceil((existingOtp.cooldownUntil.getTime() - now.getTime()) / 1000),
      );
      throw new OtpError(
        `Please wait ${remainingSecs} seconds before requesting a new OTP`,
        'COOLDOWN_ACTIVE',
        429,
        { cooldownRemainingSeconds: remainingSecs },
      );
    }

    // 3. Invalidate any prior unconsumed OTP challenges for this identity tuple
    await PhoneOtpModel.updateMany(
      { phone, userType, isConsumed: false },
      { $set: { isConsumed: true } },
    );

    // 4. Generate Cryptographically Secure 6-digit Numeric OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = hashOtp(rawOtp, config.auth.otp.pepperSecret);

    const expiresAt = new Date(now.getTime() + config.auth.otp.ttlSeconds * 1000);
    const cooldownUntil = new Date(now.getTime() + config.auth.otp.resendCooldownSeconds * 1000);

    // 5. Persist Hashed Challenge Record
    const createdChallenge = await PhoneOtpModel.create({
      phone,
      userType,
      hashedOtp,
      expiresAt,
      cooldownUntil,
      attempts: 0,
      maxAttempts: config.auth.otp.maxAttempts,
      isConsumed: false,
      correlationId,
    });

    // 6. Deliver OTP via configured provider adapter (zero plaintext logging)
    try {
      await this.provider.sendOtp(phone, rawOtp, correlationId);
    } catch (deliveryError) {
      // Do not leave unintended usable OTP challenges after failed delivery
      await PhoneOtpModel.deleteOne({ _id: createdChallenge._id });
      throw new OtpError(
        'Failed to deliver OTP. Please try again later',
        'OTP_DELIVERY_FAILED',
        502,
        {
          originalError:
            deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
        },
      );
    }

    return {
      cooldownSeconds: config.auth.otp.resendCooldownSeconds,
      expiresInSeconds: config.auth.otp.ttlSeconds,
      message: 'OTP challenge dispatched successfully',
    };
  }

  /**
   * Verifies an OTP challenge against the active hashed record.
   * On success, atomically marks the OTP as consumed and returns the resolved/provisioned User document.
   */
  public async verifyOtp(
    rawPhone: string,
    rawOtp: string,
    userType: UserType,
  ): Promise<{ user: IUserDocument }> {
    const config = getConfig();
    const phone = normalizePhoneNumber(rawPhone);

    if (!rawOtp || !/^\d{6}$/.test(rawOtp.trim())) {
      throw new OtpError('Invalid OTP code format. Must be a 6-digit code', 'INVALID_OTP', 400);
    }

    const cleanOtp = rawOtp.trim();
    const now = new Date();

    // 1. Locate the latest unconsumed challenge for this identity
    const otpDoc = await PhoneOtpModel.findOne({
      phone,
      userType,
      isConsumed: false,
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      throw new OtpError(
        'No active OTP challenge found. Please request an OTP first',
        'OTP_NOT_FOUND',
        400,
      );
    }

    // 2. Real-time Expiration Check
    if (otpDoc.isExpired(now)) {
      await PhoneOtpModel.updateOne({ _id: otpDoc._id }, { $set: { isConsumed: true } });
      throw new OtpError('OTP has expired. Please request a new one', 'OTP_EXPIRED', 400);
    }

    // 3. Attempt Limit Check
    if (otpDoc.hasExceededAttempts()) {
      await PhoneOtpModel.updateOne({ _id: otpDoc._id }, { $set: { isConsumed: true } });
      throw new OtpError(
        'Maximum verification attempts exceeded. Please request a new OTP',
        'MAX_ATTEMPTS_EXCEEDED',
        429,
      );
    }

    // 4. Constant-Time Hash Comparison
    const candidateHash = hashOtp(cleanOtp, config.auth.otp.pepperSecret);
    const isMatch = timingSafeEqualHex(candidateHash, otpDoc.hashedOtp);

    if (!isMatch) {
      // Increment attempt counter atomically
      const updated = await PhoneOtpModel.findOneAndUpdate(
        { _id: otpDoc._id },
        { $inc: { attempts: 1 } },
        { new: true },
      );

      if (updated && updated.attempts >= updated.maxAttempts) {
        await PhoneOtpModel.updateOne({ _id: otpDoc._id }, { $set: { isConsumed: true } });
        throw new OtpError(
          'Maximum verification attempts exceeded. Please request a new OTP',
          'MAX_ATTEMPTS_EXCEEDED',
          429,
        );
      }

      const remainingAttempts = Math.max(
        0,
        otpDoc.maxAttempts - (updated?.attempts ?? otpDoc.attempts + 1),
      );
      throw new OtpError(
        `Invalid OTP code. ${remainingAttempts} attempt(s) remaining`,
        'INVALID_OTP',
        400,
        { remainingAttempts },
      );
    }

    // 5. Atomic Single-Use Consumption (Guards against concurrent replay attacks)
    const consumedDoc = await PhoneOtpModel.findOneAndUpdate(
      {
        _id: otpDoc._id,
        isConsumed: false,
        attempts: { $lt: otpDoc.maxAttempts },
        expiresAt: { $gt: now },
      },
      { $set: { isConsumed: true } },
      { new: true },
    );

    if (!consumedDoc) {
      throw new OtpError(
        'OTP has already been consumed or invalidated',
        'CONCURRENT_CONSUMPTION_CONFLICT',
        409,
      );
    }

    // 6. User Provisioning & Retrieval
    let user = await UserModel.findOne({ phone, userType });

    if (!user) {
      // Customer self-registration allows creating new CUSTOMER identity accounts
      if (userType === UserType.CUSTOMER) {
        user = await UserModel.create({
          phone,
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
        });
      } else {
        // Partner and Staff identities must NEVER be auto-created via OTP
        throw new OtpError(
          'Authorized account not found for this identity',
          'IDENTITY_NOT_FOUND',
          404,
        );
      }
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new OtpError(
        `Account is ${user.status.toLowerCase()}. Please contact platform support`,
        'ACCOUNT_NOT_ACTIVE',
        403,
      );
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    return { user };
  }
}
