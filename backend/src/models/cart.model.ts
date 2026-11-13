import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import {
  CART_OWNER_TYPES,
  DECIMAL_STRING_REGEX,
  MAX_CART_ITEMS,
  MAX_QUANTITY_STRING_LENGTH,
  PINCODE_REGEX,
  type CartOwnerType,
} from '@thehomez/shared-types';

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

export interface ICartItemSubdocument {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  quantity: string;
  acknowledgedUnitPricePaise: number | null;
  acknowledgedPincode?: string | null;
  addedAt: Date;
}

export interface ICartDocument extends Document {
  ownerType: CartOwnerType;
  userId: Types.ObjectId | null;
  sessionTokenHash: string | null;
  pincode: string | null;
  items: ICartItemSubdocument[];
  version: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItemSubdocument>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'productId is required'],
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductVariant',
      default: null,
    },
    quantity: {
      type: String,
      required: [true, 'quantity is required'],
      trim: true,
      maxlength: [
        MAX_QUANTITY_STRING_LENGTH,
        `quantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
      ],
      match: [DECIMAL_STRING_REGEX, 'quantity must be a valid canonical decimal string'],
    },
    acknowledgedUnitPricePaise: {
      type: Number,
      default: null,
      validate: {
        validator: (val: number | null | undefined): boolean =>
          val === null ||
          val === undefined ||
          (typeof val === 'number' && Number.isInteger(val) && Number.isSafeInteger(val) && val > 0),
        message: 'acknowledgedUnitPricePaise must be null or a positive safe integer in paise',
      },
    },
    acknowledgedPincode: {
      type: String, default: null,
      validate: { validator: (val: string | null | undefined): boolean => val == null || PINCODE_REGEX.test(val),
        message: 'acknowledgedPincode must be a valid 6-digit Indian postal code' },
    },
    addedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { _id: true },
);

const cartSchema = new Schema<ICartDocument>(
  {
    ownerType: {
      type: String,
      required: [true, 'ownerType is required'],
      enum: {
        values: CART_OWNER_TYPES,
        message: 'ownerType must be USER or GUEST',
      },
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    sessionTokenHash: {
      type: String,
      default: null,
      validate: {
        validator: (val: string | null | undefined): boolean =>
          val === null || val === undefined || SHA256_HEX_REGEX.test(val),
        message: 'sessionTokenHash must be a SHA-256 hex digest',
      },
    },
    pincode: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: (val: string | null | undefined): boolean =>
          val === null || val === undefined || PINCODE_REGEX.test(val),
        message: 'pincode must be a valid 6-digit Indian postal code',
      },
    },
    items: {
      type: [cartItemSchema],
      default: [],
      validate: [
        {
          validator: (val: ICartItemSubdocument[]): boolean =>
            Array.isArray(val) && val.length <= MAX_CART_ITEMS,
          message: `Cart cannot contain more than ${MAX_CART_ITEMS} items`,
        },
      ],
    },
    version: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'version cannot be negative'],
      validate: {
        validator: (val: number): boolean => Number.isInteger(val),
        message: 'version must be an integer',
      },
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'carts',
  },
);

cartSchema.pre('validate', function validateCartOwnerInvariant(next) {
  if (this.ownerType === 'USER') {
    if (!this.userId) {
      this.invalidate('userId', 'USER cart must reference a userId');
    }
    if (this.sessionTokenHash !== null) {
      this.invalidate('sessionTokenHash', 'USER cart cannot store sessionTokenHash');
    }
    if (this.expiresAt !== null) {
      this.invalidate('expiresAt', 'USER cart cannot set expiresAt');
    }
  } else if (this.ownerType === 'GUEST') {
    if (!this.sessionTokenHash) {
      this.invalidate('sessionTokenHash', 'GUEST cart must reference sessionTokenHash');
    }
    if (this.userId !== null) {
      this.invalidate('userId', 'GUEST cart cannot set userId');
    }
    if (!this.expiresAt) {
      this.invalidate('expiresAt', 'GUEST cart must set expiresAt');
    }
  }
  next();
});

cartSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { ownerType: 'USER' },
    name: 'unique_user_cart',
  },
);

cartSchema.index(
  { sessionTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { ownerType: 'GUEST' },
    name: 'unique_guest_cart',
  },
);

cartSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { ownerType: 'GUEST' },
    name: 'ttl_guest_cart',
  },
);

export const CartModel: Model<ICartDocument> =
  mongoose.models.Cart || mongoose.model<ICartDocument>('Cart', cartSchema);
