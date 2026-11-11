import { describe, expect, expectTypeOf, it } from 'vitest';
import { ZodError } from 'zod';
import {
  ADDRESS_ERROR_CODES,
  CART_ERROR_CODES,
  CART_ITEM_STATUSES,
  CART_LOCALIZATION_STATES,
  CART_SESSION_TOKEN_HEADER,
  CART_VALIDATION_ISSUE_CODES,
  CHECKOUT_DELIVERY_FEE_STATUS,
  CHECKOUT_ERROR_CODES,
  CHECKOUT_PRICING_BASIS,
  CHECKOUT_SESSION_STATUSES,
  CHECKOUT_SESSION_TTL_MINUTES,
  CHECKOUT_TAX_STATUS,
  COMMERCE_ERROR_CODES,
  GUEST_CART_TTL_DAYS,
  IDEMPOTENCY_KEY_HEADER,
  MAX_ADDRESSES_PER_CUSTOMER,
  MAX_ALLOWED_QUANTITY_PRECISION,
  MAX_CART_ITEMS,
  acknowledgeCartPricesSchema,
  addCartItemSchema,
  addressIdParamSchema,
  cartItemDtoSchema,
  cartItemIdParamSchema,
  cartItemPriceDriftDtoSchema,
  cartSummaryDtoSchema,
  cartValidationResultDtoSchema,
  checkoutSessionDtoSchema,
  checkoutSessionIdParamSchema,
  createCustomerAddressSchema,
  customerAddressDtoSchema,
  guestCartTokenHeaderSchema,
  idempotencyKeyHeaderSchema,
  migrateGuestCartSchema,
  prepareCheckoutResponseDtoSchema,
  prepareCheckoutSchema,
  updateCartItemQuantitySchema,
  updateCartLocationSchema,
  updateCustomerAddressSchema,
  validateCartSchema,
  type ICartItemDto,
  type ICartSummaryDto,
  type ICartValidationResultDto,
  type ICheckoutSessionDto,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
  type IPrepareCheckoutResponseDto,
} from '../src/index.js';

describe('Milestone 5B Stage 0A — Shared Customer Commerce Contracts', () => {
  const validUserId = '672b00000000000000000001';
  const validAddressId = '672b00000000000000000010';
  const validCartId = '672b00000000000000000020';
  const validItemId = '672b00000000000000000030';
  const validProductId = '672b00000000000000000040';
  const validVariantId = '672b00000000000000000050';
  const validServiceAreaId = '672b00000000000000000060';
  const validSessionId = '672b00000000000000000070';
  const validGuestUuidV4 = '550e8400-e29b-41d4-a716-446655440000';

  const validServiceAreaSummary = {
    id: validServiceAreaId,
    code: 'BLR-EAST',
    name: 'Bengaluru East',
    city: 'Bengaluru',
    state: 'Karnataka',
  };

  // =========================================================================
  // 1. Customer Addresses (address.ts)
  // =========================================================================
  describe('1. Customer Delivery Site Address Contracts', () => {
    it('validates create and update address payloads and enforces bounds', () => {
      const createPayload: ICreateCustomerAddressDto = {
        label: 'Whitefield Site Gate 2',
        recipientName: 'Ramesh Rao',
        phone: '+919876543210',
        streetAddress: 'Plot 14, KIADB Industrial Area, Whitefield',
        landmark: 'Near ITPL Main Gate',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560037',
        siteContactPerson: {
          name: 'Suresh Kumar',
          phone: '+919811122233',
        },
        heavyVehicleAccessInstructions: '12-wheeler tipper entry allowed between 6 AM and 9 PM.',
        isDefault: true,
      };

      expect(createCustomerAddressSchema.parse(createPayload)).toEqual(createPayload);
      expect(
        updateCustomerAddressSchema.parse({
          landmark: null,
          heavyVehicleAccessInstructions: null,
          isDefault: false,
        }),
      ).toEqual({
        landmark: null,
        heavyVehicleAccessInstructions: null,
        isDefault: false,
      });
      expect(addressIdParamSchema.parse({ addressId: validAddressId })).toEqual({
        addressId: validAddressId,
      });
      expect(MAX_ADDRESSES_PER_CUSTOMER).toBe(20);
    });

    it('rejects invalid PIN codes, non-E.164 phones, and oversized access notes', () => {
      expect(() =>
        createCustomerAddressSchema.parse({
          label: 'Site A',
          recipientName: 'Ramesh Rao',
          phone: '9876543210', // missing E.164 '+'
          streetAddress: 'Plot 14, Whitefield Main Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
        }),
      ).toThrow(ZodError);

      expect(() =>
        createCustomerAddressSchema.parse({
          label: 'Site A',
          recipientName: 'Ramesh Rao',
          phone: '+919876543210',
          streetAddress: 'Plot 14, Whitefield Main Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '056001', // leading 0 invalid in India
        }),
      ).toThrow(ZodError);

      expect(() =>
        createCustomerAddressSchema.parse({
          label: 'Site A',
          recipientName: 'Ramesh Rao',
          phone: '+919876543210',
          streetAddress: 'Plot 14, Whitefield Main Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          heavyVehicleAccessInstructions: 'x'.repeat(301),
        }),
      ).toThrow(ZodError);
    });

    it('strictly rejects client-supplied identity or server-managed serviceability fields', () => {
      const forbiddenPayloads = [
        { userId: validUserId },
        { isServiceable: true },
        { serviceAreaId: validServiceAreaId },
        { partnerId: validUserId },
      ];

      for (const forbidden of forbiddenPayloads) {
        expect(() =>
          createCustomerAddressSchema.parse({
            label: 'Site A',
            recipientName: 'Ramesh Rao',
            phone: '+919876543210',
            streetAddress: 'Plot 14, Whitefield Main Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560037',
            ...forbidden,
          }),
        ).toThrow(ZodError);
      }
    });

    it('enforces live serviceability vs serviceArea consistency on ICustomerAddressDto', () => {
      const serviceableAddress: ICustomerAddressDto = {
        id: validAddressId,
        label: 'Site A',
        recipientName: 'Ramesh Rao',
        phone: '+919876543210',
        streetAddress: 'Plot 14, Whitefield Main Road',
        landmark: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560037',
        siteContactPerson: null,
        heavyVehicleAccessInstructions: null,
        isDefault: true,
        isServiceable: true,
        serviceArea: validServiceAreaSummary,
        createdAt: '2026-11-11T10:00:00.000Z',
        updatedAt: '2026-11-11T10:00:00.000Z',
      };

      expect(customerAddressDtoSchema.parse(serviceableAddress)).toEqual(serviceableAddress);
      expectTypeOf(serviceableAddress).toMatchTypeOf<ICustomerAddressDto>();

      expect(() =>
        customerAddressDtoSchema.parse({
          ...serviceableAddress,
          isServiceable: true,
          serviceArea: null,
        }),
      ).toThrow(ZodError);

      expect(() =>
        customerAddressDtoSchema.parse({
          ...serviceableAddress,
          isServiceable: false,
          serviceArea: validServiceAreaSummary,
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 2. Customer Cart, Line Items, Price Drift & Validation (cart.ts)
  // =========================================================================
  describe('2. Customer Cart, Line Item & Validation Contracts', () => {
    const validCartItem: ICartItemDto = {
      itemId: validItemId,
      productId: validProductId,
      variantId: validVariantId,
      sku: 'CEM-OPC53-50KG',
      title: 'OPC 53 Grade Cement',
      brand: 'UltraTech',
      slug: 'opc-53-grade-cement',
      imageUrl: 'https://cdn.example.com/cement.jpg',
      variantTitle: '50 kg Bag',
      variantAttributes: { weight: '50 kg' },
      unitCode: 'TONNE',
      quantityPrecision: 3,
      minOrderQuantity: '0.500',
      maxOrderQuantity: '25.000',
      stepIncrement: '0.250',
      quantity: '1.500',
      pricingTierApplied: 'TIER_1',
      tierMinQuantity: '1.000',
      unitPricePaise: 520000,
      lineSubtotalPaise: 780000,
      mrpSubtotalPaise: 840000,
      savingsPaise: 60000,
      isServiceAreaOverride: true,
      acknowledgedUnitPricePaise: 500000,
      priceDrift: {
        hasChanged: true,
        acknowledgedUnitPricePaise: 500000,
        currentUnitPricePaise: 520000,
        deltaPaise: 20000,
        direction: 'INCREASED',
      },
      isAvailable: true,
      availabilityUnknown: false,
      minLeadTimeHours: 12,
      itemStatus: 'VALID',
      isValidForCheckout: false, // unacknowledged price drift blocks checkout
      statusMessage: null,
      addedAt: '2026-11-11T10:00:00.000Z',
    };

    const validCartSummary: ICartSummaryDto = {
      cartId: validCartId,
      ownerType: 'USER',
      version: 3,
      customerSegment: 'B2B',
      pincode: '560037',
      localizationState: 'SERVICEABLE',
      isServiceable: true,
      serviceArea: validServiceAreaSummary,
      items: [validCartItem],
      totalItemCount: 1,
      validItemCount: 1,
      materialSubtotalPaise: 780000,
      currency: 'INR',
      pricingBasis: 'GST_EXCLUSIVE_NET',
      pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
      hasBlockingIssues: false,
      hasUnacknowledgedPriceChanges: true,
      isValidForCheckout: false,
      updatedAt: '2026-11-11T10:05:00.000Z',
    };

    it('enforces platform boundaries, precision ceiling (3), and guest UUID v4 tokens', () => {
      expect(MAX_CART_ITEMS).toBe(50);
      expect(GUEST_CART_TTL_DAYS).toBe(30);
      expect(CART_SESSION_TOKEN_HEADER).toBe('X-Cart-Session-Token');
      expect(MAX_ALLOWED_QUANTITY_PRECISION).toBe(3);

      expect(guestCartTokenHeaderSchema.parse(validGuestUuidV4)).toBe(validGuestUuidV4);
      // UUID v1 must fail strict v4 validation
      expect(() =>
        guestCartTokenHeaderSchema.parse('550e8400-e29b-11d4-a716-446655440000'),
      ).toThrow(ZodError);
      expect(() => migrateGuestCartSchema.parse({ guestSessionToken: 'not-a-uuid' })).toThrow(
        ZodError,
      );
      expect(migrateGuestCartSchema.parse({ guestSessionToken: validGuestUuidV4 })).toEqual({
        guestSessionToken: validGuestUuidV4,
      });
    });

    it('validates cart mutation schemas and rejects client-authoritative prices/vendors/decimals > canonical', () => {
      expect(
        addCartItemSchema.parse({
          productId: validProductId,
          variantId: null,
          quantity: '1.250',
          pincode: '560037',
        }),
      ).toEqual({
        productId: validProductId,
        variantId: null,
        quantity: '1.250',
        mode: 'INCREMENT',
        pincode: '560037',
      });

      expect(
        updateCartItemQuantitySchema.parse({ quantity: '10', expectedVersion: 2 }),
      ).toEqual({
        quantity: '10',
        expectedVersion: 2,
      });
      expect(cartItemIdParamSchema.parse({ itemId: validItemId })).toEqual({ itemId: validItemId });
      expect(updateCartLocationSchema.parse({ pincode: null })).toEqual({ pincode: null });
      expect(acknowledgeCartPricesSchema.parse({ itemIds: [validItemId] })).toEqual({
        itemIds: [validItemId],
      });

      // Reject leading zeros, exponents, negative quantities
      for (const badQty of ['01', '1e2', '-5', '15.']) {
        expect(() =>
          addCartItemSchema.parse({ productId: validProductId, quantity: badQty }),
        ).toThrow(ZodError);
      }

      // Reject client-authoritative prices, customerSegment, partnerId, serviceAreaId
      for (const forbidden of [
        { unitPricePaise: 100 },
        { subtotalPaise: 100 },
        { customerSegment: 'B2B' },
        { partnerId: validUserId },
        { serviceAreaId: validServiceAreaId },
        { acknowledgedUnitPricePaise: 100 },
      ]) {
        expect(() =>
          addCartItemSchema.parse({
            productId: validProductId,
            quantity: '1',
            ...forbidden,
          }),
        ).toThrow(ZodError);
      }

      // Reject supplying both pincode and addressId to validateCartSchema
      expect(() =>
        validateCartSchema.parse({ pincode: '560037', addressId: validAddressId }),
      ).toThrow(ZodError);
    });

    it('enforces integer paise, quantityPrecision <= 3, tri-state availability, and price drift invariants', () => {
      expect(cartItemDtoSchema.parse(validCartItem)).toEqual(validCartItem);
      expect(cartSummaryDtoSchema.parse(validCartSummary)).toEqual(validCartSummary);

      // Reject precision > 3
      expect(() =>
        cartItemDtoSchema.parse({ ...validCartItem, quantityPrecision: 4 }),
      ).toThrow(ZodError);

      // Reject floating-point monetary amounts
      expect(() =>
        cartItemDtoSchema.parse({ ...validCartItem, unitPricePaise: 5200.5 }),
      ).toThrow(ZodError);

      // Reject inconsistent priceDrift direction / delta
      expect(() =>
        cartItemPriceDriftDtoSchema.parse({
          hasChanged: true,
          acknowledgedUnitPricePaise: 500000,
          currentUnitPricePaise: 520000,
          deltaPaise: -20000,
          direction: 'INCREASED',
        }),
      ).toThrow(ZodError);

      // Enforce tri-state unlocalized cart semantics
      const unlocalizedCart: ICartSummaryDto = {
        ...validCartSummary,
        pincode: null,
        localizationState: 'UNLOCALIZED',
        isServiceable: null,
        serviceArea: null,
        items: [
          {
            ...validCartItem,
            isAvailable: null,
            availabilityUnknown: true,
            minLeadTimeHours: null,
            itemStatus: 'UNLOCALIZED',
            isValidForCheckout: false,
          },
        ],
        validItemCount: 0,
        hasBlockingIssues: true,
        isValidForCheckout: false,
      };
      expect(cartSummaryDtoSchema.parse(unlocalizedCart)).toEqual(unlocalizedCart);

      // Reject UNLOCALIZED cart with boolean isServiceable
      expect(() =>
        cartSummaryDtoSchema.parse({
          ...unlocalizedCart,
          isServiceable: false,
        }),
      ).toThrow(ZodError);

      // Reject UNLOCALIZED item with non-null isAvailable
      expect(() =>
        cartItemDtoSchema.parse({
          ...validCartItem,
          availabilityUnknown: true,
          isAvailable: false,
          minLeadTimeHours: null,
        }),
      ).toThrow(ZodError);
    });

    it('validates CartValidationResultDto and enum registries', () => {
      const validationResult: ICartValidationResultDto = {
        isValidForCheckout: false,
        evaluatedPincode: '560037',
        localizationState: 'SERVICEABLE',
        isServiceable: true,
        blockingReasons: [],
        priceChangedItems: [
          {
            code: 'PRICE_CHANGED',
            severity: 'WARNING',
            itemId: validItemId,
            productId: validProductId,
            variantId: validVariantId,
            message: 'Unit price increased from ₹5,000.00 to ₹5,200.00',
            acknowledgedUnitPricePaise: 500000,
            currentUnitPricePaise: 520000,
          },
        ],
        cart: validCartSummary,
      };

      expect(cartValidationResultDtoSchema.parse(validationResult)).toEqual(validationResult);
      expect(CART_LOCALIZATION_STATES).toEqual(['UNLOCALIZED', 'SERVICEABLE', 'UNSERVICEABLE']);
      expect(CART_ITEM_STATUSES).toContain('OUT_OF_STOCK_IN_AREA');
      expect(CART_VALIDATION_ISSUE_CODES).toContain('PRICE_CHANGED');
    });
  });

  // =========================================================================
  // 3. Checkout Preparation & Session Snapshots (checkout.ts)
  // =========================================================================
  describe('3. Checkout Preparation & Session Snapshot Contracts', () => {
    const validSession: ICheckoutSessionDto = {
      sessionId: validSessionId,
      cartId: validCartId,
      cartVersion: 4,
      customerSegment: 'B2B',
      deliveryAddressSnapshot: {
        addressId: validAddressId,
        label: 'Whitefield Site Gate 2',
        recipientName: 'Ramesh Rao',
        phone: '+919876543210',
        streetAddress: 'Plot 14, KIADB Industrial Area, Whitefield',
        landmark: 'Near ITPL Main Gate',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560037',
        siteContactPerson: {
          name: 'Suresh Kumar',
          phone: '+919811122233',
        },
        heavyVehicleAccessInstructions: '12-wheeler tipper entry 6 AM - 9 PM.',
      },
      serviceAreaSnapshot: {
        serviceAreaId: validServiceAreaId,
        code: 'BLR-EAST',
        name: 'Bengaluru East',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
      items: [
        {
          productId: validProductId,
          variantId: validVariantId,
          sku: 'CEM-OPC53-50KG',
          title: 'OPC 53 Grade Cement',
          brand: 'UltraTech',
          unitCode: 'TONNE',
          quantityPrecision: 3,
          quantity: '1.500',
          pricingTierApplied: 'TIER_1',
          tierMinQuantity: '1.000',
          unitPricePaise: 520000,
          lineSubtotalPaise: 780000,
          mrpSubtotalPaise: 840000,
          savingsPaise: 60000,
          minLeadTimeHours: 12,
          isServiceAreaOverride: true,
        },
      ],
      materialSubtotalPaise: 780000,
      currency: 'INR',
      pricingBasis: 'GST_EXCLUSIVE_NET',
      deliveryFeeStatus: 'PENDING_DECISION_7',
      taxStatus: 'DEFERRED_PHASE_4',
      status: 'PREPARED',
      cartModifiedSincePrepare: false,
      expiresAt: '2026-11-11T10:20:00.000Z',
      createdAt: '2026-11-11T10:05:00.000Z',
      updatedAt: '2026-11-11T10:05:00.000Z',
    };

    it('enforces pre-tax, pre-freight, pre-order boundaries on CheckoutSession', () => {
      expect(CHECKOUT_SESSION_TTL_MINUTES).toBe(15);
      expect(IDEMPOTENCY_KEY_HEADER).toBe('Idempotency-Key');
      expect(CHECKOUT_PRICING_BASIS).toBe('GST_EXCLUSIVE_NET');
      expect(CHECKOUT_DELIVERY_FEE_STATUS).toBe('PENDING_DECISION_7');
      expect(CHECKOUT_TAX_STATUS).toBe('DEFERRED_PHASE_4');
      expect(CHECKOUT_SESSION_STATUSES).toEqual(['PREPARED', 'EXPIRED', 'SUPERSEDED']);
      expect(CHECKOUT_SESSION_STATUSES).not.toContain('CONSUMED');

      const response: IPrepareCheckoutResponseDto = {
        session: validSession,
        idempotentReplay: false,
      };
      expect(prepareCheckoutResponseDtoSchema.parse(response)).toEqual(response);
      expect(checkoutSessionDtoSchema.parse(validSession)).toEqual(validSession);
      expect(checkoutSessionIdParamSchema.parse({ sessionId: validSessionId })).toEqual({
        sessionId: validSessionId,
      });
    });

    it('validates Idempotency-Key and strict prepareCheckoutSchema', () => {
      expect(idempotencyKeyHeaderSchema.parse('idem-checkout-001')).toBe('idem-checkout-001');
      expect(() => idempotencyKeyHeaderSchema.parse('')).toThrow(ZodError);
      expect(() => idempotencyKeyHeaderSchema.parse('a'.repeat(65))).toThrow(ZodError);

      expect(
        prepareCheckoutSchema.parse({ addressId: validAddressId, expectedCartVersion: 4 }),
      ).toEqual({
        addressId: validAddressId,
        expectedCartVersion: 4,
      });

      // Reject forbidden client-supplied commercial or allocation overrides
      for (const forbidden of [
        { deliveryFeePaise: 0 },
        { taxPaise: 0 },
        { materialSubtotalPaise: 100 },
        { partnerId: validUserId },
        { customerSegment: 'B2B' },
      ]) {
        expect(() =>
          prepareCheckoutSchema.parse({ addressId: validAddressId, ...forbidden }),
        ).toThrow(ZodError);
      }
    });

    it('rejects mismatched materialSubtotalPaise or floating-point paise in CheckoutSession', () => {
      expect(() =>
        checkoutSessionDtoSchema.parse({
          ...validSession,
          materialSubtotalPaise: 779999,
        }),
      ).toThrow(ZodError);

      expect(() =>
        checkoutSessionDtoSchema.parse({
          ...validSession,
          materialSubtotalPaise: 780000.5,
        }),
      ).toThrow(ZodError);
    });

    it('exports canonical commerce error codes without collisions', () => {
      expect(COMMERCE_ERROR_CODES.ADDRESS_NOT_FOUND).toBe(ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND);
      expect(COMMERCE_ERROR_CODES.CART_VERSION_CONFLICT).toBe(
        CART_ERROR_CODES.CART_VERSION_CONFLICT,
      );
      expect(COMMERCE_ERROR_CODES.IDEMPOTENCY_KEY_PAYLOAD_MISMATCH).toBe(
        CHECKOUT_ERROR_CODES.IDEMPOTENCY_KEY_PAYLOAD_MISMATCH,
      );
      expect(Object.keys(COMMERCE_ERROR_CODES).length).toBeGreaterThanOrEqual(20);
    });
  });
});
