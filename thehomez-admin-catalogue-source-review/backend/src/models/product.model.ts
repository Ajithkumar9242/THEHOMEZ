import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  type ProductStatus,
  PRODUCT_SLUG_REGEX,
  MAX_SPECIFICATION_KEYS,
  MAX_SPECIFICATION_VALUE_LENGTH,
  MAX_PRODUCT_IMAGES,
  DECIMAL_STRING_REGEX,
  MAX_ALLOWED_QUANTITY_PRECISION,
} from '@thehomez/shared-types';

export interface IProductDocument extends Document {
  slug: string;
  title: string;
  brand: string;
  description?: string;
  categoryId: mongoose.Types.ObjectId;
  subcategoryId: mongoose.Types.ObjectId;
  hasVariants: boolean;
  sku: string | null;
  status: ProductStatus;
  images: string[];
  specifications: Record<string, string>;
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
  publishedBy?: mongoose.Types.ObjectId | null;
  publishedAt: Date | null;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProductDocument>(
  {
    slug: {
      type: String,
      required: [true, 'Product slug is required'],
      lowercase: true,
      trim: true,
      match: [
        PRODUCT_SLUG_REGEX,
        'Slug must be lowercase alphanumeric words separated by single hyphens',
      ],
      maxlength: [100, 'Slug cannot exceed 100 characters'],
    },
    title: {
      type: String,
      required: [true, 'Product title is required'],
      trim: true,
      minlength: [1, 'Product title cannot be empty'],
      maxlength: [200, 'Product title cannot exceed 200 characters'],
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
      trim: true,
      minlength: [1, 'Brand cannot be empty'],
      maxlength: [100, 'Brand cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: undefined,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category ID is required'],
    },
    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Subcategory ID is required'],
    },
    hasVariants: {
      type: Boolean,
      required: true,
      default: false,
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'],
      default: 'DRAFT',
    },
    images: {
      type: [String],
      default: [],
      validate: [
        (val: string[]) => val.length <= MAX_PRODUCT_IMAGES,
        `Images cannot exceed ${MAX_PRODUCT_IMAGES} URLs`,
      ],
    },
    specifications: {
      type: Map,
      of: {
        type: String,
        maxlength: [
          MAX_SPECIFICATION_VALUE_LENGTH,
          `Value cannot exceed ${MAX_SPECIFICATION_VALUE_LENGTH} characters`,
        ],
      },
      default: {},
      validate: [
        (val: Map<string, string>) => (val ? val.size <= MAX_SPECIFICATION_KEYS : true),
        `Specifications cannot exceed ${MAX_SPECIFICATION_KEYS} entries`,
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
    publishedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'products',
    autoIndex: true,
  },
);

/**
 * Pre-validate hook:
 * Enforces slug normalization, uppercase sku for single items, and null sku for multi-variant items.
 */
productSchema.pre('validate', function (next) {
  if (this.slug && typeof this.slug === 'string') {
    this.slug = this.slug.trim().toLowerCase();
  }
  if (this.hasVariants) {
    this.sku = null;
  } else if (this.sku && typeof this.sku === 'string') {
    this.sku = this.sku.trim().toUpperCase();
  }
  next();
});

/**
 * Case-Insensitive Unique Index on product slug
 */
productSchema.index(
  { slug: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_product_slug_ci',
  },
);

/**
 * Compound Query Indexes
 */
productSchema.index({ brand: 1, status: 1 }, { name: 'brand_1_status_1' });
productSchema.index(
  { categoryId: 1, subcategoryId: 1, status: 1 },
  { name: 'categoryId_1_subcategoryId_1_status_1' },
);

/**
 * Text Index for keyword search
 */
productSchema.index(
  { title: 'text', brand: 'text', description: 'text' },
  { name: 'text_search_index' },
);

productSchema.index({ unitCode: 1 }, { name: 'unitCode_1' });

export const ProductModel: Model<IProductDocument> =
  mongoose.models.Product || mongoose.model<IProductDocument>('Product', productSchema);
