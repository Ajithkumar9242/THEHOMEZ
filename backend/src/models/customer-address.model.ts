import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import {
  PINCODE_REGEX,
  E164_PHONE_REGEX,
  ADDRESS_LABEL_MIN_LENGTH,
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_RECIPIENT_MIN_LENGTH,
  ADDRESS_RECIPIENT_MAX_LENGTH,
  ADDRESS_STREET_MIN_LENGTH,
  ADDRESS_STREET_MAX_LENGTH,
  ADDRESS_LANDMARK_MAX_LENGTH,
  ADDRESS_CITY_MIN_LENGTH,
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_STATE_MIN_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH,
  ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH,
  ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH,
} from '@thehomez/shared-types';

export interface ISiteContactPersonSubdoc {
  name: string;
  phone: string;
}

export interface ICustomerAddressDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  label: string;
  recipientName: string;
  phone: string;
  streetAddress: string;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  siteContactPerson?: ISiteContactPersonSubdoc | null;
  heavyVehicleAccessInstructions?: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const siteContactPersonSchema = new Schema<ISiteContactPersonSubdoc>(
  {
    name: {
      type: String,
      required: [true, 'Site contact name is required'],
      trim: true,
      minlength: [
        ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH,
        `Site contact name must be at least ${ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH} characters`,
      ],
      maxlength: [
        ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH,
        `Site contact name cannot exceed ${ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH} characters`,
      ],
    },
    phone: {
      type: String,
      required: [true, 'Site contact phone is required'],
      trim: true,
      match: [E164_PHONE_REGEX, 'Site contact phone must be in valid E.164 format'],
    },
  },
  { _id: false },
);

const customerAddressSchema = new Schema<ICustomerAddressDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer userId is required'],
      immutable: true,
      index: true,
    },
    label: {
      type: String,
      required: [true, 'Address label is required'],
      trim: true,
      minlength: [
        ADDRESS_LABEL_MIN_LENGTH,
        `Address label must be at least ${ADDRESS_LABEL_MIN_LENGTH} character`,
      ],
      maxlength: [
        ADDRESS_LABEL_MAX_LENGTH,
        `Address label cannot exceed ${ADDRESS_LABEL_MAX_LENGTH} characters`,
      ],
    },
    recipientName: {
      type: String,
      required: [true, 'Recipient name is required'],
      trim: true,
      minlength: [
        ADDRESS_RECIPIENT_MIN_LENGTH,
        `Recipient name must be at least ${ADDRESS_RECIPIENT_MIN_LENGTH} characters`,
      ],
      maxlength: [
        ADDRESS_RECIPIENT_MAX_LENGTH,
        `Recipient name cannot exceed ${ADDRESS_RECIPIENT_MAX_LENGTH} characters`,
      ],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [E164_PHONE_REGEX, 'Phone number must be in valid E.164 format'],
    },
    streetAddress: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true,
      minlength: [
        ADDRESS_STREET_MIN_LENGTH,
        `Street address must be at least ${ADDRESS_STREET_MIN_LENGTH} characters`,
      ],
      maxlength: [
        ADDRESS_STREET_MAX_LENGTH,
        `Street address cannot exceed ${ADDRESS_STREET_MAX_LENGTH} characters`,
      ],
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: [
        ADDRESS_LANDMARK_MAX_LENGTH,
        `Landmark cannot exceed ${ADDRESS_LANDMARK_MAX_LENGTH} characters`,
      ],
      default: null,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      minlength: [
        ADDRESS_CITY_MIN_LENGTH,
        `City must be at least ${ADDRESS_CITY_MIN_LENGTH} characters`,
      ],
      maxlength: [
        ADDRESS_CITY_MAX_LENGTH,
        `City cannot exceed ${ADDRESS_CITY_MAX_LENGTH} characters`,
      ],
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      minlength: [
        ADDRESS_STATE_MIN_LENGTH,
        `State must be at least ${ADDRESS_STATE_MIN_LENGTH} characters`,
      ],
      maxlength: [
        ADDRESS_STATE_MAX_LENGTH,
        `State cannot exceed ${ADDRESS_STATE_MAX_LENGTH} characters`,
      ],
    },
    pincode: {
      type: String,
      required: [true, 'PIN code is required'],
      trim: true,
      match: [PINCODE_REGEX, 'Pincode must be a valid 6-digit Indian postal code'],
    },
    siteContactPerson: {
      type: siteContactPersonSchema,
      required: false,
      default: null,
    },
    heavyVehicleAccessInstructions: {
      type: String,
      trim: true,
      maxlength: [
        ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH,
        `Heavy vehicle access instructions cannot exceed ${ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH} characters`,
      ],
      default: null,
    },
    isDefault: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'customer_addresses',
    autoIndex: true,
  },
);

/**
 * Supports ordered customer address book listing (default address first, then most recently updated).
 */
customerAddressSchema.index(
  { userId: 1, isDefault: -1, updatedAt: -1 },
  { name: 'idx_customer_addresses_list' },
);

/**
 * Enforces at most one default address per customer at the MongoDB storage engine level.
 */
customerAddressSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
    name: 'unique_customer_default_address',
  },
);

export const CustomerAddressModel: Model<ICustomerAddressDocument> =
  mongoose.models.CustomerAddress ||
  mongoose.model<ICustomerAddressDocument>('CustomerAddress', customerAddressSchema);
