import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { UserType, PermissionCode } from '@thehomez/shared-types';

export interface IRoleDocument extends Document {
  code: string;
  name: string;
  description?: string;
  userType: UserType;
  isSystemManaged: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRoleDocument>(
  {
    code: {
      type: String,
      required: [true, 'Role code is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    userType: {
      type: String,
      required: [true, 'UserType is required for role scoping'],
      enum: Object.values(UserType),
      index: true,
    },
    isSystemManaged: {
      type: Boolean,
      default: false,
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator(perms: string[]) {
          const validCodes = new Set(Object.values(PermissionCode) as string[]);
          return perms.every((p) => validCodes.has(p) || typeof p === 'string');
        },
        message: 'Invalid permission code supplied in permissions array',
      },
    },
  },
  {
    timestamps: true,
    collection: 'roles',
    autoIndex: true,
  },
);

export const RoleModel: Model<IRoleDocument> =
  mongoose.models.Role || mongoose.model<IRoleDocument>('Role', roleSchema);
