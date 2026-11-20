import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { CustomerAddressModel } from '../src/models/customer-address.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { CustomerAuditLogModel } from '../src/models/customer-audit-log.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';

describe('Stage C-2: Backend Admin Customer APIs & Contract Tests', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Staff Users & Tokens
  let superAdminUser: IUserDocument;
  let superAdminToken: string;

  let customerReaderStaff: IUserDocument;
  let customerReaderToken: string;

  let staffNoCustomerPerm: IUserDocument;
  let staffNoCustomerPermToken: string;

  let b2bVerifierStaff: IUserDocument;
  let b2bVerifierToken: string;

  let customerSuspenderStaff: IUserDocument;
  let customerSuspenderToken: string;

  // Customer & Non-Staff Users
  let regularCustomer: IUserDocument;
  let regularCustomerToken: string;

  let b2bCustomer: IUserDocument;
  let suspendedCustomer: IUserDocument;

  let partnerUser: IUserDocument;
  let partnerToken: string;

  // Service Area Fixtures
  let _testServiceArea: InstanceType<typeof ServiceAreaModel>;

  const createdUserIds: Types.ObjectId[] = [];
  const createdRoleIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    try {
      await connectDatabase(undefined, { serverSelectionTimeoutMS: 30000 });
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for test suite:', err);
      throw err;
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      // 1. Service Area for Address enrichment
      _testServiceArea = await ServiceAreaModel.create({
        code: 'TEST-CUST-SA-1',
        name: 'Bengaluru Core Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560001', '560025'],
        isActive: true,
      });

      // 2. Roles
      const seededRoles = await RoleModel.create([
        {
          code: 'TEST_ADMIN_CUST_SUPER',
          name: 'Super Admin Test Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: Object.values(PermissionCode),
        },
        {
          code: 'TEST_ADMIN_CUST_READ_ONLY',
          name: 'Customer Read Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CUSTOMER_READ],
        },
        {
          code: 'TEST_ADMIN_CUST_SUSPEND_ONLY',
          name: 'Customer Suspend Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CUSTOMER_SUSPEND],
        },
        {
          code: 'TEST_ADMIN_CUST_B2B_ONLY',
          name: 'B2B Verify Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.B2B_VERIFY],
        },
        {
          code: 'TEST_ADMIN_CUST_NO_PERM',
          name: 'Staff No Customer Perm Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
      ]);
      createdRoleIds.push(...seededRoles.map((r) => r._id));

      // 3. Batch Create Users (Staff, Partner, Customers) in a single round-trip
      const createdUsers = await UserModel.create([
        {
          phone: '+919988000001',
          email: 'superadmin-cust@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_CUST_SUPER'],
        },
        {
          phone: '+919988000002',
          email: 'reader-cust@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_CUST_READ_ONLY'],
        },
        {
          phone: '+919988000003',
          email: 'noperm-cust@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_CUST_NO_PERM'],
        },
        {
          phone: '+919988000004',
          email: 'b2b-verifier@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_CUST_B2B_ONLY'],
        },
        {
          phone: '+919988000005',
          email: 'suspender-cust@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_CUST_SUSPEND_ONLY'],
        },
        {
          phone: '+919988000006',
          email: 'partner-cust@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: new Types.ObjectId(),
          roles: [],
        },
        {
          phone: '+919988111111',
          email: 'regular-customer@example.com',
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
          metadata: { profileNotes: 'Retail homeowner' },
        },
        {
          phone: '+919988222222',
          email: 'b2b-contractor@example.com',
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: ['B2B_CUSTOMER'],
          metadata: {
            companyName: 'Apex Infra Projects',
            gstin: '29AAAAA0000A1Z5',
          },
        },
        {
          phone: '+919988333333',
          email: 'suspended-user@example.com',
          userType: UserType.CUSTOMER,
          status: UserStatus.SUSPENDED,
          roles: ['B2B_CUSTOMER'],
        },
      ]);

      superAdminUser = createdUsers[0]!;
      customerReaderStaff = createdUsers[1]!;
      staffNoCustomerPerm = createdUsers[2]!;
      b2bVerifierStaff = createdUsers[3]!;
      customerSuspenderStaff = createdUsers[4]!;
      partnerUser = createdUsers[5]!;
      regularCustomer = createdUsers[6]!;
      b2bCustomer = createdUsers[7]!;
      suspendedCustomer = createdUsers[8]!;

      superAdminToken = tokenService.signAccessToken(superAdminUser);
      customerReaderToken = tokenService.signAccessToken(customerReaderStaff);
      staffNoCustomerPermToken = tokenService.signAccessToken(staffNoCustomerPerm);
      b2bVerifierToken = tokenService.signAccessToken(b2bVerifierStaff);
      customerSuspenderToken = tokenService.signAccessToken(customerSuspenderStaff);
      partnerToken = tokenService.signAccessToken(partnerUser);
      regularCustomerToken = tokenService.signAccessToken(regularCustomer);

      // 6. Customer Delivery Addresses
      await CustomerAddressModel.create([
        {
          userId: regularCustomer._id,
          label: 'Home Villa',
          recipientName: 'Ajith Customer',
          phone: '+919988111111',
          streetAddress: '123 Palm Grove Lane',
          landmark: 'Opposite Central Park',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          isDefault: true,
        },
        {
          userId: regularCustomer._id,
          label: 'Weekend Retreat',
          recipientName: 'Ajith Alternate',
          phone: '+919988111111',
          streetAddress: '45 Lake View Road',
          city: 'Mysuru',
          state: 'Karnataka',
          pincode: '570001',
          isDefault: false,
        },
        {
          userId: b2bCustomer._id,
          label: 'Commercial Tower Site A',
          recipientName: 'Site Foreman',
          phone: '+919988222223',
          streetAddress: 'Plot 77, EPIP Zone, Whitefield',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560025',
          isDefault: true,
          heavyVehicleAccessInstructions: '40-ton trailer clearance via Gate 2',
        },
      ]);

      // 7. Active Refresh Tokens for regular customer
      await RefreshTokenModel.create({
        tokenHash: 'dummy_active_refresh_hash_1',
        userId: regularCustomer._id,
        userType: UserType.CUSTOMER,
        familyId: 'family_cust_1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      });

      createdUserIds.push(...createdUsers.map((u) => u._id));
    }
  }, 120000);

  afterAll(async () => {
    if (isDbConnected) {
      if (createdUserIds.length > 0) {
        await CustomerAuditLogModel.deleteMany({ targetUserId: { $in: createdUserIds } });
        await CustomerAddressModel.deleteMany({ userId: { $in: createdUserIds } });
        await RefreshTokenModel.deleteMany({ userId: { $in: createdUserIds } });
        await UserModel.deleteMany({ _id: { $in: createdUserIds } });
      }
      if (_testServiceArea?._id) {
        await ServiceAreaModel.deleteMany({ _id: _testServiceArea._id });
      }
      if (createdRoleIds.length > 0) {
        await RoleModel.deleteMany({ _id: { $in: createdRoleIds } });
      }
      await disconnectDatabase();
    }
  }, 120000);

  // =========================================================================
  // 1. RBAC & IDENTITY GUARDS
  // =========================================================================
  describe('1. RBAC & Identity Isolation Guards', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/admin/customers');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('strictly rejects CUSTOMER token from admin customer endpoints with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers')
        .set('Authorization', `Bearer ${regularCustomerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('strictly rejects PARTNER token from admin customer endpoints with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects STAFF user lacking CUSTOMER_READ with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers')
        .set('Authorization', `Bearer ${staffNoCustomerPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/insufficient permissions/i);
    });

    it('allows STAFF user with CUSTOMER_READ to access directory', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers')
        .set('Authorization', `Bearer ${customerReaderToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // =========================================================================
  // 2. API 1: CUSTOMER DIRECTORY (GET /api/v1/admin/customers)
  // =========================================================================
  describe('2. API 1: Customer Directory Listing', () => {
    it('scopes listing strictly to CUSTOMER identity and never returns STAFF or PARTNER users', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.items;
      expect(items.length).toBeGreaterThan(0);

      // Verify no staff or partner phone exists in output
      const phones = items.map((c: { phone: string }) => c.phone);
      expect(phones).not.toContain(superAdminUser.phone);
      expect(phones).not.toContain(customerReaderStaff.phone);
      expect(phones).not.toContain(partnerUser.phone);

      // Verify each item has required safe fields
      for (const item of items) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('phone');
        expect(item).toHaveProperty('status');
        expect(item).toHaveProperty('customerSegment');
        expect(item).toHaveProperty('addressCount');
        expect(item).toHaveProperty('createdAt');

        // Sensitive credentials must NEVER be exposed
        expect(item).not.toHaveProperty('passwordHash');
        expect(item).not.toHaveProperty('password');
        expect(item).not.toHaveProperty('otp');
        expect(item).not.toHaveProperty('tokenHash');
      }
    });

    it('supports pagination with page and limit parameters', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers?page=1&limit=2')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 2,
      });
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(3);
      expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination.hasNextPage).toBe(true);
    });

    it('enforces limit boundary (max 100, reject > 100)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers?limit=150')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('filters customers by status (ACTIVE vs SUSPENDED)', async () => {
      const activeRes = await request(app)
        .get('/api/v1/admin/customers?status=ACTIVE')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(activeRes.status).toBe(200);
      for (const c of activeRes.body.data.items) {
        expect(c.status).toBe('ACTIVE');
      }

      const suspendedRes = await request(app)
        .get('/api/v1/admin/customers?status=SUSPENDED')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(suspendedRes.status).toBe(200);
      for (const c of suspendedRes.body.data.items) {
        expect(c.status).toBe('SUSPENDED');
      }
    });

    it('filters customers by commercial segment (B2B vs B2C)', async () => {
      const b2bRes = await request(app)
        .get('/api/v1/admin/customers?segment=B2B')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(b2bRes.status).toBe(200);
      for (const c of b2bRes.body.data.items) {
        expect(c.roles).toContain('B2B_CUSTOMER');
      }

      const b2cRes = await request(app)
        .get('/api/v1/admin/customers?segment=B2C')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(b2cRes.status).toBe(200);
      for (const c of b2cRes.body.data.items) {
        expect(c.roles).not.toContain('B2B_CUSTOMER');
      }
    });

    it('searches customers safely by phone number with regex escaping', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers?search=%2B919988111111')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].phone).toBe('+919988111111');
      expect(res.body.data.items[0].addressCount).toBe(2);
      expect(res.body.data.items[0].defaultCity).toBe('Bengaluru');
      expect(res.body.data.items[0].defaultPincode).toBe('560001');
    });

    it('searches customers safely by valid MongoDB ObjectId', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers?search=${b2bCustomer._id.toString()}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].id).toBe(b2bCustomer._id.toString());
      expect(res.body.data.items[0].customerSegment).toBe('B2B');
    });

    it('correctly marks suspended B2B customer as B2C runtime segment', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers?search=${suspendedCustomer._id.toString()}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      // In TheHomez pricing engine, suspended accounts lose B2B wholesale rates
      expect(res.body.data.items[0].customerSegment).toBe('B2C');
      expect(res.body.data.items[0].status).toBe('SUSPENDED');
    });
  });

  // =========================================================================
  // 3. API 2: CUSTOMER DETAIL (GET /api/v1/admin/customers/:id)
  // =========================================================================
  describe('3. API 2: Customer Detail Inspection', () => {
    it('returns 400 when customer ID format is invalid', async () => {
      const res = await request(app)
        .get('/api/v1/admin/customers/invalid-non-object-id')
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when customer ID does not exist', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/admin/customers/${nonExistentId}`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('returns 404 when querying an existing STAFF or PARTNER ID to prevent enumeration', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers/${partnerUser._id.toString()}`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('returns full customer detail with delivery addresses and serviceability', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers/${regularCustomer._id.toString()}`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.id).toBe(regularCustomer._id.toString());
      expect(data.phone).toBe(regularCustomer.phone);
      expect(data.email).toBe(regularCustomer.email);
      expect(data.status).toBe('ACTIVE');
      expect(data.customerSegment).toBe('B2C');

      // Addresses inspection
      expect(Array.isArray(data.addresses)).toBe(true);
      expect(data.addresses.length).toBe(2);

      const defaultAddr = data.addresses.find(
        (a: {
          isDefault: boolean;
          label: string;
          pincode: string;
          isServiceable: boolean;
          serviceArea: { code: string; city: string };
        }) => a.isDefault === true,
      );
      expect(defaultAddr).toBeDefined();
      expect(defaultAddr.label).toBe('Home Villa');
      expect(defaultAddr.pincode).toBe('560001');
      expect(defaultAddr.isServiceable).toBe(true);
      expect(defaultAddr.serviceArea).toMatchObject({
        code: 'TEST-CUST-SA-1',
        city: 'Bengaluru',
      });

      const unserviceableAddr = data.addresses.find(
        (a: {
          isDefault: boolean;
          pincode: string;
          isServiceable: boolean;
          serviceArea: unknown;
        }) => a.isDefault === false,
      );
      expect(unserviceableAddr.pincode).toBe('570001');
      expect(unserviceableAddr.isServiceable).toBe(false);
      expect(unserviceableAddr.serviceArea).toBeNull();
    });

    it('projects safe metadata without leaking secrets or password fields', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers/${b2bCustomer._id.toString()}`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.metadata).toBeDefined();
      expect(data.metadata.companyName).toBe('Apex Infra Projects');
      expect(data.metadata.gstin).toBe('29AAAAA0000A1Z5');

      // Negative check for sensitive auth leaks
      expect(data).not.toHaveProperty('passwordHash');
      expect(data).not.toHaveProperty('refreshToken');
      expect(data).not.toHaveProperty('otp');
    });
  });

  // =========================================================================
  // 4. API 3: CUSTOMER ADDRESS INSPECTION (GET /api/v1/admin/customers/:id/addresses)
  // =========================================================================
  describe('4. API 3: Customer Delivery Address Inspection (Read-Only)', () => {
    it('returns 404 for non-existent customer', async () => {
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/admin/customers/${fakeId}/addresses`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('returns all delivery addresses owned by the specified customer with hub details', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/customers/${b2bCustomer._id.toString()}/addresses`)
        .set('Authorization', `Bearer ${customerReaderToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);

      const addr = res.body.data[0];
      expect(addr.label).toBe('Commercial Tower Site A');
      expect(addr.recipientName).toBe('Site Foreman');
      expect(addr.heavyVehicleAccessInstructions).toBe('40-ton trailer clearance via Gate 2');
      expect(addr.isServiceable).toBe(true);
      expect(addr.serviceArea.code).toBe('TEST-CUST-SA-1');
    });
  });

  // =========================================================================
  // 5. API 4: CUSTOMER ACCOUNT STATUS (PATCH /api/v1/admin/customers/:id/status)
  // =========================================================================
  describe('5. API 4: Customer Account Status Mutation', () => {
    it('rejects staff lacking CUSTOMER_SUSPEND permission with HTTP 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerReaderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Attempted fraud investigation',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects request with missing or empty audit reason with HTTP 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerSuspenderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: '   ',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid state transition (ACTIVE -> ACTIVE) with HTTP 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerSuspenderToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'No-op transition attempt',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toMatch(/already active/i);
    });

    it('suspends active customer, revokes refresh tokens, and records audit trail', async () => {
      // Confirm customer has active refresh token before suspension
      const activeTokensBefore = await RefreshTokenModel.countDocuments({
        userId: regularCustomer._id,
        isRevoked: false,
      });
      expect(activeTokensBefore).toBeGreaterThan(0);

      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerSuspenderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Suspicious card attempts on Order #1042',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');

      // Verify DB status
      const updatedUser = await UserModel.findById(regularCustomer._id);
      expect(updatedUser?.status).toBe(UserStatus.SUSPENDED);

      // Verify active refresh tokens were revoked
      const activeTokensAfter = await RefreshTokenModel.countDocuments({
        userId: regularCustomer._id,
        isRevoked: false,
      });
      expect(activeTokensAfter).toBe(0);

      const revokedToken = await RefreshTokenModel.findOne({ userId: regularCustomer._id });
      expect(revokedToken?.isRevoked).toBe(true);
      expect(revokedToken?.revokedReason).toBe('SECURITY_RESET');

      // Verify audit log record
      const auditLog = await CustomerAuditLogModel.findOne({
        targetCustomerId: regularCustomer._id,
        action: 'CUSTOMER_STATUS_CHANGED',
      }).sort({ createdAt: -1 });

      expect(auditLog).toBeDefined();
      expect(auditLog?.staffUserId.toString()).toBe(customerSuspenderStaff._id.toString());
      expect(auditLog?.previousState).toEqual({ status: 'ACTIVE' });
      expect(auditLog?.newState).toEqual({ status: 'SUSPENDED' });
      expect(auditLog?.reason).toBe('Suspicious card attempts on Order #1042');
    });

    it('reactivates suspended customer and logs audit trail', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerSuspenderToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Identity verified with bank statement. Reinstating account.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const updatedUser = await UserModel.findById(regularCustomer._id);
      expect(updatedUser?.status).toBe(UserStatus.ACTIVE);

      // Verify reactivation audit log
      const auditLog = await CustomerAuditLogModel.findOne({
        targetCustomerId: regularCustomer._id,
        action: 'CUSTOMER_STATUS_CHANGED',
      }).sort({ createdAt: -1 });

      expect(auditLog).toBeDefined();
      expect(auditLog?.previousState).toEqual({ status: 'SUSPENDED' });
      expect(auditLog?.newState).toEqual({ status: 'ACTIVE' });
      expect(auditLog?.reason).toBe('Identity verified with bank statement. Reinstating account.');
    });

    it('rejects self-suspension if a staff ID matches target customer ID', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${customerSuspenderStaff._id.toString()}/status`)
        .set('Authorization', `Bearer ${customerSuspenderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Accidental self suspension attempt',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SELF_SUSPENSION_PROHIBITED');
    });
  });

  // =========================================================================
  // 6. API 5: B2B CUSTOMER VERIFICATION (PATCH /api/v1/admin/customers/:id/b2b-status)
  // =========================================================================
  describe('6. API 5: B2B Wholesale Customer Verification', () => {
    it('rejects staff lacking B2B_VERIFY permission with HTTP 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${customerReaderToken}`)
        .send({
          isB2B: true,
          companyName: 'Ajith Constructions Pvt Ltd',
          gstin: '29AAAAA0000A1Z5',
          reason: 'Verified GSTIN certificate',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects granting B2B status without company name with HTTP 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${b2bVerifierToken}`)
        .send({
          isB2B: true,
          reason: 'Missing company name',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toMatch(/company name is required/i);
    });

    it('rejects malformed GSTIN with HTTP 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${b2bVerifierToken}`)
        .send({
          isB2B: true,
          companyName: 'Ajith Constructions',
          gstin: 'INVALID_GSTIN_123',
          reason: 'Verification test',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toMatch(/invalid gstin format/i);
    });

    it('grants B2B_CUSTOMER role, records metadata and creates audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${b2bVerifierToken}`)
        .send({
          isB2B: true,
          companyName: 'Ajith Constructions Pvt Ltd',
          gstin: '29AAAAA0000A1Z5',
          reason: 'Verified GSTIN & active trade license with Karnataka commercial tax portal',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customerSegment).toBe('B2B');
      expect(res.body.data.roles).toContain('B2B_CUSTOMER');
      expect(res.body.data.metadata.companyName).toBe('Ajith Constructions Pvt Ltd');
      expect(res.body.data.metadata.gstin).toBe('29AAAAA0000A1Z5');
      expect(res.body.data.metadata.b2bVerification).toMatchObject({
        isB2B: true,
        companyName: 'Ajith Constructions Pvt Ltd',
        gstin: '29AAAAA0000A1Z5',
        verifiedByStaffId: b2bVerifierStaff._id.toString(),
      });

      // Verify DB persistence
      const userInDb = await UserModel.findById(regularCustomer._id);
      expect(userInDb?.roles).toContain('B2B_CUSTOMER');

      // Verify Audit log
      const auditLog = await CustomerAuditLogModel.findOne({
        targetCustomerId: regularCustomer._id,
        action: 'CUSTOMER_B2B_VERIFIED',
      }).sort({ createdAt: -1 });

      expect(auditLog).toBeDefined();
      expect(auditLog?.staffUserId.toString()).toBe(b2bVerifierStaff._id.toString());
      expect(auditLog?.reason).toContain('Verified GSTIN');
    });

    it('prevents duplicate B2B_CUSTOMER role when grant is called again', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${b2bVerifierToken}`)
        .send({
          isB2B: true,
          companyName: 'Ajith Constructions Pvt Ltd Updated',
          reason: 'Updated company address review',
        });

      expect(res.status).toBe(200);
      const b2bRoles = res.body.data.roles.filter((r: string) => r === 'B2B_CUSTOMER');
      expect(b2bRoles.length).toBe(1);
    });

    it('revokes B2B status safely while preserving unrelated roles and metadata', async () => {
      // Add a dummy unrelated role to verify it is preserved
      await UserModel.updateOne(
        { _id: regularCustomer._id },
        { $set: { roles: ['B2B_CUSTOMER', 'LOYALTY_MEMBER'] } },
      );

      const res = await request(app)
        .patch(`/api/v1/admin/customers/${regularCustomer._id.toString()}/b2b-status`)
        .set('Authorization', `Bearer ${b2bVerifierToken}`)
        .send({
          isB2B: false,
          reason: 'GSTIN registration cancelled on state portal',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customerSegment).toBe('B2C');
      expect(res.body.data.roles).not.toContain('B2B_CUSTOMER');
      expect(res.body.data.roles).toContain('LOYALTY_MEMBER'); // Preserved!
      expect(res.body.data.metadata.b2bVerification.isB2B).toBe(false);

      // Verify audit log
      const auditLog = await CustomerAuditLogModel.findOne({
        targetCustomerId: regularCustomer._id,
        action: 'CUSTOMER_B2B_REVOKED',
      }).sort({ createdAt: -1 });

      expect(auditLog).toBeDefined();
      expect(auditLog?.previousState.roles).toContain('B2B_CUSTOMER');
      expect(auditLog?.newState.roles).not.toContain('B2B_CUSTOMER');
    });
  });
});
