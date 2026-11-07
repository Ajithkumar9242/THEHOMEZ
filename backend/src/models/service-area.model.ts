import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { PINCODE_REGEX, MAX_PINCODES_PER_SERVICE_AREA } from '@thehomez/shared-types';

export interface IServiceAreaDocument extends Document {
  code: string;
  name: string;
  city: string;
  state: string;
  countryCode: string;
  pincodes: string[];
  deliveryRadiusKm?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const serviceAreaSchema = new Schema<IServiceAreaDocument>(
  {
    code: {
      type: String,
      required: [true, 'Service area code is required'],
      uppercase: true,
      trim: true,
      set: (val: string): string => (typeof val === 'string' ? val.trim().toUpperCase() : val),
      match: [
        /^[A-Z0-9_-]{3,32}$/,
        'Service area code must be 3-32 characters of uppercase letters, numbers, hyphens or underscores',
      ],
    },
    name: {
      type: String,
      required: [true, 'Service area name is required'],
      trim: true,
      maxlength: [100, 'Service area name cannot exceed 100 characters'],
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      maxlength: [100, 'City cannot exceed 100 characters'],
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      maxlength: [100, 'State cannot exceed 100 characters'],
    },
    countryCode: {
      type: String,
      required: [true, 'Country code is required'],
      default: 'IN',
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 2,
    },
    pincodes: {
      type: [String],
      required: [true, 'PIN codes array is required'],
      validate: [
        {
          validator(pins: string[]): boolean {
            return Array.isArray(pins) && pins.length <= MAX_PINCODES_PER_SERVICE_AREA;
          },
          message: `PIN codes array exceeds technical maximum limit of ${MAX_PINCODES_PER_SERVICE_AREA}`,
        },
        {
          validator(pins: string[]): boolean {
            return pins.every((pin) => typeof pin === 'string' && PINCODE_REGEX.test(pin));
          },
          message: 'All PIN codes must be valid 6-digit Indian postal codes',
        },
        {
          validator(pins: string[]): boolean {
            return new Set(pins).size === pins.length;
          },
          message: 'Duplicate PIN codes within the same service area are not permitted',
        },
      ],
      default: [],
    },
    deliveryRadiusKm: {
      type: Number,
      min: [0, 'Delivery radius must be non-negative'],
      max: [500, 'Delivery radius cannot exceed 500 km'],
      default: undefined,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'service_areas',
    autoIndex: true,
  },
);

/**
 * Pre-validation hook: Guarantees that code is trimmed and capitalized before validation.
 */
serviceAreaSchema.pre('validate', function (next) {
  if (this.code && typeof this.code === 'string') {
    this.code = this.code.trim().toUpperCase();
  }
  next();
});

/**
 * Case-Insensitive Unique Index on service area code:
 * Collation with strength 2 guarantees that 'BLR-EAST' and 'blr-east' cannot coexist
 * at the storage engine level.
 */
serviceAreaSchema.index(
  { code: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_code_ci',
  },
);

/**
 * Partial Unique Multikey Index on pincodes for active service areas:
 * Enforces at the database storage engine level that no active PIN code can be assigned
 * to more than one active service area simultaneously.
 * When isActive is false, documents are excluded from this index, allowing inactive areas
 * to stage PIN codes without conflicting with operational hubs.
 */
serviceAreaSchema.index(
  { pincodes: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'unique_active_pincodes',
  },
);

/**
 * Compound index for regional administrative filtering.
 */
serviceAreaSchema.index({ city: 1, isActive: 1 });

export const ServiceAreaModel: Model<IServiceAreaDocument> =
  mongoose.models.ServiceArea ||
  mongoose.model<IServiceAreaDocument>('ServiceArea', serviceAreaSchema);
