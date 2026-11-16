import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { CHECKOUT_DELIVERY_FEE_STATUS, CHECKOUT_ERROR_CODES, CHECKOUT_PRICING_BASIS,
  CHECKOUT_SESSION_TTL_MINUTES, CHECKOUT_TAX_STATUS, CART_ERROR_CODES, MIN_LEAD_TIME_HOURS,
  type ICheckoutSessionDto, type IPrepareCheckoutRequestDto } from '@thehomez/shared-types';
import { CartModel } from '../models/cart.model.js';
import { CartValidationSnapshotModel } from '../models/cart-validation-snapshot.model.js';
import { CheckoutSessionModel, type ICheckoutSessionDocument } from '../models/checkout-session.model.js';
import { CustomerAddressModel } from '../models/customer-address.model.js';
import { ServiceAreaModel } from '../models/service-area.model.js';
import { CartService } from './cart/cart.service.js';
import { CartError } from './cart/cart.errors.js';
import { withTransaction } from '../database/transaction.js';

export class CheckoutPreparationService {
  constructor(private readonly carts = new CartService()) {}
  private dto(doc: ICheckoutSessionDocument, modified: boolean): ICheckoutSessionDto {
    return { sessionId: doc._id.toString(), cartId: doc.cartId.toString(), cartVersion: doc.cartVersion,
      customerSegment: doc.customerSegment, deliveryAddressSnapshot: doc.deliveryAddressSnapshot,
      serviceAreaSnapshot: doc.serviceAreaSnapshot, items: doc.items, materialSubtotalPaise: doc.materialSubtotalPaise,
      currency: 'INR', pricingBasis: CHECKOUT_PRICING_BASIS, deliveryFeeStatus: CHECKOUT_DELIVERY_FEE_STATUS,
      taxStatus: CHECKOUT_TAX_STATUS, status: doc.status, cartModifiedSincePrepare: modified,
      expiresAt: doc.expiresAt.toISOString(), createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() };
  }
  async prepare(userId: string, dto: IPrepareCheckoutRequestDto, key: string): Promise<{session: ICheckoutSessionDto; idempotentReplay: boolean}> {
    const user = new Types.ObjectId(userId);
    const address = await CustomerAddressModel.findOne({ _id: new Types.ObjectId(dto.addressId), userId: user });
    if (!address) throw new CartError('Delivery address not found', CHECKOUT_ERROR_CODES.ADDRESS_NOT_FOUND, 404);
    const cart = await CartModel.findOne({ ownerType: 'USER', userId: user });
    if (!cart || !cart.items.length) throw new CartError('Cart is empty', CHECKOUT_ERROR_CODES.CHECKOUT_CART_INVALID, 422);
    if (dto.expectedCartVersion !== undefined && cart.version !== dto.expectedCartVersion) throw new CartError('Cart version conflict', CART_ERROR_CODES.CART_VERSION_CONFLICT, 409);
    const snapshot = dto.validationSnapshotId ? await CartValidationSnapshotModel.findOne({ _id: new Types.ObjectId(dto.validationSnapshotId), ownerType: 'USER', userId: user, cartId: cart._id }) : null;
    if (!snapshot) throw new CartError('A current address-bound validation snapshot is required', CHECKOUT_ERROR_CODES.VALIDATION_SNAPSHOT_REQUIRED, 422);
    if (snapshot.expiresAt <= new Date()) throw new CartError('Validation snapshot expired', CART_ERROR_CODES.VALIDATION_SNAPSHOT_EXPIRED, 410);
    if (snapshot.cartVersion !== cart.version || !snapshot.addressId?.equals(address._id) || snapshot.pincode !== address.pincode) throw new CartError('Validation snapshot does not match this cart and delivery address', CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
    const validation = await this.carts.validateCart({ ownerType: 'USER', userId },
      { addressId: address._id.toString(), expectedVersion: cart.version }, { persistSnapshot: false });
    if (!validation.isValidForCheckout || snapshot.items.length !== cart.items.length || snapshot.items.some((s) => {
      const live = validation.cart.items.find((i) => i.itemId === s.itemId.toString());
      const line = cart.items.find((i) => i._id.equals(s.itemId));
      return !live || !line || live.unitPricePaise !== s.unitPricePaise || live.unitCode !== s.unitCode ||
        live.quantityPrecision !== s.quantityPrecision || line.acknowledgedUnitPricePaise !== s.unitPricePaise ||
        line.acknowledgedPincode !== address.pincode ||
        live.quantity !== s.quantity || !line.productId.equals(s.productId) || (line.variantId?.toString() ?? null) !== (s.variantId?.toString() ?? null);
    })) throw new CartError('Cart prices or contents changed; validate and acknowledge the current prices', CHECKOUT_ERROR_CODES.PRICE_DRIFT_UNACKNOWLEDGED, 422, validation.priceChangedItems);
    const area = await ServiceAreaModel.findOne({ pincodes: address.pincode, isActive: true });
    if (!area) throw new CartError('Delivery address is not serviceable', CHECKOUT_ERROR_CODES.ADDRESS_UNSERVICEABLE, 422);
    const items = validation.cart.items.map((line) => ({ productId: line.productId, variantId: line.variantId,
      sku: line.sku || line.productId, title: line.title, brand: line.brand, unitCode: line.unitCode,
      quantityPrecision: line.quantityPrecision, quantity: line.quantity, pricingTierApplied: line.pricingTierApplied || 'STANDARD',
      tierMinQuantity: line.tierMinQuantity, unitPricePaise: line.unitPricePaise!, lineSubtotalPaise: line.lineSubtotalPaise!,
      mrpSubtotalPaise: line.mrpSubtotalPaise, savingsPaise: line.savingsPaise, minLeadTimeHours: line.minLeadTimeHours ?? MIN_LEAD_TIME_HOURS,
      isServiceAreaOverride: line.isServiceAreaOverride }));
    const requestHash = createHash('sha256').update(JSON.stringify({ addressId: address._id.toString(), cartVersion: cart.version,
      items: items.map(({ productId, variantId, quantity, unitCode, quantityPrecision, unitPricePaise }) =>
        ({ productId, variantId, quantity, unitCode, quantityPrecision, unitPricePaise })) })).digest('hex');
    const subtotal = items.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
    const sessionData = { userId: user, cartId: cart._id, cartVersion: cart.version, idempotencyKey: key,
        requestHash, customerSegment: validation.cart.customerSegment, deliveryAddressSnapshot: { addressId: address._id.toString(),
        label: address.label, recipientName: address.recipientName, phone: address.phone, streetAddress: address.streetAddress,
        landmark: address.landmark, city: address.city, state: address.state, pincode: address.pincode,
        siteContactPerson: address.siteContactPerson, heavyVehicleAccessInstructions: address.heavyVehicleAccessInstructions },
        serviceAreaSnapshot: { serviceAreaId: area._id.toString(), code: area.code, name: area.name, city: area.city, state: area.state },
        items, materialSubtotalPaise: subtotal, currency: 'INR', pricingBasis: CHECKOUT_PRICING_BASIS,
        deliveryFeeStatus: CHECKOUT_DELIVERY_FEE_STATUS, taxStatus: CHECKOUT_TAX_STATUS, status: 'PREPARED',
        expiresAt: new Date(Date.now() + CHECKOUT_SESSION_TTL_MINUTES * 60_000) };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await withTransaction(async (session) => {
          const prior = await CheckoutSessionModel.findOne({ userId: user, idempotencyKey: key }).session(session);
          if (prior) {
            if (prior.requestHash !== requestHash || prior.status !== 'PREPARED' || prior.expiresAt <= new Date()) {
              throw new CartError('Idempotency key was used for a different or inactive checkout request',
                CHECKOUT_ERROR_CODES.IDEMPOTENCY_KEY_PAYLOAD_MISMATCH, 409);
            }
            return { session: this.dto(prior, cart.version !== prior.cartVersion), idempotentReplay: true };
          }

          const latestCart = await CartModel.findOne({ _id: cart._id, ownerType: 'USER', userId: user }).session(session);
          if (!latestCart || latestCart.version !== cart.version) {
            throw new CartError('Cart changed during checkout preparation; validate again', CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
          }

          await CheckoutSessionModel.updateMany({ userId: user, status: 'PREPARED' },
            { $set: { status: 'SUPERSEDED' } }, { session });
          const [created] = await CheckoutSessionModel.create([sessionData], { session });
          if (!created) throw new Error('Checkout session was not created');
          return { session: this.dto(created, false), idempotentReplay: false };
        });
      } catch (err) {
        const mongoError = err as { code?: number; message?: string };
        if (mongoError.code === 11000) {
          const racedKey = await CheckoutSessionModel.findOne({ userId: user, idempotencyKey: key });
          if (racedKey) {
            if (racedKey.requestHash !== requestHash || racedKey.status !== 'PREPARED' || racedKey.expiresAt <= new Date()) {
              throw new CartError('Idempotency key was used for a different or inactive checkout request',
                CHECKOUT_ERROR_CODES.IDEMPOTENCY_KEY_PAYLOAD_MISMATCH, 409);
            }
            return { session: this.dto(racedKey, cart.version !== racedKey.cartVersion), idempotentReplay: true };
          }
          if (mongoError.message?.includes('unique_active_checkout_session_per_customer')) continue;
        }
        throw err;
      }
    }
    throw new CartError('Checkout preparation conflicted with another request; retry with the same key',
      CHECKOUT_ERROR_CODES.IDEMPOTENCY_KEY_PAYLOAD_MISMATCH, 409);
  }
  async get(userId: string, sessionId: string): Promise<ICheckoutSessionDto> {
    const doc = await CheckoutSessionModel.findOne({ _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId) });
    if (!doc) throw new CartError('Checkout session not found', CHECKOUT_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND, 404);
    if (doc.expiresAt <= new Date() || doc.status === 'EXPIRED') throw new CartError('Checkout session expired', CHECKOUT_ERROR_CODES.CHECKOUT_SESSION_EXPIRED, 410);
    const cart = await CartModel.findById(doc.cartId);
    return this.dto(doc, !cart || cart.version !== doc.cartVersion);
  }
}
