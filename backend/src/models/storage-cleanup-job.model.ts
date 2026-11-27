import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export enum StorageCleanupTriggerReason {
  UPLOAD_COMPENSATION_FAILURE = 'UPLOAD_COMPENSATION_FAILURE',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  DOCUMENT_REJECTED = 'DOCUMENT_REJECTED',
  REPLACED_DOCUMENT = 'REPLACED_DOCUMENT',
  MANUAL_PURGE = 'MANUAL_PURGE',
  ORPHAN_DISCOVERY = 'ORPHAN_DISCOVERY',
  ORPHAN_RECONCILIATION = 'ORPHAN_RECONCILIATION',
}

export enum StorageCleanupStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  RETRYING = 'RETRYING',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
  RESOLVED = 'RESOLVED',
  COMPLETED = 'COMPLETED',
}

export interface IStorageCleanupJobDocument extends Document {
  storageKey: string;
  partnerId?: Types.ObjectId;
  documentId?: Types.ObjectId;
  triggerReason: StorageCleanupTriggerReason;
  status: StorageCleanupStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  nextRetryAt: Date;
  leaseExpiresAt?: Date;
  workerId?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const storageCleanupJobSchema = new Schema<IStorageCleanupJobDocument>(
  {
    storageKey: {
      type: String,
      required: [true, 'storageKey is required'],
      trim: true,
      unique: true, // Stable unique identity guaranteeing at most one cleanup job per storage key
      index: true,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      default: undefined,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      default: undefined,
    },
    triggerReason: {
      type: String,
      required: [true, 'triggerReason is required'],
      enum: Object.values(StorageCleanupTriggerReason),
    },
    status: {
      type: String,
      required: [true, 'status is required'],
      enum: Object.values(StorageCleanupStatus),
      default: StorageCleanupStatus.PENDING,
      index: true,
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
      default: 5,
      min: 1,
    },
    lastError: {
      type: String,
      default: undefined,
    },
    nextRetryAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    leaseExpiresAt: {
      type: Date,
      default: undefined,
      index: true,
    },
    workerId: {
      type: String,
      default: undefined,
    },
    resolvedAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
    collection: 'storage_cleanup_jobs',
    autoIndex: true,
  },
);

/**
 * Compound index for high-throughput worker job acquisition and leasing.
 */
storageCleanupJobSchema.index({ status: 1, nextRetryAt: 1, leaseExpiresAt: 1 });

export const StorageCleanupJobModel: Model<IStorageCleanupJobDocument> =
  mongoose.models.StorageCleanupJob ||
  mongoose.model<IStorageCleanupJobDocument>('StorageCleanupJob', storageCleanupJobSchema);
