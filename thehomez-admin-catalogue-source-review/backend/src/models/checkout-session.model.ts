import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import { CHECKOUT_DELIVERY_FEE_STATUS, CHECKOUT_PRICING_BASIS, CHECKOUT_SESSION_STATUSES, CHECKOUT_TAX_STATUS } from '@thehomez/shared-types';
import type { ICheckoutDeliveryAddressSnapshot, ICheckoutServiceAreaSnapshot, ICheckoutSessionItemSnapshot } from '@thehomez/shared-types';

export interface ICheckoutSessionDocument extends Document {
  userId: Types.ObjectId; cartId: Types.ObjectId; cartVersion: number;
  idempotencyKey: string; requestHash: string; customerSegment: 'B2B' | 'B2C';
  deliveryAddressSnapshot: ICheckoutDeliveryAddressSnapshot; serviceAreaSnapshot: ICheckoutServiceAreaSnapshot;
  items: ICheckoutSessionItemSnapshot[]; materialSubtotalPaise: number;
  currency: 'INR'; pricingBasis: typeof CHECKOUT_PRICING_BASIS;
  deliveryFeeStatus: typeof CHECKOUT_DELIVERY_FEE_STATUS; taxStatus: typeof CHECKOUT_TAX_STATUS;
  status: (typeof CHECKOUT_SESSION_STATUSES)[number]; expiresAt: Date; createdAt: Date; updatedAt: Date;
}

const address = new Schema({ addressId: String, label: String, recipientName: String, phone: String,
  streetAddress: String, landmark: String, city: String, state: String, pincode: String,
  siteContactPerson: Schema.Types.Mixed, heavyVehicleAccessInstructions: String }, { _id: false });
const area = new Schema({ serviceAreaId: String, code: String, name: String, city: String, state: String }, { _id: false });
const item = new Schema({ productId: String, variantId: String, sku: String, title: String, brand: String,
  unitCode: String, quantityPrecision: Number, quantity: String, pricingTierApplied: String,
  tierMinQuantity: String, unitPricePaise: Number, lineSubtotalPaise: Number, mrpSubtotalPaise: Number,
  savingsPaise: Number, minLeadTimeHours: Number, isServiceAreaOverride: Boolean }, { _id: false });
const schema = new Schema<ICheckoutSessionDocument>({
  userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  cartId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  cartVersion: { type: Number, required: true, immutable: true },
  idempotencyKey: { type: String, required: true, maxlength: 64 }, requestHash: { type: String, required: true },
  customerSegment: { type: String, enum: ['B2C', 'B2B'], required: true },
  deliveryAddressSnapshot: { type: address, required: true, immutable: true },
  serviceAreaSnapshot: { type: area, required: true, immutable: true },
  items: { type: [item], required: true, immutable: true }, materialSubtotalPaise: { type: Number, required: true, immutable: true },
  currency: { type: String, enum: ['INR'], default: 'INR' }, pricingBasis: { type: String, enum: [CHECKOUT_PRICING_BASIS], required: true },
  deliveryFeeStatus: { type: String, enum: [CHECKOUT_DELIVERY_FEE_STATUS], required: true },
  taxStatus: { type: String, enum: [CHECKOUT_TAX_STATUS], required: true },
  status: { type: String, enum: CHECKOUT_SESSION_STATUSES, required: true }, expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'checkout_sessions' });
schema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, name: 'unique_checkout_idempotency' });
schema.index({ userId: 1, status: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'PREPARED' },
  name: 'unique_active_checkout_session_per_customer',
});
schema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_checkout_user_status' });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_checkout_session' });
export const CheckoutSessionModel: Model<ICheckoutSessionDocument> = mongoose.models.CheckoutSession || mongoose.model<ICheckoutSessionDocument>('CheckoutSession', schema);
