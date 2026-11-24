import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IAdminSessionDocument extends Document<string> {
  _id: string; // Session UUID (matches refresh token familyId)
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  absoluteExpiresAt: Date;
  lastActivityAt: Date;
  isRevoked: boolean;
  revokedReason?:
    | 'LOGOUT'
    | 'IDLE_TIMEOUT'
    | 'ABSOLUTE_TIMEOUT'
    | 'SECURITY_RESET'
    | 'REUSE_DETECTED'
    | 'CONCURRENT_ROTATION_CONFLICT'
    | string;
  revokedAt?: Date;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
  };
  updatedAt: Date;

  isAbsoluteExpired(now?: Date): boolean;
  isIdleExpired(now?: Date, timeoutMs?: number): boolean;
  isActive(now?: Date, idleTimeoutMs?: number): boolean;
}

const adminSessionSchema = new Schema<IAdminSessionDocument>(
  {
    _id: {
      type: String,
      required: [true, 'Session identifier (UUID) is required'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    absoluteExpiresAt: {
      type: Date,
      required: [true, 'Absolute expiration timestamp is required'],
    },
    lastActivityAt: {
      type: Date,
      required: true,
      default: Date.now,
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
      enum: [
        'LOGOUT',
        'IDLE_TIMEOUT',
        'ABSOLUTE_TIMEOUT',
        'SECURITY_RESET',
        'REUSE_DETECTED',
        'CONCURRENT_ROTATION_CONFLICT',
      ],
      default: undefined,
    },
    revokedAt: {
      type: Date,
      default: undefined,
    },
    metadata: {
      userAgent: { type: String, trim: true },
      ipAddress: { type: String, trim: true },
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'admin_sessions',
    autoIndex: true,
  },
);

/**
 * Compound index to quickly find active sessions for a user.
 */
adminSessionSchema.index({ userId: 1, isRevoked: 1 });

/**
 * Retention TTL index: automatically deletes session records 30 days after absolute expiration.
 */
adminSessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 2592000 });

adminSessionSchema.methods.isAbsoluteExpired = function (now: Date = new Date()): boolean {
  return now.getTime() >= this.absoluteExpiresAt.getTime();
};

adminSessionSchema.methods.isIdleExpired = function (
  now: Date = new Date(),
  timeoutMs: number = 30 * 60 * 1000,
): boolean {
  return now.getTime() - this.lastActivityAt.getTime() >= timeoutMs;
};

adminSessionSchema.methods.isActive = function (
  now: Date = new Date(),
  idleTimeoutMs: number = 30 * 60 * 1000,
): boolean {
  return !this.isRevoked && !this.isAbsoluteExpired(now) && !this.isIdleExpired(now, idleTimeoutMs);
};

export const AdminSessionModel: Model<IAdminSessionDocument> =
  mongoose.models.AdminSession ||
  mongoose.model<IAdminSessionDocument>('AdminSession', adminSessionSchema);
