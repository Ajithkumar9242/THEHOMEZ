import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface ICartValidationSnapshotItem {
  itemId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
  quantity: string;
  unitCode: string;
  quantityPrecision: number;
  unitPricePaise: number;
}

export interface ICartValidationSnapshotDocument extends Document {
  ownerType: 'USER' | 'GUEST';
  userId: Types.ObjectId | null;
  sessionTokenHash: string | null;
  cartId: Types.ObjectId;
  cartVersion: number;
  addressId: Types.ObjectId | null;
  pincode: string | null;
  items: ICartValidationSnapshotItem[];
  expiresAt: Date;
  createdAt: Date;
}

const itemSchema = new Schema<ICartValidationSnapshotItem>({
  itemId: { type: Schema.Types.ObjectId, required: true },
  productId: { type: Schema.Types.ObjectId, required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  quantity: { type: String, required: true },
  unitCode: { type: String, required: true },
  quantityPrecision: { type: Number, required: true },
  unitPricePaise: { type: Number, required: true },
}, { _id: false });

const schema = new Schema<ICartValidationSnapshotDocument>({
  ownerType: { type: String, enum: ['USER', 'GUEST'], required: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  sessionTokenHash: { type: String, default: null, immutable: true },
  cartId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  cartVersion: { type: Number, required: true, immutable: true },
  addressId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  pincode: { type: String, default: null, immutable: true },
  items: { type: [itemSchema], required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'cart_validation_snapshots' });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_cart_validation_snapshot' });
schema.index({ userId: 1, cartId: 1, cartVersion: 1 });
schema.index({ sessionTokenHash: 1, cartId: 1, cartVersion: 1 });

export const CartValidationSnapshotModel: Model<ICartValidationSnapshotDocument> =
  mongoose.models.CartValidationSnapshot || mongoose.model<ICartValidationSnapshotDocument>('CartValidationSnapshot', schema);
