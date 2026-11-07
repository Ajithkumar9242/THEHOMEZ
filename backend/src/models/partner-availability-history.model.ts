import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface IPartnerAvailabilityHistoryDocument extends Document {
  partnerProductId: Types.ObjectId;
  partnerId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  serviceAreaId: Types.ObjectId;
  previousState: boolean | null;
  newState: boolean;
  reason?: string;
  changedBy: Types.ObjectId;
  createdAt: Date;
}

const partnerAvailabilityHistorySchema = new Schema<IPartnerAvailabilityHistoryDocument>(
  {
    partnerProductId: {
      type: Schema.Types.ObjectId,
      ref: 'PartnerProduct',
      required: [true, 'partnerProductId is required'],
      index: true,
    },
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      required: [true, 'partnerId is required'],
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'productId is required'],
      index: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductVariant',
      default: null,
      index: true,
    },
    serviceAreaId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceArea',
      required: [true, 'serviceAreaId is required'],
      index: true,
    },
    previousState: {
      type: Boolean,
      default: null,
    },
    newState: {
      type: Boolean,
      required: [true, 'newState is required'],
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [200, 'reason cannot exceed 200 characters'],
      default: undefined,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'changedBy is required'],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'partner_availability_history',
    autoIndex: true,
  },
);

// Query index for retrieving item history timeline chronologically
partnerAvailabilityHistorySchema.index(
  { partnerProductId: 1, createdAt: -1 },
  { name: 'idx_history_partner_product_created' },
);

/**
 * IMMUTABILITY GUARANTEE:
 * Partner availability history records represent an immutable operational audit log.
 * Application-level Mongoose middleware blocks document and query level modifications (update/delete).
 *
 * NOTE: Application-level Mongoose hooks provide defense-in-depth within the Node.js layer,
 * but do not replace production MongoDB database security configurations (such as
 * configuring database user roles without drop/delete privileges on audit collections).
 */
partnerAvailabilityHistorySchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(
      new Error(
        'PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified',
      ),
    );
  }
  next();
});

const blockMutation = function (this: unknown, next: (err?: Error) => void) {
  next(
    new Error(
      'PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted',
    ),
  );
};

partnerAvailabilityHistorySchema.pre('updateOne', blockMutation);
partnerAvailabilityHistorySchema.pre('updateMany', blockMutation);
partnerAvailabilityHistorySchema.pre('findOneAndUpdate', blockMutation);
partnerAvailabilityHistorySchema.pre('replaceOne', blockMutation);
partnerAvailabilityHistorySchema.pre('deleteOne', blockMutation);
partnerAvailabilityHistorySchema.pre('deleteMany', blockMutation);
partnerAvailabilityHistorySchema.pre('findOneAndDelete', blockMutation);
partnerAvailabilityHistorySchema.pre('findOneAndReplace', blockMutation);

export const PartnerAvailabilityHistoryModel: Model<IPartnerAvailabilityHistoryDocument> =
  mongoose.models.PartnerAvailabilityHistory ||
  mongoose.model<IPartnerAvailabilityHistoryDocument>(
    'PartnerAvailabilityHistory',
    partnerAvailabilityHistorySchema,
  );

// Intercept Model.bulkWrite to block update/delete/replace operations
const originalBulkWrite = PartnerAvailabilityHistoryModel.bulkWrite.bind(
  PartnerAvailabilityHistoryModel,
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PartnerAvailabilityHistoryModel.bulkWrite = function (ops: any[], options?: any) {
  if (Array.isArray(ops)) {
    for (const op of ops) {
      if (op.updateOne || op.updateMany || op.deleteOne || op.deleteMany || op.replaceOne) {
        throw new Error(
          'PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted via bulkWrite',
        );
      }
    }
  }
  return originalBulkWrite(ops, options);
} as typeof PartnerAvailabilityHistoryModel.bulkWrite;

// Intercept Model.bulkSave to block modifying existing records
const originalBulkSave = PartnerAvailabilityHistoryModel.bulkSave.bind(
  PartnerAvailabilityHistoryModel,
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PartnerAvailabilityHistoryModel.bulkSave = function (docs: any[], options?: any) {
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && !doc.isNew) {
        throw new Error(
          'PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified via bulkSave',
        );
      }
    }
  }
  return originalBulkSave(docs, options);
} as typeof PartnerAvailabilityHistoryModel.bulkSave;
