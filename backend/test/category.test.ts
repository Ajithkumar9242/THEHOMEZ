import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CategoryModel } from '../src/models/category.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import type { Application } from 'express';
import { runCategoriesSeed } from '../src/seeds/categories.seed.js';

describe('Milestone 4 Step 2: Product Taxonomy — Categories & Subcategories', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  let catalogAdminUser: InstanceType<typeof UserModel>;
  let catalogAdminToken: string;

  let catalogReadOnlyUser: InstanceType<typeof UserModel>;
  let catalogReadOnlyToken: string;

  let unauthorizedUser: InstanceType<typeof UserModel>;
  let unauthorizedToken: string;

  let customerUser: InstanceType<typeof UserModel>;
  let customerToken: string;

  let partnerUser: InstanceType<typeof UserModel>;
  let partnerToken: string;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for integration testing:', err);
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      await CategoryModel.deleteMany({
        slug: { $regex: /^(test-|civil-|steel-|plumbing-|electrical-|services-)/ },
      });
      await UserModel.deleteMany({ phone: { $regex: /^\+919333/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CAT_TEST_/ } });
      await PartnerModel.deleteMany({ businessName: { $regex: /^Test Category Partner/ } });
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await CategoryModel.deleteMany({
        slug: { $regex: /^(test-|civil-|steel-|plumbing-|electrical-|services-)/ },
      });
      await UserModel.deleteMany({ phone: { $regex: /^\+919333/ } });
      await RoleModel.deleteMany({ code: { $regex: /^CAT_TEST_/ } });
      await PartnerModel.deleteMany({ businessName: { $regex: /^Test Category Partner/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (isDbConnected) {
      await CategoryModel.deleteMany({ slug: { $regex: /^test-/ } });

      // 1. Catalog Manager (CATALOG_WRITE + CATALOG_READ)
      await RoleModel.findOneAndUpdate(
        { code: 'CAT_TEST_ADMIN' },
        {
          code: 'CAT_TEST_ADMIN',
          name: 'Catalog Manager Test Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
        },
        { upsert: true, new: true },
      );

      catalogAdminUser = (await UserModel.findOneAndUpdate(
        { phone: '+919333000001' },
        {
          phone: '+919333000001',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['CAT_TEST_ADMIN'],
        },
        { upsert: true, new: true },
      )) as InstanceType<typeof UserModel>;
      catalogAdminToken = tokenService.signAccessToken(catalogAdminUser);

      // 2. Catalog Read Only (CATALOG_READ only)
      await RoleModel.findOneAndUpdate(
        { code: 'CAT_TEST_RO' },
        {
          code: 'CAT_TEST_RO',
          name: 'Catalog Read Only Test Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
        { upsert: true, new: true },
      );

      catalogReadOnlyUser = (await UserModel.findOneAndUpdate(
        { phone: '+919333000002' },
        {
          phone: '+919333000002',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['CAT_TEST_RO'],
        },
        { upsert: true, new: true },
      )) as InstanceType<typeof UserModel>;
      catalogReadOnlyToken = tokenService.signAccessToken(catalogReadOnlyUser);

      // 3. Unauthorized Staff User (lacks catalog permissions)
      await RoleModel.findOneAndUpdate(
        { code: 'CAT_TEST_UNAUTH' },
        {
          code: 'CAT_TEST_UNAUTH',
          name: 'Catalog Unauthorized Staff Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CUSTOMER_READ],
        },
        { upsert: true, new: true },
      );

      unauthorizedUser = (await UserModel.findOneAndUpdate(
        { phone: '+919333000003' },
        {
          phone: '+919333000003',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['CAT_TEST_UNAUTH'],
        },
        { upsert: true, new: true },
      )) as InstanceType<typeof UserModel>;
      unauthorizedToken = tokenService.signAccessToken(unauthorizedUser);

      // 4. Customer User
      customerUser = (await UserModel.findOneAndUpdate(
        { phone: '+919333000004' },
        {
          phone: '+919333000004',
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
        },
        { upsert: true, new: true },
      )) as InstanceType<typeof UserModel>;
      customerToken = tokenService.signAccessToken(customerUser);

      // 5. Partner User
      const partnerDoc = await PartnerModel.findOneAndUpdate(
        { businessName: 'Test Category Partner Supplies' },
        {
          businessName: 'Test Category Partner Supplies',
          phone: '+919333000005',
          status: 'ACTIVE',
        },
        { upsert: true, new: true },
      );

      partnerUser = (await UserModel.findOneAndUpdate(
        { phone: '+919333000005' },
        {
          phone: '+919333000005',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: partnerDoc._id,
          roles: [],
        },
        { upsert: true, new: true },
      )) as InstanceType<typeof UserModel>;
      partnerToken = tokenService.signAccessToken(partnerUser);
    }
  });

  // ============================================================================
  // SUITE 1: Data Model & Schema Validation
  // ============================================================================
  describe('Suite 1: Data Model & Schema Validation', () => {
    it('creates a valid root category with level 0 and null parentId', async () => {
      const root = await CategoryModel.create({
        slug: 'test-building-materials',
        name: 'Test Building Materials',
        description: 'Foundational construction items',
        displayOrder: 1,
        isActive: true,
      });

      expect(root._id).toBeDefined();
      expect(root.slug).toBe('test-building-materials');
      expect(root.level).toBe(0);
      expect(root.parentId).toBeNull();
      expect(root.displayOrder).toBe(1);
      expect(root.isActive).toBe(true);
    });

    it('creates a valid subcategory referencing a root category with level 1', async () => {
      const root = await CategoryModel.create({
        slug: 'test-paints-coatings',
        name: 'Test Paints & Coatings',
        displayOrder: 2,
      });

      const sub = await CategoryModel.create({
        slug: 'test-interior-emulsion',
        name: 'Test Interior Emulsion',
        parentId: root._id,
        displayOrder: 1,
      });

      expect(sub._id).toBeDefined();
      expect(sub.slug).toBe('test-interior-emulsion');
      expect(sub.level).toBe(1);
      expect(sub.parentId?.toString()).toBe(root._id.toString());
    });

    it('enforces case-insensitive unique slug index at database level', async () => {
      await CategoryModel.create({
        slug: 'test-unique-slug',
        name: 'First Category',
      });

      // Direct database write with exact same slug fails
      await expect(
        CategoryModel.create({
          slug: 'test-unique-slug',
          name: 'Duplicate Slug Category',
        }),
      ).rejects.toThrow();

      // Direct database write differing only by casing fails due to collation index
      await expect(
        CategoryModel.create({
          slug: 'TEST-UNIQUE-SLUG',
          name: 'Uppercase Slug Category',
        }),
      ).rejects.toThrow();
    });

    it('normalizes slug with lowercase trimming in pre-validation hook', async () => {
      const category = await CategoryModel.create({
        slug: '  TEST-UPPERCASE-SLUG  ',
        name: 'Normalized Slug Test',
      });

      expect(category.slug).toBe('test-uppercase-slug');
    });

    it('permits duplicate category names under different slugs', async () => {
      const cat1 = await CategoryModel.create({
        slug: 'test-plumbing-accessories',
        name: 'Accessories',
      });
      const cat2 = await CategoryModel.create({
        slug: 'test-electrical-accessories',
        name: 'Accessories',
      });

      expect(cat1.name).toBe('Accessories');
      expect(cat2.name).toBe('Accessories');
      expect(cat1.slug).not.toBe(cat2.slug);
    });
  });

  // ============================================================================
  // SUITE 2: AC-TAX-01 (Unique Slug & Concurrency)
  // ============================================================================
  describe('Suite 2: AC-TAX-01 (Unique Slug & Concurrency)', () => {
    it('rejects creating a duplicate slug sequentially with HTTP 409 Conflict', async () => {
      const res1 = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-sand-aggregates',
          name: 'Sand and Aggregates',
          displayOrder: 1,
        });

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);

      const res2 = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-sand-aggregates',
          name: 'Duplicate Sand Aggregates',
          displayOrder: 2,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe('CATEGORY_SLUG_EXISTS');
    });

    it('rejects duplicate slug differing only by casing (normalized before check)', async () => {
      const res1 = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-cement-binders',
          name: 'Cement Binders',
        });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'TEST-CEMENT-BINDERS',
          name: 'Uppercase Cement Binders',
        });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('CATEGORY_SLUG_EXISTS');
    });

    it('CONCURRENCY REGRESSION: simultaneous category creation requests with identical slug: exactly ONE succeeds', async () => {
      const targetSlug = 'test-concurrent-slug';

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${catalogAdminToken}`)
          .send({
            slug: targetSlug,
            name: 'Concurrent Attempt A',
            displayOrder: 1,
          }),
        request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${catalogAdminToken}`)
          .send({
            slug: targetSlug,
            name: 'Concurrent Attempt B',
            displayOrder: 2,
          }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      expect(conflictRes.body.error.code).toBe('CATEGORY_SLUG_EXISTS');

      const count = await CategoryModel.countDocuments({ slug: targetSlug });
      expect(count).toBe(1);
    });
  });

  // ============================================================================
  // SUITE 3: AC-TAX-02 (Hierarchical Depth Guard & Integrity)
  // ============================================================================
  describe('Suite 3: AC-TAX-02 (Hierarchical Depth Guard & Integrity)', () => {
    it('allows a subcategory referencing a root category (level 0)', async () => {
      const rootRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-roofing',
          name: 'Roofing Solutions',
          displayOrder: 1,
        });
      expect(rootRes.status).toBe(201);
      const rootId = rootRes.body.data.category.id;

      const subRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-metal-sheets',
          name: 'Metal Roofing Sheets',
          parentId: rootId,
          displayOrder: 1,
        });
      expect(subRes.status).toBe(201);
      expect(subRes.body.data.category.level).toBe(1);
      expect(subRes.body.data.category.parentId).toBe(rootId);
    });

    it('AC-TAX-02: rejects creating a subcategory under another subcategory (depth > 1)', async () => {
      const root = await CategoryModel.create({
        slug: 'test-electricals',
        name: 'Electricals',
        level: 0,
      });

      const sub = await CategoryModel.create({
        slug: 'test-switches-sockets',
        name: 'Switches & Sockets',
        parentId: root._id,
        level: 1,
      });

      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-modular-switches',
          name: 'Modular Switches',
          parentId: sub._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CATEGORY_HIERARCHY');
    });

    it('rejects category being its own parent with HTTP 400 CATEGORY_CIRCULAR_REFERENCE', async () => {
      const cat = await CategoryModel.create({
        slug: 'test-self-ref',
        name: 'Self Reference Test',
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${cat._id}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          parentId: cat._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_CIRCULAR_REFERENCE');
    });

    it('rejects converting a root category with existing children into a subcategory', async () => {
      const rootA = await CategoryModel.create({
        slug: 'test-root-a',
        name: 'Root A',
      });
      const rootB = await CategoryModel.create({
        slug: 'test-root-b',
        name: 'Root B',
      });
      await CategoryModel.create({
        slug: 'test-child-a',
        name: 'Child of A',
        parentId: rootA._id,
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${rootA._id}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          parentId: rootB._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_HAS_CHILDREN');
    });

    it('rejects non-existent parentId with HTTP 404 PARENT_CATEGORY_NOT_FOUND', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-orphan-sub',
          name: 'Orphan Subcategory',
          parentId: fakeId,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARENT_CATEGORY_NOT_FOUND');
    });
  });

  // ============================================================================
  // SUITE 4: AC-TAX-03 (Display Ordering & Public Tree Retrieval)
  // ============================================================================
  describe('Suite 4: AC-TAX-03 (Display Ordering & Public Tree Retrieval)', () => {
    it('returns root categories and subcategories strictly sorted by displayOrder: 1, name: 1', async () => {
      await CategoryModel.create({
        slug: 'test-root-order-2',
        name: 'Bravo Root',
        displayOrder: 20,
      });

      const root1 = await CategoryModel.create({
        slug: 'test-root-order-1',
        name: 'Alpha Root',
        displayOrder: 10,
      });

      await CategoryModel.create({
        slug: 'test-sub-order-b',
        name: 'Zulu Sub',
        parentId: root1._id,
        displayOrder: 2,
      });

      await CategoryModel.create({
        slug: 'test-sub-order-a',
        name: 'Alpha Sub',
        parentId: root1._id,
        displayOrder: 1,
      });

      const res = await request(app).get('/api/v1/categories');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.categories)).toBe(true);

      const testCategories = res.body.data.categories.filter((c: { slug: string }) =>
        c.slug.startsWith('test-root-order-'),
      );

      expect(testCategories.length).toBe(2);
      expect(testCategories[0].slug).toBe('test-root-order-1');
      expect(testCategories[1].slug).toBe('test-root-order-2');

      const subcategories = testCategories[0].subcategories;
      expect(subcategories.length).toBe(2);
      expect(subcategories[0].slug).toBe('test-sub-order-a');
      expect(subcategories[1].slug).toBe('test-sub-order-b');
    });

    it('retrieves single category details by slug with active subcategories', async () => {
      const root = await CategoryModel.create({
        slug: 'test-single-lookup',
        name: 'Single Lookup Category',
        displayOrder: 1,
      });

      await CategoryModel.create({
        slug: 'test-single-child',
        name: 'Single Child Category',
        parentId: root._id,
        displayOrder: 1,
      });

      const res = await request(app).get('/api/v1/categories/test-single-lookup');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.category.slug).toBe('test-single-lookup');
      expect(res.body.data.subcategories.length).toBe(1);
      expect(res.body.data.subcategories[0].slug).toBe('test-single-child');
    });
  });

  // ============================================================================
  // SUITE 5: AC-TAX-04 (Deactivation Cascading & Public Visibility)
  // ============================================================================
  describe('Suite 5: AC-TAX-04 (Deactivation Cascading & Public Visibility)', () => {
    it('AC-TAX-04: deactivating a parent category excludes it and all child subcategories from public tree', async () => {
      const root = await CategoryModel.create({
        slug: 'test-inactive-parent',
        name: 'Inactive Parent',
        isActive: false,
        displayOrder: 1,
      });

      await CategoryModel.create({
        slug: 'test-active-child-under-inactive',
        name: 'Active Child Under Inactive Parent',
        parentId: root._id,
        isActive: true,
        displayOrder: 1,
      });

      // 1. Public request without token
      const pubRes = await request(app).get('/api/v1/categories');
      expect(pubRes.status).toBe(200);
      const foundRoot = pubRes.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-inactive-parent',
      );
      expect(foundRoot).toBeUndefined();

      // 2. Direct slug lookup for inactive parent returns 404
      const slugRes1 = await request(app).get('/api/v1/categories/test-inactive-parent');
      expect(slugRes1.status).toBe(404);
      expect(slugRes1.body.error.code).toBe('CATEGORY_NOT_FOUND');

      // 3. Direct slug lookup for child of inactive parent returns 404
      const slugRes2 = await request(app).get(
        '/api/v1/categories/test-active-child-under-inactive',
      );
      expect(slugRes2.status).toBe(404);
      expect(slugRes2.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('excludes inactive subcategory from active parent in public tree view', async () => {
      const root = await CategoryModel.create({
        slug: 'test-active-parent',
        name: 'Active Parent',
        isActive: true,
        displayOrder: 1,
      });

      await CategoryModel.create({
        slug: 'test-inactive-sub',
        name: 'Inactive Sub',
        parentId: root._id,
        isActive: false,
        displayOrder: 1,
      });

      await CategoryModel.create({
        slug: 'test-active-sub',
        name: 'Active Sub',
        parentId: root._id,
        isActive: true,
        displayOrder: 2,
      });

      const res = await request(app).get('/api/v1/categories');
      expect(res.status).toBe(200);

      const foundRoot = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-active-parent',
      );
      expect(foundRoot).toBeDefined();
      expect(foundRoot.subcategories.length).toBe(1);
      expect(foundRoot.subcategories[0].slug).toBe('test-active-sub');
    });
  });

  // ============================================================================
  // SUITE 6: Granular Visibility Matrix & Token Safety (TASK 4)
  // ============================================================================
  describe('Suite 6: Granular Visibility Matrix & Token Safety (TASK 4)', () => {
    beforeEach(async () => {
      const inactiveRoot = await CategoryModel.create({
        slug: 'test-visibility-matrix-inactive',
        name: 'Visibility Inactive Root',
        isActive: false,
        displayOrder: 99,
      });

      await CategoryModel.create({
        slug: 'test-visibility-matrix-child',
        name: 'Visibility Child',
        parentId: inactiveRoot._id,
        isActive: true,
        displayOrder: 1,
      });
    });

    it('anonymous users CANNOT retrieve inactive categories using includeInactive=true', async () => {
      const res = await request(app).get('/api/v1/categories?includeInactive=true');
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-visibility-matrix-inactive',
      );
      expect(found).toBeUndefined();
    });

    it('customer principals CANNOT retrieve inactive categories using includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories?includeInactive=true')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-visibility-matrix-inactive',
      );
      expect(found).toBeUndefined();
    });

    it('partner principals CANNOT retrieve inactive categories using includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories?includeInactive=true')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-visibility-matrix-inactive',
      );
      expect(found).toBeUndefined();
    });

    it('unauthorized staff (lacking CATALOG_READ) CANNOT retrieve inactive categories using includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories?includeInactive=true')
        .set('Authorization', `Bearer ${unauthorizedToken}`);
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-visibility-matrix-inactive',
      );
      expect(found).toBeUndefined();
    });

    it('authorized staff with CATALOG_READ CAN retrieve inactive categories using includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories?includeInactive=true')
        .set('Authorization', `Bearer ${catalogReadOnlyToken}`);
      expect(res.status).toBe(200);
      const found = res.body.data.categories.find(
        (c: { slug: string }) => c.slug === 'test-visibility-matrix-inactive',
      );
      expect(found).toBeDefined();
      expect(found.isActive).toBe(false);
      expect(found.subcategories.length).toBe(1);
    });

    it('single slug endpoint: inactive category returns 404 for anonymous users even with includeInactive=true', async () => {
      const res = await request(app).get(
        '/api/v1/categories/test-visibility-matrix-inactive?includeInactive=true',
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('single slug endpoint: inactive category returns 404 for partner tokens even with includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories/test-visibility-matrix-inactive?includeInactive=true')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('single slug endpoint: inactive category returns 200 for staff holding CATALOG_READ with includeInactive=true', async () => {
      const res = await request(app)
        .get('/api/v1/categories/test-visibility-matrix-inactive?includeInactive=true')
        .set('Authorization', `Bearer ${catalogReadOnlyToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.category.slug).toBe('test-visibility-matrix-inactive');
      expect(res.body.data.category.isActive).toBe(false);
    });

    it('rejects malformed token format with HTTP 401 MALFORMED_TOKEN (never silently falls back)', async () => {
      const res = await request(app)
        .get('/api/v1/categories')
        .set('Authorization', 'InvalidFormatHeader');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MALFORMED_TOKEN');
    });

    it('rejects invalid or forged JWT signature with HTTP 401 INVALID_ACCESS_TOKEN', async () => {
      const forgedToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwidXNlclR5cGUiOiJTVEFGRiJ9.bogus_signature';
      const res = await request(app)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${forgedToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  });

  // ============================================================================
  // SUITE 7: AC-TAX-05 (RBAC & Route Authorization)
  // ============================================================================
  describe('Suite 7: AC-TAX-05 (RBAC & Route Authorization)', () => {
    it('unauthenticated user is rejected with HTTP 401 when creating category', async () => {
      const res = await request(app).post('/api/v1/categories').send({
        slug: 'test-unauth-cat',
        name: 'Unauth Category',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('unauthenticated user is rejected with HTTP 401 when updating category', async () => {
      const cat = await CategoryModel.create({
        slug: 'test-unauth-update',
        name: 'Unauth Update',
      });

      const res = await request(app).patch(`/api/v1/categories/${cat._id}`).send({
        name: 'New Name',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('user lacking CATALOG_WRITE receives HTTP 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .send({
          slug: 'test-forbidden-cat',
          name: 'Forbidden Category',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('user with CATALOG_READ only CANNOT create categories (HTTP 403)', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogReadOnlyToken}`)
        .send({
          slug: 'test-readonly-fail',
          name: 'Read Only Fail',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('authorized user with CATALOG_WRITE can create and update categories', async () => {
      const createRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          slug: 'test-authorized-flow',
          name: 'Authorized Flow',
          displayOrder: 5,
        });

      expect(createRes.status).toBe(201);
      const catId = createRes.body.data.category.id;

      const updateRes = await request(app)
        .patch(`/api/v1/categories/${catId}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({
          name: 'Updated Authorized Flow',
          displayOrder: 10,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.category.name).toBe('Updated Authorized Flow');
      expect(updateRes.body.data.category.displayOrder).toBe(10);
    });
  });

  // ============================================================================
  // SUITE 8: Category Deletion & Referential Integrity (TASK 2)
  // ============================================================================
  describe('Suite 8: Category Deletion & Referential Integrity (TASK 2)', () => {
    it('rejects deleting a category that has subcategories with HTTP 400 CATEGORY_HAS_CHILDREN', async () => {
      const root = await CategoryModel.create({
        slug: 'test-del-parent',
        name: 'Delete Parent',
      });
      await CategoryModel.create({
        slug: 'test-del-child',
        name: 'Delete Child',
        parentId: root._id,
      });

      const res = await request(app)
        .delete(`/api/v1/categories/${root._id}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_HAS_CHILDREN');
    });

    it('normal administrative deprecation: soft deactivation preserves data and hides from public view', async () => {
      const leaf = await CategoryModel.create({
        slug: 'test-deprecate-leaf',
        name: 'Deprecate Leaf Category',
        isActive: true,
      });

      // Admin deactivates
      const patchRes = await request(app)
        .patch(`/api/v1/categories/${leaf._id}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`)
        .send({ isActive: false });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.category.isActive).toBe(false);

      // Public cannot discover deactivated category
      const pubRes = await request(app).get('/api/v1/categories/test-deprecate-leaf');
      expect(pubRes.status).toBe(404);

      // Document is preserved in database
      const dbDoc = await CategoryModel.findById(leaf._id);
      expect(dbDoc).not.toBeNull();
      expect(dbDoc?.isActive).toBe(false);
    });

    it('allows deleting an unreferenced leaf category successfully', async () => {
      const leaf = await CategoryModel.create({
        slug: 'test-leaf-category',
        name: 'Leaf Category',
      });

      const res = await request(app)
        .delete(`/api/v1/categories/${leaf._id}`)
        .set('Authorization', `Bearer ${catalogAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await CategoryModel.findById(leaf._id);
      expect(check).toBeNull();
    });
  });

  // ============================================================================
  // SUITE 9: Category Seed Execution & Safety (TASK 1)
  // ============================================================================
  describe('Suite 9: Category Seed Execution & Safety (TASK 1)', () => {
    it('seeds physical construction material categories and excludes trade services', async () => {
      // Clean seed categories before running seed test
      await CategoryModel.deleteMany({
        slug: {
          $in: [
            'services-contractors',
            'electricians',
            'plumbers',
            'civil-construction',
            'steel-structural',
            'cement',
            'sand-aggregates',
            'bricks-blocks',
            'tmt-rebars',
            'binding-wire-mesh',
            'plumbing-sanitaryware',
            'cpvc-pipes-fittings',
            'pvc-pipes-fittings',
            'sanitaryware',
            'electrical-lighting',
            'modular-switches',
            'wires-cables',
            'led-lighting',
            'paints-finishes',
            'interior-emulsion',
            'exterior-emulsion',
            'waterproofing',
            'flooring-tiles',
            'vitrified-tiles',
            'ceramic-wall-tiles',
          ],
        },
      });

      const result1 = await runCategoriesSeed();
      expect(result1.seeded).toBeGreaterThan(0);

      // Verify physical construction materials exist
      const civil = await CategoryModel.findOne({ slug: 'civil-construction' });
      expect(civil).not.toBeNull();
      expect(civil?.level).toBe(0);

      const cement = await CategoryModel.findOne({ slug: 'cement' });
      expect(cement).not.toBeNull();
      expect(cement?.level).toBe(1);
      expect(cement?.parentId?.toString()).toBe(civil?._id.toString());

      const steel = await CategoryModel.findOne({ slug: 'steel-structural' });
      expect(steel).not.toBeNull();

      const plumbing = await CategoryModel.findOne({ slug: 'plumbing-sanitaryware' });
      expect(plumbing).not.toBeNull();

      const electrical = await CategoryModel.findOne({ slug: 'electrical-lighting' });
      expect(electrical).not.toBeNull();

      // TASK 1: Confirm trade services are explicitly EXCLUDED from product taxonomy
      const tradeServices = await CategoryModel.findOne({ slug: 'services-contractors' });
      expect(tradeServices).toBeNull();

      const electricians = await CategoryModel.findOne({ slug: 'electricians' });
      expect(electricians).toBeNull();

      // Re-running seed performs idempotent updates with 0 new seeded
      const result2 = await runCategoriesSeed();
      expect(result2.seeded).toBe(0);
      expect(result2.updated).toBeGreaterThan(0);
    });

    it('rejects seed execution unconditionally in production environments', async () => {
      await expect(runCategoriesSeed({ isProduction: true })).rejects.toThrow(
        'Development fixture seeding is permanently blocked in production environments.',
      );
    });
  });
});
