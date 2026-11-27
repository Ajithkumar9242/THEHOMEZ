import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  MAX_SERVICE_AREAS_PER_PARTNER,
  DeliveryMode,
  PartnerDocumentType,
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
} from '@thehomez/shared-types';

export type PartnerStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';

export interface IManualSecurityReviewSubdoc {
  status: ManualSecurityReviewStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reason?: string;
}

export interface IPartnerDocumentItem {
  _id: mongoose.Types.ObjectId;
  documentType: PartnerDocumentType;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  uploadedAt: Date;
  uploadedBy: mongoose.Types.ObjectId;
  status: DocumentReviewStatus;
  rejectionReason?: string;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  expiresAt?: Date;
  scanStatus: DocumentScanStatus;
  scanGeneration: number;
  lastScanJobId?: string;
  scannedAt?: Date;
  scanDetails?: {
    engine?: string;
    signatureVersion?: string;
    threatName?: string;
  };
  manualSecurityReview: IManualSecurityReviewSubdoc;
  notes?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
}

export interface IPartnerDocument extends Document {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  serviceAreaIds: mongoose.Types.ObjectId[];
  status: PartnerStatus;
  deliveryMode: DeliveryMode;
  metadata?: Record<string, unknown>;
  coverageVersion: number;
  documents: IPartnerDocumentItem[];
  createdAt: Date;
  updatedAt: Date;
}

const partnerDocumentItemSchema = new Schema<IPartnerDocumentItem>(
  {
    documentType: {
      type: String,
      enum: Object.values(PartnerDocumentType),
      required: [true, 'documentType is required'],
    },
    storageKey: {
      type: String,
      required: [true, 'storageKey is required'],
      trim: true,
    },
    originalFilename: {
      type: String,
      required: [true, 'originalFilename is required'],
      trim: true,
    },
    mimeType: {
      type: String,
      required: [true, 'mimeType is required'],
      trim: true,
    },
    fileSizeBytes: {
      type: Number,
      required: [true, 'fileSizeBytes is required'],
      min: [1, 'fileSizeBytes must be greater than 0'],
    },
    sha256Hash: {
      type: String,
      required: [true, 'sha256Hash is required'],
      trim: true,
      minlength: [64, 'sha256Hash must be 64 hexadecimal characters'],
      maxlength: [64, 'sha256Hash must be 64 hexadecimal characters'],
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'uploadedBy staff user ID is required'],
    },
    status: {
      type: String,
      enum: Object.values(DocumentReviewStatus),
      default: DocumentReviewStatus.PENDING_REVIEW,
      required: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: undefined,
    },
    reviewedAt: {
      type: Date,
      default: undefined,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
    expiresAt: {
      type: Date,
      default: undefined,
    },
    scanStatus: {
      type: String,
      enum: Object.values(DocumentScanStatus),
      default: DocumentScanStatus.PENDING_SCAN,
      required: true,
    },
    scanGeneration: {
      type: Number,
      default: 1,
      min: [1, 'scanGeneration must be positive'],
    },
    lastScanJobId: {
      type: String,
      default: undefined,
    },
    scannedAt: {
      type: Date,
      default: undefined,
    },
    scanDetails: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    manualSecurityReview: {
      status: {
        type: String,
        enum: Object.values(ManualSecurityReviewStatus),
        default: ManualSecurityReviewStatus.NOT_REVIEWED,
        required: true,
      },
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: undefined,
      },
      reviewedAt: {
        type: Date,
        default: undefined,
      },
      reason: {
        type: String,
        trim: true,
        default: undefined,
      },
    },
    notes: {
      type: String,
      trim: true,
      default: undefined,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      required: true,
    },
    deletedAt: {
      type: Date,
      default: undefined,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
  },
  { _id: true, timestamps: false },
);

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
      default: 'PENDING_VERIFICATION',
      index: true,
    },
    coverageVersion: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'coverageVersion cannot be negative'],
    },
    deliveryMode: {
      type: String,
      enum: Object.values(DeliveryMode),
      default: DeliveryMode.PARTNER_MANAGED,
    },
    documents: {
      type: [partnerDocumentItemSchema],
      default: [],
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

/**
 * Sparse multikey index for looking up partner documents by storageKey during reconciliation.
 */
partnerSchema.index({ 'documents.storageKey': 1 }, { sparse: true });

export const PartnerModel: Model<IPartnerDocument> =
  mongoose.models.Partner || mongoose.model<IPartnerDocument>('Partner', partnerSchema);
