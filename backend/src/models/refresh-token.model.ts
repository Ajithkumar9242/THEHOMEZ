import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { UserType } from '@thehomez/shared-types';

export interface IRefreshTokenDocument extends Document {
  tokenHash: string;
  userId: mongoose.Types.ObjectId;
  userType: UserType;
  familyId: string;
  isRevoked: boolean;
  revokedReason?: 'ROTATED' | 'LOGOUT' | 'REUSE_DETECTED' | string;
  revokedAt?: Date;
  replacedByTokenHash?: string;
  expiresAt: Date;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
  };
  createdAt: Date;
  updatedAt: Date;

  isExpired(now?: Date): boolean;
  isActive(now?: Date): boolean;
}

const refreshTokenSchema = new Schema<IRefreshTokenDocument>(
  {
    tokenHash: {
      type: String,
      required: [true, 'Token hash is required'],
      unique: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    userType: {
      type: String,
      required: [true, 'UserType is required'],
      enum: Object.values(UserType),
      index: true,
    },
    familyId: {
      type: String,
      required: [true, 'Family ID is required for rotation tracking'],
      trim: true,
      index: true,
    },
    isRevoked: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    revokedReason: {
      type: String,
      enum: ['ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'SECURITY_RESET'],
      default: undefined,
    },
    revokedAt: {
      type: Date,
      default: undefined,
    },
    replacedByTokenHash: {
      type: String,
      trim: true,
      default: undefined,
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration timestamp is required'],
    },
    metadata: {
      userAgent: { type: String, trim: true },
      ipAddress: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
    collection: 'refresh_tokens',
    autoIndex: true,
  },
);

/**
 * Compound index to efficiently locate all active tokens within a rotation family.
 */
refreshTokenSchema.index({ familyId: 1, isRevoked: 1 });

/**
 * Compound index to query active tokens for a specific user.
 */
refreshTokenSchema.index({ userId: 1, isRevoked: 1 });

/**
 * Retention TTL index: preserves tokens for 30 days (2,592,000s) after their expiration timestamp.
 * This guarantees that even rotated or revoked tokens remain accessible long enough to detect
 * token reuse and replay attempts.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2592000 });

refreshTokenSchema.methods.isExpired = function (now: Date = new Date()): boolean {
  return now.getTime() > this.expiresAt.getTime();
};

refreshTokenSchema.methods.isActive = function (now: Date = new Date()): boolean {
  return !this.isRevoked && !this.isExpired(now);
};

export const RefreshTokenModel: Model<IRefreshTokenDocument> =
  mongoose.models.RefreshToken ||
  mongoose.model<IRefreshTokenDocument>('RefreshToken', refreshTokenSchema);
