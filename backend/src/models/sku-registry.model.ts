import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  type SkuRegistryStatus,
  type SkuEntityType,
  CANONICAL_SKU_REGEX,
  MAX_SKU_LENGTH,
} from '@thehomez/shared-types';

export interface ISkuRegistryDocument extends Document {
  sku: string;
  normalizedSku: string;
  entityType: SkuEntityType;
  entityId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  status: SkuRegistryStatus;
  createdAt: Date;
  updatedAt: Date;
}

const skuRegistrySchema = new Schema<ISkuRegistryDocument>(
  {
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      trim: true,
      maxlength: [MAX_SKU_LENGTH, `SKU cannot exceed ${MAX_SKU_LENGTH} characters`],
      match: [
        CANONICAL_SKU_REGEX,
        'SKU must be 4-64 alphanumeric characters, hyphens or underscores, starting and ending with alphanumeric',
      ],
    },
    normalizedSku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    entityType: {
      type: String,
      required: true,
      enum: ['PRODUCT', 'VARIANT'],
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'entityType',
    },
    productId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Product',
    },
    status: {
      type: String,
      required: true,
      enum: ['RESERVED', 'ASSIGNED', 'ARCHIVED'],
      default: 'RESERVED',
    },
  },
  {
    timestamps: true,
    collection: 'sku_registry',
    autoIndex: true,
  },
);

/**
 * Pre-validation hook:
 * Ensures normalizedSku is strictly uppercase trimmed before validation and indexing.
 */
skuRegistrySchema.pre('validate', function (next) {
  if (this.sku && typeof this.sku === 'string') {
    this.sku = this.sku.trim();
    this.normalizedSku = this.sku.toUpperCase();
  }
  next();
});

/**
 * Catalogue-Wide Case-Insensitive Unique Index on normalizedSku:
 * Collation strength 2 ensures cross-collection uniqueness across products and variants.
 */
skuRegistrySchema.index(
  { normalizedSku: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_normalized_sku',
  },
);

/**
 * Unique Entity Ownership Index:
 * Guarantees an entity (Product or Variant) can have at most one active registry record.
 */
skuRegistrySchema.index(
  { entityId: 1, entityType: 1 },
  {
    unique: true,
    name: 'unique_entity_ownership',
  },
);

/**
 * Query Index for Product-level Variant Lookups and Cascades:
 */
skuRegistrySchema.index({ productId: 1, status: 1 }, { name: 'productId_1_status_1' });

export const SkuRegistryModel: Model<ISkuRegistryDocument> =
  mongoose.models.SkuRegistry ||
  mongoose.model<ISkuRegistryDocument>('SkuRegistry', skuRegistrySchema);
