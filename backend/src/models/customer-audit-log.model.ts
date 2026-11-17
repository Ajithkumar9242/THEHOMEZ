import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export type CustomerAuditAction =
  'CUSTOMER_STATUS_CHANGED' | 'CUSTOMER_B2B_VERIFIED' | 'CUSTOMER_B2B_REVOKED';

export interface ICustomerAuditLogDocument extends Document {
  staffUserId: Types.ObjectId;
  targetCustomerId: Types.ObjectId;
  action: CustomerAuditAction;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  reason: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const customerAuditLogSchema = new Schema<ICustomerAuditLogDocument>(
  {
    staffUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'staffUserId is required'],
      index: true,
    },
    targetCustomerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'targetCustomerId is required'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'action is required'],
      enum: ['CUSTOMER_STATUS_CHANGED', 'CUSTOMER_B2B_VERIFIED', 'CUSTOMER_B2B_REVOKED'],
      index: true,
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
      maxlength: [500, 'reason cannot exceed 500 characters'],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'customer_audit_logs',
    autoIndex: true,
  },
);

customerAuditLogSchema.index({ targetCustomerId: 1, createdAt: -1 });
customerAuditLogSchema.index({ staffUserId: 1, createdAt: -1 });

export const CustomerAuditLogModel: Model<ICustomerAuditLogDocument> =
  mongoose.models.CustomerAuditLog ||
  mongoose.model<ICustomerAuditLogDocument>('CustomerAuditLog', customerAuditLogSchema);
