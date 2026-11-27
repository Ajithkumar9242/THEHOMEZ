import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export type PartnerAuditAction =
  | 'PARTNER_STATUS_CHANGED'
  | 'PARTNER_SERVICE_AREAS_ASSIGNED'
  | 'PARTNER_AVAILABILITY_OVERRIDE'
  | 'PARTNER_PROFILE_UPDATED'
  | 'PARTNER_OPERATOR_CREDENTIALS_UPDATED'
  | 'PARTNER_REACTIVATED'
  | 'PARTNER_REACTIVATION_WAIVER_GRANTED'
  | 'PARTNER_DOCUMENT_UPLOADED'
  | 'PARTNER_DOCUMENT_STATUS_CHANGED'
  | 'PARTNER_DOCUMENT_DELETED'
  | 'PARTNER_DOCUMENT_ACCESSED'
  | 'PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED'
  | 'PARTNER_DOCUMENT_SCAN_RESULT_RECORDED'
  | 'PARTNER_DOCUMENT_RETROACTIVE_INFECTION_DETECTED'
  | 'STORAGE_TAG_HEALED'
  | 'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED';

export interface IPartnerAuditLogMetadata {
  staffEmail?: string;
  staffPhone?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface IPartnerAuditLogDocument extends Document {
  partnerId?: Types.ObjectId;
  staffUserId: Types.ObjectId;
  action: PartnerAuditAction;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  reason: string;
  metadata?: IPartnerAuditLogMetadata;
  createdAt: Date;
}

const SYSTEM_STORAGE_AUDIT_ACTIONS: readonly PartnerAuditAction[] = [
  'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED',
  'STORAGE_TAG_HEALED',
];

const partnerAuditLogSchema = new Schema<IPartnerAuditLogDocument>(
  {
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      required: [
        function (this: IPartnerAuditLogDocument): boolean {
          return !SYSTEM_STORAGE_AUDIT_ACTIONS.includes(this.action);
        },
        'partnerId is required for partner audit actions',
      ],
      index: true,
    },
    staffUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'staffUserId is required'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'action is required'],
      enum: [
        'PARTNER_STATUS_CHANGED',
        'PARTNER_SERVICE_AREAS_ASSIGNED',
        'PARTNER_AVAILABILITY_OVERRIDE',
        'PARTNER_PROFILE_UPDATED',
        'PARTNER_OPERATOR_CREDENTIALS_UPDATED',
        'PARTNER_REACTIVATED',
        'PARTNER_REACTIVATION_WAIVER_GRANTED',
        'PARTNER_DOCUMENT_UPLOADED',
        'PARTNER_DOCUMENT_STATUS_CHANGED',
        'PARTNER_DOCUMENT_DELETED',
        'PARTNER_DOCUMENT_ACCESSED',
        'PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED',
        'PARTNER_DOCUMENT_SCAN_RESULT_RECORDED',
        'PARTNER_DOCUMENT_RETROACTIVE_INFECTION_DETECTED',
        'STORAGE_TAG_HEALED',
        'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED',
      ],
    },
    previousState: {
      type: Schema.Types.Mixed,
      required: [true, 'previousState is required'],
    },
    newState: {
      type: Schema.Types.Mixed,
      required: [true, 'newState is required'],
    },
    reason: {
      type: String,
      required: [true, 'reason is required'],
      trim: true,
      minlength: [10, 'reason must be at least 10 characters'],
      maxlength: [500, 'reason cannot exceed 500 characters'],
    },
    metadata: {
      staffEmail: { type: String, trim: true },
      staffPhone: { type: String, trim: true },
      ipAddress: { type: String, trim: true },
      userAgent: { type: String, trim: true },
      correlationId: { type: String, trim: true },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'partner_audit_logs',
    autoIndex: true,
  },
);

// Query index for retrieving partner audit history chronologically
partnerAuditLogSchema.index(
  { partnerId: 1, createdAt: -1 },
  { name: 'idx_partner_audit_partner_created' },
);

/**
 * IMMUTABILITY GUARANTEE:
 * Partner audit records represent an immutable regulatory compliance ledger.
 * Application-level Mongoose middleware blocks document and query level modifications (update/delete).
 */
partnerAuditLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(
      new Error('PARTNER_AUDIT_LOG_IMMUTABLE: Partner audit log records cannot be modified'),
    );
  }
  next();
});

const blockMutation = function (this: unknown, next: (err?: Error) => void) {
  next(
    new Error(
      'PARTNER_AUDIT_LOG_IMMUTABLE: Partner audit log records cannot be modified or deleted',
    ),
  );
};

partnerAuditLogSchema.pre('updateOne', blockMutation);
partnerAuditLogSchema.pre('updateMany', blockMutation);
partnerAuditLogSchema.pre('findOneAndUpdate', blockMutation);
partnerAuditLogSchema.pre('replaceOne', blockMutation);
partnerAuditLogSchema.pre('deleteOne', blockMutation);
partnerAuditLogSchema.pre('deleteMany', blockMutation);
partnerAuditLogSchema.pre('findOneAndDelete', blockMutation);
partnerAuditLogSchema.pre('findOneAndReplace', blockMutation);

export const PartnerAuditLogModel: Model<IPartnerAuditLogDocument> =
  mongoose.models.PartnerAuditLog ||
  mongoose.model<IPartnerAuditLogDocument>('PartnerAuditLog', partnerAuditLogSchema);

// Intercept Model.bulkWrite to block update/delete/replace operations
const originalBulkWrite = PartnerAuditLogModel.bulkWrite.bind(PartnerAuditLogModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PartnerAuditLogModel.bulkWrite = function (ops: any[], options?: any) {
  if (Array.isArray(ops)) {
    for (const op of ops) {
      if (op.updateOne || op.updateMany || op.deleteOne || op.deleteMany || op.replaceOne) {
        throw new Error(
          'PARTNER_AUDIT_LOG_IMMUTABLE: Partner audit log records cannot be modified or deleted via bulkWrite',
        );
      }
    }
  }
  return originalBulkWrite(ops, options);
} as typeof PartnerAuditLogModel.bulkWrite;

// Intercept Model.bulkSave to block modifying existing records
const originalBulkSave = PartnerAuditLogModel.bulkSave.bind(PartnerAuditLogModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PartnerAuditLogModel.bulkSave = function (docs: any[], options?: any) {
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && !doc.isNew) {
        throw new Error(
          'PARTNER_AUDIT_LOG_IMMUTABLE: Partner audit log records cannot be modified via bulkSave',
        );
      }
    }
  }
  return originalBulkSave(docs, options);
} as typeof PartnerAuditLogModel.bulkSave;
