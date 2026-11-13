import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Application } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import {
  ADDRESS_ERROR_CODES,
  MAX_ADDRESSES_PER_CUSTOMER,
  PermissionCode,
  UserStatus,
  UserType,
  customerAddressDtoSchema,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CustomerAddressModel } from '../src/models/customer-address.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { logger } from '../src/logger/logger.js';

describe('Milestone 5B.1: Customer Delivery Site Address Book (Backend)', () => {
  let isDbConnected = false;
  let app: Application;
  let concurrencyApp: Application;
  let tokenService: TokenService;

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

  let activeServiceArea: IServiceAreaDocument;
  let inactiveServiceArea: IServiceAreaDocument;

  const testPhonePrefix = '+9193333';
  const testRolePrefix = 'ADDR_TEST_';
  const testSaPrefix = 'ADDR-TEST-SA-';

  const activePincode = '560991';
  const inactivePincode = '560992';
  const uncoveredPincode = '560993';

  function buildValidPayload(
    overrides: Partial<ICreateCustomerAddressDto> = {},
  ): ICreateCustomerAddressDto {
    return {
      label: 'Whitefield Site Gate 2',
      recipientName: 'Ramesh Rao',
      phone: '+919876543210',
      streetAddress: 'Plot 14, KIADB Industrial Area, Whitefield',
      landmark: 'Near ITPL Main Gate',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: activePincode,
      siteContactPerson: {
        name: 'Suresh Kumar',
        phone: '+919811122233',
      },
      heavyVehicleAccessInstructions: '12-wheeler tipper entry allowed between 6 AM and 9 PM.',
      ...overrides,
    };
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

    if (!isDbConnected) {
      return;
    }

    await CustomerAddressModel.syncIndexes();

    // Clean only test fixtures belonging to this suite
    const existingTestUsers = await UserModel.find({
      phone: { $regex: /^\+9193333/ },
    }).select('_id');
    const existingTestUserIds = existingTestUsers.map((u) => u._id);
    if (existingTestUserIds.length > 0) {
      await CustomerAddressModel.deleteMany({ userId: { $in: existingTestUserIds } });
    }
    await UserModel.deleteMany({ phone: { $regex: /^\+9193333/ } });
    await RoleModel.deleteMany({ code: { $regex: /^ADDR_TEST_/ } });
    await ServiceAreaModel.deleteMany({ code: { $regex: /^ADDR-TEST-SA-/ } });

    await RoleModel.create({
      code: `${testRolePrefix}ADMIN`,
      name: 'Address Test Admin',
      userType: UserType.STAFF,
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.SETTINGS_WRITE],
    });

    activeServiceArea = await ServiceAreaModel.create({
      code: `${testSaPrefix}ACTIVE`,
      name: 'Bengaluru Address Test Active Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: [activePincode],
      isActive: true,
    });

    inactiveServiceArea = await ServiceAreaModel.create({
      code: `${testSaPrefix}INACTIVE`,
      name: 'Bengaluru Address Test Inactive Zone',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: [inactivePincode],
      isActive: false,
    });

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
      roles: [`${testRolePrefix}ADMIN`],
    });

    tokenA = tokenService.signAccessToken(customerA);
    tokenB = tokenService.signAccessToken(customerB);
    suspendedToken = tokenService.signAccessToken(suspendedCustomer);
    pendingToken = tokenService.signAccessToken(pendingCustomer);
    partnerToken = tokenService.signAccessToken(partnerUser);
    staffToken = tokenService.signAccessToken(staffUser);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    if (!isDbConnected) return;

    await CustomerAddressModel.deleteMany({
      userId: { $in: [customerA._id, customerB._id] },
    });

    // Ensure service area active flags are reset before each test
    await ServiceAreaModel.updateOne({ _id: activeServiceArea._id }, { $set: { isActive: true } });
    await ServiceAreaModel.updateOne(
      { _id: inactiveServiceArea._id },
      { $set: { isActive: false } },
    );
  });

  afterAll(async () => {
    if (isDbConnected) {
      await CustomerAddressModel.deleteMany({
        userId: {
          $in: [
            customerA._id,
            customerB._id,
            suspendedCustomer._id,
            pendingCustomer._id,
            partnerUser._id,
            staffUser._id,
          ],
        },
      });
      await UserModel.deleteMany({ phone: { $regex: /^\+9193333/ } });
      await RoleModel.deleteMany({ code: { $regex: /^ADDR_TEST_/ } });
      await ServiceAreaModel.deleteMany({ code: { $regex: /^ADDR-TEST-SA-/ } });
      await disconnectDatabase();
    }
  });

  describe('1. Data Model & Indexes', () => {
    it('registers expected listing and partial unique default indexes on customer_addresses', async () => {
      if (!isDbConnected) return;

      const indexes = await CustomerAddressModel.collection.indexes();
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain('idx_customer_addresses_list');
      expect(indexNames).toContain('unique_customer_default_address');

      const defaultUniqueIdx = indexes.find((idx) => idx.name === 'unique_customer_default_address');
      expect(defaultUniqueIdx?.unique).toBe(true);
      expect(defaultUniqueIdx?.partialFilterExpression).toEqual({ isDefault: true });
    });

    it('enforces single-default invariant at MongoDB storage level while allowing defaults per distinct customer', async () => {
      if (!isDbConnected) return;

      await CustomerAddressModel.create({
        userId: customerA._id,
        ...buildValidPayload(),
        isDefault: true,
      });

      // Another customer can also have a default address
      await CustomerAddressModel.create({
        userId: customerB._id,
        ...buildValidPayload(),
        isDefault: true,
      });

      // Second default for the same customer directly in DB must fail with E11000
      await expect(
        CustomerAddressModel.create({
          userId: customerA._id,
          ...buildValidPayload({ label: 'Duplicate Default Attempt' }),
          isDefault: true,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('2. CRUD Lifecycle, Default Promotion & Live Serviceability', () => {
    it('returns empty array when customer has no saved addresses', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('creates first address with auto-promoted isDefault=true and returns clean DTO without internal DB fields', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const dto: ICustomerAddressDto = res.body.data;
      expect(customerAddressDtoSchema.parse(dto)).toEqual(dto);
      expect(dto.isDefault).toBe(true);
      expect(dto.isServiceable).toBe(true);
      expect(dto.serviceArea).toEqual({
        id: activeServiceArea._id.toString(),
        code: activeServiceArea.code,
        name: activeServiceArea.name,
        city: activeServiceArea.city,
        state: activeServiceArea.state,
      });

      // Must not expose internal Mongoose fields or ownership FK
      expect(dto).not.toHaveProperty('_id');
      expect(dto).not.toHaveProperty('__v');
      expect(dto).not.toHaveProperty('userId');
    });

    it('lists addresses ordered by default first then most recently updated, and retrieves single address by ID', async () => {
      if (!isDbConnected) return;

      const firstRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site 1 (Default)' }));
      expect(firstRes.status).toBe(201);
      const firstId = firstRes.body.data.id;

      const secondRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site 2', pincode: uncoveredPincode, isDefault: false }));
      expect(secondRes.status).toBe(201);
      expect(secondRes.body.data.isDefault).toBe(false);
      expect(secondRes.body.data.isServiceable).toBe(false);
      expect(secondRes.body.data.serviceArea).toBeNull();
      const secondId = secondRes.body.data.id;

      const thirdRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site 3', pincode: inactivePincode }));
      expect(thirdRes.status).toBe(201);
      expect(thirdRes.body.data.isDefault).toBe(false);
      expect(thirdRes.body.data.isServiceable).toBe(false);
      expect(thirdRes.body.data.serviceArea).toBeNull();
      const thirdId = thirdRes.body.data.id;

      const listRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(3);
      expect(listRes.body.data.map((a: ICustomerAddressDto) => a.id)).toEqual([
        firstId,
        thirdId,
        secondId,
      ]);

      const getOneRes = await request(app)
        .get(`/api/v1/customer/addresses/${secondId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getOneRes.status).toBe(200);
      expect(getOneRes.body.data.id).toBe(secondId);
      expect(getOneRes.body.data.label).toBe('Site 2');
    });

    it('updates address fields, clears nullable optional fields, and atomically swaps default via PUT and PATCH', async () => {
      if (!isDbConnected) return;

      const create1 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site Alpha' }));
      const id1 = create1.body.data.id;

      const create2 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site Beta', pincode: uncoveredPincode }));
      const id2 = create2.body.data.id;

      // Update Site Beta: clear optional fields and make serviceable + default via PUT
      const putRes = await request(app)
        .put(`/api/v1/customer/addresses/${id2}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          label: '  Site Beta Updated  ',
          pincode: activePincode,
          landmark: null,
          siteContactPerson: null,
          heavyVehicleAccessInstructions: '',
          isDefault: true,
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.label).toBe('Site Beta Updated');
      expect(putRes.body.data.landmark).toBeNull();
      expect(putRes.body.data.siteContactPerson).toBeNull();
      expect(putRes.body.data.heavyVehicleAccessInstructions).toBeNull();
      expect(putRes.body.data.isDefault).toBe(true);
      expect(putRes.body.data.isServiceable).toBe(true);

      // Verify Site Alpha was unset as default
      const getAlpha = await request(app)
        .get(`/api/v1/customer/addresses/${id1}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getAlpha.status).toBe(200);
      expect(getAlpha.body.data.isDefault).toBe(false);

      // Atomically swap default back to Site Alpha via PATCH /:addressId/default
      const patchDefaultRes = await request(app)
        .patch(`/api/v1/customer/addresses/${id1}/default`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(patchDefaultRes.status).toBe(200);
      expect(patchDefaultRes.body.data.id).toBe(id1);
      expect(patchDefaultRes.body.data.isDefault).toBe(true);

      // Idempotent repeat PATCH on already-default address
      const repeatPatchRes = await request(app)
        .patch(`/api/v1/customer/addresses/${id1}/default`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(repeatPatchRes.status).toBe(200);
      expect(repeatPatchRes.body.data.isDefault).toBe(true);

      const listAfter = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listAfter.body.data.filter((a: ICustomerAddressDto) => a.isDefault)).toHaveLength(1);
      expect(listAfter.body.data[0].id).toBe(id1);
    });

    it('deletes default address and promotes newest remaining address, and deletes last address cleanly', async () => {
      if (!isDbConnected) return;

      const a1 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Oldest' }));
      const a2 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Middle' }));
      const a3 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Newest' }));

      const id1 = a1.body.data.id;
      const id2 = a2.body.data.id;
      const id3 = a3.body.data.id;

      // Delete non-default middle address -> no default promotion
      const delNonDefault = await request(app)
        .delete(`/api/v1/customer/addresses/${id2}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delNonDefault.status).toBe(200);
      expect(delNonDefault.body.data).toEqual({
        deletedAddressId: id2,
        promotedDefaultAddressId: null,
      });

      // Delete default (id1) -> newest remaining (id3) promoted
      const delDefault = await request(app)
        .delete(`/api/v1/customer/addresses/${id1}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delDefault.status).toBe(200);
      expect(delDefault.body.data).toEqual({
        deletedAddressId: id1,
        promotedDefaultAddressId: id3,
      });

      // Delete final remaining address (id3) -> promotedDefaultAddressId is null
      const delLast = await request(app)
        .delete(`/api/v1/customer/addresses/${id3}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delLast.status).toBe(200);
      expect(delLast.body.data).toEqual({
        deletedAddressId: id3,
        promotedDefaultAddressId: null,
      });

      const listRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toEqual([]);
    });

    it('dynamically reflects ServiceAreaModel activation/deactivation on subsequent reads', async () => {
      if (!isDbConnected) return;

      const created = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ pincode: activePincode }));

      expect(created.status).toBe(201);
      expect(created.body.data.isServiceable).toBe(true);
      const addressId = created.body.data.id;

      // Deactivate service area dynamically
      await ServiceAreaModel.updateOne(
        { _id: activeServiceArea._id },
        { $set: { isActive: false } },
      );

      const afterDeactivate = await request(app)
        .get(`/api/v1/customer/addresses/${addressId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterDeactivate.status).toBe(200);
      expect(afterDeactivate.body.data.isServiceable).toBe(false);
      expect(afterDeactivate.body.data.serviceArea).toBeNull();

      // Reactivate service area
      await ServiceAreaModel.updateOne(
        { _id: activeServiceArea._id },
        { $set: { isActive: true } },
      );

      const afterReactivate = await request(app)
        .get(`/api/v1/customer/addresses/${addressId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterReactivate.status).toBe(200);
      expect(afterReactivate.body.data.isServiceable).toBe(true);
      expect(afterReactivate.body.data.serviceArea?.code).toBe(activeServiceArea.code);
    });
  });

  describe('3. Validation Rules (PIN, E.164 Phone, Bounds, Strict Fields, ObjectId)', () => {
    it('rejects invalid Indian PIN codes with HTTP 400 VALIDATION_ERROR', async () => {
      if (!isDbConnected) return;

      for (const badPin of ['056001', '56001', '5600001', '56A001', '']) {
        const res = await request(app)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(buildValidPayload({ pincode: badPin }));

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects non-E.164 phone numbers on primary phone and siteContactPerson.phone', async () => {
      if (!isDbConnected) return;

      for (const badPhone of ['9876543210', '+019876543210', '+919876', 'invalid']) {
        const resPrimary = await request(app)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(buildValidPayload({ phone: badPhone }));

        expect(resPrimary.status).toBe(400);
        expect(resPrimary.body.error.code).toBe('VALIDATION_ERROR');

        const resSiteContact = await request(app)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(
            buildValidPayload({
              siteContactPerson: { name: 'Site Lead', phone: badPhone },
            }),
          );

        expect(resSiteContact.status).toBe(400);
        expect(resSiteContact.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects missing required fields and string length violations', async () => {
      if (!isDbConnected) return;

      const missingRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ label: 'Incomplete' });
      expect(missingRes.status).toBe(400);
      expect(missingRes.body.error.code).toBe('VALIDATION_ERROR');

      const oversizedRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(
          buildValidPayload({
            heavyVehicleAccessInstructions: 'x'.repeat(301),
          }),
        );
      expect(oversizedRes.status).toBe(400);
      expect(oversizedRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('strictly rejects unexpected and server-managed fields including self userId/customerId', async () => {
      if (!isDbConnected) return;

      const strictRejectedPayloads = [
        { userId: customerA._id.toString() },
        { isServiceable: true },
        { serviceAreaId: activeServiceArea._id.toString() },
        { partnerId: new mongoose.Types.ObjectId().toString() },
        { unexpectedExtraField: 'evil' },
      ];

      for (const extra of strictRejectedPayloads) {
        const res = await request(app)
          .post('/api/v1/customer/addresses')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ ...buildValidPayload(), ...extra });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }

      const customerIdRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...buildValidPayload(), customerId: customerA._id.toString() });

      expect(customerIdRes.status).toBe(403);
      expect(customerIdRes.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');

      // Also reject unexpected fields on PUT
      const created = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload());
      const addressId = created.body.data.id;

      const putExtra = await request(app)
        .put(`/api/v1/customer/addresses/${addressId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ label: 'Updated', isServiceable: false });
      expect(putExtra.status).toBe(400);
      expect(putExtra.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed ObjectIds in :addressId param with HTTP 400 VALIDATION_ERROR', async () => {
      if (!isDbConnected) return;

      for (const badId of ['not-an-objectid', '12345', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
        const getRes = await request(app)
          .get(`/api/v1/customer/addresses/${badId}`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(getRes.status).toBe(400);
        expect(getRes.body.error.code).toBe('VALIDATION_ERROR');

        const putRes = await request(app)
          .put(`/api/v1/customer/addresses/${badId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ label: 'Valid' });
        expect(putRes.status).toBe(400);
        expect(putRes.body.error.code).toBe('VALIDATION_ERROR');

        const patchRes = await request(app)
          .patch(`/api/v1/customer/addresses/${badId}/default`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(patchRes.status).toBe(400);
        expect(patchRes.body.error.code).toBe('VALIDATION_ERROR');

        const delRes = await request(app)
          .delete(`/api/v1/customer/addresses/${badId}`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(delRes.status).toBe(400);
        expect(delRes.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('4. Authentication, Inactive Customer, Wrong User Type & Anti-IDOR Isolation', () => {
    it('rejects unauthenticated requests across all address endpoints with HTTP 401', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();

      const responses = await Promise.all([
        request(app).get('/api/v1/customer/addresses'),
        request(app).post('/api/v1/customer/addresses').send(buildValidPayload()),
        request(app).get(`/api/v1/customer/addresses/${fakeId}`),
        request(app).put(`/api/v1/customer/addresses/${fakeId}`).send({ label: 'New' }),
        request(app).patch(`/api/v1/customer/addresses/${fakeId}/default`),
        request(app).delete(`/api/v1/customer/addresses/${fakeId}`),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects SUSPENDED and PENDING_VERIFICATION customers with HTTP 401 ACCOUNT_NOT_ACTIVE', async () => {
      if (!isDbConnected) return;

      const suspendedRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${suspendedToken}`);
      expect(suspendedRes.status).toBe(401);
      expect(suspendedRes.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

      const pendingRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send(buildValidPayload());
      expect(pendingRes.status).toBe(401);
      expect(pendingRes.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects PARTNER and STAFF principals with HTTP 403 CUSTOMER_IDENTITY_REQUIRED', async () => {
      if (!isDbConnected) return;

      const partnerGet = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${partnerToken}`);
      expect(partnerGet.status).toBe(403);
      expect(partnerGet.body.error.code).toBe(ADDRESS_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);

      const staffPost = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(buildValidPayload());
      expect(staffPost.status).toBe(403);
      expect(staffPost.body.error.code).toBe(ADDRESS_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED);
    });

    it('rejects client identity spoofing (mismatched userId/customerId in body/query/header) with HTTP 403', async () => {
      if (!isDbConnected) return;

      const bodySpoof = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...buildValidPayload(), userId: customerB._id.toString() });
      expect(bodySpoof.status).toBe(403);
      expect(bodySpoof.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');

      const querySpoof = await request(app)
        .get(`/api/v1/customer/addresses?customerId=${customerB._id.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(querySpoof.status).toBe(403);
      expect(querySpoof.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');

      const headerSpoof = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-user-id', customerB._id.toString());
      expect(headerSpoof.status).toBe(403);
      expect(headerSpoof.body.error.code).toBe('CUSTOMER_IDENTITY_MISMATCH');
    });

    it('prevents cross-customer read, update, set-default, and delete with HTTP 404 ADDRESS_NOT_FOUND', async () => {
      if (!isDbConnected) return;

      const createdA = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Customer A Private Site' }));
      expect(createdA.status).toBe(201);
      const addressAId = createdA.body.data.id;

      // Customer B list does not include Customer A's address
      const listB = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(listB.status).toBe(200);
      expect(listB.body.data).toEqual([]);

      // Customer B cannot read, update, set-default, or delete Customer A's address
      const getB = await request(app)
        .get(`/api/v1/customer/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(getB.status).toBe(404);
      expect(getB.body.error.code).toBe(ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND);

      const putB = await request(app)
        .put(`/api/v1/customer/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ label: 'Hijacked' });
      expect(putB.status).toBe(404);
      expect(putB.body.error.code).toBe(ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND);

      const patchB = await request(app)
        .patch(`/api/v1/customer/addresses/${addressAId}/default`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(patchB.status).toBe(404);
      expect(patchB.body.error.code).toBe(ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND);

      const delB = await request(app)
        .delete(`/api/v1/customer/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(delB.status).toBe(404);
      expect(delB.body.error.code).toBe(ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND);

      // Confirm Customer A's address remains intact
      const getA = await request(app)
        .get(`/api/v1/customer/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(getA.status).toBe(200);
      expect(getA.body.data.label).toBe('Customer A Private Site');
    });

    it('rejects malformed JSON bodies, non-object JSON payloads, nested unexpected fields, and malformed Bearer headers', async () => {
      if (!isDbConnected) return;

      const malformedAuthRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(malformedAuthRes.status).toBe(401);
      expect(malformedAuthRes.body.error.code).toBe('MALFORMED_TOKEN');

      const malformedJsonRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Content-Type', 'application/json')
        .send('{"label": "Broken"');
      expect(malformedJsonRes.status).toBe(400);

      const arrayPayloadRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send([buildValidPayload()]);
      expect(arrayPayloadRes.status).toBe(400);
      expect(arrayPayloadRes.body.error.code).toBe('VALIDATION_ERROR');

      const nestedStrictRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          ...buildValidPayload(),
          siteContactPerson: {
            name: 'Suresh Kumar',
            phone: '+919811122233',
            role: 'admin',
          },
        });
      expect(nestedStrictRes.status).toBe(400);
      expect(nestedStrictRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('immediately blocks mid-session suspended customer holding a previously issued active JWT', async () => {
      if (!isDbConnected) return;

      const tempActive = await UserModel.create({
        phone: `${testPhonePrefix}00099`,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      const activeJwt = tokenService.signAccessToken(tempActive);

      const okRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${activeJwt}`);
      expect(okRes.status).toBe(200);

      await UserModel.updateOne({ _id: tempActive._id }, { $set: { status: UserStatus.SUSPENDED } });

      const blockedRes = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${activeJwt}`)
        .send(buildValidPayload());
      expect(blockedRes.status).toBe(401);
      expect(blockedRes.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });
  });

  describe('5. Maximum 20 Addresses Limit & Concurrency Safety', () => {
    it('enforces maximum of 20 addresses per customer and allows re-creating after deletion', async () => {
      if (!isDbConnected) return;

      // Seed 20 addresses directly for customerA
      const docs = Array.from({ length: MAX_ADDRESSES_PER_CUSTOMER }, (_, idx) => ({
        userId: customerA._id,
        ...buildValidPayload({ label: `Site ${idx + 1}` }),
        isDefault: idx === 0,
      }));
      await CustomerAddressModel.insertMany(docs);

      // 21st via API must fail with 400 ADDRESS_LIMIT_EXCEEDED
      const overflowRes = await request(concurrencyApp)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site 21' }));

      expect(overflowRes.status).toBe(400);
      expect(overflowRes.body.error.code).toBe(ADDRESS_ERROR_CODES.ADDRESS_LIMIT_EXCEEDED);

      // Customer B is unaffected and can still create an address
      const customerBRes = await request(concurrencyApp)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenB}`)
        .send(buildValidPayload({ label: 'Customer B Site 1' }));
      expect(customerBRes.status).toBe(201);

      // Delete one of Customer A's addresses, then create 20th again
      const listA = await request(concurrencyApp)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);
      const nonDefaultId = listA.body.data[1].id;

      const delRes = await request(concurrencyApp)
        .delete(`/api/v1/customer/addresses/${nonDefaultId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(200);

      const recreateRes = await request(concurrencyApp)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload({ label: 'Site 20 Replacement' }));
      expect(recreateRes.status).toBe(201);
    });

    it('prevents exceeding 20 addresses under concurrent POST requests', async () => {
      if (!isDbConnected) return;

      // Seed 18 addresses -> only 2 slots left
      const docs = Array.from({ length: 18 }, (_, idx) => ({
        userId: customerA._id,
        ...buildValidPayload({ label: `Seeded ${idx + 1}` }),
        isDefault: idx === 0,
      }));
      await CustomerAddressModel.insertMany(docs);

      // Fire 6 concurrent create requests
      const concurrentResponses = await Promise.all(
        Array.from({ length: 6 }, (_, idx) =>
          request(concurrencyApp)
            .post('/api/v1/customer/addresses')
            .set('Authorization', `Bearer ${tokenA}`)
            .send(buildValidPayload({ label: `Concurrent ${idx + 1}` })),
        ),
      );

      const createdCount = concurrentResponses.filter((r) => r.status === 201).length;
      const limitRejectedCount = concurrentResponses.filter(
        (r) => r.status === 400 && r.body.error.code === ADDRESS_ERROR_CODES.ADDRESS_LIMIT_EXCEEDED,
      ).length;

      expect(createdCount).toBe(2);
      expect(limitRejectedCount).toBe(4);

      const totalStored = await CustomerAddressModel.countDocuments({ userId: customerA._id });
      expect(totalStored).toBe(MAX_ADDRESSES_PER_CUSTOMER);
    });

    it('maintains exactly one default address under concurrent first-creates and concurrent set-default requests', async () => {
      if (!isDbConnected) return;

      // 4 concurrent creations from empty address book, all requesting isDefault: true
      const createResponses = await Promise.all(
        Array.from({ length: 4 }, (_, idx) =>
          request(concurrencyApp)
            .post('/api/v1/customer/addresses')
            .set('Authorization', `Bearer ${tokenA}`)
            .send(buildValidPayload({ label: `Burst ${idx + 1}`, isDefault: true })),
        ),
      );

      expect(createResponses.every((r) => r.status === 201)).toBe(true);
      const createdIds = createResponses.map((r) => r.body.data.id as string);

      const defaultsAfterCreate = await CustomerAddressModel.countDocuments({
        userId: customerA._id,
        isDefault: true,
      });
      expect(defaultsAfterCreate).toBe(1);

      // Concurrent PATCH /:addressId/default across distinct addresses
      const patchResponses = await Promise.all(
        createdIds.map((id) =>
          request(concurrencyApp)
            .patch(`/api/v1/customer/addresses/${id}/default`)
            .set('Authorization', `Bearer ${tokenA}`),
        ),
      );

      expect(patchResponses.every((r) => r.status === 200)).toBe(true);

      const defaultsAfterSwap = await CustomerAddressModel.countDocuments({
        userId: customerA._id,
        isDefault: true,
      });
      expect(defaultsAfterSwap).toBe(1);
    });
  });

  describe('6. Database Failure Handling & PII Log Safety', () => {
    it('handles database read failure gracefully with HTTP 500 without leaking raw DB errors', async () => {
      if (!isDbConnected) return;

      vi.spyOn(CustomerAddressModel, 'find').mockImplementationOnce(() => {
        throw new Error('MongoNetworkError: mongodb://admin:secret@10.0.0.5:27017/thehomez');
      });

      const res = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.message).not.toContain('mongodb://');
      expect(res.body.error.message).not.toContain('secret');
    });

    it('handles database write failure gracefully with HTTP 500 and string error code', async () => {
      if (!isDbConnected) return;

      vi.spyOn(mongoose, 'startSession').mockRejectedValueOnce(
        Object.assign(new Error('Simulated replica set failure'), { code: 112 }),
      );

      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(buildValidPayload());

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.message).not.toContain('replica set');
    });

    it('does not log personal address details during create, update, or delete operations', async () => {
      if (!isDbConnected) return;

      const infoSpy = vi.spyOn(logger, 'info');
      const sensitivePayload = buildValidPayload({
        label: 'Secret Construction Site',
        recipientName: 'Vikram Deshmukh',
        phone: '+919845012345',
        streetAddress: '99 Sensitive Street, Koramangala',
        landmark: 'Opposite Water Tank',
        siteContactPerson: {
          name: 'Arjun Nair',
          phone: '+919845099999',
        },
        heavyVehicleAccessInstructions: 'Gate code 4499 for tipper',
      });

      const created = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(sensitivePayload);
      expect(created.status).toBe(201);
      const id = created.body.data.id;

      await request(app)
        .put(`/api/v1/customer/addresses/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ recipientName: 'Updated Recipient Name' });

      await request(app)
        .delete(`/api/v1/customer/addresses/${id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      const serializedLogs = JSON.stringify(infoSpy.mock.calls);
      expect(serializedLogs).not.toContain('Vikram Deshmukh');
      expect(serializedLogs).not.toContain('Updated Recipient Name');
      expect(serializedLogs).not.toContain('+919845012345');
      expect(serializedLogs).not.toContain('99 Sensitive Street');
      expect(serializedLogs).not.toContain('Opposite Water Tank');
      expect(serializedLogs).not.toContain('Arjun Nair');
      expect(serializedLogs).not.toContain('+919845099999');
      expect(serializedLogs).not.toContain('Gate code 4499');
      expect(serializedLogs).not.toContain(activePincode);
    });
  });
});
