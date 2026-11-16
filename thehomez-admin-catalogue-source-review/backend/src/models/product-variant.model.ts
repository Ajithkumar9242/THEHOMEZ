import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  type ProductVariantStatus,
  MAX_VARIANT_ATTRIBUTES,
  MAX_VARIANT_IMAGES,
  DECIMAL_STRING_REGEX,
  MAX_ALLOWED_QUANTITY_PRECISION,
} from '@thehomez/shared-types';

export interface IProductVariantDocument extends Document {
  productId: mongoose.Types.ObjectId;
  sku: string;
  title: string;
  status: ProductVariantStatus;
  attributes: Record<string, string>;
  images: string[];
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const productVariantSchema = new Schema<IProductVariantDocument>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
    },
    sku: {
      type: String,
      required: [true, 'Variant SKU is required'],
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: [true, 'Variant title is required'],
      trim: true,
      minlength: [1, 'Variant title cannot be empty'],
      maxlength: [200, 'Variant title cannot exceed 200 characters'],
    },
    status: {
      type: String,
      required: true,
      enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'],
      default: 'DRAFT',
    },
    attributes: {
      type: Map,
      of: String,
      required: [true, 'Variant attributes map is required'],
      validate: [
        (val: Map<string, string>) => val && val.size >= 1 && val.size <= MAX_VARIANT_ATTRIBUTES,
        `Attributes must contain between 1 and ${MAX_VARIANT_ATTRIBUTES} key-value pairs`,
      ],
    },
    images: {
      type: [String],
      default: [],
      validate: [
        (val: string[]) => val.length <= MAX_VARIANT_IMAGES,
        `Images cannot exceed ${MAX_VARIANT_IMAGES} URLs`,
      ],
    },
    unitCode: {
      type: String,
      trim: true,
      uppercase: true,
      ref: 'Unit',
      default: null,
    },
    quantityPrecision: {
      type: Number,
      min: [0, 'quantityPrecision cannot be negative'],
      max: [
        MAX_ALLOWED_QUANTITY_PRECISION,
        `quantityPrecision cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
      ],
      default: null,
    },
    minOrderQuantity: {
      type: String,
      trim: true,
      match: [DECIMAL_STRING_REGEX, 'minOrderQuantity must be a valid canonical decimal string'],
      default: null,
    },
    maxOrderQuantity: {
      type: String,
      trim: true,
      match: [DECIMAL_STRING_REGEX, 'maxOrderQuantity must be a valid canonical decimal string'],
      default: null,
    },
    stepIncrement: {
      type: String,
      trim: true,
      match: [DECIMAL_STRING_REGEX, 'stepIncrement must be a valid canonical decimal string'],
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'product_variants',
    autoIndex: true,
  },
);

/**
 * Pre-validate hook:
 * Ensures sku is strictly trimmed and uppercase.
 */
productVariantSchema.pre('validate', function (next) {
  if (this.sku && typeof this.sku === 'string') {
    this.sku = this.sku.trim().toUpperCase();
  }
  next();
});

/**
 * Compound Query Index for Product-level Variant Filtering:
 */
productVariantSchema.index({ productId: 1, status: 1 }, { name: 'productId_1_status_1' });

/**
 * Secondary Index for Variant SKU lookups:
 * (Authoritative unique enforcement across all products and variants resides in sku_registry)
 */
productVariantSchema.index({ sku: 1 }, { name: 'sku_1' });

productVariantSchema.index({ unitCode: 1 }, { name: 'unitCode_1' });

export const ProductVariantModel: Model<IProductVariantDocument> =
  mongoose.models.ProductVariant ||
  mongoose.model<IProductVariantDocument>('ProductVariant', productVariantSchema);
