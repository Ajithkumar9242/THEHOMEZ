import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { UserType, UserStatus } from '@thehomez/shared-types';

export interface IUserDocument extends Document {
  phone: string;
  userType: UserType;
  email?: string;
  passwordHash?: string;
  status: UserStatus;
  roles: string[];
  partnerId?: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDocument>(
  {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+[1-9]\d{9,14}$/, 'Phone number must be a valid E.164 string (+91...)'],
    },
    userType: {
      type: String,
      required: [true, 'UserType is required'],
      enum: Object.values(UserType),
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: undefined,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Email must be a valid email address',
      ],
    },
    passwordHash: {
      type: String,
      select: false,
      default: undefined,
    },
    status: {
      type: String,
      required: [true, 'User status is required'],
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
      index: true,
    },
    roles: {
      type: [String],
      default: [],
      index: true,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      default: undefined,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      default: undefined,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    lastLoginAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
    collection: 'users',
    autoIndex: true,
  },
);

/**
 * Compound Unique Index: Enforces that a single normalized E.164 phone number
 * can have separate distinct identity accounts per UserType (Customer, Partner, Staff).
 */
userSchema.index({ phone: 1, userType: 1 }, { unique: true });

/**
 * Sparse unique index on email to allow multiple null/undefined values
 * while enforcing uniqueness for accounts that provide an email.
 */
userSchema.index({ email: 1 }, { unique: true, sparse: true });

export const UserModel: Model<IUserDocument> =
  mongoose.models.User || mongoose.model<IUserDocument>('User', userSchema);
