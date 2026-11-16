import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  UserType,
  PermissionCode,
  SYSTEM_ROLE_SEEDS,
  STANDARD_PARTNER_ROLE_PERMISSIONS,
} from '@thehomez/shared-types';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { RoleModel } from '../src/models/role.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';

describe('RbacService — Database-Backed RBAC & Idempotent Role Seeding', () => {
  let isDbConnected = false;
  let rbacService: RbacService;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }
    rbacService = new RbacService();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await RoleModel.deleteMany({
        code: {
          $regex:
            /^(SUPER_ADMIN|OPS_MANAGER|CATALOG_MANAGER|PARTNER_MANAGER|PARTNER_OPERATOR|FINANCE_OFFICER|SUPPORT|TEST_)/,
        },
      });
      await UserModel.deleteMany({ phone: { $in: ['+919777766666', '+919888877777'] } });
      await disconnectDatabase();
    }
  });

  describe('Idempotent System Role Seeding', () => {
    it('seeds all SYSTEM_ROLE_SEEDS into the database on first run', async () => {
      if (!isDbConnected) return;

      // Clean existing system roles
      await RoleModel.deleteMany({
        code: { $in: Object.values(SYSTEM_ROLE_SEEDS).map((s) => s.code) },
      });

      const { insertedCount, existingCount } = await rbacService.seedDefaultRoles();
      const expectedTotal = Object.keys(SYSTEM_ROLE_SEEDS).length;

      expect(insertedCount).toBe(expectedTotal);
      expect(existingCount).toBe(0);

      // Verify SUPER_ADMIN role exists with all permissions
      const superAdmin = await rbacService.getRoleByCode('SUPER_ADMIN');
      expect(superAdmin).toBeDefined();
      expect(superAdmin?.name).toBe('Super Administrator');
      expect(superAdmin?.isSystemManaged).toBe(true);
      expect(superAdmin?.permissions).toContain(PermissionCode.RBAC_MANAGE);

      // Verify PARTNER_OPERATOR role exists with UserType.PARTNER and availability permissions
      const partnerOperator = await rbacService.getRoleByCode('PARTNER_OPERATOR');
      expect(partnerOperator).toBeDefined();
      expect(partnerOperator?.name).toBe('Partner Operator');
      expect(partnerOperator?.userType).toBe(UserType.PARTNER);
      expect(partnerOperator?.isSystemManaged).toBe(true);
      expect(partnerOperator?.permissions).toEqual(
        expect.arrayContaining([...STANDARD_PARTNER_ROLE_PERMISSIONS]),
      );
      expect(partnerOperator?.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(partnerOperator?.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      expect(partnerOperator?.permissions).not.toContain(PermissionCode.CATALOG_WRITE);
      expect(partnerOperator?.permissions).not.toContain(PermissionCode.CATALOG_PUBLISH);
    });

    it('is strictly idempotent and does NOT overwrite administrator customizations', async () => {
      if (!isDbConnected) return;

      // Simulate Administrator Customization:
      // Admin customizes OPS_MANAGER by adding a custom permission and changing the description
      const customDescription = 'Customized by platform administrator';
      await RoleModel.updateOne(
        { code: 'OPS_MANAGER' },
        {
          $set: {
            description: customDescription,
            permissions: [PermissionCode.ORDER_READ, PermissionCode.SETTINGS_WRITE],
          },
        },
      );

      // Re-run role seeding (e.g. simulated server restart or deploy)
      const { insertedCount, existingCount } = await rbacService.seedDefaultRoles();
      const expectedTotal = Object.keys(SYSTEM_ROLE_SEEDS).length;

      expect(insertedCount).toBe(0);
      expect(existingCount).toBe(expectedTotal);

      // Verify that the administrator's customizations were PRESERVED and not overwritten!
      const opsManager = await rbacService.getRoleByCode('OPS_MANAGER');
      expect(opsManager?.description).toBe(customDescription);
      expect(opsManager?.permissions).toContain(PermissionCode.SETTINGS_WRITE);
    });
  });

  describe('Effective Permission Aggregation & Identity Verification', () => {
    it('aggregates permissions from multiple roles without duplicates', async () => {
      if (!isDbConnected) return;

      const perms = await rbacService.getEffectivePermissions(['SUPPORT', 'OPS_MANAGER']);

      expect(Array.isArray(perms)).toBe(true);
      expect(perms).toContain(PermissionCode.CUSTOMER_READ);
      expect(perms).toContain(PermissionCode.ORDER_READ);

      // Set deduplication check
      const uniquePerms = Array.from(new Set(perms));
      expect(perms.length).toBe(uniquePerms.length);
    });

    it('returns empty array when no roles are assigned', async () => {
      const perms = await rbacService.getEffectivePermissions([]);
      expect(perms).toEqual([]);
    });

    it('validates role compatibility against target UserType', async () => {
      if (!isDbConnected) return;

      // Create a PARTNER-scoped role
      await RoleModel.create({
        code: 'TEST_PARTNER_OPERATOR',
        name: 'Partner Operator',
        userType: UserType.PARTNER,
        permissions: [PermissionCode.FULFILMENT_UPDATE],
      });

      // Valid: STAFF user with STAFF role
      const staffCheck = await rbacService.validateRolesForUserType(
        ['SUPER_ADMIN'],
        UserType.STAFF,
      );
      expect(staffCheck.valid).toBe(true);

      // Incompatible: CUSTOMER user assigned STAFF role
      const customerCheck = await rbacService.validateRolesForUserType(
        ['SUPER_ADMIN'],
        UserType.CUSTOMER,
      );
      expect(customerCheck.valid).toBe(false);
      expect(customerCheck.incompatibleRoles).toContain('SUPER_ADMIN');

      // Incompatible: PARTNER user assigned STAFF role
      const partnerCheck = await rbacService.validateRolesForUserType(
        ['SUPER_ADMIN', 'TEST_PARTNER_OPERATOR'],
        UserType.PARTNER,
      );
      expect(partnerCheck.valid).toBe(false);
      expect(partnerCheck.incompatibleRoles).toContain('SUPER_ADMIN');
    });

    it('resolves full IUserPrincipal with dynamic database permissions', async () => {
      if (!isDbConnected) return;

      const user = await UserModel.create({
        phone: '+919777766666',
        userType: UserType.STAFF,
        roles: ['SUPPORT'],
      });

      const principal = await rbacService.resolveUserPrincipal(user);

      expect(principal.id).toBe(user._id.toString());
      expect(principal.userType).toBe(UserType.STAFF);
      expect(principal.roles).toEqual(['SUPPORT']);
      expect(principal.permissions).toContain(PermissionCode.CUSTOMER_READ);
      expect(principal.permissions).toContain(PermissionCode.ORDER_READ);
    });
  });

  describe('Standard Partner Role Provisioning & Scoping (Decision #46)', () => {
    it('idempotently provisions PARTNER_OPERATOR role with STANDARD_PARTNER_ROLE_PERMISSIONS', async () => {
      if (!isDbConnected) return;

      // Clean PARTNER_OPERATOR if present
      await RoleModel.deleteOne({ code: 'PARTNER_OPERATOR' });

      // First run: inserts PARTNER_OPERATOR
      const role1 = await rbacService.provisionStandardPartnerRole();
      expect(role1.code).toBe('PARTNER_OPERATOR');
      expect(role1.name).toBe('Partner Operator');
      expect(role1.userType).toBe(UserType.PARTNER);
      expect(role1.isSystemManaged).toBe(true);
      expect(role1.permissions).toEqual(
        expect.arrayContaining([...STANDARD_PARTNER_ROLE_PERMISSIONS]),
      );
      expect(role1.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(role1.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      expect(role1.permissions).not.toContain(PermissionCode.CATALOG_WRITE);
      expect(role1.permissions).not.toContain(PermissionCode.CATALOG_PUBLISH);

      // Re-provisioning: strictly idempotent and preserves role
      const role2 = await rbacService.provisionStandardPartnerRole();
      expect(role2.code).toBe('PARTNER_OPERATOR');
      expect(role2._id.toString()).toBe(role1._id.toString());
    });

    it('preserves administrator customizations on PARTNER_OPERATOR during re-provisioning', async () => {
      if (!isDbConnected) return;

      // Simulate admin customization (e.g. adding a custom permitted capability)
      const customDesc = 'Customized partner role for specialized yard managers';
      await RoleModel.updateOne(
        { code: 'PARTNER_OPERATOR' },
        {
          $set: {
            description: customDesc,
            permissions: [
              ...STANDARD_PARTNER_ROLE_PERMISSIONS,
              PermissionCode.ORDER_READ, // custom granted read capability
            ],
          },
        },
      );

      // Re-run provision helper
      await rbacService.provisionStandardPartnerRole();

      const customizedRole = await rbacService.getRoleByCode('PARTNER_OPERATOR');
      expect(customizedRole?.description).toBe(customDesc);
      expect(customizedRole?.permissions).toContain(PermissionCode.ORDER_READ);
      expect(customizedRole?.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(customizedRole?.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
    });

    it('strictly enforces UserType scoping for PARTNER_OPERATOR', async () => {
      if (!isDbConnected) return;

      // Ensure standard partner role is seeded
      await rbacService.provisionStandardPartnerRole();

      // Valid: PARTNER user with PARTNER_OPERATOR role
      const validPartner = await rbacService.validateRolesForUserType(
        ['PARTNER_OPERATOR'],
        UserType.PARTNER,
      );
      expect(validPartner.valid).toBe(true);
      expect(validPartner.incompatibleRoles).toEqual([]);

      // Incompatible: STAFF user assigned PARTNER_OPERATOR
      const invalidStaff = await rbacService.validateRolesForUserType(
        ['PARTNER_OPERATOR'],
        UserType.STAFF,
      );
      expect(invalidStaff.valid).toBe(false);
      expect(invalidStaff.incompatibleRoles).toContain('PARTNER_OPERATOR');

      // Incompatible: CUSTOMER user assigned PARTNER_OPERATOR
      const invalidCustomer = await rbacService.validateRolesForUserType(
        ['PARTNER_OPERATOR'],
        UserType.CUSTOMER,
      );
      expect(invalidCustomer.valid).toBe(false);
      expect(invalidCustomer.incompatibleRoles).toContain('PARTNER_OPERATOR');

      // Incompatible: PARTNER user assigned STAFF role (CATALOG_MANAGER)
      const invalidPartnerStaff = await rbacService.validateRolesForUserType(
        ['CATALOG_MANAGER'],
        UserType.PARTNER,
      );
      expect(invalidPartnerStaff.valid).toBe(false);
      expect(invalidPartnerStaff.incompatibleRoles).toContain('CATALOG_MANAGER');
    });

    it('resolves partner IUserPrincipal with PARTNER_AVAILABILITY permissions and tenantId', async () => {
      if (!isDbConnected) return;

      const dummyPartnerId = new mongoose.Types.ObjectId();
      const partnerUser = await UserModel.create({
        phone: '+919888877777',
        userType: UserType.PARTNER,
        roles: ['PARTNER_OPERATOR'],
        partnerId: dummyPartnerId,
      });

      const principal = await rbacService.resolveUserPrincipal(partnerUser);

      expect(principal.id).toBe(partnerUser._id.toString());
      expect(principal.userType).toBe(UserType.PARTNER);
      expect(principal.partnerId).toBe(dummyPartnerId.toString());
      expect(principal.roles).toEqual(['PARTNER_OPERATOR']);
      expect(principal.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(principal.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      expect(principal.permissions).not.toContain(PermissionCode.CATALOG_WRITE);
      expect(principal.permissions).not.toContain(PermissionCode.CATALOG_PUBLISH);
    });
  });
});
