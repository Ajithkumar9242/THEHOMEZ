import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { UserType } from '@thehomez/shared-types';

export interface IOtpLockoutDocument extends Document {
  phone: string;
  userType: UserType;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastFailedAt: Date;
  createdAt: Date;
  updatedAt: Date;

  isLocked(now?: Date): boolean;
}

const otpLockoutSchema = new Schema<IOtpLockoutDocument>(
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
    failedAttempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    lastFailedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'phone_otp_lockouts',
    autoIndex: true,
  },
);

// Compound index to ensure uniqueness per phone + userType identity tuple
otpLockoutSchema.index({ phone: 1, userType: 1 }, { unique: true });
// TTL index: automatically purge inactive lockout documents after 24 hours
otpLockoutSchema.index({ lastFailedAt: 1 }, { expireAfterSeconds: 86400 });

otpLockoutSchema.methods.isLocked = function (now: Date = new Date()): boolean {
  return this.lockedUntil !== null && now.getTime() < this.lockedUntil.getTime();
};

export const OtpLockoutModel: Model<IOtpLockoutDocument> =
  mongoose.models.OtpLockout ||
  mongoose.model<IOtpLockoutDocument>('OtpLockout', otpLockoutSchema);
