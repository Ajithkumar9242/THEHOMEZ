import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { PartnerAvailabilityService } from '../src/services/partner-availability/index.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { PartnerAvailabilityHistoryModel } from '../src/models/partner-availability-history.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import {
  UserType,
  PermissionCode,
  type IUserPrincipal,
  type ISetPartnerProductAvailabilityDto,
} from '@thehomez/shared-types';

describe('Milestone 4 Step 6: Subtask 6.3A — PartnerAvailabilityService Domain Service Tests', () => {
  const availabilityService = new PartnerAvailabilityService();

  const dummyUserId = new Types.ObjectId();
  let categoryId: Types.ObjectId;

  // Service Areas
  let activeServiceArea1: IServiceAreaDocument;
  let activeServiceArea2: IServiceAreaDocument;
  let inactiveServiceArea: IServiceAreaDocument;

  // Partners
  let partnerA: IPartnerDocument;
  let partnerB: IPartnerDocument;
  let suspendedPartner: IPartnerDocument;

  // Principals
  let principalPartnerA: IUserPrincipal;
  let principalPartnerB: IUserPrincipal;
  let principalStaffAdmin: IUserPrincipal;
  let principalStaffReadOnly: IUserPrincipal;
  let principalUnauthorized: IUserPrincipal;

  // Products & Variants
  let standaloneProduct: IProductDocument;
  let draftProduct: IProductDocument;
  let multiVariantParent: IProductDocument;
  let childVariant1: IProductVariantDocument;
  let childVariant2: IProductVariantDocument;
  let draftVariant: IProductVariantDocument;
  let foreignParent: IProductDocument;
  let foreignVariant: IProductVariantDocument;

  beforeAll(async () => {
    await connectDatabase();

    // Clean test data
    await PartnerProductModel.collection.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
    await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^SVC-AVAIL-/ } });
    await ProductModel.collection.deleteMany({ slug: { $regex: /^svc-avail-/ } });
    await PartnerModel.collection.deleteMany({ phone: { $regex: /^\+9198777/ } });
    await ServiceAreaModel.collection.deleteMany({ code: { $regex: /^SVC-SA-/ } });
    await CategoryModel.collection.deleteMany({ code: { $regex: /^SVC_CAT_/ } });

    // Sync authoritative indexes
    await PartnerProductModel.syncIndexes();
    await PartnerAvailabilityHistoryModel.syncIndexes();

    // 1. Fixture: Category
    const category = await CategoryModel.create({
      code: `SVC_CAT_${Date.now()}`,
      name: 'Availability Service Category',
      slug: `svc-avail-cat-${Date.now()}`,
      isActive: true,
      displayOrder: 1,
    });
    categoryId = category._id;

    // 2. Fixture: Service Areas
    activeServiceArea1 = await ServiceAreaModel.create({
      code: `SVC-SA-BLR-N-${Date.now()}`,
      name: 'Bengaluru North',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560001', '560002'],
      isActive: true,
    });

    activeServiceArea2 = await ServiceAreaModel.create({
      code: `SVC-SA-BLR-S-${Date.now()}`,
      name: 'Bengaluru South',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560068', '560069'],
      isActive: true,
    });

    inactiveServiceArea = await ServiceAreaModel.create({
      code: `SVC-SA-INACTIVE-${Date.now()}`,
      name: 'Inactive Area',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['560099'],
      isActive: false,
    });

    // 3. Fixture: Partners
    // Partner A assigned to SA1 and SA2
    partnerA = await PartnerModel.create({
      businessName: 'Partner A Building Supplies',
      phone: '+919877700001',
      serviceAreaIds: [activeServiceArea1._id, activeServiceArea2._id],
      status: 'ACTIVE',
      deliveryMode: 'PARTNER_MANAGED',
    });

    // Partner B assigned to SA1 only
    partnerB = await PartnerModel.create({
      businessName: 'Partner B Timber & Steel',
      phone: '+919877700002',
      serviceAreaIds: [activeServiceArea1._id],
      status: 'ACTIVE',
      deliveryMode: 'PLATFORM_MANAGED',
    });

    // Suspended Partner
    suspendedPartner = await PartnerModel.create({
      businessName: 'Suspended Merchant Ltd',
      phone: '+919877700003',
      serviceAreaIds: [activeServiceArea1._id],
      status: 'SUSPENDED',
      deliveryMode: 'PARTNER_MANAGED',
    });

    // 4. Fixture: Principals
    principalPartnerA = {
      id: dummyUserId.toString(),
      userType: UserType.PARTNER,
      phone: '+919877700001',
      roles: ['PARTNER_OPERATOR'],
      partnerId: partnerA._id.toString(),
      permissions: [
        PermissionCode.PARTNER_AVAILABILITY_READ,
        PermissionCode.PARTNER_AVAILABILITY_WRITE,
      ],
    };

    principalPartnerB = {
      id: new Types.ObjectId().toString(),
      userType: UserType.PARTNER,
      phone: '+919877700002',
      roles: ['PARTNER_OPERATOR'],
      partnerId: partnerB._id.toString(),
      permissions: [
        PermissionCode.PARTNER_AVAILABILITY_READ,
        PermissionCode.PARTNER_AVAILABILITY_WRITE,
      ],
    };

    principalStaffAdmin = {
      id: new Types.ObjectId().toString(),
      userType: UserType.STAFF,
      phone: '+919877700099',
      roles: ['SUPER_ADMIN'],
      permissions: [
        PermissionCode.PARTNER_AVAILABILITY_READ,
        PermissionCode.PARTNER_AVAILABILITY_WRITE,
        PermissionCode.CATALOG_READ,
        PermissionCode.CATALOG_WRITE,
      ],
    };

    principalStaffReadOnly = {
      id: new Types.ObjectId().toString(),
      userType: UserType.STAFF,
      phone: '+919877700098',
      roles: ['SUPPORT'],
      permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
    };

    principalUnauthorized = {
      id: new Types.ObjectId().toString(),
      userType: UserType.CUSTOMER,
      phone: '+919877700097',
      roles: ['B2C_CUSTOMER'],
      permissions: [PermissionCode.CUSTOMER_READ],
    };

    // 5. Fixture: Standalone Product (Published & Active)
    standaloneProduct = await ProductModel.create({
      title: 'UltraTech OPC 53 Grade Cement',
      brand: 'UltraTech',
      slug: `svc-avail-cement-${Date.now()}`,
      categoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `SVC-AVAIL-CEM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
      images: ['https://cdn.thehomez.com/products/cement.webp'],
      specifications: { Grade: '53' },
      unitCode: 'BAG',
    });

    // 6. Fixture: Draft Standalone Product
    draftProduct = await ProductModel.create({
      title: 'Draft Unreleased Bricks',
      brand: 'RedClay',
      slug: `svc-avail-draft-bricks-${Date.now()}`,
      categoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `SVC-AVAIL-DRF-${Date.now()}`,
      status: 'DRAFT',
      publishedAt: null,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
      images: [],
      specifications: {},
    });

    // 7. Fixture: Multi-Variant Parent & Child Variants
    multiVariantParent = await ProductModel.create({
      title: 'Kamdhenu TMT Rebar Fe-550D',
      brand: 'Kamdhenu',
      slug: `svc-avail-rebar-${Date.now()}`,
      categoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
      images: ['https://cdn.thehomez.com/products/rebar.webp'],
      specifications: { Grade: 'Fe-550D' },
    });

    childVariant1 = await ProductVariantModel.create({
      productId: multiVariantParent._id,
      sku: `SVC-AVAIL-REBAR-8MM-${Date.now()}`,
      title: 'Kamdhenu TMT Rebar 8mm',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { Diameter: '8mm' },
      images: [],
    });

    childVariant2 = await ProductVariantModel.create({
      productId: multiVariantParent._id,
      sku: `SVC-AVAIL-REBAR-12MM-${Date.now()}`,
      title: 'Kamdhenu TMT Rebar 12mm',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { Diameter: '12mm' },
      images: [],
    });

    draftVariant = await ProductVariantModel.create({
      productId: multiVariantParent._id,
      sku: `SVC-AVAIL-REBAR-DRAFT-${Date.now()}`,
      title: 'Kamdhenu TMT Rebar 16mm (Draft)',
      status: 'DRAFT',
      publishedAt: null,
      attributes: { Diameter: '16mm' },
      images: [],
    });

    // 8. Fixture: Foreign Parent and Variant
    foreignParent = await ProductModel.create({
      title: 'Tata Tiscon Rebar',
      brand: 'Tata',
      slug: `svc-avail-tata-rebar-${Date.now()}`,
      categoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
      images: [],
      specifications: {},
    });

    foreignVariant = await ProductVariantModel.create({
      productId: foreignParent._id,
      sku: `SVC-AVAIL-TATA-10MM-${Date.now()}`,
      title: 'Tata Tiscon 10mm',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { Diameter: '10mm' },
      images: [],
    });
  });

  afterAll(async () => {
    await PartnerProductModel.collection.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
    await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^SVC-AVAIL-/ } });
    await ProductModel.collection.deleteMany({ slug: { $regex: /^svc-avail-/ } });
    await PartnerModel.collection.deleteMany({ phone: { $regex: /^\+9198777/ } });
    await ServiceAreaModel.collection.deleteMany({ code: { $regex: /^SVC-SA-/ } });
    await CategoryModel.collection.deleteMany({ code: { $regex: /^SVC_CAT_/ } });
    await disconnectDatabase();
  });

  // ============================================================================
  // 1. Security & RBAC Enforcement (AC-AVAIL-01 to AC-AVAIL-06)
  // ============================================================================
  describe('1. Security, Tenant Isolation & Dynamic RBAC', () => {
    it('rejects unauthenticated callers with 401 UNAUTHENTICATED', async () => {
      await expect(
        availabilityService.setAvailability(
          null as unknown as IUserPrincipal,
          {} as unknown as ISetPartnerProductAvailabilityDto,
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'UNAUTHENTICATED', statusCode: 401 }));
    });

    it('rejects callers lacking PARTNER_AVAILABILITY_WRITE with 403 FORBIDDEN', async () => {
      await expect(
        availabilityService.setAvailability(principalUnauthorized, {
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN', statusCode: 403 }));
    });

    it('rejects callers lacking PARTNER_AVAILABILITY_READ with 403 FORBIDDEN', async () => {
      await expect(
        availabilityService.listAvailability(principalUnauthorized, {}),
      ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN', statusCode: 403 }));
    });

    it('rejects partner route tenant spoofing attempts with 403 TENANT_MISMATCH (AC-AVAIL-03)', async () => {
      // Partner A attempts to specify Partner B's ID in explicitPartnerId
      await expect(
        availabilityService.setAvailability(
          principalPartnerA,
          {
            productId: standaloneProduct._id.toString(),
            serviceAreaId: activeServiceArea1._id.toString(),
          },
          partnerB._id.toString(), // Tenant mismatch
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'TENANT_MISMATCH', statusCode: 403 }));
    });

    it('enforces cross-tenant read isolation: returns 404 PARTNER_PRODUCT_NOT_FOUND (AC-AVAIL-01)', async () => {
      // Create record for Partner B
      const partnerBRecord = await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // Partner A attempts to read Partner B's record by ID
      await expect(
        availabilityService.getAvailabilityById(principalPartnerA, partnerBRecord.id),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'PARTNER_PRODUCT_NOT_FOUND', statusCode: 404 }),
      );

      // Partner A attempts to read Partner B's history
      await expect(
        availabilityService.getAvailabilityHistory(principalPartnerA, partnerBRecord.id),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'PARTNER_PRODUCT_NOT_FOUND', statusCode: 404 }),
      );
    });

    it('enforces cross-tenant mutation isolation: Partner A cannot toggle Partner B record (AC-AVAIL-02)', async () => {
      const partnerBRecord = await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      await expect(
        availabilityService.toggleAvailability(principalPartnerA, partnerBRecord.id, {
          isAvailable: false,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'PARTNER_PRODUCT_NOT_FOUND', statusCode: 404 }),
      );

      // Verify Partner B's record remains untouched
      const freshRecord = await availabilityService.getAvailabilityById(
        principalPartnerB,
        partnerBRecord.id,
      );
      expect(freshRecord.isAvailable).toBe(true);
    });

    it('allows administrative cross-tenant read & write by authorized staff (AC-AVAIL-06)', async () => {
      const partnerBRecord = await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // Staff admin reads Partner B's record with explicit partnerId
      const adminRead = await availabilityService.getAvailabilityById(
        principalStaffAdmin,
        partnerBRecord.id,
        partnerB._id.toString(),
      );
      expect(adminRead.id).toBe(partnerBRecord.id);

      // Staff read-only inspector can read
      const staffRead = await availabilityService.getAvailabilityById(
        principalStaffReadOnly,
        partnerBRecord.id,
      );
      expect(staffRead.id).toBe(partnerBRecord.id);

      // Staff admin toggles availability
      const updated = await availabilityService.toggleAvailability(
        principalStaffAdmin,
        partnerBRecord.id,
        { isAvailable: false, reason: 'Platform administrative intervention' },
      );
      expect(updated.isAvailable).toBe(false);
    });
  });

  // ============================================================================
  // 2. Service Area Assignment & Partner Status (AC-AVAIL-07 to AC-AVAIL-11)
  // ============================================================================
  describe('2. Service Area Assignment & Partner Lifecycle', () => {
    it('successfully links availability in an active assigned service area (AC-AVAIL-07)', async () => {
      const result = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        minLeadTimeHours: 6,
        partnerCustomSku: 'CUSTOM-SKU-001',
      });

      expect(result.id).toBeDefined();
      expect(result.partnerId).toBe(partnerA._id.toString());
      expect(result.productId).toBe(standaloneProduct._id.toString());
      expect(result.variantId).toBeNull();
      expect(result.serviceAreaId).toBe(activeServiceArea1._id.toString());
      expect(result.isAvailable).toBe(true);
      expect(result.minLeadTimeHours).toBe(6);
      expect(result.partnerCustomSku).toBe('CUSTOM-SKU-001');
      expect(result.version).toBe(0);
      expect(result.product?.title).toBe(standaloneProduct.title);
      expect(result.serviceArea?.code).toBe(activeServiceArea1.code);
    });

    it('rejects availability in an unassigned service area with 400 (AC-AVAIL-08)', async () => {
      // Partner B is only assigned to SA1, NOT SA2
      await expect(
        availabilityService.setAvailability(principalPartnerB, {
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea2._id.toString(), // Unassigned to Partner B
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER',
          statusCode: 400,
        }),
      );
    });

    it('rejects availability in an inactive service area with 400 (AC-AVAIL-09)', async () => {
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: standaloneProduct._id.toString(),
          serviceAreaId: inactiveServiceArea._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER', // Not assigned (or inactive)
          statusCode: 400,
        }),
      );
    });

    it('rejects write attempts by a suspended partner with 400 (AC-AVAIL-10)', async () => {
      const principalSuspended: IUserPrincipal = {
        id: new Types.ObjectId().toString(),
        userType: UserType.PARTNER,
        phone: '+919877700003',
        roles: ['PARTNER_OPERATOR'],
        partnerId: suspendedPartner._id.toString(),
        permissions: [
          PermissionCode.PARTNER_AVAILABILITY_READ,
          PermissionCode.PARTNER_AVAILABILITY_WRITE,
        ],
      };

      await expect(
        availabilityService.setAvailability(principalSuspended, {
          productId: standaloneProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'PARTNER_NOT_ACTIVE',
          statusCode: 400,
        }),
      );
    });
  });

  // ============================================================================
  // 3. Sellable SKU & Product Lifecycle Integration (AC-AVAIL-12 to AC-AVAIL-17)
  // ============================================================================
  describe('3. Sellable SKU & Product Lifecycle Integration', () => {
    it('successfully links standalone product with variantId: null (AC-AVAIL-12)', async () => {
      const result = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        variantId: null,
        serviceAreaId: activeServiceArea2._id.toString(),
        isAvailable: true,
      });

      expect(result.variantId).toBeNull();
      expect(result.isAvailable).toBe(true);
    });

    it('rejects standalone availability on multi-variant parent container with 400 (AC-AVAIL-13)', async () => {
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: multiVariantParent._id.toString(),
          variantId: null, // Prohibited on multi-variant parent
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY',
          statusCode: 400,
        }),
      );
    });

    it('rejects variantId on standalone product with 400 (AC-AVAIL-14)', async () => {
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: standaloneProduct._id.toString(),
          variantId: childVariant1._id.toString(), // Prohibited on standalone
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY',
          statusCode: 400,
        }),
      );
    });

    it('successfully links child variant to its multi-variant parent (AC-AVAIL-15)', async () => {
      const result = await availabilityService.setAvailability(principalPartnerA, {
        productId: multiVariantParent._id.toString(),
        variantId: childVariant1._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        minLeadTimeHours: 12,
      });

      expect(result.variantId).toBe(childVariant1._id.toString());
      expect(result.variant?.title).toBe(childVariant1.title);
      expect(result.variant?.attributes).toEqual({ Diameter: '8mm' });
    });

    it('rejects variant belonging to a different parent product with 400 (AC-AVAIL-16)', async () => {
      // Pairing multiVariantParent (Kamdhenu) with foreignVariant (Tata Tiscon)
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: multiVariantParent._id.toString(),
          variantId: foreignVariant._id.toString(), // Belongs to foreignParent!
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
          statusCode: 400,
        }),
      );
    });

    it('rejects linking unpublished/draft products with 400', async () => {
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: draftProduct._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'CANNOT_LINK_UNPUBLISHED_PRODUCT',
          statusCode: 400,
        }),
      );
    });

    it('rejects linking unpublished/draft variants with 400', async () => {
      await expect(
        availabilityService.setAvailability(principalPartnerA, {
          productId: multiVariantParent._id.toString(),
          variantId: draftVariant._id.toString(),
          serviceAreaId: activeServiceArea1._id.toString(),
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'CANNOT_LINK_UNPUBLISHED_PRODUCT',
          statusCode: 400,
        }),
      );
    });

    it('cascades availability deactivation when master product is archived (AC-AVAIL-17)', async () => {
      // Ensure Partner A has active availability on standaloneProduct
      await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // Execute cascade deactivation helper
      const cascadeResult = await availabilityService.deactivateAvailabilityForProduct(
        standaloneProduct._id.toString(),
        dummyUserId.toString(),
      );

      expect(cascadeResult.modifiedCount).toBeGreaterThan(0);

      // Assert in database that availability is now false
      const doc = await PartnerProductModel.findOne({
        partnerId: partnerA._id,
        productId: standaloneProduct._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(doc?.isAvailable).toBe(false);

      // Assert transition history entry was created
      const history = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: doc?._id,
      }).sort({ createdAt: -1 });
      expect(history[0].previousState).toBe(true);
      expect(history[0].newState).toBe(false);
      expect(history[0].reason).toContain('Product archived: cascade availability deactivation');
    });
  });

  // ============================================================================
  // 4. Concurrency, OCC & Batch Transactions (AC-AVAIL-18 to AC-AVAIL-21)
  // ============================================================================
  describe('4. Concurrency, OCC, Idempotency & Batch Updates', () => {
    it('handles repeated setAvailability idempotently without unnecessary history', async () => {
      // First set: isAvailable = true
      const first = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      const historyCountBefore = await PartnerAvailabilityHistoryModel.countDocuments({
        partnerProductId: first.id,
      });

      // Repeated set with same isAvailable = true
      const second = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      const historyCountAfter = await PartnerAvailabilityHistoryModel.countDocuments({
        partnerProductId: first.id,
      });

      expect(second.isAvailable).toBe(true);
      // History count did not increase because state did not change!
      expect(historyCountAfter).toBe(historyCountBefore);
    });

    it('detects optimistic concurrency conflicts on toggle with 409 (AC-AVAIL-20)', async () => {
      const item = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // First toggle: version matches (expected version 0) -> succeeds, version becomes 1
      const updated = await availabilityService.toggleAvailability(principalPartnerA, item.id, {
        isAvailable: false,
        version: item.version,
      });
      expect(updated.version).toBe(item.version + 1);

      // Second toggle using the old version 0 -> fails with 409 conflict
      await expect(
        availabilityService.toggleAvailability(principalPartnerA, item.id, {
          isAvailable: true,
          version: item.version, // Stale version!
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'CONCURRENT_MODIFICATION_CONFLICT',
          statusCode: 409,
        }),
      );
    });

    it('executes atomic batch updates successfully (AC-AVAIL-21)', async () => {
      const item1 = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      const item2 = await availabilityService.setAvailability(principalPartnerA, {
        productId: multiVariantParent._id.toString(),
        variantId: childVariant1._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: false,
      });

      const batchResult = await availabilityService.batchUpdateAvailability(principalPartnerA, {
        items: [
          { id: item1.id, isAvailable: false, reason: 'Temporary outage' },
          { id: item2.id, isAvailable: true, reason: 'Restocked' },
        ],
      });

      expect(batchResult.updatedCount).toBe(2);
      expect(batchResult.updatedIds).toContain(item1.id);
      expect(batchResult.updatedIds).toContain(item2.id);

      const check1 = await availabilityService.getAvailabilityById(principalPartnerA, item1.id);
      const check2 = await availabilityService.getAvailabilityById(principalPartnerA, item2.id);
      expect(check1.isAvailable).toBe(false);
      expect(check2.isAvailable).toBe(true);
    });

    it('rolls back the entire batch transaction if any item fails (AC-AVAIL-21)', async () => {
      const partnerAItem = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      const partnerBItem = await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // Partner A sends a batch containing partnerAItem (valid) and partnerBItem (unauthorized!)
      await expect(
        availabilityService.batchUpdateAvailability(principalPartnerA, {
          items: [
            { id: partnerAItem.id, isAvailable: false },
            { id: partnerBItem.id, isAvailable: false }, // Belongs to Partner B!
          ],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'PARTNER_PRODUCT_NOT_FOUND',
          statusCode: 404,
        }),
      );

      // Verify that partnerAItem was NOT modified (transaction rollback confirmed!)
      const untouchedPartnerA = await availabilityService.getAvailabilityById(
        principalPartnerA,
        partnerAItem.id,
      );
      expect(untouchedPartnerA.isAvailable).toBe(true);
    });

    it('rejects duplicate IDs within the same batch payload with 400', async () => {
      const item = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      await expect(
        availabilityService.batchUpdateAvailability(principalPartnerA, {
          items: [
            { id: item.id, isAvailable: false },
            { id: item.id, isAvailable: true }, // Duplicate!
          ],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'DUPLICATE_BATCH_ITEMS',
          statusCode: 400,
        }),
      );
    });

    it('rejects batch payloads exceeding 100 items with 400', async () => {
      const fakeItems = Array.from({ length: 101 }, () => ({
        id: new Types.ObjectId().toString(),
        isAvailable: true,
      }));

      await expect(
        availabilityService.batchUpdateAvailability(principalPartnerA, {
          items: fakeItems,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_BATCH_SIZE',
          statusCode: 400,
        }),
      );
    });
  });

  // ============================================================================
  // 5. State Transition Audit History (AC-AVAIL-22 to AC-AVAIL-24)
  // ============================================================================
  describe('5. State Transition Audit History & Immutability', () => {
    it('creates initial audit history with previousState: null on create (AC-AVAIL-22)', async () => {
      const item = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea2._id.toString(),
        isAvailable: true,
      });

      const history = await availabilityService.getAvailabilityHistory(principalPartnerA, item.id);
      expect(history.length).toBeGreaterThanOrEqual(1);
      const initialEntry = history[history.length - 1];
      expect(initialEntry.previousState).toBeNull();
      expect(initialEntry.newState).toBe(true);
      expect(initialEntry.reason).toBe('Initial availability linking');
    });

    it('logs state toggle audit with operational reason (AC-AVAIL-23)', async () => {
      const item = await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea2._id.toString(),
        isAvailable: true,
      });

      await availabilityService.toggleAvailability(principalPartnerA, item.id, {
        isAvailable: false,
        reason: 'South yard stock depleted',
      });

      const history = await availabilityService.getAvailabilityHistory(principalPartnerA, item.id);
      expect(history[0].previousState).toBe(true);
      expect(history[0].newState).toBe(false);
      expect(history[0].reason).toBe('South yard stock depleted');
    });

    it('enforces audit record immutability (AC-AVAIL-24)', async () => {
      const historyRecord = await PartnerAvailabilityHistoryModel.findOne();
      expect(historyRecord).toBeDefined();

      // Attempt direct mutation
      await expect(
        PartnerAvailabilityHistoryModel.updateOne(
          { _id: historyRecord?._id },
          { $set: { reason: 'Tampered reason' } },
        ),
      ).rejects.toThrowError(/PARTNER_AVAILABILITY_HISTORY_IMMUTABLE/);
    });
  });

  // ============================================================================
  // 6. Public Storefront Discovery & Unknown Semantics (AC-AVAIL-25 to AC-AVAIL-28)
  // ============================================================================
  describe('6. Public Storefront Discovery & Unknown Semantics (Decision #48)', () => {
    it('returns unknown semantics when no delivery PIN is supplied (AC-AVAIL-25)', async () => {
      const res = await availabilityService.resolveStorefrontAvailability(
        standaloneProduct._id.toString(),
        null,
        undefined, // No PIN
      );

      expect(res.availabilityUnknown).toBe(true);
      expect(res.isAvailable).toBeNull();
      expect(res.serviceAreaId).toBeNull();
      expect(res.minLeadTimeHours).toBeNull();
      expect(res.availablePartnerCount).toBeNull();
      expect(res.message).toContain('Enter delivery PIN code');
    });

    it('returns known unserviceable semantics when invalid PIN is supplied', async () => {
      const res = await availabilityService.resolveStorefrontAvailability(
        standaloneProduct._id.toString(),
        null,
        '999999', // Unknown PIN
      );

      expect(res.availabilityUnknown).toBe(false);
      expect(res.isAvailable).toBe(false);
      expect(res.serviceAreaId).toBeNull();
      expect(res.minLeadTimeHours).toBeNull();
      expect(res.availablePartnerCount).toBe(0);
      expect(res.message).toContain('Delivery not available');
    });

    it('resolves active service area and available partners with valid PIN (AC-AVAIL-26)', async () => {
      // Set Partner A: isAvailable = true, minLeadTimeHours = 4 in SA1 (PIN 560001)
      await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        minLeadTimeHours: 4,
      });

      // Set Partner B: isAvailable = true, minLeadTimeHours = 8 in SA1 (PIN 560001)
      await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        minLeadTimeHours: 8,
      });

      const res = await availabilityService.resolveStorefrontAvailability(
        standaloneProduct._id.toString(),
        null,
        '560001', // SA1 PIN
      );

      expect(res.availabilityUnknown).toBe(false);
      expect(res.isAvailable).toBe(true);
      expect(res.serviceAreaId).toBe(activeServiceArea1._id.toString());
      expect(res.minLeadTimeHours).toBe(4); // Minimum across available partners
      expect(res.availablePartnerCount).toBe(2); // Partner A & Partner B
    });

    it('aggregates multi-partner availability correctly when one is out-of-stock (AC-AVAIL-27)', async () => {
      // Partner A: isAvailable = false
      await availabilityService.setAvailability(principalPartnerA, {
        productId: multiVariantParent._id.toString(),
        variantId: childVariant2._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: false,
      });

      // Partner B: isAvailable = true, minLeadTimeHours = 10
      await availabilityService.setAvailability(principalPartnerB, {
        productId: multiVariantParent._id.toString(),
        variantId: childVariant2._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
        minLeadTimeHours: 10,
      });

      const res = await availabilityService.resolveStorefrontAvailability(
        multiVariantParent._id.toString(),
        childVariant2._id.toString(),
        '560001',
      );

      expect(res.isAvailable).toBe(true);
      expect(res.minLeadTimeHours).toBe(10);
      expect(res.availablePartnerCount).toBe(1); // Only Partner B is available
    });

    it('suppresses availability immediately when active partner is suspended (AC-AVAIL-11)', async () => {
      // Create a dedicated partner
      const tempPartner = await PartnerModel.create({
        businessName: 'Temporary Partner',
        phone: '+919877700050',
        serviceAreaIds: [activeServiceArea1._id],
        status: 'ACTIVE',
        deliveryMode: 'PARTNER_MANAGED',
      });

      const tempPrincipal: IUserPrincipal = {
        id: new Types.ObjectId().toString(),
        userType: UserType.PARTNER,
        phone: '+919877700050',
        roles: ['PARTNER_OPERATOR'],
        partnerId: tempPartner._id.toString(),
        permissions: [
          PermissionCode.PARTNER_AVAILABILITY_READ,
          PermissionCode.PARTNER_AVAILABILITY_WRITE,
        ],
      };

      // Set item availability to true
      await availabilityService.setAvailability(tempPrincipal, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      // Now suspend partner in the database
      tempPartner.status = 'SUSPENDED';
      await tempPartner.save();

      // Ensure Partner A & B are out of stock for this test item
      await availabilityService.setAvailability(principalPartnerA, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: false,
      });
      await availabilityService.setAvailability(principalPartnerB, {
        productId: standaloneProduct._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: false,
      });

      // Query storefront
      const res = await availabilityService.resolveStorefrontAvailability(
        standaloneProduct._id.toString(),
        null,
        '560001',
      );

      // Instantly suppressed: suspended partner stock is excluded!
      expect(res.isAvailable).toBe(false);
      expect(res.availablePartnerCount).toBe(0);
    });

    it('preserves public anonymity: contains zero partner identity or pricing fields (AC-AVAIL-28)', async () => {
      const res = await availabilityService.resolveStorefrontAvailability(
        standaloneProduct._id.toString(),
        null,
        '560001',
      );

      const resObj = res as Record<string, unknown>;
      expect(resObj.partnerId).toBeUndefined();
      expect(resObj.partnerIds).toBeUndefined();
      expect(resObj.partnerName).toBeUndefined();
      expect(resObj.price).toBeUndefined();
      expect(resObj.pricePaise).toBeUndefined();
      expect(resObj.margin).toBeUndefined();
    });
  });

  // ============================================================================
  // 7. Listing Queries, Filtering, Pagination & Cascade Deactivation
  // ============================================================================
  describe('7. Listing Queries, Filtering, Pagination & Variant Cascade', () => {
    it('lists partner availability records with strict tenant isolation', async () => {
      // List for Partner A
      const listA = await availabilityService.listAvailability(principalPartnerA, {});
      expect(listA.items.length).toBeGreaterThan(0);
      expect(listA.items.every((item) => item.partnerId === partnerA._id.toString())).toBe(true);

      // List for Partner B
      const listB = await availabilityService.listAvailability(principalPartnerB, {});
      expect(listB.items.every((item) => item.partnerId === partnerB._id.toString())).toBe(true);
    });

    it('filters availability listing by serviceAreaId', async () => {
      const filtered = await availabilityService.listAvailability(principalPartnerA, {
        serviceAreaId: activeServiceArea1._id.toString(),
      });

      expect(filtered.items.length).toBeGreaterThan(0);
      expect(
        filtered.items.every((item) => item.serviceAreaId === activeServiceArea1._id.toString()),
      ).toBe(true);
    });

    it('filters availability listing by isAvailable status', async () => {
      const availableOnly = await availabilityService.listAvailability(principalPartnerA, {
        isAvailable: true,
      });
      expect(availableOnly.items.every((item) => item.isAvailable === true)).toBe(true);

      const unavailableOnly = await availabilityService.listAvailability(principalPartnerA, {
        isAvailable: false,
      });
      expect(unavailableOnly.items.every((item) => item.isAvailable === false)).toBe(true);
    });

    it('filters availability listing by categoryId', async () => {
      const categoryList = await availabilityService.listAvailability(principalPartnerA, {
        categoryId: categoryId.toString(),
      });
      expect(categoryList.items.length).toBeGreaterThan(0);
    });

    it('filters availability listing by search query matching product title or brand', async () => {
      const searchResult = await availabilityService.listAvailability(principalPartnerA, {
        search: 'UltraTech',
      });
      expect(searchResult.items.length).toBeGreaterThan(0);
      expect(searchResult.items.some((item) => item.product?.brand === 'UltraTech')).toBe(true);
    });

    it('filters availability listing by productId', async () => {
      const targetProductId = standaloneProduct._id.toString();
      const result = await availabilityService.listAvailability(principalPartnerA, {
        productId: targetProductId,
      });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.productId === targetProductId)).toBe(true);

      // Verify that querying a different product returns 0 items for Partner A
      const otherProductId = new Types.ObjectId().toString();
      const emptyResult = await availabilityService.listAvailability(principalPartnerA, {
        productId: otherProductId,
      });
      expect(emptyResult.items).toHaveLength(0);
      expect(emptyResult.total).toBe(0);
    });

    it('rejects invalid productId format with 400 VALIDATION_ERROR', async () => {
      await expect(
        availabilityService.listAvailability(principalPartnerA, {
          productId: 'not-a-valid-id',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
        }),
      );
    });

    it('combines productId filter with isAvailable and serviceAreaId', async () => {
      const targetProductId = standaloneProduct._id.toString();
      const targetSaId = activeServiceArea1._id.toString();

      const combinedResult = await availabilityService.listAvailability(principalPartnerA, {
        productId: targetProductId,
        serviceAreaId: targetSaId,
        isAvailable: true,
      });

      expect(
        combinedResult.items.every(
          (item) =>
            item.productId === targetProductId &&
            item.serviceAreaId === targetSaId &&
            item.isAvailable === true,
        ),
      ).toBe(true);
    });

    it('paginates availability listing results cleanly', async () => {
      const paginated = await availabilityService.listAvailability(principalPartnerA, {
        page: 1,
        limit: 2,
      });
      expect(paginated.limit).toBe(2);
      expect(paginated.page).toBe(1);
      expect(paginated.items.length).toBeLessThanOrEqual(2);
      expect(paginated.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('cascades availability deactivation when a specific variant is archived', async () => {
      // Ensure Partner A has active availability on childVariant1
      await availabilityService.setAvailability(principalPartnerA, {
        productId: multiVariantParent._id.toString(),
        variantId: childVariant1._id.toString(),
        serviceAreaId: activeServiceArea1._id.toString(),
        isAvailable: true,
      });

      const cascadeResult = await availabilityService.deactivateAvailabilityForVariant(
        childVariant1._id.toString(),
        dummyUserId.toString(),
      );

      expect(cascadeResult.modifiedCount).toBeGreaterThan(0);

      const doc = await PartnerProductModel.findOne({
        partnerId: partnerA._id,
        variantId: childVariant1._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(doc?.isAvailable).toBe(false);

      const history = await PartnerAvailabilityHistoryModel.find({
        partnerProductId: doc?._id,
      }).sort({ createdAt: -1 });
      expect(history[0].previousState).toBe(true);
      expect(history[0].newState).toBe(false);
      expect(history[0].reason).toContain('Variant archived: cascade availability deactivation');
    });
  });
});
