import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import {
  type PricingScope,
  type IB2BVolumeTier,
  MAX_B2B_VOLUME_TIERS,
} from '@thehomez/shared-types';

export interface IProductPricingDocument extends Document {
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  serviceAreaId: Types.ObjectId | null;
  pricingScope: PricingScope;
  currency: 'INR';
  b2cPricePaise: number;
  b2cMrpPaise: number | null;
  b2bPricePaise: number | null;
  b2bTiers: IB2BVolumeTier[];
  isActive: boolean;
  version: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const b2bVolumeTierSchema = new Schema<IB2BVolumeTier>(
  {
    minQuantity: {
      type: String,
      required: [true, 'Tier minQuantity is required'],
      trim: true,
      maxlength: [15, 'Tier minQuantity cannot exceed 15 characters'],
      match: [/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Tier minQuantity must be a canonical decimal string'],
    },
    pricePaise: {
      type: Number,
      required: [true, 'Tier pricePaise is required'],
      min: [0, 'Tier pricePaise cannot be negative'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && Number.isSafeInteger(v),
        message: 'Tier pricePaise must be a safe integer',
      },
    },
  },
  { _id: false },
);

const productPricingSchema = new Schema<IProductPricingDocument>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'ProductId is required'],
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
      enum: {
        values: ['STANDALONE_GLOBAL', 'STANDALONE_REGIONAL', 'VARIANT_GLOBAL', 'VARIANT_REGIONAL'],
        message: 'Invalid pricing scope: {VALUE}',
      },
      index: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
      trim: true,
      enum: ['INR'],
    },
    b2cPricePaise: {
      type: Number,
      required: [true, 'b2cPricePaise is required'],
      min: [0, 'b2cPricePaise must be non-negative'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && Number.isSafeInteger(v),
        message: 'b2cPricePaise must be a safe integer',
      },
    },
    b2cMrpPaise: {
      type: Number,
      default: null,
      min: [0, 'b2cMrpPaise must be non-negative'],
      validate: [
        {
          validator: (v: number | null) =>
            v === null || (Number.isInteger(v) && Number.isSafeInteger(v)),
          message: 'b2cMrpPaise must be a safe integer when provided',
        },
        {
          validator: function (this: IProductPricingDocument, v: number | null) {
            if (v === null || v === undefined) return true;
            return v >= this.b2cPricePaise;
          },
          message: 'b2cMrpPaise cannot be less than b2cPricePaise',
        },
      ],
    },
    b2bPricePaise: {
      type: Number,
      default: null,
      min: [0, 'b2bPricePaise must be non-negative'],
      validate: {
        validator: (v: number | null) =>
          v === null || (Number.isInteger(v) && Number.isSafeInteger(v)),
        message: 'b2bPricePaise must be a safe integer when provided',
      },
    },
    b2bTiers: {
      type: [b2bVolumeTierSchema],
      default: [],
      validate: [
        {
          validator: (tiers: IB2BVolumeTier[]) => tiers.length <= MAX_B2B_VOLUME_TIERS,
          message: `b2bTiers cannot exceed ${MAX_B2B_VOLUME_TIERS} volume slabs`,
        },
        {
          validator: function (this: IProductPricingDocument, tiers: IB2BVolumeTier[]) {
            if (tiers && tiers.length > 0) {
              return this.b2bPricePaise !== null && this.b2bPricePaise !== undefined;
            }
            return true;
          },
          message: 'b2bPricePaise is mandatory when b2bTiers are configured',
        },
      ],
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'createdBy is required'],
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'updatedBy is required'],
    },
  },
  {
    timestamps: true,
    collection: 'product_pricing',
    autoIndex: true,
  },
);

// Pre-validate hook strictly enforcing pricingScope consistency and database-backed entity pairing
productPricingSchema.pre('validate', async function () {
  // 1. Structural Scope Field Validation
  if (this.pricingScope === 'STANDALONE_GLOBAL') {
    if (this.variantId !== null || this.serviceAreaId !== null) {
      throw new Error(
        'INVALID_PRICING_SCOPE_FIELDS: STANDALONE_GLOBAL pricing must have variantId: null and serviceAreaId: null',
      );
    }
  } else if (this.pricingScope === 'STANDALONE_REGIONAL') {
    if (this.variantId !== null || !this.serviceAreaId) {
      throw new Error(
        'INVALID_PRICING_SCOPE_FIELDS: STANDALONE_REGIONAL pricing must have variantId: null and a valid serviceAreaId',
      );
    }
  } else if (this.pricingScope === 'VARIANT_GLOBAL') {
    if (!this.variantId || this.serviceAreaId !== null) {
      throw new Error(
        'INVALID_PRICING_SCOPE_FIELDS: VARIANT_GLOBAL pricing must have a valid variantId and serviceAreaId: null',
      );
    }
  } else if (this.pricingScope === 'VARIANT_REGIONAL') {
    if (!this.variantId || !this.serviceAreaId) {
      throw new Error(
        'INVALID_PRICING_SCOPE_FIELDS: VARIANT_REGIONAL pricing must have both a valid variantId and a valid serviceAreaId',
      );
    }
  }

  // 2. Database-backed Variant/Product Identity Consistency
  // Active when variantId is present (VARIANT_GLOBAL / VARIANT_REGIONAL)
  if (this.variantId) {
    const ProductVariantModel = mongoose.models.ProductVariant;
    if (ProductVariantModel && mongoose.connection.readyState === 1) {
      const variant = await ProductVariantModel.findById(this.variantId).select('productId');
      if (!variant) {
        throw new Error(
          'VARIANT_NOT_FOUND: The referenced variantId does not exist in the database',
        );
      }
      if (!variant.productId.equals(this.productId)) {
        throw new Error(
          'VARIANT_DOES_NOT_BELONG_TO_PRODUCT: The referenced variant belongs to a different product',
        );
      }
    }
  }

  // 3. Database-backed Standalone Pricing Guard (Cannot assign standalone pricing to multi-variant parents)
  if (!this.variantId && this.productId) {
    const ProductModel = mongoose.models.Product;
    if (ProductModel && mongoose.connection.readyState === 1) {
      const product = await ProductModel.findById(this.productId).select('hasVariants');
      if (product && product.hasVariants === true) {
        throw new Error(
          'PARENT_CONTAINER_CANNOT_HAVE_PRICE: Standalone pricing cannot be assigned to multi-variant parent products',
        );
      }
    }
  }
});

// 1. Standalone Product Global Pricing (Exactly 1 global price per standalone product)
productPricingSchema.index(
  { productId: 1 },
  {
    unique: true,
    name: 'unique_standalone_global_pricing',
    partialFilterExpression: { pricingScope: 'STANDALONE_GLOBAL' },
  },
);

// 2. Standalone Product Regional Override (Exactly 1 price per standalone product per service area)
productPricingSchema.index(
  { productId: 1, serviceAreaId: 1 },
  {
    unique: true,
    name: 'unique_standalone_regional_pricing',
    partialFilterExpression: { pricingScope: 'STANDALONE_REGIONAL' },
  },
);

// 3. Variant Global Pricing (Exactly 1 global price per variant)
productPricingSchema.index(
  { variantId: 1 },
  {
    unique: true,
    name: 'unique_variant_global_pricing',
    partialFilterExpression: { pricingScope: 'VARIANT_GLOBAL' },
  },
);

// 4. Variant Regional Override (Exactly 1 price per variant per service area)
productPricingSchema.index(
  { variantId: 1, serviceAreaId: 1 },
  {
    unique: true,
    name: 'unique_variant_regional_pricing',
    partialFilterExpression: { pricingScope: 'VARIANT_REGIONAL' },
  },
);

// 5. Compound index for active pricing lookup across scopes
productPricingSchema.index(
  { productId: 1, variantId: 1, pricingScope: 1, isActive: 1 },
  { name: 'idx_pricing_scope_active' },
);

export const ProductPricingModel: Model<IProductPricingDocument> =
  mongoose.models.ProductPricing ||
  mongoose.model<IProductPricingDocument>('ProductPricing', productPricingSchema);
