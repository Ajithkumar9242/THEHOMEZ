import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import {
  type PricingScope,
  type PriceHistoryAction,
  type IB2BVolumeTier,
} from '@thehomez/shared-types';

export interface IPriceHistoryDocument extends Document {
  pricingId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  serviceAreaId: Types.ObjectId | null;
  pricingScope: PricingScope;
  action: PriceHistoryAction;
  previousB2cPricePaise: number | null;
  newB2cPricePaise: number;
  previousB2cMrpPaise: number | null;
  newB2cMrpPaise: number | null;
  previousB2bPricePaise: number | null;
  newB2bPricePaise: number | null;
  previousTiers: IB2BVolumeTier[];
  newTiers: IB2BVolumeTier[];
  changeReason: string;
  changedBy: Types.ObjectId;
  createdAt: Date;
}

const b2bVolumeTierSchema = new Schema<IB2BVolumeTier>(
  {
    minQuantity: {
      type: String,
      required: true,
      trim: true,
    },
    pricePaise: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const priceHistorySchema = new Schema<IPriceHistoryDocument>(
  {
    pricingId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductPricing',
      required: [true, 'pricingId is required'],
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
      default: null,
      index: true,
    },
    pricingScope: {
      type: String,
      required: [true, 'pricingScope is required'],
      enum: ['STANDALONE_GLOBAL', 'STANDALONE_REGIONAL', 'VARIANT_GLOBAL', 'VARIANT_REGIONAL'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'action is required'],
      enum: ['CREATED', 'UPDATED', 'DEACTIVATED'],
    },
    previousB2cPricePaise: {
      type: Number,
      default: null,
    },
    newB2cPricePaise: {
      type: Number,
      required: [true, 'newB2cPricePaise is required'],
      min: [0, 'newB2cPricePaise must be non-negative'],
    },
    previousB2cMrpPaise: {
      type: Number,
      default: null,
    },
    newB2cMrpPaise: {
      type: Number,
      default: null,
    },
    previousB2bPricePaise: {
      type: Number,
      default: null,
    },
    newB2bPricePaise: {
      type: Number,
      default: null,
    },
    previousTiers: {
      type: [b2bVolumeTierSchema],
      default: [],
    },
    newTiers: {
      type: [b2bVolumeTierSchema],
      default: [],
    },
    changeReason: {
      type: String,
      required: [true, 'changeReason is required'],
      trim: true,
      maxlength: [500, 'changeReason cannot exceed 500 characters'],
      validate: {
        validator: (v: string) => typeof v === 'string' && v.trim().length > 0,
        message: 'changeReason cannot be empty or whitespace only',
      },
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'changedBy is required'],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'price_history',
    autoIndex: true,
  },
);

// Append-only immutability guards: prevent all updates and deletions
priceHistorySchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified'));
  }
  next();
});

const blockMutation = function (this: unknown, next: (err?: Error) => void) {
  next(new Error('PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified or deleted'));
};

priceHistorySchema.pre('updateOne', blockMutation);
priceHistorySchema.pre('updateMany', blockMutation);
priceHistorySchema.pre('findOneAndUpdate', blockMutation);
priceHistorySchema.pre('replaceOne', blockMutation);
priceHistorySchema.pre('deleteOne', blockMutation);
priceHistorySchema.pre('deleteMany', blockMutation);
priceHistorySchema.pre('findOneAndDelete', blockMutation);
priceHistorySchema.pre('findOneAndReplace', blockMutation);

priceHistorySchema.index(
  { productId: 1, variantId: 1, createdAt: -1 },
  { name: 'idx_price_history_lookup' },
);

export const PriceHistoryModel: Model<IPriceHistoryDocument> =
  mongoose.models.PriceHistory ||
  mongoose.model<IPriceHistoryDocument>('PriceHistory', priceHistorySchema);

// Intercept Model.bulkWrite to block update/delete/replace operations
const originalBulkWrite = PriceHistoryModel.bulkWrite.bind(PriceHistoryModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PriceHistoryModel.bulkWrite = function (ops: any[], options?: any) {
  if (Array.isArray(ops)) {
    for (const op of ops) {
      if (op.updateOne || op.updateMany || op.deleteOne || op.deleteMany || op.replaceOne) {
        throw new Error(
          'PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified or deleted via bulkWrite',
        );
      }
    }
  }
  return originalBulkWrite(ops, options);
} as typeof PriceHistoryModel.bulkWrite;

// Intercept Model.bulkSave to block modifying existing records
const originalBulkSave = PriceHistoryModel.bulkSave.bind(PriceHistoryModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PriceHistoryModel.bulkSave = function (docs: any[], options?: any) {
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && !doc.isNew) {
        throw new Error(
          'PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified via bulkSave',
        );
      }
    }
  }
  return originalBulkSave(docs, options);
} as typeof PriceHistoryModel.bulkSave;
