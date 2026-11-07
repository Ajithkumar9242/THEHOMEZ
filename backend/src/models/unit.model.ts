import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  type UnitClassification,
  UNIT_CODE_REGEX,
  MAX_UNIT_NAME_LENGTH,
  MAX_UNIT_DESCRIPTION_LENGTH,
  MAX_ALLOWED_QUANTITY_PRECISION,
} from '@thehomez/shared-types';

export interface IUnitDocument extends Document {
  code: string;
  name: string;
  symbol: string;
  singularLabel: string;
  pluralLabel: string;
  description?: string;
  classification: UnitClassification;
  isDiscrete: boolean;
  allowedMaxPrecision: number;
  isActive: boolean;
  isSystem: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const unitSchema = new Schema<IUnitDocument>(
  {
    code: {
      type: String,
      required: [true, 'Unit code is required'],
      trim: true,
      uppercase: true,
      match: [
        UNIT_CODE_REGEX,
        'Unit code must be uppercase alphanumeric with underscores (2-20 characters)',
      ],
    },
    name: {
      type: String,
      required: [true, 'Unit name is required'],
      trim: true,
      maxlength: [MAX_UNIT_NAME_LENGTH, `Name cannot exceed ${MAX_UNIT_NAME_LENGTH} characters`],
    },
    symbol: {
      type: String,
      required: [true, 'Unit symbol abbreviation is required'],
      trim: true,
      maxlength: [10, 'Symbol cannot exceed 10 characters'],
    },
    singularLabel: {
      type: String,
      required: [true, 'Singular label is required'],
      trim: true,
      maxlength: [50, 'Singular label cannot exceed 50 characters'],
    },
    pluralLabel: {
      type: String,
      required: [true, 'Plural label is required'],
      trim: true,
      maxlength: [50, 'Plural label cannot exceed 50 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [
        MAX_UNIT_DESCRIPTION_LENGTH,
        `Description cannot exceed ${MAX_UNIT_DESCRIPTION_LENGTH} characters`,
      ],
      default: undefined,
    },
    classification: {
      type: String,
      required: [true, 'Classification is required'],
      enum: ['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME'],
    },
    isDiscrete: {
      type: Boolean,
      required: true,
      default: false,
    },
    allowedMaxPrecision: {
      type: Number,
      required: true,
      min: [0, 'Precision ceiling cannot be negative'],
      max: [
        MAX_ALLOWED_QUANTITY_PRECISION,
        `Precision ceiling cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
      ],
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    isSystem: {
      type: Boolean,
      required: true,
      default: true,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'units',
    autoIndex: true,
  },
);

/**
 * Pre-validate Hook:
 * Ensures uppercase code and enforces discrete unit invariants.
 */
unitSchema.pre('validate', function (next) {
  if (this.code && typeof this.code === 'string') {
    this.code = this.code.trim().toUpperCase();
  }
  if (this.isDiscrete && this.allowedMaxPrecision > 0) {
    return next(
      new Error('Discrete units cannot have decimal precision (allowedMaxPrecision must be 0)'),
    );
  }
  if (this.classification === 'COUNT') {
    this.isDiscrete = true;
    if (this.allowedMaxPrecision > 0) {
      return next(
        new Error('Discrete units cannot have decimal precision (allowedMaxPrecision must be 0)'),
      );
    }
    this.allowedMaxPrecision = 0;
  }
  next();
});

/**
 * Indexes
 */
unitSchema.index({ code: 1 }, { unique: true, name: 'unique_unit_code' });
unitSchema.index({ classification: 1, isActive: 1 }, { name: 'classification_1_isActive_1' });

export const UnitModel: Model<IUnitDocument> =
  mongoose.models.Unit || mongoose.model<IUnitDocument>('Unit', unitSchema);
