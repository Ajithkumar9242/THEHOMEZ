import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Application } from 'express';
import request from 'supertest';
import mongoose, { type Types } from 'mongoose';
import {
  CART_ERROR_CODES,
  CHECKOUT_DELIVERY_FEE_STATUS,
  CHECKOUT_TAX_STATUS,
  CART_SESSION_TOKEN_HEADER,
  UserStatus,
  UserType,
  cartSummaryDtoSchema,
  cartValidationResultDtoSchema,
  type ICartSummaryDto,
  type ICartValidationResultDto,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel, type ICategoryDocument } from '../src/models/category.model.js';
import { CustomerAddressModel } from '../src/models/customer-address.model.js';
import { CartValidationSnapshotModel } from '../src/models/cart-validation-snapshot.model.js';
import { CheckoutSessionModel } from '../src/models/checkout-session.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductPricingModel,
  type IProductPricingDocument,
} from '../src/models/product-pricing.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { TokenService, hashToken } from '../src/services/token/token.service.js';

describe('Milestone 5B.3: Cart Validation & Price Acknowledgement (Backend)', () => {
  let isDbConnected = false;
  let app: Application;
  let tokenService: TokenService;
  const priorApiRateLimit = process.env.RATE_LIMIT_MAX_REQUESTS;

  const dummyAdminId = new mongoose.Types.ObjectId();

  // Isolated users (phone prefix +9194446 — does not collide with 5B.2 +9194444 or guard +9192222)
  let customerA: IUserDocument;
  let customerB: IUserDocument;
  let partnerUser: IUserDocument;
  let staffUser: IUserDocument;

  let tokenA: string;
  let tokenB: string;
  let partnerToken: string;
  let staffToken: string;

  // Guest tokens
  const guestToken1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  // Service areas & PINs (isolated — not used by 5B.2)
  let saServiceable: IServiceAreaDocument;
  let saOutOfStock: IServiceAreaDocument;
  const serviceablePincode = '560985';
  const outOfStockPincode = '560986';
  const unserviceablePincode = '560987'; // no matching service area

  // Partners
  let partnerAlpha: IPartnerDocument;

  // Categories
  let categoryDoc: ICategoryDocument;

  // Products & pricing
  let discreteProduct: IProductDocument;
  let bulkProduct: IProductDocument;
  let unpricedProduct: IProductDocument;
  let draftProduct: IProductDocument;
  let parentWithVariants: IProductDocument;
  let activeVariant: IProductVariantDocument;
  let discreteGlobalPricing: IProductPricingDocument;
  let bulkGlobalPricing: IProductPricingDocument;
  let variantPricing: IProductPricingDocument;

  // Track IDs for cleanup
  const createdUserIds: Types.ObjectId[] = [];
  const createdCategoryIds: Types.ObjectId[] = [];
  const createdProductIds: Types.ObjectId[] = [];
  const createdVariantIds: Types.ObjectId[] = [];
  const createdPricingIds: Types.ObjectId[] = [];
  const createdPartnerIds: Types.ObjectId[] = [];
  const createdPartnerProductIds: Types.ObjectId[] = [];
  const createdServiceAreaIds: Types.ObjectId[] = [];
  const createdAddressIds: Types.ObjectId[] = [];

  const testPhonePrefix = '+9194446';
  const testSlugPrefix = 'cart-val-test-';
  const testSkuPrefix = 'CARTVALTEST-';
  const testSaPrefix = 'CARTVAL-TEST-SA-';

  // ============================================================
  // Helpers
  // ============================================================

  function parseValidSummary(body: unknown): ICartSummaryDto {
    const envelope = body as { success: boolean; data: unknown };
    expect(envelope.success).toBe(true);
    return cartSummaryDtoSchema.parse(envelope.data);
  }

  function parseValidValidationResult(body: unknown): ICartValidationResultDto {
    const envelope = body as { success: boolean; data: unknown };
    expect(envelope.success).toBe(true);
    return cartValidationResultDtoSchema.parse(envelope.data);
  }

  function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function guestHeader(token: string) {
    return { [CART_SESSION_TOKEN_HEADER]: token };
  }

  async function addItemToCart(token: string, productId: string, quantity: string) {
    const res = await request(app)
      .post('/api/v1/cart/items')
      .set(authHeader(token))
      .send({ productId, quantity });
    expect(res.status).toBe(200);
    return parseValidSummary(res.body);
  }

  async function addItemToGuestCart(guestToken: string, productId: string, quantity: string) {
    const res = await request(app)
      .post('/api/v1/cart/items')
      .set(guestHeader(guestToken))
      .send({ productId, quantity });
    expect(res.status).toBe(200);
    return parseValidSummary(res.body);
  }

  async function createServiceableAddress(user = customerA): Promise<Types.ObjectId> {
    const address = await CustomerAddressModel.create({ userId: user._id, label: 'Test Site',
      recipientName: 'Test Customer', phone: user.phone, streetAddress: '100 Test Road',
      city: 'Test City', state: 'Test State', pincode: serviceablePincode, isDefault: false });
    createdAddressIds.push(address._id);
    return address._id;
  }

  async function cleanupTestFixtures(): Promise<void> {
    if (!isDbConnected) return;

    await CartModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        {
          ownerType: 'GUEST',
          sessionTokenHash: { $in: [hashToken(guestToken1)] },
        },
      ],
    });
    await CartValidationSnapshotModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        { sessionTokenHash: hashToken(guestToken1) },
      ],
    });
    await CheckoutSessionModel.deleteMany({ userId: { $in: createdUserIds } });

    if (createdAddressIds.length > 0) {
      await CustomerAddressModel.deleteMany({ _id: { $in: createdAddressIds } });
    }
    if (createdPartnerProductIds.length > 0) {
      await PartnerProductModel.deleteMany({ _id: { $in: createdPartnerProductIds } });
    }
    if (createdPricingIds.length > 0) {
      await ProductPricingModel.deleteMany({ _id: { $in: createdPricingIds } });
    }
    if (createdVariantIds.length > 0) {
      await ProductVariantModel.deleteMany({ _id: { $in: createdVariantIds } });
    }
    if (createdProductIds.length > 0) {
      await ProductModel.deleteMany({ _id: { $in: createdProductIds } });
    }
    if (createdCategoryIds.length > 0) {
      await CategoryModel.deleteMany({ _id: { $in: createdCategoryIds } });
    }
    if (createdPartnerIds.length > 0) {
      await PartnerModel.deleteMany({ _id: { $in: createdPartnerIds } });
    }
    if (createdServiceAreaIds.length > 0) {
      await ServiceAreaModel.deleteMany({ _id: { $in: createdServiceAreaIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }

    // Defensive cleanup
    await ProductModel.deleteMany({ slug: { $regex: /^cart-val-test-/ } });
    await ProductVariantModel.deleteMany({ sku: { $regex: /^CARTVALTEST-/ } });
    await CategoryModel.deleteMany({ slug: { $regex: /^cart-val-test-/ } });
    await ServiceAreaModel.deleteMany({ code: { $regex: /^CARTVAL-TEST-SA-/ } });
    await PartnerModel.deleteMany({ phone: { $regex: /^\+9194446/ } });
    await UserModel.deleteMany({ phone: { $regex: /^\+9194446/ } });
    await CustomerAddressModel.deleteMany({ phone: { $regex: /^\+9194446/ } });
  }

  // ============================================================
  // Test Setup
  // ============================================================

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
    getConfig(true);
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    app = createApp();

    if (!isDbConnected) return;

    await cleanupTestFixtures();
    await seedApprovedUnits();

    // Users
    customerA = await UserModel.create({
      phone: `${testPhonePrefix}10001`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    customerB = await UserModel.create({
      phone: `${testPhonePrefix}10002`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    partnerUser = await UserModel.create({
      phone: `${testPhonePrefix}10005`,
      userType: UserType.PARTNER,
      status: UserStatus.ACTIVE,
      partnerId: new mongoose.Types.ObjectId(),
      roles: [],
    });
    staffUser = await UserModel.create({
      phone: `${testPhonePrefix}10006`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: [],
    });

    createdUserIds.push(customerA._id, customerB._id, partnerUser._id, staffUser._id);

    tokenA = tokenService.signAccessToken(customerA);
    tokenB = tokenService.signAccessToken(customerB);
    partnerToken = tokenService.signAccessToken(partnerUser);
    staffToken = tokenService.signAccessToken(staffUser);

    // Service Areas
    saServiceable = await ServiceAreaModel.create({
      code: `${testSaPrefix}SERVICEABLE`,
      name: 'CartVal Test Serviceable Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: [serviceablePincode],
      isActive: true,
    });
    saOutOfStock = await ServiceAreaModel.create({
      code: `${testSaPrefix}OUTOFSTOCK`,
      name: 'CartVal Test Out-of-Stock Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: [outOfStockPincode],
      isActive: true,
    });
    createdServiceAreaIds.push(saServiceable._id, saOutOfStock._id);

    // Partners
    partnerAlpha = await PartnerModel.create({
      businessName: 'CartValTestPartnerAlphaSecret',
      phone: `${testPhonePrefix}20001`,
      serviceAreaIds: [saServiceable._id],
      status: 'ACTIVE',
    });
    createdPartnerIds.push(partnerAlpha._id);

    // Category
    categoryDoc = await CategoryModel.create({
      name: 'CartVal Test Category',
      slug: `${testSlugPrefix}root`,
      level: 0,
      isActive: true,
      displayOrder: 1,
    });
    createdCategoryIds.push(categoryDoc._id);

    const now = new Date();

    // Products
    discreteProduct = await ProductModel.create({
      slug: `${testSlugPrefix}cement`,
      title: 'CartVal Test Cement (50kg)',
      brand: 'CartValBrand',
      categoryId: categoryDoc._id,
      subcategoryId: categoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}CEMENT`,
      status: 'ACTIVE',
      images: ['https://cdn.example.com/cv-cement.jpg'],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      maxOrderQuantity: '100',
      stepIncrement: '1',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    unpricedProduct = await ProductModel.create({
      slug: `${testSlugPrefix}unpriced`,
      title: 'CartVal Test Unpriced Product',
      brand: 'CartValBrand',
      categoryId: categoryDoc._id,
      subcategoryId: categoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}UNPRICED`,
      status: 'ACTIVE',
      images: [],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '1',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    draftProduct = await ProductModel.create({
      slug: `${testSlugPrefix}draft`,
      title: 'CartVal Test Draft Product',
      brand: 'CartValBrand',
      categoryId: categoryDoc._id,
      subcategoryId: categoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}DRAFT`,
      status: 'DRAFT',
      images: [],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      stepIncrement: '1',
      publishedAt: null,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    parentWithVariants = await ProductModel.create({
      slug: `${testSlugPrefix}tmt`,
      title: 'CartVal Test TMT Steel',
      brand: 'CartValBrand',
      categoryId: categoryDoc._id,
      subcategoryId: categoryDoc._id,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      images: [],
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    bulkProduct = await ProductModel.create({
      slug: `${testSlugPrefix}msand`,
      title: 'CartVal Test Bulk M-Sand',
      brand: 'CartValBrand',
      categoryId: categoryDoc._id,
      subcategoryId: categoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}MSAND`,
      status: 'ACTIVE',
      images: [],
      unitCode: 'TON',
      quantityPrecision: 3,
      minOrderQuantity: '0.500',
      maxOrderQuantity: '25.000',
      stepIncrement: '0.250',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdProductIds.push(
      discreteProduct._id,
      bulkProduct._id,
      unpricedProduct._id,
      draftProduct._id,
      parentWithVariants._id,
    );

    activeVariant = await ProductVariantModel.create({
      productId: parentWithVariants._id,
      sku: `${testSkuPrefix}TMT-10MM`,
      title: '10mm Bundle',
      status: 'ACTIVE',
      attributes: { diameter: '10mm' },
      images: [],
      unitCode: 'MT',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      maxOrderQuantity: '50.00',
      stepIncrement: '0.50',
      publishedAt: now,
    });
    createdVariantIds.push(activeVariant._id);

    // Pricing
    discreteGlobalPricing = await ProductPricingModel.create({
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 50000, // ₹500/bag
      b2cMrpPaise: 55000,
      b2bPricePaise: 47000,
      b2bTiers: [],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    bulkGlobalPricing = await ProductPricingModel.create({
      productId: bulkProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 120055, // ₹1,200.55/ton -> tests HALF_UP fractional rounding
      b2cMrpPaise: 140000,
      b2bPricePaise: 110000,
      b2bTiers: [{ minQuantity: '2.000', pricePaise: 105000 }],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const bulkRegionalPricing = await ProductPricingModel.create({
      productId: bulkProduct._id,
      variantId: null,
      serviceAreaId: saServiceable._id,
      pricingScope: 'STANDALONE_REGIONAL',
      b2cPricePaise: 115000, // Regional override for serviceablePincode
      b2cMrpPaise: 140000,
      b2bPricePaise: 108000,
      b2bTiers: [],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    variantPricing = await ProductPricingModel.create({
      productId: parentWithVariants._id,
      variantId: activeVariant._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      b2cPricePaise: 7000000, // ₹70,000/mt
      b2cMrpPaise: 7500000,
      b2bPricePaise: null,
      b2bTiers: [],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdPricingIds.push(
      discreteGlobalPricing._id,
      bulkGlobalPricing._id,
      bulkRegionalPricing._id,
      variantPricing._id,
    );

    // Partner availability: discreteProduct & bulkProduct available in saServiceable, NOT in saOutOfStock
    const ppAlpha = await PartnerProductModel.create({
      partnerId: partnerAlpha._id,
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: saServiceable._id,
      isAvailable: true,
      minLeadTimeHours: 24,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const ppBulk = await PartnerProductModel.create({
      partnerId: partnerAlpha._id,
      productId: bulkProduct._id,
      variantId: null,
      serviceAreaId: saServiceable._id,
      isAvailable: true,
      minLeadTimeHours: 12,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const ppVariant = await PartnerProductModel.create({
      partnerId: partnerAlpha._id,
      productId: parentWithVariants._id,
      variantId: activeVariant._id,
      serviceAreaId: saServiceable._id,
      isAvailable: true,
      minLeadTimeHours: 48,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdPartnerProductIds.push(ppAlpha._id, ppBulk._id, ppVariant._id);
  });

  afterAll(async () => {
    await cleanupTestFixtures();
    await disconnectDatabase();
    if (priorApiRateLimit === undefined) delete process.env.RATE_LIMIT_MAX_REQUESTS;
    else process.env.RATE_LIMIT_MAX_REQUESTS = priorApiRateLimit;
    getConfig(true);
  });

  beforeEach(async () => {
    if (!isDbConnected) return;

    // Clear all carts between tests
    await CartModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        {
          ownerType: 'GUEST',
          sessionTokenHash: { $in: [hashToken(guestToken1)] },
        },
      ],
    });
    await CartValidationSnapshotModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        { sessionTokenHash: hashToken(guestToken1) },
      ],
    });
    await CheckoutSessionModel.deleteMany({ userId: { $in: createdUserIds } });

    // Clear addresses
    if (createdAddressIds.length > 0) {
      await CustomerAddressModel.deleteMany({ _id: { $in: createdAddressIds } });
      createdAddressIds.length = 0;
    }

    // Restore customerA/B roles, discreteProduct, and pricing to baseline
    await UserModel.findByIdAndUpdate(customerA._id, {
      $set: { status: UserStatus.ACTIVE, roles: [] },
    });
    await ProductModel.findByIdAndUpdate(discreteProduct._id, {
      $set: { status: 'ACTIVE', publishedAt: new Date() },
    });
    await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
      $set: { b2cPricePaise: 50000, isActive: true },
    });
    await ProductPricingModel.findByIdAndUpdate(bulkGlobalPricing._id, {
      $set: { b2cPricePaise: 120055, isActive: true },
    });
  });

  // ============================================================
  // POST /api/v1/cart/validate
  // ============================================================

  describe('POST /api/v1/cart/validate', () => {
    it('requires authentication or guest token', async () => {
      const res = await request(app).post('/api/v1/cart/validate').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_TOKEN_REQUIRED);
    });

    it('rejects PARTNER user type', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(partnerToken))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects STAFF user type', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(staffToken))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects unknown fields (strict schema)', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode, unknownField: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects both pincode and addressId simultaneously', async () => {
      const fakeAddressId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode, addressId: fakeAddressId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid pincode format', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: 'ABCDEF' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns CART_EMPTY blocking reason for empty cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({});
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.blockingReasons.some((r) => r.code === 'CART_EMPTY')).toBe(true);
      expect(result.blockingReasons[0]?.severity).toBe('BLOCKING');
      expect(result.priceChangedItems).toHaveLength(0);
    });

    it('returns CART_UNLOCALIZED when cart has items but no pincode', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({});
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.localizationState).toBe('UNLOCALIZED');
      expect(result.isServiceable).toBeNull();
      expect(result.blockingReasons.some((r) => r.code === 'CART_UNLOCALIZED')).toBe(true);
    });

    it('returns valid result when cart is fully serviceable with stock', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await request(app)
        .patch('/api/v1/cart/location')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({});
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(true);
      expect(result.localizationState).toBe('SERVICEABLE');
      expect(result.isServiceable).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
      expect(result.priceChangedItems).toHaveLength(0);
      expect(result.evaluatedPincode).toBe(serviceablePincode);
    });

    it('overrides cart pincode with ephemeral pincode in validate body without mutating cart', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.evaluatedPincode).toBe(serviceablePincode);
      expect(result.localizationState).toBe('SERVICEABLE');
      expect(result.isValidForCheckout).toBe(true);

      // Cart persisted pincode remains null
      const afterGet = await request(app).get('/api/v1/cart').set(authHeader(tokenA));
      expect(parseValidSummary(afterGet.body).pincode).toBeNull();
    });

    it('returns PINCODE_UNSERVICEABLE when pincode override is not served', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: unserviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.localizationState).toBe('UNSERVICEABLE');
      expect(result.isServiceable).toBe(false);
      expect(result.blockingReasons.some((r) => r.code === 'PINCODE_UNSERVICEABLE')).toBe(true);
    });

    it('detects OUT_OF_STOCK_IN_AREA when product not available in area', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: outOfStockPincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.blockingReasons.some((r) => r.code === 'OUT_OF_STOCK_IN_AREA')).toBe(true);
    });

    it('detects PRODUCT_UNAVAILABLE when product deactivated after adding to cart', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductModel.findByIdAndUpdate(discreteProduct._id, {
        $set: { status: 'ARCHIVED', publishedAt: null },
      });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.blockingReasons.some((r) => r.code === 'PRODUCT_UNAVAILABLE')).toBe(true);
    });

    it('detects PRICE_CHANGED on price increase (WARNING severity)', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.priceChangedItems).toHaveLength(1);
      expect(result.priceChangedItems[0]?.code).toBe('PRICE_CHANGED');
      expect(result.priceChangedItems[0]?.severity).toBe('WARNING');
      expect(result.priceChangedItems[0]?.acknowledgedUnitPricePaise).toBe(50000);
      expect(result.priceChangedItems[0]?.currentUnitPricePaise).toBe(55000);
      expect(result.cart.items[0]?.priceDrift?.direction).toBe('INCREASED');
      expect(result.cart.items[0]?.priceDrift?.deltaPaise).toBe(5000);
      expect(result.blockingReasons).toHaveLength(0);
    });

    it('detects PRICE_CHANGED on price decrease (WARNING severity)', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 46000 },
      });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.priceChangedItems).toHaveLength(1);
      expect(result.priceChangedItems[0]?.acknowledgedUnitPricePaise).toBe(50000);
      expect(result.priceChangedItems[0]?.currentUnitPricePaise).toBe(46000);
      expect(result.cart.items[0]?.priceDrift?.direction).toBe('DECREASED');
      expect(result.cart.items[0]?.priceDrift?.deltaPaise).toBe(-4000);
    });

    it('evaluates regional pricing precedence and flags drift against global watermark', async () => {
      // Add bulkProduct without pincode -> acknowledged at global price 120055
      await addItemToCart(tokenA, bulkProduct._id.toString(), '0.500');

      // Validate at serviceablePincode -> regional override 115000 applies
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.priceChangedItems).toHaveLength(1);
      expect(result.priceChangedItems[0]?.acknowledgedUnitPricePaise).toBe(120055);
      expect(result.priceChangedItems[0]?.currentUnitPricePaise).toBe(115000);
      expect(result.cart.items[0]?.isServiceAreaOverride).toBe(true);
      expect(result.cart.items[0]?.lineSubtotalPaise).toBe(57500);
    });

    it('re-evaluates pricing using fresh customer B2B role from UserModel', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await request(app)
        .patch('/api/v1/cart/location')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });

      // Upgrade customerA to B2B_CUSTOMER in DB without re-issuing JWT
      await UserModel.findByIdAndUpdate(customerA._id, {
        $set: { roles: ['B2B_CUSTOMER'] },
      });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({});
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.cart.customerSegment).toBe('B2B');
      expect(result.priceChangedItems).toHaveLength(1);
      expect(result.priceChangedItems[0]?.acknowledgedUnitPricePaise).toBe(50000);
      expect(result.priceChangedItems[0]?.currentUnitPricePaise).toBe(47000);
    });

    it('detects NOT_PRICED when item loses active pricing after being added', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      // Deactivate pricing after item was added
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { isActive: false },
      });

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.isValidForCheckout).toBe(false);
      expect(result.blockingReasons.some((r) => r.code === 'NOT_PRICED')).toBe(true);
    });

    it('resolves pincode from addressId for authenticated USER', async () => {
      const addr = await CustomerAddressModel.create({
        userId: customerA._id,
        label: 'Site Office',
        recipientName: 'Test Customer A',
        phone: `${testPhonePrefix}30001`,
        streetAddress: '123 Test Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: serviceablePincode,
        isDefault: false,
      });
      createdAddressIds.push(addr._id);

      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ addressId: addr._id.toString() });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.evaluatedPincode).toBe(serviceablePincode);
      expect(result.isValidForCheckout).toBe(true);
    });

    it('returns 404 ADDRESS_NOT_FOUND when addressId belongs to another customer (Anti-IDOR)', async () => {
      const addrB = await CustomerAddressModel.create({
        userId: customerB._id,
        label: 'B Office',
        recipientName: 'Customer B',
        phone: `${testPhonePrefix}30002`,
        streetAddress: '456 Test Avenue',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: serviceablePincode,
        isDefault: false,
      });
      createdAddressIds.push(addrB._id);

      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ addressId: addrB._id.toString() });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
    });

    it('rejects guest passing addressId with 403 CUSTOMER_IDENTITY_REQUIRED', async () => {
      await addItemToGuestCart(guestToken1, discreteProduct._id.toString(), '5');
      const fakeAddressId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(guestHeader(guestToken1))
        .send({ addressId: fakeAddressId });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('returns 409 CART_VERSION_CONFLICT for wrong expectedVersion on validate', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ expectedVersion: 9999 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);
    });

    it('validate and GET /cart do not silently acknowledge price changes or mutate version', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const beforeCart = await request(app).get('/api/v1/cart').set(authHeader(tokenA));
      const beforeSummary = parseValidSummary(beforeCart.body);
      const versionBefore = beforeSummary.version;

      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 54000 },
      });

      const valRes = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(valRes.status).toBe(200);
      expect(parseValidValidationResult(valRes.body).priceChangedItems).toHaveLength(1);

      const afterCart = await request(app).get('/api/v1/cart').set(authHeader(tokenA));
      const afterSummary = parseValidSummary(afterCart.body);
      expect(afterSummary.version).toBe(versionBefore);
      expect(afterSummary.items[0]?.acknowledgedUnitPricePaise).toBe(50000);
      expect(afterSummary.hasUnacknowledgedPriceChanges).toBe(true);
    });

    it('works for guest cart (via guest token)', async () => {
      await addItemToGuestCart(guestToken1, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(guestHeader(guestToken1))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const result = parseValidValidationResult(res.body);
      expect(result.evaluatedPincode).toBe(serviceablePincode);
      expect(result.isValidForCheckout).toBe(true);
    });

    it('does not expose supplier/partner identity in validate response', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      expect(res.status).toBe(200);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('partnerId');
      expect(serialized).not.toContain('CartValTestPartnerAlphaSecret');
    });
  });

  // ============================================================
  // POST /api/v1/cart/acknowledge-prices
  // ============================================================

  describe('POST /api/v1/cart/acknowledge-prices', () => {
    async function validationSnapshot(token = tokenA, guest = false): Promise<string> {
      const req = request(app).post('/api/v1/cart/validate');
      const response = await (guest ? req.set(guestHeader(token)) : req.set(authHeader(token)))
        .send({ pincode: serviceablePincode });
      expect(response.status).toBe(200);
      const parsed = parseValidValidationResult(response.body);
      expect(parsed.validationSnapshotId).toBeTruthy();
      return parsed.validationSnapshotId!;
    }

    it('requires authentication or guest token', async () => {
      const res = await request(app).post('/api/v1/cart/acknowledge-prices').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_TOKEN_REQUIRED);
    });

    it('rejects PARTNER user type', async () => {
      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(partnerToken))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects unknown fields (strict schema)', async () => {
      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ unknownField: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects empty itemIds array', async () => {
      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ itemIds: [] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when cart does not exist', async () => {
      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);
    });

    it('acknowledges all items when itemIds omitted', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(200);
      const summary = parseValidSummary(res.body);
      expect(summary.hasUnacknowledgedPriceChanges).toBe(false);
      const item = summary.items[0];
      expect(item?.priceDrift?.hasChanged).toBe(false);
      expect(item?.priceDrift?.acknowledgedUnitPricePaise).toBe(55000);
    });

    it('acknowledges decimal quantity standalone product cleanly (precision 3)', async () => {
      await addItemToCart(tokenA, bulkProduct._id.toString(), '0.500');
      await ProductPricingModel.findByIdAndUpdate(bulkGlobalPricing._id, {
        $set: { b2cPricePaise: 125000 },
      });

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(200);
      const summary = parseValidSummary(res.body);
      expect(summary.hasUnacknowledgedPriceChanges).toBe(false);
      expect(summary.items[0]?.acknowledgedUnitPricePaise).toBe(115000);
      expect(summary.items[0]?.lineSubtotalPaise).toBe(57500);
    });

    it('acknowledges only specified itemId without modifying unrelated items', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const twoItemCart = await addItemToCart(tokenA, bulkProduct._id.toString(), '0.500');

      const discreteItemId = twoItemCart.items.find(
        (i) => i.productId === discreteProduct._id.toString(),
      )?.itemId;
      const bulkItemId = twoItemCart.items.find(
        (i) => i.productId === bulkProduct._id.toString(),
      )?.itemId;
      expect(discreteItemId).toBeTruthy();
      expect(bulkItemId).toBeTruthy();

      // Drift BOTH items
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });
      await ProductPricingModel.findByIdAndUpdate(bulkGlobalPricing._id, {
        $set: { b2cPricePaise: 130000 },
      });

      // Acknowledge ONLY discreteItemId
      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ itemIds: [discreteItemId], validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(200);
      const summary = parseValidSummary(res.body);

      const updatedDiscrete = summary.items.find((i) => i.itemId === discreteItemId);
      const untouchedBulk = summary.items.find((i) => i.itemId === bulkItemId);

      expect(updatedDiscrete?.priceDrift?.hasChanged).toBe(false);
      expect(updatedDiscrete?.acknowledgedUnitPricePaise).toBe(55000);

      expect(untouchedBulk?.priceDrift?.hasChanged).toBe(true);
      expect(untouchedBulk?.acknowledgedUnitPricePaise).toBe(120055);
      expect(summary.hasUnacknowledgedPriceChanges).toBe(true);
    });

    it('returns 404 for non-existent itemId in this cart', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const fakeItemId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ itemIds: [fakeItemId], validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);
    });

    it('returns 409 CART_VERSION_CONFLICT for wrong expectedVersion', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ expectedVersion: 9999, validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);
    });

    it('is safely repeatable with fresh version and increments cart version', async () => {
      const initial = await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const firstAck = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ expectedVersion: initial.version, validationSnapshotId: await validationSnapshot() });
      expect(firstAck.status).toBe(200);
      const firstSummary = parseValidSummary(firstAck.body);
      expect(firstSummary.version).toBe(initial.version + 1);
      expect(firstSummary.hasUnacknowledgedPriceChanges).toBe(false);

      const secondAck = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ expectedVersion: firstSummary.version, validationSnapshotId: await validationSnapshot() });
      expect(secondAck.status).toBe(200);
      const secondSummary = parseValidSummary(secondAck.body);
      expect(secondSummary.version).toBe(firstSummary.version + 1);
      expect(secondSummary.hasUnacknowledgedPriceChanges).toBe(false);
    });

    it('handles concurrent acknowledge-prices with optimistic locking', async () => {
      const initial = await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const snapshotId = await validationSnapshot();
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/cart/acknowledge-prices')
          .set(authHeader(tokenA))
          .send({ expectedVersion: initial.version, validationSnapshotId: snapshotId }),
        request(app)
          .post('/api/v1/cart/acknowledge-prices')
          .set(authHeader(tokenA))
          .send({ expectedVersion: initial.version, validationSnapshotId: snapshotId }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('prevents cross-customer access to acknowledgement', async () => {
      const cartA = await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const itemId = cartA.items[0]?.itemId;
      const snapshotId = await validationSnapshot(tokenA);

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenB))
        .send({ itemIds: [itemId], validationSnapshotId: snapshotId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);
    });

    it('validate after acknowledge shows isValidForCheckout = true when no blocking issues', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const validateBefore = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      const resultBefore = parseValidValidationResult(validateBefore.body);
      expect(resultBefore.priceChangedItems).toHaveLength(1);
      expect(resultBefore.isValidForCheckout).toBe(false);

      await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ validationSnapshotId: resultBefore.validationSnapshotId });

      const validateAfter = await request(app)
        .post('/api/v1/cart/validate')
        .set(authHeader(tokenA))
        .send({ pincode: serviceablePincode });
      const resultAfter = parseValidValidationResult(validateAfter.body);
      expect(resultAfter.priceChangedItems).toHaveLength(0);
      expect(resultAfter.isValidForCheckout).toBe(true);
    });

    it('does not expose supplier/partner identity in acknowledge response', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA))
        .send({ validationSnapshotId: await validationSnapshot() });
      expect(res.status).toBe(200);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('partnerId');
      expect(serialized).not.toContain('CartValTestPartnerAlphaSecret');
    });

    it('works for guest cart (via guest token)', async () => {
      await addItemToGuestCart(guestToken1, discreteProduct._id.toString(), '5');
      await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
        $set: { b2cPricePaise: 55000 },
      });

      const res = await request(app)
        .post('/api/v1/cart/acknowledge-prices')
        .set(guestHeader(guestToken1))
        .send({ validationSnapshotId: await validationSnapshot(guestToken1, true) });
      expect(res.status).toBe(200);
      const summary = parseValidSummary(res.body);
      expect(summary.hasUnacknowledgedPriceChanges).toBe(false);
    });

    it('returns 409 CART_VERSION_CONFLICT if concurrent update causes findOneAndUpdate to return null', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const spy = vi.spyOn(CartModel, 'findOneAndUpdate').mockResolvedValueOnce(null as never);
      try {
        const res = await request(app)
          .post('/api/v1/cart/acknowledge-prices')
          .set(authHeader(tokenA))
          .send({ validationSnapshotId: await validationSnapshot() });
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);
      } finally {
        spy.mockRestore();
      }
    });

    it('isolates customer validation snapshots and keeps guest snapshot ownership token-bound', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      await addItemToCart(tokenB, discreteProduct._id.toString(), '5');
      const customerSnapshotId = await validationSnapshot(tokenA);
      const crossCustomer = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenB)).send({ validationSnapshotId: customerSnapshotId });
      expect(crossCustomer.status).toBe(404);
      expect(crossCustomer.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_NOT_FOUND);

      await addItemToGuestCart(guestToken1, discreteProduct._id.toString(), '5');
      const guestSnapshotId = await validationSnapshot(guestToken1, true);
      const guestWithWrongToken = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(guestHeader('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
        .send({ validationSnapshotId: guestSnapshotId });
      expect(guestWithWrongToken.status).toBe(404);
      const guestAck = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(guestHeader(guestToken1)).send({ validationSnapshotId: guestSnapshotId });
      expect(guestAck.status).toBe(200);
    });

    it('rejects expired snapshots and cart version changes', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const expiredId = await validationSnapshot();
      await CartValidationSnapshotModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(expiredId) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA)).send({ validationSnapshotId: expiredId });
      expect(expired.status).toBe(410);
      expect(expired.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_EXPIRED);

      const freshId = await validationSnapshot();
      await CartModel.updateOne({ userId: customerA._id }, { $inc: { version: 1 } });
      const stale = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA)).send({ validationSnapshotId: freshId });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);
    });

    it('rejects price, quantity and item identity changes after validation', async () => {
      const initial = await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const priceSnapshot = await validationSnapshot();
      await ProductPricingModel.updateOne({ _id: discreteGlobalPricing._id }, { $set: { b2cPricePaise: 55500 } });
      const changedPrice = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA)).send({ validationSnapshotId: priceSnapshot });
      expect(changedPrice.status).toBe(409);
      expect(changedPrice.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);

      const quantitySnapshot = await validationSnapshot();
      await request(app).patch(`/api/v1/cart/items/${initial.items[0]!.itemId}`)
        .set(authHeader(tokenA)).send({ quantity: '6' });
      const changedQuantity = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA)).send({ validationSnapshotId: quantitySnapshot });
      expect(changedQuantity.status).toBe(409);
      expect(changedQuantity.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);

      const itemSnapshot = await validationSnapshot();
      await request(app).delete(`/api/v1/cart/items/${initial.items[0]!.itemId}`).set(authHeader(tokenA));
      const changedItems = await request(app).post('/api/v1/cart/acknowledge-prices')
        .set(authHeader(tokenA)).send({ validationSnapshotId: itemSnapshot });
      expect(changedItems.status).toBe(409);
      expect(changedItems.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);
    });

    it('does not treat replaying the same acknowledgement snapshot as a fresh acknowledgement', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const snapshotId = await validationSnapshot();
      const body = { validationSnapshotId: snapshotId };
      const first = await request(app).post('/api/v1/cart/acknowledge-prices').set(authHeader(tokenA)).send(body);
      const replay = await request(app).post('/api/v1/cart/acknowledge-prices').set(authHeader(tokenA)).send(body);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(409);
      expect(replay.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);
    });

    it('leaves CartModel unchanged while each eligible validation persists a fresh infrastructure snapshot', async () => {
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const before = await CartModel.findOne({ userId: customerA._id }).lean();
      const countBefore = await CartValidationSnapshotModel.countDocuments({ cartId: before!._id });
      const first = parseValidValidationResult((await request(app).post('/api/v1/cart/validate')
        .set(authHeader(tokenA)).send({ pincode: serviceablePincode })).body);
      const second = parseValidValidationResult((await request(app).post('/api/v1/cart/validate')
        .set(authHeader(tokenA)).send({ pincode: serviceablePincode })).body);
      const after = await CartModel.findOne({ userId: customerA._id }).lean();
      expect(after?.version).toBe(before?.version);
      expect(after?.updatedAt?.toISOString()).toBe(before?.updatedAt?.toISOString());
      expect(after?.items).toEqual(before?.items);
      expect(first.validationSnapshotId).not.toBe(second.validationSnapshotId);
      expect(await CartValidationSnapshotModel.countDocuments({ cartId: before!._id })).toBe(countBefore + 2);

      const snapshotsBeforeAck = await CartValidationSnapshotModel.countDocuments({ cartId: before!._id });
      const ack = await request(app).post('/api/v1/cart/acknowledge-prices').set(authHeader(tokenA))
        .send({ validationSnapshotId: second.validationSnapshotId });
      expect(ack.status).toBe(200);
      // Acknowledgement's internal authoritative revalidation is not an extra snapshot-producing API validation.
      expect(await CartValidationSnapshotModel.countDocuments({ cartId: before!._id })).toBe(snapshotsBeforeAck);
    });

    it('rejects a variant price change after the customer reviewed the validation snapshot', async () => {
      const added = await request(app).post('/api/v1/cart/items').set(authHeader(tokenA))
        .send({ productId: parentWithVariants._id.toString(), variantId: activeVariant._id.toString(), quantity: '1' });
      expect(added.status).toBe(200);
      const snapshotId = await validationSnapshot();
      await ProductPricingModel.updateOne({ _id: variantPricing._id }, { $set: { b2cPricePaise: variantPricing.b2cPricePaise + 100 } });
      const changed = await request(app).post('/api/v1/cart/acknowledge-prices').set(authHeader(tokenA))
        .send({ validationSnapshotId: snapshotId });
      expect(changed.status).toBe(409);
      expect(changed.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);
    });
  });

  describe('Milestone 5B.4 checkout preparation backend', () => {
    async function readyContext() {
      const addressId = await createServiceableAddress();
      await addItemToCart(tokenA, discreteProduct._id.toString(), '5');
      const validateForAck = await request(app).post('/api/v1/cart/validate').set(authHeader(tokenA))
        .send({ addressId: addressId.toString() });
      const firstValidation = parseValidValidationResult(validateForAck.body);
      const ack = await request(app).post('/api/v1/cart/acknowledge-prices').set(authHeader(tokenA))
        .send({ validationSnapshotId: firstValidation.validationSnapshotId });
      expect(ack.status).toBe(200);
      const current = await request(app).post('/api/v1/cart/validate').set(authHeader(tokenA))
        .send({ addressId: addressId.toString() });
      const validation = parseValidValidationResult(current.body);
      expect(validation.isValidForCheckout).toBe(true);
      return { addressId: addressId.toString(), snapshotId: validation.validationSnapshotId!, version: validation.cart.version };
    }

    async function prepare(context: {addressId: string; snapshotId: string; version: number}, key = new mongoose.Types.ObjectId().toString(), addressId = context.addressId, token = tokenA) {
      return request(app).post('/api/v1/checkout/prepare').set(authHeader(token)).set('Idempotency-Key', key)
        .send({ addressId, expectedCartVersion: context.version, validationSnapshotId: context.snapshotId });
    }

    it('rejects stale, expired, foreign-owner and address-mismatched validation snapshots', async () => {
      const context = await readyContext();
      const foreign = await prepare(context, 'foreign-snapshot-test-key', context.addressId, tokenB);
      expect(foreign.status).toBe(404);

      const secondAddress = await createServiceableAddress();
      const mismatch = await prepare(context, 'address-mismatch-test-key', secondAddress.toString());
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);

      await CustomerAddressModel.updateOne({ _id: context.addressId }, { $set: { pincode: outOfStockPincode } });
      const pinMismatch = await prepare(context, 'pin-mismatch-test-key');
      expect(pinMismatch.status).toBe(409);
      expect(pinMismatch.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE);

      await CartValidationSnapshotModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(context.snapshotId) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await prepare(context, 'expired-checkout-snapshot-key');
      expect(expired.status).toBe(410);
      expect(expired.body.error.code).toBe(CART_ERROR_CODES.VALIDATION_SNAPSHOT_EXPIRED);
    });

    it('rejects checkout preparation after cart quantity or price changes since validation', async () => {
      const quantityContext = await readyContext();
      const cart = await CartModel.findOne({ userId: customerA._id });
      await request(app).patch(`/api/v1/cart/items/${cart!.items[0]!._id}`).set(authHeader(tokenA)).send({ quantity: '6' });
      const staleQuantity = await prepare(quantityContext, 'stale-quantity-key');
      expect(staleQuantity.status).toBe(409);

      const priceContext = await readyContext();
      await ProductPricingModel.updateOne({ _id: discreteGlobalPricing._id }, { $set: { b2cPricePaise: 57000 } });
      const stalePrice = await prepare(priceContext, 'stale-price-key');
      expect(stalePrice.status).toBe(422);
      expect(stalePrice.body.error.code).toBe('PRICE_DRIFT_UNACKNOWLEDGED');
    });

    it('prepares a pre-order snapshot and replays the same idempotency payload', async () => {
      const context = await readyContext();
      const key = 'checkout-idempotent-replay-key';
      const before = (await mongoose.connection.db!.listCollections().toArray()).map((item) => item.name);
      const availabilityBefore = await PartnerProductModel.countDocuments({});
      const cartBeforePrepare = await CartModel.findOne({ userId: customerA._id });
      const snapshotsBeforePrepare = await CartValidationSnapshotModel.countDocuments({ cartId: cartBeforePrepare!._id });
      const first = await prepare(context, key);
      expect(await CartValidationSnapshotModel.countDocuments({ cartId: cartBeforePrepare!._id })).toBe(snapshotsBeforePrepare);
      const sessionId = first.body.data.session.sessionId as string;
      const sessionBeforeApiWrite = await CheckoutSessionModel.findById(sessionId).lean();
      const attemptedMutation = await request(app).patch(`/api/v1/checkout/sessions/${sessionId}`)
        .set(authHeader(tokenA)).send({ materialSubtotalPaise: 1, status: 'PREPARED' });
      expect(attemptedMutation.status).toBe(404);
      const sessionAfterApiWrite = await CheckoutSessionModel.findById(sessionId).lean();
      expect(sessionAfterApiWrite?.materialSubtotalPaise).toBe(sessionBeforeApiWrite?.materialSubtotalPaise);
      expect(sessionAfterApiWrite?.items).toEqual(sessionBeforeApiWrite?.items);
      const replayValidation = parseValidValidationResult((await request(app).post('/api/v1/cart/validate')
        .set(authHeader(tokenA)).send({ addressId: context.addressId })).body);
      const replay = await prepare({ ...context, snapshotId: replayValidation.validationSnapshotId! }, key);
      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.data.idempotentReplay).toBe(true);
      expect(replay.body.data.session.deliveryFeeStatus).toBe(CHECKOUT_DELIVERY_FEE_STATUS);
      expect(replay.body.data.session.taxStatus).toBe(CHECKOUT_TAX_STATUS);
      expect(replay.body.data.session.materialSubtotalPaise).toBe(250000);
      expect(replay.body.data.session.items[0].unitPricePaise).toBe(50000);
      expect(await CartValidationSnapshotModel.countDocuments({ cartId: cartBeforePrepare!._id })).toBe(snapshotsBeforePrepare + 1);

      const alternateAddressId = await createServiceableAddress();
      const alternateValidation = parseValidValidationResult((await request(app).post('/api/v1/cart/validate')
        .set(authHeader(tokenA)).send({ addressId: alternateAddressId.toString() })).body);
      const payloadMismatch = await prepare({ addressId: alternateAddressId.toString(),
        snapshotId: alternateValidation.validationSnapshotId!, version: alternateValidation.cart.version }, key);
      expect(payloadMismatch.status).toBe(409);
      expect(payloadMismatch.body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

      const concurrentKey = 'checkout-concurrent-idempotency-key';
      const concurrent = await Promise.all([prepare(context, concurrentKey), prepare(context, concurrentKey)]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
      const after = (await mongoose.connection.db!.listCollections().toArray()).map((item) => item.name);
      expect(await PartnerProductModel.countDocuments({})).toBe(availabilityBefore);
      const forbidden = /^(orders|fulfilment_units|inventory_reservations|payments|payment_intents|tax_calculations|delivery_fee_calculations)$/i;
      expect(after.filter((name) => forbidden.test(name)).sort()).toEqual(before.filter((name) => forbidden.test(name)).sort());
    });

    it('returns superseded sessions as superseded and rejects their idempotent replay', async () => {
      const context = await readyContext();
      const first = await prepare(context, 'first-session-to-supersede');
      const second = await prepare(context, 'second-session-supersedes-first');
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstSessionId = first.body.data.session.sessionId as string;
      const readSuperseded = await request(app).get(`/api/v1/checkout/sessions/${firstSessionId}`).set(authHeader(tokenA));
      expect(readSuperseded.status).toBe(200);
      expect(readSuperseded.body.data.status).toBe('SUPERSEDED');
      const replay = await prepare(context, 'first-session-to-supersede');
      expect(replay.status).toBe(409);
      expect(replay.body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    });

    it('keeps exactly one active prepared session when different-key requests race', async () => {
      const context = await readyContext();
      const originalUpdateMany = CheckoutSessionModel.updateMany.bind(CheckoutSessionModel);
      let arrivals = 0;
      let release!: () => void;
      const bothRequestsReady = new Promise<void>((resolve) => { release = resolve; });
      const updateBarrier = vi.spyOn(CheckoutSessionModel, 'updateMany').mockImplementation((...args) => {
        arrivals += 1;
        if (arrivals === 2) release();
        return bothRequestsReady.then(() => originalUpdateMany(...args));
      });

      let results;
      try {
        results = await Promise.all([
          prepare(context, 'checkout-racing-active-session-a'),
          prepare(context, 'checkout-racing-active-session-b'),
        ]);
      } finally {
        updateBarrier.mockRestore();
      }

      expect(results.map((response) => response.status).sort()).toEqual([201, 201]);
      const prepared = await CheckoutSessionModel.find({ userId: customerA._id, status: 'PREPARED' }).lean();
      expect(prepared).toHaveLength(1);
      const sessions = await CheckoutSessionModel.find({ userId: customerA._id }).lean();
      expect(sessions.filter((session) => session.status === 'SUPERSEDED')).toHaveLength(1);
    });

    it('returns expired sessions as gone and rejects expired idempotency replays', async () => {
      const context = await readyContext();
      const key = 'expired-checkout-session-replay';
      const prepared = await prepare(context, key);
      expect(prepared.status).toBe(201);
      const sessionId = prepared.body.data.session.sessionId as string;
      await CheckoutSessionModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(sessionId) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const readExpired = await request(app).get(`/api/v1/checkout/sessions/${sessionId}`).set(authHeader(tokenA));
      expect(readExpired.status).toBe(410);
      const replay = await prepare(context, key);
      expect(replay.status).toBe(409);
      expect(replay.body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    });
  });
});
