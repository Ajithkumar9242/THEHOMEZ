import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  MAX_SERVICE_AREAS_PER_PARTNER,
  DeliveryMode,
  type PartnerApplicationStatus,
  PARTNER_APPLICATION_STATUSES,
} from '@thehomez/shared-types';

export interface IPartnerApplicationAuditSubdocument {
  action: string;
  performedBy: mongoose.Types.ObjectId;
  timestamp: Date;
  previousStatus?: PartnerApplicationStatus;
  newStatus?: PartnerApplicationStatus;
  reason?: string;
  refusalReasonCode?: string;
  metadata?: Record<string, unknown>;
}

export interface IPartnerApplicationDocument extends Document {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  deliveryMode: DeliveryMode;
  serviceAreaIds: mongoose.Types.ObjectId[];
  metadata?: Record<string, unknown>;
  initialUser: {
    contactName: string;
    phone: string;
    email?: string;
  };
  status: PartnerApplicationStatus;
  refusalReasonCode?: string;
  rejectionReason?: string;
  previousApplicationId?: mongoose.Types.ObjectId;
  assignedStaffUserId?: mongoose.Types.ObjectId;
  partnerId?: mongoose.Types.ObjectId;
  auditHistory: IPartnerApplicationAuditSubdocument[];
  createdAt: Date;
  updatedAt: Date;
}

const partnerApplicationAuditSchema = new Schema<IPartnerApplicationAuditSubdocument>(
  {
    action: {
      type: String,
      required: [true, 'Audit action is required'],
      trim: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Staff user ID is required for audit record'],
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
    previousStatus: {
      type: String,
      enum: [...PARTNER_APPLICATION_STATUSES],
      default: undefined,
    },
    newStatus: {
      type: String,
      enum: [...PARTNER_APPLICATION_STATUSES],
      default: undefined,
    },
    reason: {
      type: String,
      trim: true,
      default: undefined,
    },
    refusalReasonCode: {
      type: String,
      trim: true,
      default: undefined,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: true },
);

const initialUserSchema = new Schema(
  {
    contactName: {
      type: String,
      required: [true, 'Contact person name is required'],
      trim: true,
      maxlength: [100, 'Contact name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Contact phone number is required'],
      trim: true,
      match: [/^\+[1-9]\d{9,14}$/, 'Contact phone number must be a valid E.164 string (+91...)'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: undefined,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Contact email must be a valid email address',
      ],
    },
  },
  { _id: false },
);

const partnerApplicationSchema = new Schema<IPartnerApplicationDocument>(
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
      required: [true, 'Business phone number is required'],
      trim: true,
      match: [/^\+[1-9]\d{9,14}$/, 'Business phone number must be a valid E.164 string (+91...)'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: undefined,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Business email must be a valid email address',
      ],
    },
    deliveryMode: {
      type: String,
      enum: Object.values(DeliveryMode),
      default: DeliveryMode.PARTNER_MANAGED,
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
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    initialUser: {
      type: initialUserSchema,
      required: [true, 'Initial primary partner user details are required'],
    },
    status: {
      type: String,
      required: true,
      enum: [...PARTNER_APPLICATION_STATUSES],
      default: 'SUBMITTED',
    },
    refusalReasonCode: {
      type: String,
      trim: true,
      default: undefined,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: undefined,
    },
    previousApplicationId: {
      type: Schema.Types.ObjectId,
      ref: 'PartnerApplication',
      default: undefined,
    },
    assignedStaffUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      default: undefined,
    },
    auditHistory: {
      type: [partnerApplicationAuditSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'partner_applications',
    autoIndex: true,
  },
);

/**
 * Standard indexing for administrative queries and reapplication lineage.
 * Note: Neither phone nor email has a unique index, ensuring zero credential deadlocks on reapplication.
 */
partnerApplicationSchema.index({ status: 1 });
partnerApplicationSchema.index({ previousApplicationId: 1 });
partnerApplicationSchema.index({ createdAt: -1 });

export const PartnerApplicationModel: Model<IPartnerApplicationDocument> =
  mongoose.models.PartnerApplication ||
  mongoose.model<IPartnerApplicationDocument>('PartnerApplication', partnerApplicationSchema);
