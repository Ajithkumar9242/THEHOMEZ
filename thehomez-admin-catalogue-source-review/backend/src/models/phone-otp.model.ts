import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { UserType } from '@thehomez/shared-types';

export interface IPhoneOtpDocument extends Document {
  phone: string;
  userType: UserType;
  hashedOtp: string;
  expiresAt: Date;
  cooldownUntil: Date;
  attempts: number;
  maxAttempts: number;
  isConsumed: boolean;
  correlationId?: string;
  createdAt: Date;
  updatedAt: Date;

  // Domain Helper Methods
  isExpired(now?: Date): boolean;
  isCooldownActive(now?: Date): boolean;
  hasExceededAttempts(): boolean;
  canAttempt(now?: Date): boolean;
}

const phoneOtpSchema = new Schema<IPhoneOtpDocument>(
  {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    userType: {
      type: String,
      required: [true, 'UserType is required'],
      enum: Object.values(UserType),
      index: true,
    },
    hashedOtp: {
      type: String,
      required: [true, 'Hashed OTP is required'],
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration timestamp is required'],
    },
    cooldownUntil: {
      type: Date,
      required: [true, 'Cooldown timestamp is required'],
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 3,
      min: 1,
    },
    isConsumed: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    correlationId: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
    collection: 'phone_otps',
    autoIndex: true,
  },
);

/**
 * Compound index to rapidly locate the latest active OTP for an identity tuple.
 */
phoneOtpSchema.index({ phone: 1, userType: 1, isConsumed: 1, createdAt: -1 });
phoneOtpSchema.index({ phone: 1, userType: 1, createdAt: -1 });

/**
 * Retention TTL index: cleans up old OTP documents 1 hour after expiration.
 * Application logic enforces strict real-time expiration; MongoDB TTL handles background hygiene.
 */
phoneOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// Helper methods enforcing business rules in application logic
phoneOtpSchema.methods.isExpired = function (now: Date = new Date()): boolean {
  return now.getTime() > this.expiresAt.getTime();
};

phoneOtpSchema.methods.isCooldownActive = function (now: Date = new Date()): boolean {
  return now.getTime() < this.cooldownUntil.getTime();
};

phoneOtpSchema.methods.hasExceededAttempts = function (): boolean {
  return this.attempts >= this.maxAttempts;
};

phoneOtpSchema.methods.canAttempt = function (now: Date = new Date()): boolean {
  return !this.isConsumed && !this.isExpired(now) && !this.hasExceededAttempts();
};

export const PhoneOtpModel: Model<IPhoneOtpDocument> =
  mongoose.models.PhoneOtp || mongoose.model<IPhoneOtpDocument>('PhoneOtp', phoneOtpSchema);
