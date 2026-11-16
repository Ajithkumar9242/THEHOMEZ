import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import type { Application } from 'express';
import request from 'supertest';
import mongoose, { type Types } from 'mongoose';
import pino from 'pino';
import {
  CART_ERROR_CODES,
  CART_SESSION_TOKEN_HEADER,
  MAX_CART_ITEMS,
  UserStatus,
  UserType,
  cartSummaryDtoSchema,
  type ICartSummaryDto,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel, type ICategoryDocument } from '../src/models/category.model.js';
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
import { RoleModel } from '../src/models/role.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { TokenService, hashToken } from '../src/services/token/token.service.js';
import { CartController } from '../src/controllers/cart.controller.js';
import { createCartRouter } from '../src/routes/cart.routes.js';
import express from 'express';
import { errorHandlerMiddleware } from '../src/middleware/error-handler.js';

describe('Milestone 5B.2: Customer Cart (Backend)', () => {
  let isDbConnected = false;
  let app: Application;
  let concurrencyApp: Application;
  let tokenService: TokenService;

  const dummyAdminId = new mongoose.Types.ObjectId();

  // Users & tokens (isolated phone range +9194444xxxxx)
  let customerA: IUserDocument;
  let customerB: IUserDocument;
  let suspendedCustomer: IUserDocument;
  let pendingCustomer: IUserDocument;
  let partnerUser: IUserDocument;
  let staffUser: IUserDocument;

  let tokenA: string;
  let tokenB: string;
  let suspendedToken: string;
  let pendingToken: string;
  let partnerToken: string;
  let staffToken: string;

  const guestToken1 = '11111111-1111-4111-8111-111111111111';
  const guestToken2 = '22222222-2222-4222-9222-222222222222';

  // Service Areas & PINs (isolated non-demo PINs)
  let saRegional: IServiceAreaDocument;
  let saEmptyStock: IServiceAreaDocument;
  let saInactive: IServiceAreaDocument;
  const regionalPincode = '560981';
  const emptyStockPincode = '560982';
  const inactivePincode = '560983';
  const unmappedPincode = '560984';

  // Partners (strictly excluded from API responses)
  let partnerAlpha: IPartnerDocument;
  let partnerBeta: IPartnerDocument;

  // Categories
  let categoryDoc: ICategoryDocument;
  let subcategoryDoc: ICategoryDocument;

  // Catalog fixtures
  let discreteProduct: IProductDocument; // precision 0, MOQ 5, step 2, max 50
  let bulkProduct: IProductDocument; // precision 3, MOQ "0.500", step "0.250", max "25.000"
  let parentWithVariants: IProductDocument;
  let activeVariant12mm: IProductVariantDocument;
  let archivedVariant: IProductVariantDocument;
  let draftProduct: IProductDocument;
  let unpricedProduct: IProductDocument;
  let discreteGlobalPricing: IProductPricingDocument;

  // 50+ distinct products for max-cart-item tests (created on demand or tracked for cleanup)
  const bulkExtraProducts: IProductDocument[] = [];
  const createdCategoryIds: Types.ObjectId[] = [];
  const createdProductIds: Types.ObjectId[] = [];
  const createdVariantIds: Types.ObjectId[] = [];
  const createdPricingIds: Types.ObjectId[] = [];
  const createdPartnerIds: Types.ObjectId[] = [];
  const createdPartnerProductIds: Types.ObjectId[] = [];
  const createdServiceAreaIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [];

  const testPhonePrefix = '+9194444';
  const partnerPhonePrefix = '+9194445';
  const testSaPrefix = 'CART-TEST-SA-';
  const testSlugPrefix = 'cart-test-';
  const testSkuPrefix = 'CARTTEST-';

  function parseValidSummary(body: unknown): ICartSummaryDto {
    const envelope = body as { success: boolean; data: unknown };
    expect(envelope.success).toBe(true);
    return cartSummaryDtoSchema.parse(envelope.data);
  }

  function assertNoSupplierLeaks(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('partnerId');
    expect(serialized).not.toContain('businessName');
    expect(serialized).not.toContain('partnerCustomSku');
    expect(serialized).not.toContain(partnerAlpha._id.toString());
    expect(serialized).not.toContain(partnerBeta._id.toString());
    expect(serialized).not.toContain('CartTestPartnerAlphaSecretName');
    expect(serialized).not.toContain('CartTestPartnerBetaSecretName');
    expect(serialized).not.toContain('SECRET-SUPPLIER-SKU');
  }

  async function cleanupTestFixtures(): Promise<void> {
    if (!isDbConnected) return;

    await CartModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        {
          ownerType: 'GUEST',
          sessionTokenHash: { $in: [hashToken(guestToken1), hashToken(guestToken2)] },
        },
      ],
    });

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

    // Defensive cleanup for any leftover cart-test prefixed fixtures
    await ProductModel.deleteMany({ slug: { $regex: /^cart-test-/ } });
    await ProductVariantModel.deleteMany({ sku: { $regex: /^CARTTEST-/ } });
    await CategoryModel.deleteMany({ slug: { $regex: /^cart-test-/ } });
    await ServiceAreaModel.deleteMany({ code: { $regex: /^CART-TEST-SA-/ } });
    await PartnerModel.deleteMany({ phone: { $regex: /^\+9194445/ } });
    await UserModel.deleteMany({ phone: { $regex: /^\+9194444/ } });
    await RoleModel.deleteMany({ code: { $regex: /^CART_TEST_/ } });
  }

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    app = createApp();
    concurrencyApp = createApp();

    if (!isDbConnected) return;

    await cleanupTestFixtures();
    await seedApprovedUnits();

    await RoleModel.create([
      {
        code: 'CART_TEST_ADMIN',
        name: 'Cart Test Admin Role',
        userType: UserType.STAFF,
        permissions: [],
      },
    ]);

    customerA = await UserModel.create({
      phone: `${testPhonePrefix}00001`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    customerB = await UserModel.create({
      phone: `${testPhonePrefix}00002`,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
    });
    suspendedCustomer = await UserModel.create({
      phone: `${testPhonePrefix}00003`,
      userType: UserType.CUSTOMER,
      status: UserStatus.SUSPENDED,
      roles: [],
    });
    pendingCustomer = await UserModel.create({
      phone: `${testPhonePrefix}00004`,
      userType: UserType.CUSTOMER,
      status: UserStatus.PENDING_VERIFICATION,
      roles: [],
    });
    partnerUser = await UserModel.create({
      phone: `${testPhonePrefix}00005`,
      userType: UserType.PARTNER,
      status: UserStatus.ACTIVE,
      partnerId: new mongoose.Types.ObjectId(),
      roles: [],
    });
    staffUser = await UserModel.create({
      phone: `${testPhonePrefix}00006`,
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CART_TEST_ADMIN'],
    });

    createdUserIds.push(
      customerA._id,
      customerB._id,
      suspendedCustomer._id,
      pendingCustomer._id,
      partnerUser._id,
      staffUser._id,
    );

    tokenA = tokenService.signAccessToken(customerA);
    tokenB = tokenService.signAccessToken(customerB);
    suspendedToken = tokenService.signAccessToken(suspendedCustomer);
    pendingToken = tokenService.signAccessToken(pendingCustomer);
    partnerToken = tokenService.signAccessToken(partnerUser);
    staffToken = tokenService.signAccessToken(staffUser);

    saRegional = await ServiceAreaModel.create({
      code: `${testSaPrefix}REGIONAL`,
      name: 'Cart Test Regional Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: [regionalPincode],
      isActive: true,
    });
    saEmptyStock = await ServiceAreaModel.create({
      code: `${testSaPrefix}EMPTY`,
      name: 'Cart Test Empty Stock Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: [emptyStockPincode],
      isActive: true,
    });
    saInactive = await ServiceAreaModel.create({
      code: `${testSaPrefix}INACTIVE`,
      name: 'Cart Test Inactive Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: [inactivePincode],
      isActive: false,
    });
    createdServiceAreaIds.push(saRegional._id, saEmptyStock._id, saInactive._id);

    partnerAlpha = await PartnerModel.create({
      businessName: 'CartTestPartnerAlphaSecretName',
      phone: `${partnerPhonePrefix}00001`,
      serviceAreaIds: [saRegional._id],
      status: 'ACTIVE',
    });
    partnerBeta = await PartnerModel.create({
      businessName: 'CartTestPartnerBetaSecretName',
      phone: `${partnerPhonePrefix}00002`,
      serviceAreaIds: [saRegional._id],
      status: 'ACTIVE',
    });
    createdPartnerIds.push(partnerAlpha._id, partnerBeta._id);

    categoryDoc = await CategoryModel.create({
      name: 'Cart Test Construction Materials',
      slug: `${testSlugPrefix}root-materials`,
      level: 0,
      isActive: true,
      displayOrder: 1,
    });
    subcategoryDoc = await CategoryModel.create({
      name: 'Cart Test Cement & Aggregates',
      slug: `${testSlugPrefix}sub-cement`,
      parentId: categoryDoc._id,
      level: 1,
      isActive: true,
      displayOrder: 1,
    });
    createdCategoryIds.push(categoryDoc._id, subcategoryDoc._id);

    const now = new Date();

    discreteProduct = await ProductModel.create({
      slug: `${testSlugPrefix}cement-53`,
      title: 'OPC 53 Grade Cement (50kg)',
      brand: 'UltraBuild',
      categoryId: categoryDoc._id,
      subcategoryId: subcategoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}CEMENT-53`,
      status: 'ACTIVE',
      images: ['https://cdn.example.com/cement.jpg'],
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '5',
      maxOrderQuantity: '50',
      stepIncrement: '2',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    bulkProduct = await ProductModel.create({
      slug: `${testSlugPrefix}river-sand`,
      title: 'Washed M-Sand Bulk',
      brand: 'QuarryPro',
      categoryId: categoryDoc._id,
      subcategoryId: subcategoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}MSAND`,
      status: 'ACTIVE',
      images: ['https://cdn.example.com/msand.jpg'],
      unitCode: 'TON',
      quantityPrecision: 3,
      minOrderQuantity: '0.500',
      maxOrderQuantity: '25.000',
      stepIncrement: '0.250',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    parentWithVariants = await ProductModel.create({
      slug: `${testSlugPrefix}tmt-rebar`,
      title: 'Fe-550D TMT Steel Bar',
      brand: 'TataTest',
      categoryId: categoryDoc._id,
      subcategoryId: subcategoryDoc._id,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      images: ['https://cdn.example.com/tmt.jpg'],
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    draftProduct = await ProductModel.create({
      slug: `${testSlugPrefix}draft-bricks`,
      title: 'Draft Hollow Blocks',
      brand: 'BlockCraft',
      categoryId: categoryDoc._id,
      subcategoryId: subcategoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}DRAFT-BLK`,
      status: 'DRAFT',
      images: [],
      unitCode: 'PCS',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '10',
      publishedAt: null,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    unpricedProduct = await ProductModel.create({
      slug: `${testSlugPrefix}unpriced-tile`,
      title: 'Unpriced Vitrified Tile',
      brand: 'TilePro',
      categoryId: categoryDoc._id,
      subcategoryId: subcategoryDoc._id,
      hasVariants: false,
      sku: `${testSkuPrefix}UNPRICED`,
      status: 'ACTIVE',
      images: [],
      unitCode: 'SQFT',
      quantityPrecision: 2,
      minOrderQuantity: '10',
      stepIncrement: '5',
      publishedAt: now,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdProductIds.push(
      discreteProduct._id,
      bulkProduct._id,
      parentWithVariants._id,
      draftProduct._id,
      unpricedProduct._id,
    );

    activeVariant12mm = await ProductVariantModel.create({
      productId: parentWithVariants._id,
      sku: `${testSkuPrefix}TMT-12MM`,
      title: '12mm Standard Bundle',
      status: 'ACTIVE',
      attributes: { diameter: '12mm', grade: 'Fe550D' },
      images: ['https://cdn.example.com/tmt-12.jpg'],
      unitCode: 'MT',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      maxOrderQuantity: '100.00',
      stepIncrement: '0.50',
      publishedAt: now,
    });

    archivedVariant = await ProductVariantModel.create({
      productId: parentWithVariants._id,
      sku: `${testSkuPrefix}TMT-ARCHIVED`,
      title: '32mm Archived Bundle',
      status: 'ARCHIVED',
      attributes: { diameter: '32mm' },
      images: [],
      unitCode: 'MT',
      quantityPrecision: 2,
      minOrderQuantity: '1.00',
      stepIncrement: '0.50',
      publishedAt: null,
    });

    createdVariantIds.push(activeVariant12mm._id, archivedVariant._id);

    discreteGlobalPricing = await ProductPricingModel.create({
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 40000, // ₹400.00 / bag
      b2cMrpPaise: 45000,
      b2bPricePaise: 37500, // ₹375.00 / bag base B2B
      b2bTiers: [
        { minQuantity: '11', pricePaise: 36000 }, // TIER_1
      ],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const discreteRegionalPricing = await ProductPricingModel.create({
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: saRegional._id,
      pricingScope: 'STANDALONE_REGIONAL',
      b2cPricePaise: 38500, // Regional override lower price
      b2cMrpPaise: 45000,
      b2bPricePaise: 36500,
      b2bTiers: [{ minQuantity: '11', pricePaise: 35000 }],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const bulkGlobalPricing = await ProductPricingModel.create({
      productId: bulkProduct._id,
      variantId: null,
      serviceAreaId: null,
      pricingScope: 'STANDALONE_GLOBAL',
      b2cPricePaise: 120055, // ₹1,200.55 / ton -> tests HALF_UP fractional rounding
      b2cMrpPaise: 140000,
      b2bPricePaise: 110000,
      b2bTiers: [],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const variantPricing = await ProductPricingModel.create({
      productId: parentWithVariants._id,
      variantId: activeVariant12mm._id,
      serviceAreaId: null,
      pricingScope: 'VARIANT_GLOBAL',
      b2cPricePaise: 6200000,
      b2cMrpPaise: 6500000,
      b2bPricePaise: null, // fallback to B2C for B2B
      b2bTiers: [],
      isActive: true,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdPricingIds.push(
      discreteGlobalPricing._id,
      discreteRegionalPricing._id,
      bulkGlobalPricing._id,
      variantPricing._id,
    );

    const ppAlpha = await PartnerProductModel.create({
      partnerId: partnerAlpha._id,
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: saRegional._id,
      isAvailable: true,
      partnerCustomSku: 'SECRET-SUPPLIER-SKU-01',
      minLeadTimeHours: 12,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const ppBeta = await PartnerProductModel.create({
      partnerId: partnerBeta._id,
      productId: discreteProduct._id,
      variantId: null,
      serviceAreaId: saRegional._id,
      isAvailable: true,
      partnerCustomSku: 'SECRET-SUPPLIER-SKU-02',
      minLeadTimeHours: 4, // Minimum lead time across partners
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    const ppVariant = await PartnerProductModel.create({
      partnerId: partnerAlpha._id,
      productId: parentWithVariants._id,
      variantId: activeVariant12mm._id,
      serviceAreaId: saRegional._id,
      isAvailable: true,
      minLeadTimeHours: 24,
      createdBy: dummyAdminId,
      updatedBy: dummyAdminId,
    });

    createdPartnerProductIds.push(ppAlpha._id, ppBeta._id, ppVariant._id);
  });

  beforeEach(async () => {
    if (!isDbConnected) return;

    await CartModel.deleteMany({
      $or: [
        { userId: { $in: createdUserIds } },
        {
          ownerType: 'GUEST',
          sessionTokenHash: { $in: [hashToken(guestToken1), hashToken(guestToken2)] },
        },
      ],
    });

    // Reset customerA/B roles cleanly and ensure discreteProduct/variant/pricing baseline state
    await UserModel.findByIdAndUpdate(customerA._id, {
      $set: { status: UserStatus.ACTIVE, roles: [] },
    });
    await UserModel.findByIdAndUpdate(customerB._id, {
      $set: { status: UserStatus.ACTIVE, roles: [] },
    });
    await ProductModel.findByIdAndUpdate(discreteProduct._id, {
      $set: { status: 'ACTIVE', publishedAt: new Date() },
    });
    await ProductVariantModel.findByIdAndUpdate(activeVariant12mm._id, {
      $set: { status: 'ACTIVE', publishedAt: new Date() },
    });
    await ProductPricingModel.findByIdAndUpdate(discreteGlobalPricing._id, {
      $set: { b2cPricePaise: 40000, isActive: true },
    });
  });

  afterAll(async () => {
    await cleanupTestFixtures();
    if (isDbConnected) {
      await disconnectDatabase();
    }
  });

  describe('1. Authentication, Guards, Ownership & Security', () => {
    it('rejects unauthenticated requests lacking X-Cart-Session-Token with 400 CART_TOKEN_REQUIRED', async () => {
      if (!isDbConnected) return;

      const getRes = await request(app).get('/api/v1/cart');
      expect(getRes.status).toBe(400);
      expect(getRes.body.error.code).toBe(CART_ERROR_CODES.CART_TOKEN_REQUIRED);

      const postRes = await request(app).post('/api/v1/cart/items').send({
        productId: discreteProduct._id.toString(),
        quantity: '5',
      });
      expect(postRes.status).toBe(400);
      expect(postRes.body.error.code).toBe(CART_ERROR_CODES.CART_TOKEN_REQUIRED);
    });

    it('rejects malformed or non-UUID-v4 guest tokens with 400 INVALID_CART_TOKEN', async () => {
      if (!isDbConnected) return;

      const badTokens = [
        'not-a-uuid',
        '11111111-1111-1111-8111-111111111111', // UUID v1 version nibble
        '11111111-1111-4111-0111-111111111111', // invalid variant nibble
        '11111111-1111-4111-8111-111111111111; DROP TABLE carts',
      ];

      for (const badToken of badTokens) {
        const res = await request(app)
          .get('/api/v1/cart')
          .set(CART_SESSION_TOKEN_HEADER, badToken);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(CART_ERROR_CODES.INVALID_CART_TOKEN);
      }
    });

    it('rejects PARTNER and STAFF principals with 403 CUSTOMER_IDENTITY_REQUIRED', async () => {
      if (!isDbConnected) return;

      const partnerRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(partnerRes.status).toBe(403);
      expect(partnerRes.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);

      const staffRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
        });
      expect(staffRes.status).toBe(403);
      expect(staffRes.body.error.code).toBe(CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects SUSPENDED and PENDING_VERIFICATION customers and detects live account suspension', async () => {
      if (!isDbConnected) return;

      const suspRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${suspendedToken}`);
      expect([401, 403]).toContain(suspRes.status);

      const pendingRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${pendingToken}`);
      expect([401, 403]).toContain(pendingRes.status);

      // Suspend active customer mid-session while JWT is still unexpired
      await UserModel.findByIdAndUpdate(customerA._id, {
        $set: { status: UserStatus.SUSPENDED },
      });
      const revokedRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect([401, 403]).toContain(revokedRes.status);
    });

    it('rejects spoofed userId/customerId in body, query, and x-user-id headers', async () => {
      if (!isDbConnected) return;

      const spoofBodyRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
          customerId: customerB._id.toString(),
        });
      expect(spoofBodyRes.status).toBe(403);

      const spoofQueryRes = await request(app)
        .get(`/api/v1/cart?userId=${customerB._id.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(spoofQueryRes.status).toBe(403);

      const spoofHeaderRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-user-id', customerB._id.toString());
      expect(spoofHeaderRes.status).toBe(403);
    });

    it('enforces strict cross-customer and cross-guest cart isolation without resource-existence leaks', async () => {
      if (!isDbConnected) return;

      // Customer A adds item
      const addARes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(addARes.status).toBe(200);
      const summaryA = parseValidSummary(addARes.body);
      const itemIdA = summaryA.items[0]!.itemId;

      // Customer B attempts to read cart -> sees empty cart
      const getBRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(getBRes.status).toBe(200);
      expect(parseValidSummary(getBRes.body).items).toHaveLength(0);

      // Customer B attempts to update or delete Customer A's itemId -> 404 CART_ITEM_NOT_FOUND
      const patchBRes = await request(app)
        .patch(`/api/v1/cart/items/${itemIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ quantity: '7' });
      expect(patchBRes.status).toBe(404);
      expect(patchBRes.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);

      const delBRes = await request(app)
        .delete(`/api/v1/cart/items/${itemIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(delBRes.status).toBe(404);
      expect(delBRes.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);

      // Guest 1 vs Guest 2 isolation
      const addG1Res = await request(app)
        .post('/api/v1/cart/items')
        .set(CART_SESSION_TOKEN_HEADER, guestToken1)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(addG1Res.status).toBe(200);
      const guest1ItemId = parseValidSummary(addG1Res.body).items[0]!.itemId;

      const patchG2Res = await request(app)
        .patch(`/api/v1/cart/items/${guest1ItemId}`)
        .set(CART_SESSION_TOKEN_HEADER, guestToken2)
        .send({ quantity: '9' });
      expect(patchG2Res.status).toBe(404);
      expect(patchG2Res.body.error.code).toBe(CART_ERROR_CODES.CART_ITEM_NOT_FOUND);

      // Verify guest token is stored ONLY hashed as SHA-256 and never raw in MongoDB
      const rawGuestDoc = await CartModel.findOne({ ownerType: 'GUEST' });
      expect(rawGuestDoc).not.toBeNull();
      expect(rawGuestDoc!.sessionTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rawGuestDoc!.sessionTokenHash).not.toBe(guestToken1);
      expect(rawGuestDoc!.expiresAt).toBeInstanceOf(Date);
    });

    it('ignores X-Cart-Session-Token when authenticated CUSTOMER token is present and persists expiresAt = null', async () => {
      if (!isDbConnected) return;

      // Populate guest cart first
      await request(app)
        .post('/api/v1/cart/items')
        .set(CART_SESSION_TOKEN_HEADER, guestToken1)
        .send({ productId: bulkProduct._id.toString(), quantity: '0.500' });

      // Authenticated customer sends same guest header -> still operates on USER cart
      const addUserRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set(CART_SESSION_TOKEN_HEADER, guestToken1)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });

      expect(addUserRes.status).toBe(200);
      const summary = parseValidSummary(addUserRes.body);
      expect(summary.ownerType).toBe('USER');
      expect(summary.items).toHaveLength(1);
      expect(summary.items[0]!.productId).toBe(discreteProduct._id.toString());

      const userCartDoc = await CartModel.findOne({ ownerType: 'USER', userId: customerA._id });
      expect(userCartDoc).not.toBeNull();
      expect(userCartDoc!.expiresAt).toBeNull();
      expect(userCartDoc!.sessionTokenHash).toBeNull();
    });

    it('rejects strict schema violations, client-supplied pricing/segments/suppliers, and unknown query params', async () => {
      if (!isDbConnected) return;

      const extraPricingRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
          unitPricePaise: 1,
          customerSegment: 'B2B',
        });
      expect(extraPricingRes.status).toBe(400);
      expect(extraPricingRes.body.error.code).toBe('VALIDATION_ERROR');

      const badQueryRes = await request(app)
        .get('/api/v1/cart?unexpected=1')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(badQueryRes.status).toBe(400);
      expect(badQueryRes.body.error.code).toBe('VALIDATION_ERROR');

      const badClearRes = await request(app)
        .post('/api/v1/cart/clear')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ extraField: true });
      expect(badClearRes.status).toBe(400);
      expect(badClearRes.body.error.code).toBe('VALIDATION_ERROR');

      const badParamRes = await request(app)
        .patch('/api/v1/cart/items/not-an-object-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: '5' });
      expect(badParamRes.status).toBe(400);
      expect(badParamRes.body.error.code).toBe('VALIDATION_ERROR');

      const nestedUnknownRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
          metadata: { partnerId: partnerAlpha._id.toString() },
        });
      expect(nestedUnknownRes.status).toBe(400);
      expect(nestedUnknownRes.body.error.code).toBe('VALIDATION_ERROR');

      const badPinRes = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: '012345' });
      expect(badPinRes.status).toBe(400);
      expect(badPinRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Catalog Validation, Quantity Arithmetic & Core CRUD Flows', () => {
    it('rejects non-existent, DRAFT, unpriced, missing-variant, and mismatched-variant targets', async () => {
      if (!isDbConnected) return;

      const fakeId = new mongoose.Types.ObjectId().toString();

      const missingProd = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: fakeId, quantity: '5' });
      expect(missingProd.status).toBe(404);
      expect(missingProd.body.error.code).toBe('PRODUCT_NOT_FOUND');

      const draftRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: draftProduct._id.toString(), quantity: '10' });
      expect(draftRes.status).toBe(404);
      expect(draftRes.body.error.code).toBe('PRODUCT_NOT_AVAILABLE');

      const unpricedRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: unpricedProduct._id.toString(), quantity: '10' });
      expect(unpricedRes.status).toBe(404);
      expect(unpricedRes.body.error.code).toBe('PRODUCT_NOT_PRICED');

      const parentDirect = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: parentWithVariants._id.toString(), quantity: '1.00' });
      expect(parentDirect.status).toBe(400);
      expect(parentDirect.body.error.code).toBe('PARENT_CONTAINER_CANNOT_HAVE_PRICE');

      const standaloneWithVariant = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          variantId: activeVariant12mm._id.toString(),
          quantity: '5',
        });
      expect(standaloneWithVariant.status).toBe(400);
      expect(standaloneWithVariant.body.error.code).toBe('SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE');

      const wrongVariantOwner = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: parentWithVariants._id.toString(),
          variantId: activeVariant12mm._id.toString(),
          quantity: '1.00',
        });
      expect(wrongVariantOwner.status).toBe(200);

      const archivedVarRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: parentWithVariants._id.toString(),
          variantId: archivedVariant._id.toString(),
          quantity: '1.00',
        });
      expect(archivedVarRes.status).toBe(404);
      expect(archivedVarRes.body.error.code).toBe('PRODUCT_NOT_AVAILABLE');
    });

    it('enforces precision <= 3, MOQ, maxOrderQuantity, stepIncrement, and INCREMENT step re-validation', async () => {
      if (!isDbConnected) return;

      // Discrete precision 0 (MOQ 5, step 2, max 50)
      const decOnDiscrete = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5.5' });
      expect(decOnDiscrete.status).toBe(400);
      expect(decOnDiscrete.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_MUST_BE_INTEGER);

      const belowMoq = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '3' });
      expect(belowMoq.status).toBe(400);
      expect(belowMoq.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_BELOW_MINIMUM);

      const badStep = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '6' });
      expect(badStep.status).toBe(400);
      expect(badStep.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_STEP_INVALID);

      const aboveMax = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '51' });
      expect(aboveMax.status).toBe(400);
      expect(aboveMax.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_ABOVE_MAXIMUM);

      // Bulk precision 3 (MOQ "0.500", step "0.250", max "25.000")
      const precisionExceeded = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: bulkProduct._id.toString(), quantity: '0.5001' });
      expect(precisionExceeded.status).toBe(400);
      expect(precisionExceeded.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_PRECISION_EXCEEDED);

      // Valid add 5 bags + invalid increment 5 bags (5+5=10 is NOT 5+2k) -> rejected
      const validAdd = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(validAdd.status).toBe(200);

      const invalidIncrementSum = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5', mode: 'INCREMENT' });
      expect(invalidIncrementSum.status).toBe(400);
      expect(invalidIncrementSum.body.error.code).toBe(CART_ERROR_CODES.QUANTITY_STEP_INVALID);

      // Valid increment +2 bags -> 7 bags; valid fractional bulk 0.500 + 0.250 -> 0.750 with HALF_UP math
      const validIncrement = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '2', mode: 'INCREMENT' });
      expect(validIncrement.status).toBe(200);
      expect(parseValidSummary(validIncrement.body).items[0]!.quantity).toBe('7');

      const bulkAdd = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: bulkProduct._id.toString(), quantity: '0.500' });
      expect(bulkAdd.status).toBe(200);

      const bulkInc = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: bulkProduct._id.toString(), quantity: '0.250', mode: 'INCREMENT' });
      expect(bulkInc.status).toBe(200);
      const bulkSummary = parseValidSummary(bulkInc.body);
      const bulkLine = bulkSummary.items.find((i) => i.productId === bulkProduct._id.toString())!;
      expect(bulkLine.quantity).toBe('0.750');
      // 120055 * 0.750 = 90041.25 -> HALF_UP rounds to 90041
      expect(bulkLine.lineSubtotalPaise).toBe(90041);
    });

    it('supports PATCH quantity, DELETE item (even if product archived), and POST clear preserving pincode', async () => {
      if (!isDbConnected) return;

      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
          pincode: regionalPincode,
        });
      expect(addRes.status).toBe(200);
      const cart1 = parseValidSummary(addRes.body);
      const itemId = cart1.items[0]!.itemId;
      expect(cart1.pincode).toBe(regionalPincode);

      // PATCH replace quantity
      const patchRes = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: '9', expectedVersion: cart1.version });
      expect(patchRes.status).toBe(200);
      const cart2 = parseValidSummary(patchRes.body);
      expect(cart2.items[0]!.quantity).toBe('9');
      expect(cart2.version).toBe(cart1.version + 1);

      // Admin archives product AFTER customer added it -> customer sees PRODUCT_UNAVAILABLE and can still DELETE it
      await ProductModel.findByIdAndUpdate(discreteProduct._id, {
        $set: { status: 'ARCHIVED', publishedAt: null },
      });

      const getArchivedRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getArchivedRes.status).toBe(200);
      const blockedCart = parseValidSummary(getArchivedRes.body);
      expect(blockedCart.items[0]!.itemStatus).toBe('PRODUCT_UNAVAILABLE');
      expect(blockedCart.items[0]!.isValidForCheckout).toBe(false);
      expect(blockedCart.hasBlockingIssues).toBe(true);
      expect(blockedCart.isValidForCheckout).toBe(false);

      const delRes = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(200);
      const cartAfterDel = parseValidSummary(delRes.body);
      expect(cartAfterDel.items).toHaveLength(0);
      expect(cartAfterDel.pincode).toBe(regionalPincode);

      // Restore product, add 2 items, and clear cart
      await ProductModel.findByIdAndUpdate(discreteProduct._id, {
        $set: { status: 'ACTIVE', publishedAt: new Date() },
      });
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: bulkProduct._id.toString(), quantity: '0.500' });

      const clearRes = await request(app)
        .post('/api/v1/cart/clear')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(clearRes.status).toBe(200);
      const cleared = parseValidSummary(clearRes.body);
      expect(cleared.items).toHaveLength(0);
      expect(cleared.materialSubtotalPaise).toBe(0);
      expect(cleared.pincode).toBe(regionalPincode);
    });
  });

  describe('3. Tri-State Localization, Regional Overrides, B2B Live Recompute & Anonymity', () => {
    it('evaluates UNLOCALIZED, SERVICEABLE (with stock vs out-of-stock), and UNSERVICEABLE states with zero supplier leaks', async () => {
      if (!isDbConnected) return;

      // 1. Add unlocalized
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(addRes.status).toBe(200);
      const unloc = parseValidSummary(addRes.body);
      expect(unloc.localizationState).toBe('UNLOCALIZED');
      expect(unloc.isServiceable).toBeNull();
      expect(unloc.serviceArea).toBeNull();
      expect(unloc.items[0]!.availabilityUnknown).toBe(true);
      expect(unloc.items[0]!.isAvailable).toBeNull();
      expect(unloc.items[0]!.minLeadTimeHours).toBeNull();
      expect(unloc.items[0]!.itemStatus).toBe('UNLOCALIZED');
      expect(unloc.items[0]!.unitPricePaise).toBe(40000); // Global B2C
      expect(unloc.materialSubtotalPaise).toBe(200000);
      expect(unloc.pricingBasis).toBe('GST_EXCLUSIVE_NET');
      expect(unloc.pricingBasisDisclosure).toBe('GST_EXCLUSIVE_EXCLUDING_DELIVERY');
      assertNoSupplierLeaks(addRes.body);

      // 2. Switch to serviceable PIN with stock + regional override pricing
      const locServiceable = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: regionalPincode });
      expect(locServiceable.status).toBe(200);
      const srv = parseValidSummary(locServiceable.body);
      expect(srv.localizationState).toBe('SERVICEABLE');
      expect(srv.isServiceable).toBe(true);
      expect(srv.serviceArea?.code).toBe(saRegional.code);
      expect(srv.items[0]!.availabilityUnknown).toBe(false);
      expect(srv.items[0]!.isAvailable).toBe(true);
      expect(srv.items[0]!.minLeadTimeHours).toBe(4); // min(12, 4) across partners, zero IDs leaked
      expect(srv.items[0]!.isServiceAreaOverride).toBe(true);
      expect(srv.items[0]!.unitPricePaise).toBe(38500);
      expect(srv.items[0]!.priceDrift?.hasChanged).toBe(true);
      expect(srv.items[0]!.priceDrift?.deltaPaise).toBe(-1500);
      expect(srv.items[0]!.priceDrift?.direction).toBe('DECREASED');
      expect(srv.hasUnacknowledgedPriceChanges).toBe(true);
      assertNoSupplierLeaks(locServiceable.body);

      // 3. Switch to serviceable PIN where item has zero active partner stock -> OUT_OF_STOCK_IN_AREA
      const locEmpty = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: emptyStockPincode });
      expect(locEmpty.status).toBe(200);
      const emptyAreaCart = parseValidSummary(locEmpty.body);
      expect(emptyAreaCart.localizationState).toBe('SERVICEABLE');
      expect(emptyAreaCart.items[0]!.itemStatus).toBe('OUT_OF_STOCK_IN_AREA');
      expect(emptyAreaCart.items[0]!.isAvailable).toBe(false);
      expect(emptyAreaCart.items[0]!.minLeadTimeHours).toBeNull();
      expect(emptyAreaCart.items[0]!.isValidForCheckout).toBe(false);

      // 4. Switch to inactive / unmapped PIN -> UNSERVICEABLE
      const locUnserv = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: unmappedPincode });
      expect(locUnserv.status).toBe(200);
      const unserv = parseValidSummary(locUnserv.body);
      expect(unserv.localizationState).toBe('UNSERVICEABLE');
      expect(unserv.isServiceable).toBe(false);
      expect(unserv.serviceArea).toBeNull();
      expect(unserv.items[0]!.itemStatus).toBe('UNSERVICEABLE_AREA');
      expect(unserv.items[0]!.isAvailable).toBe(false);

      // 5. Clear location -> reverts cleanly to UNLOCALIZED
      const locClear = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: null });
      expect(locClear.status).toBe(200);
      expect(parseValidSummary(locClear.body).localizationState).toBe('UNLOCALIZED');
    });

    it('dynamically recomputes B2B volume tier pricing and priceDrift when customer role is granted or revoked', async () => {
      if (!isDbConnected) return;

      // Customer A (initially B2C) adds 11 bags (qualifies for TIER_1 if upgraded to B2B)
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '11' });
      expect(addRes.status).toBe(200);
      const initialCart = parseValidSummary(addRes.body);
      expect(initialCart.customerSegment).toBe('B2C');
      expect(initialCart.items[0]!.pricingTierApplied).toBe('STANDARD_B2C');
      expect(initialCart.items[0]!.unitPricePaise).toBe(40000);
      expect(initialCart.items[0]!.acknowledgedUnitPricePaise).toBe(40000);
      expect(initialCart.hasUnacknowledgedPriceChanges).toBe(false);

      // Upgrade customer to B2B_CUSTOMER in UserModel without re-issuing JWT
      await UserModel.findByIdAndUpdate(customerA._id, {
        $set: { roles: ['B2B_CUSTOMER'] },
      });

      const getB2B = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getB2B.status).toBe(200);
      const b2bCart = parseValidSummary(getB2B.body);
      expect(b2bCart.customerSegment).toBe('B2B');
      expect(b2bCart.items[0]!.pricingTierApplied).toBe('TIER_1');
      expect(b2bCart.items[0]!.unitPricePaise).toBe(36000);
      expect(b2bCart.items[0]!.lineSubtotalPaise).toBe(396000);
      expect(b2bCart.items[0]!.priceDrift?.hasChanged).toBe(true);
      expect(b2bCart.items[0]!.priceDrift?.deltaPaise).toBe(-4000);

      // Revoke B2B_CUSTOMER role -> immediate fallback back to B2C
      await UserModel.findByIdAndUpdate(customerA._id, {
        $set: { roles: [] },
      });

      const getReverted = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getReverted.status).toBe(200);
      const revertedCart = parseValidSummary(getReverted.body);
      expect(revertedCart.customerSegment).toBe('B2C');
      expect(revertedCart.items[0]!.unitPricePaise).toBe(40000);
    });
  });

  describe('4. Limits, Optimistic Concurrency, Concurrent Writes & DB Failure Rollback', () => {
    it(`enforces MAX_CART_ITEMS (${MAX_CART_ITEMS}) and still permits incrementing existing lines`, async () => {
      if (!isDbConnected) return;

      // Create 50 additional simple products + global pricing if not already created
      if (bulkExtraProducts.length === 0) {
        const now = new Date();
        for (let i = 0; i < MAX_CART_ITEMS; i++) {
          const p = await ProductModel.create({
            slug: `${testSlugPrefix}limit-item-${i}`,
            title: `Cart Limit Product ${i}`,
            brand: 'LimitBrand',
            categoryId: categoryDoc._id,
            subcategoryId: subcategoryDoc._id,
            hasVariants: false,
            sku: `${testSkuPrefix}LIM-${i}`,
            status: 'ACTIVE',
            images: [],
            unitCode: 'PCS',
            quantityPrecision: 0,
            minOrderQuantity: '1',
            maxOrderQuantity: '100',
            stepIncrement: '1',
            publishedAt: now,
            createdBy: dummyAdminId,
            updatedBy: dummyAdminId,
          });
          bulkExtraProducts.push(p);
          createdProductIds.push(p._id);

          const pr = await ProductPricingModel.create({
            productId: p._id,
            variantId: null,
            serviceAreaId: null,
            pricingScope: 'STANDALONE_GLOBAL',
            b2cPricePaise: 10000,
            b2cMrpPaise: 12000,
            b2bPricePaise: null,
            b2bTiers: [],
            isActive: true,
            createdBy: dummyAdminId,
            updatedBy: dummyAdminId,
          });
          createdPricingIds.push(pr._id);
        }
      }

      // Seed cart directly with 50 items to keep test fast, then test 51st vs incrementing item #0
      const seedItems = bulkExtraProducts.map((p) => ({
        _id: new mongoose.Types.ObjectId(),
        productId: p._id,
        variantId: null,
        quantity: '1',
        acknowledgedUnitPricePaise: 10000,
        addedAt: new Date(),
      }));

      await CartModel.create({
        ownerType: 'USER',
        userId: customerA._id,
        sessionTokenHash: null,
        pincode: null,
        items: seedItems,
        version: 1,
        expiresAt: null,
      });

      const add51stRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(add51stRes.status).toBe(400);
      expect(add51stRes.body.error.code).toBe(CART_ERROR_CODES.CART_MAX_ITEMS_EXCEEDED);

      // Incrementing existing item #0 still succeeds without exceeding 50 distinct items
      const incrementExistingRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: bulkExtraProducts[0]!._id.toString(),
          quantity: '2',
          mode: 'INCREMENT',
        });
      expect(incrementExistingRes.status).toBe(200);
      const updatedSummary = parseValidSummary(incrementExistingRes.body);
      expect(updatedSummary.totalItemCount).toBe(MAX_CART_ITEMS);
      expect(
        updatedSummary.items.find((i) => i.productId === bulkExtraProducts[0]!._id.toString())!
          .quantity,
      ).toBe('3');
    });

    it('detects expectedVersion stale conflicts with 409 CART_VERSION_CONFLICT', async () => {
      if (!isDbConnected) return;

      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ productId: discreteProduct._id.toString(), quantity: '5' });
      expect(addRes.status).toBe(200);
      const summary = parseValidSummary(addRes.body);
      const itemId = summary.items[0]!.itemId;

      const stalePatch = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: '7', expectedVersion: 99 });
      expect(stalePatch.status).toBe(409);
      expect(stalePatch.body.error.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);

      const staleLocation = await request(app)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pincode: regionalPincode, expectedVersion: 0 });
      expect(staleLocation.status).toBe(409);
      expect(staleLocation.body.error.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);

      const staleClear = await request(app)
        .post('/api/v1/cart/clear')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ expectedVersion: 0 });
      expect(staleClear.status).toBe(409);
      expect(staleClear.body.error.code).toBe(CART_ERROR_CODES.CART_VERSION_CONFLICT);
    });

    it('handles concurrent parallel cart item additions safely without lost updates or duplicate key failures', async () => {
      if (!isDbConnected) return;

      // Fire 4 concurrent requests for brand-new cart across two express instances (simulating overlapping additions)
      const results = await Promise.all([
        request(concurrencyApp)
          .post('/api/v1/cart/items')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ productId: discreteProduct._id.toString(), quantity: '5', mode: 'INCREMENT' }),
        request(concurrencyApp)
          .post('/api/v1/cart/items')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ productId: bulkProduct._id.toString(), quantity: '0.500', mode: 'INCREMENT' }),
        request(concurrencyApp)
          .post('/api/v1/cart/items')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({
            productId: parentWithVariants._id.toString(),
            variantId: activeVariant12mm._id.toString(),
            quantity: '1.00',
            mode: 'INCREMENT',
          }),
        request(concurrencyApp)
          .post('/api/v1/cart/items')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ productId: discreteProduct._id.toString(), quantity: '2', mode: 'INCREMENT' }),
      ]);

      for (const r of results) {
        expect(r.status).toBe(200);
      }

      const finalGet = await request(concurrencyApp)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(finalGet.status).toBe(200);
      const finalSummary = parseValidSummary(finalGet.body);
      expect(finalSummary.items).toHaveLength(3);
      expect(finalSummary.version).toBe(4);
      expect(
        finalSummary.items.find((i) => i.productId === discreteProduct._id.toString())!.quantity,
      ).toBe('7');
    });

    it('rolls back database failures safely and never logs tokens, session hashes, or PII', async () => {
      if (!isDbConnected) return;

      // Seed valid cart for customerA
      const seedRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          productId: discreteProduct._id.toString(),
          quantity: '5',
          pincode: regionalPincode,
        });
      expect(seedRes.status).toBe(200);
      const beforeSummary = parseValidSummary(seedRes.body);

      // Capture logs with real logger stream in an isolated router mount
      const loggedChunks: string[] = [];
      const captureStream = new Writable({
        write(chunk, _encoding, callback) {
          loggedChunks.push(chunk.toString());
          callback();
        },
      });
      const testLogger = pino(
        {
          level: 'debug',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-cart-session-token"]',
              'pincode',
              'sessionTokenHash',
            ],
            censor: '[REDACTED]',
          },
        },
        captureStream,
      );

      const isolatedApp = express();
      isolatedApp.use(express.json());
      isolatedApp.use((req, _res, next) => {
        req.log = testLogger;
        req.correlationId = 'cart-log-test';
        next();
      });
      isolatedApp.use('/api/v1/cart', createCartRouter(new CartController()));
      isolatedApp.use(errorHandlerMiddleware);

      const dbSpy = vi
        .spyOn(CartModel, 'findOneAndUpdate')
        .mockRejectedValueOnce(new Error('Simulated transient storage outage at plot X'));

      const failRes = await request(isolatedApp)
        .patch('/api/v1/cart/location')
        .set('Authorization', `Bearer ${tokenA}`)
        .set(CART_SESSION_TOKEN_HEADER, guestToken1)
        .send({ pincode: emptyStockPincode });

      dbSpy.mockRestore();

      expect(failRes.status).toBe(500);
      expect(failRes.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(failRes.body)).not.toContain('Simulated transient storage outage');

      // Cart state remains completely intact (no partial mutation persisted)
      const afterGet = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterGet.status).toBe(200);
      const afterSummary = parseValidSummary(afterGet.body);
      expect(afterSummary.pincode).toBe(beforeSummary.pincode);
      expect(afterSummary.version).toBe(beforeSummary.version);
      expect(afterSummary.items).toHaveLength(1);

      // Logs contain zero raw tokens, PINs, or sensitive DB messages
      const joinedLogs = loggedChunks.join('\n');
      expect(joinedLogs).not.toContain(tokenA);
      expect(joinedLogs).not.toContain(guestToken1);
      expect(joinedLogs).not.toContain(regionalPincode);
      expect(joinedLogs).not.toContain(emptyStockPincode);
      expect(joinedLogs).not.toContain('Simulated transient storage outage');
    });
  });
});
