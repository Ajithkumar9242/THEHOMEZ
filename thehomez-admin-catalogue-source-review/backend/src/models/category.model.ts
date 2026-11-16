import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  CATEGORY_SLUG_REGEX,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_DESC_LENGTH,
  MAX_CATEGORY_SLUG_LENGTH,
} from '@thehomez/shared-types';

export interface ICategoryDocument extends Document {
  slug: string;
  name: string;
  description?: string;
  parentId?: mongoose.Types.ObjectId | null;
  level: 0 | 1;
  displayOrder: number;
  isActive: boolean;
  iconUrl?: string;
  imageUrl?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategoryDocument>(
  {
    slug: {
      type: String,
      required: [true, 'Category slug is required'],
      lowercase: true,
      trim: true,
      set: (val: string): string => (typeof val === 'string' ? val.trim().toLowerCase() : val),
      match: [
        CATEGORY_SLUG_REGEX,
        'Slug must consist of lowercase alphanumeric words separated by hyphens',
      ],
      maxlength: [
        MAX_CATEGORY_SLUG_LENGTH,
        `Slug cannot exceed ${MAX_CATEGORY_SLUG_LENGTH} characters`,
      ],
    },
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: [
        MAX_CATEGORY_NAME_LENGTH,
        `Category name cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters`,
      ],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [
        MAX_CATEGORY_DESC_LENGTH,
        `Description cannot exceed ${MAX_CATEGORY_DESC_LENGTH} characters`,
      ],
      default: undefined,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    level: {
      type: Number,
      required: true,
      enum: [0, 1],
      default: 0,
    },
    displayOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    iconUrl: {
      type: String,
      trim: true,
      maxlength: [500, 'Icon URL cannot exceed 500 characters'],
      default: undefined,
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: [500, 'Image URL cannot exceed 500 characters'],
      default: undefined,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'categories',
    autoIndex: true,
  },
);

/**
 * Pre-validation hook:
 * Normalizes slug to lower-case trimmed string and derives level.
 */
categorySchema.pre('validate', function (next) {
  if (this.slug && typeof this.slug === 'string') {
    this.slug = this.slug.trim().toLowerCase();
  }
  if (this.parentId) {
    this.level = 1;
  } else {
    this.level = 0;
    this.parentId = null;
  }
  next();
});

/**
 * Case-Insensitive Unique Index on slug:
 * Collation with strength 2 guarantees that 'cement' and 'CEMENT' cannot coexist
 * at the storage engine level.
 */
categorySchema.index(
  { slug: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_category_slug_ci',
  },
);

/**
 * Hierarchical Traversal Indexes:
 * 1. Compound index on parentId + isActive + displayOrder for tree rendering.
 * 2. Compound index on level + isActive + displayOrder for root category discovery.
 */
categorySchema.index(
  { parentId: 1, isActive: 1, displayOrder: 1 },
  { name: 'parentId_1_isActive_1_displayOrder_1' },
);
categorySchema.index(
  { level: 1, isActive: 1, displayOrder: 1 },
  { name: 'level_1_isActive_1_displayOrder_1' },
);

export const CategoryModel: Model<ICategoryDocument> =
  mongoose.models.Category || mongoose.model<ICategoryDocument>('Category', categorySchema);
