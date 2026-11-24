import console from 'node:console';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  ADMIN_PROVISIONING_DATABASE,
  assertConnectedAdminDatabase,
  validateAdminProvisioningEnvironment,
} from './admin-provisioning-guards.mjs';

const expectedDatabase = ADMIN_PROVISIONING_DATABASE;
const targetEmail = 'admin@gmail.com';
const environmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.admin');
const invocationNodeEnv = process.env.NODE_ENV;

let database;
let exitCode = 0;

try {
  const loadedEnvironment = dotenv.config({ path: environmentPath, override: true, quiet: true });
  if (!validateAdminProvisioningEnvironment(loadedEnvironment, process.env, invocationNodeEnv)) {
    throw new Error('Dedicated development environment validation failed.');
  }

  const [databaseModule, userModule, roleModule, sharedTypes, rbacModule] = await Promise.all([
    import('../src/database/database.ts'),
    import('../src/models/user.model.ts'),
    import('../src/models/role.model.ts'),
    import('@thehomez/shared-types'),
    import('../src/services/rbac/rbac.service.ts'),
  ]);

  database = databaseModule;
  const { UserModel } = userModule;
  const { RoleModel } = roleModule;
  const { UserStatus, UserType, PermissionCode, SYSTEM_ROLE_SEEDS } = sharedTypes;
  const { RbacService } = rbacModule;

  UserModel.schema.options.autoIndex = false;
  RoleModel.schema.options.autoIndex = false;

  await database.connectDatabase(undefined, { autoIndex: false, autoCreate: false });
  const diagnostics = database.getDatabaseDiagnostics();
  assertConnectedAdminDatabase(diagnostics);

  console.log(`[audit-verify] Database confirmed: ${diagnostics.name}`);

  // 1. Query user document
  const user = await UserModel.findOne({ email: targetEmail })
    .select('+passwordHash +mfaEnabled +mfaSecret +mfaBackupCodes')
    .lean();
  if (!user) throw new Error(`User '${targetEmail}' not found.`);

  console.log(`[audit-verify] Email: ${user.email}`);
  console.log(`[audit-verify] UserType: ${user.userType} (Expected: ${UserType.STAFF})`);
  console.log(`[audit-verify] Status: ${user.status} (Expected: ${UserStatus.ACTIVE})`);
  console.log(`[audit-verify] Roles: [${user.roles.join(', ')}] (Expected: [SUPER_ADMIN])`);
  console.log(`[audit-verify] PasswordHash exists: ${Boolean(user.passwordHash)}`);
  console.log(`[audit-verify] Phone normalized exists: ${Boolean(user.phone)}`);
  console.log(`[audit-verify] MFA Enabled field present: ${user.mfaEnabled !== undefined}`);

  if (user.userType !== UserType.STAFF) throw new Error('userType mismatch!');
  if (user.status !== UserStatus.ACTIVE) throw new Error('status mismatch!');
  if (!user.roles.includes('SUPER_ADMIN')) throw new Error('SUPER_ADMIN missing from user.roles!');

  // 2. Query SUPER_ADMIN role
  const superAdminRole = await RoleModel.findOne({ code: 'SUPER_ADMIN' }).lean();
  if (!superAdminRole) throw new Error('SUPER_ADMIN role document not found!');
  console.log(`[audit-verify] SUPER_ADMIN role userType: ${superAdminRole.userType}`);
  console.log(`[audit-verify] SUPER_ADMIN role isSystemManaged: ${superAdminRole.isSystemManaged}`);
  console.log(
    `[audit-verify] SUPER_ADMIN role permission count: ${superAdminRole.permissions.length}`,
  );

  // 3. Query ADMIN_CATEGORY_READONLY role to ensure it was NOT altered
  const readOnlyRole = await RoleModel.findOne({ code: 'ADMIN_CATEGORY_READONLY' }).lean();
  if (!readOnlyRole) throw new Error('ADMIN_CATEGORY_READONLY role document missing!');
  console.log(
    `[audit-verify] ADMIN_CATEGORY_READONLY role permission count: ${readOnlyRole.permissions.length}`,
  );
  console.log(
    `[audit-verify] ADMIN_CATEGORY_READONLY permission: ${readOnlyRole.permissions[0]} (Expected: ${PermissionCode.CATALOG_READ})`,
  );

  if (
    readOnlyRole.permissions.length !== 1 ||
    readOnlyRole.permissions[0] !== PermissionCode.CATALOG_READ
  ) {
    throw new Error('ADMIN_CATEGORY_READONLY role was unexpectedly modified!');
  }

  // 4. Resolve effective permissions through RbacService
  const rbacService = new RbacService();
  const effectivePermissions = await rbacService.getEffectivePermissions(user.roles);

  const canonicalPerms = SYSTEM_ROLE_SEEDS.SUPER_ADMIN.permissions;
  console.log(
    `[audit-verify] Resolved effective permissions: ${effectivePermissions.length} / ${canonicalPerms.length}`,
  );

  const hasCatalogRead = effectivePermissions.includes(PermissionCode.CATALOG_READ);
  const hasCatalogWrite = effectivePermissions.includes(PermissionCode.CATALOG_WRITE);
  const hasCatalogPublish = effectivePermissions.includes(PermissionCode.CATALOG_PUBLISH);
  const hasPricingRead = effectivePermissions.includes(PermissionCode.PRICING_READ);
  const hasPricingWrite = effectivePermissions.includes(PermissionCode.PRICING_WRITE);
  const hasRbacManage = effectivePermissions.includes(PermissionCode.RBAC_MANAGE);

  console.log(`[audit-verify] CATALOG_READ: ${hasCatalogRead}`);
  console.log(`[audit-verify] CATALOG_WRITE: ${hasCatalogWrite}`);
  console.log(`[audit-verify] CATALOG_PUBLISH: ${hasCatalogPublish}`);
  console.log(`[audit-verify] PRICING_READ: ${hasPricingRead}`);
  console.log(`[audit-verify] PRICING_WRITE: ${hasPricingWrite}`);
  console.log(`[audit-verify] RBAC_MANAGE: ${hasRbacManage}`);

  if (
    effectivePermissions.length !== canonicalPerms.length ||
    !hasCatalogRead ||
    !hasCatalogWrite ||
    !hasRbacManage
  ) {
    throw new Error('Effective permissions verification failed!');
  }

  console.log('[audit-verify] ALL CHECKS PASSED: SUPER_ADMIN verified in thehomez_admin_verify.');
} catch (error) {
  exitCode = 1;
  console.error('[audit-verify] FAILED:', error instanceof Error ? error.message : error);
} finally {
  if (database) {
    try {
      await database.disconnectDatabase();
    } catch {
      exitCode = 1;
    }
  }
}

if (exitCode !== 0) process.exitCode = exitCode;
