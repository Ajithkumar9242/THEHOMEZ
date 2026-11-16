import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface IPartnerProductDocument extends Document {
  _id: Types.ObjectId;
  partnerId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  serviceAreaId: Types.ObjectId;
  isAvailable: boolean;
  partnerCustomSku?: string;
  minLeadTimeHours: number;
  version: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const partnerProductSchema = new Schema<IPartnerProductDocument>(
  {
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Partner',
      required: [true, 'partnerId is required'],
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
      required: [true, 'serviceAreaId is required'],
      index: true,
    },
    isAvailable: {
      type: Boolean,
      required: [true, 'isAvailable is required'],
      default: true,
      index: true,
    },
    partnerCustomSku: {
      type: String,
      trim: true,
      maxlength: [50, 'partnerCustomSku cannot exceed 50 characters'],
      default: undefined,
    },
    minLeadTimeHours: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'minLeadTimeHours cannot be negative'],
      max: [720, 'minLeadTimeHours cannot exceed 720 hours (30 days)'],
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: 'minLeadTimeHours must be an integer',
      },
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
    collection: 'partner_products',
    autoIndex: true,
  },
);

/**
 * Database-backed Pre-Validate Invariant Hooks
 *
 * Enforces strict relationship consistency:
 * 1. Partner exists and is ACTIVE.
 * 2. Service area exists, is active, and is in partner's assigned serviceAreaIds.
 * 3. Master product exists, is ACTIVE, and is published.
 * 4. Standalone products (hasVariants: false) must have variantId: null (rejects parent container and variant mismatch).
 * 5. Variants (hasVariants: true) must belong to parent productId, be ACTIVE, and be published.
 */
partnerProductSchema.pre('validate', async function (next) {
  // Only execute database-backed invariant validation if connection is active
  if (mongoose.connection.readyState !== 1) {
    return next();
  }

  // 1. Partner Verification (Partner must exist and be ACTIVE)
  if (this.partnerId) {
    const PartnerModel = mongoose.models.Partner;
    if (PartnerModel) {
      const partner = await PartnerModel.findById(this.partnerId).select('status serviceAreaIds');
      if (!partner) {
        throw new Error('PARTNER_NOT_FOUND: The referenced partner tenant does not exist');
      }
      if (partner.status !== 'ACTIVE') {
        throw new Error(
          `PARTNER_NOT_ACTIVE: Cannot configure availability for partner with status ${partner.status}`,
        );
      }

      // 2. Service Area Verification (Service area must exist, be active, and belong to partner.serviceAreaIds)
      if (this.serviceAreaId) {
        const isAssigned =
          Array.isArray(partner.serviceAreaIds) &&
          partner.serviceAreaIds.some((saId: mongoose.Types.ObjectId) =>
            saId.equals(this.serviceAreaId),
          );
        if (!isAssigned) {
          throw new Error(
            'SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER: Target service area is not assigned to this partner',
          );
        }

        const ServiceAreaModel = mongoose.models.ServiceArea;
        if (ServiceAreaModel) {
          const sa = await ServiceAreaModel.findById(this.serviceAreaId).select('isActive');
          if (!sa) {
            throw new Error('SERVICE_AREA_NOT_FOUND: Target service area does not exist');
          }
          if (!sa.isActive) {
            throw new Error('SERVICE_AREA_NOT_ACTIVE: Target service area is currently inactive');
          }
        }
      }
    }
  }

  // 3. Standalone Product Verification
  if (!this.variantId && this.productId) {
    const ProductModel = mongoose.models.Product;
    if (ProductModel) {
      const product = await ProductModel.findById(this.productId).select(
        'hasVariants status publishedAt',
      );
      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND: The referenced product does not exist');
      }
      if (product.hasVariants === true) {
        throw new Error(
          'PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY: Standalone availability cannot be assigned to multi-variant parent products',
        );
      }
      if (product.status !== 'ACTIVE' || !product.publishedAt) {
        throw new Error(
          'CANNOT_LINK_UNPUBLISHED_PRODUCT: Partner availability can only be configured for active, published products',
        );
      }
    }
  }

  // 4. Variant Verification
  if (this.variantId) {
    // If productId is provided, ensure product is a multi-variant parent
    const ProductModel = mongoose.models.Product;
    if (ProductModel && this.productId) {
      const product = await ProductModel.findById(this.productId).select(
        'hasVariants status publishedAt',
      );
      if (product && product.hasVariants === false) {
        throw new Error(
          'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY: Standalone products cannot have variant availability',
        );
      }
    }

    const ProductVariantModel = mongoose.models.ProductVariant;
    if (ProductVariantModel) {
      const variant = await ProductVariantModel.findById(this.variantId).select(
        'productId status publishedAt',
      );
      if (!variant) {
        throw new Error('VARIANT_NOT_FOUND: The referenced variantId does not exist');
      }
      if (this.productId && !variant.productId.equals(this.productId)) {
        throw new Error(
          'VARIANT_DOES_NOT_BELONG_TO_PRODUCT: The referenced variant belongs to a different parent product',
        );
      }
      if (variant.status !== 'ACTIVE' || !variant.publishedAt) {
        throw new Error(
          'CANNOT_LINK_UNPUBLISHED_VARIANT: Partner availability can only be configured for active, published variants',
        );
      }
    }
  }

  next();
});

// 1. Standalone Product Unique Index: Exactly 1 record per partner per standalone product per service area
partnerProductSchema.index(
  { partnerId: 1, productId: 1, serviceAreaId: 1 },
  {
    unique: true,
    name: 'unique_partner_standalone_product_service_area',
    partialFilterExpression: { variantId: null },
  },
);

// 2. Variant Product Unique Index: Exactly 1 record per partner per variant per service area
partnerProductSchema.index(
  { partnerId: 1, productId: 1, variantId: 1, serviceAreaId: 1 },
  {
    unique: true,
    name: 'unique_partner_variant_product_service_area',
    partialFilterExpression: { variantId: { $type: 'objectId' } },
  },
);

// 3. Supporting index for Storefront Hyperlocal Availability Resolution (Step 7)
partnerProductSchema.index(
  { serviceAreaId: 1, productId: 1, variantId: 1, isAvailable: 1 },
  { name: 'idx_service_area_product_availability' },
);

// 4. Supporting index for Partner Portal Inventory Queries
partnerProductSchema.index(
  { partnerId: 1, serviceAreaId: 1, isAvailable: 1 },
  { name: 'idx_partner_service_area_availability' },
);

export const PartnerProductModel: Model<IPartnerProductDocument> =
  mongoose.models.PartnerProduct ||
  mongoose.model<IPartnerProductDocument>('PartnerProduct', partnerProductSchema);
