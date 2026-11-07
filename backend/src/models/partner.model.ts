import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { MAX_SERVICE_AREAS_PER_PARTNER, DeliveryMode } from '@thehomez/shared-types';

export type PartnerStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';

export interface IPartnerDocument extends Document {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  serviceAreaIds: mongoose.Types.ObjectId[];
  status: PartnerStatus;
  deliveryMode: DeliveryMode;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const partnerSchema = new Schema<IPartnerDocument>(
  {
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: [120, 'Business name cannot exceed 120 characters'],
    },
    legalName: {
      type: String,
      trim: true,
      maxlength: [150, 'Legal name cannot exceed 150 characters'],
      default: undefined,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+[1-9]\d{9,14}$/, 'Phone number must be a valid E.164 string (+91...)'],
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
    serviceAreaIds: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'ServiceArea',
        },
      ],
      validate: [
        {
          validator(areas: mongoose.Types.ObjectId[]): boolean {
            return Array.isArray(areas) && areas.length <= MAX_SERVICE_AREAS_PER_PARTNER;
          },
          message: `Service areas array exceeds technical maximum limit of ${MAX_SERVICE_AREAS_PER_PARTNER}`,
        },
      ],
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ['ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED'],
      default: 'ACTIVE',
      index: true,
    },
    deliveryMode: {
      type: String,
      enum: Object.values(DeliveryMode),
      default: DeliveryMode.PARTNER_MANAGED,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'partners',
    autoIndex: true,
  },
);

/**
 * Multikey index for finding active partners serving a specific service area.
 */
partnerSchema.index({ serviceAreaIds: 1 });

/**
 * Compound index for querying active partners by service area coverage in under 5ms.
 */
partnerSchema.index({ serviceAreaIds: 1, status: 1 });

export const PartnerModel: Model<IPartnerDocument> =
  mongoose.models.Partner || mongoose.model<IPartnerDocument>('Partner', partnerSchema);
