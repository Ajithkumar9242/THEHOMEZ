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

if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--confirm') {
  console.error('Refusing assignment: rerun with the explicit --confirm flag.');
  process.exit(1);
}

let database;
let mongoose;
let session;
let exitCode = 0;

try {
  const loadedEnvironment = dotenv.config({ path: environmentPath, override: true, quiet: true });
  if (!validateAdminProvisioningEnvironment(loadedEnvironment, process.env, invocationNodeEnv)) {
    throw new Error('Dedicated development environment validation failed.');
  }

  const [databaseModule, mongooseModule, userModule, roleModule, sharedTypes, rbacModule] =
    await Promise.all([
      import('../src/database/database.ts'),
      import('mongoose'),
      import('../src/models/user.model.ts'),
      import('../src/models/role.model.ts'),
      import('@thehomez/shared-types'),
      import('../src/services/rbac/rbac.service.ts'),
    ]);

  database = databaseModule;
  mongoose = mongooseModule.default;
  const { UserModel } = userModule;
  const { RoleModel } = roleModule;
  const { UserStatus, UserType, PermissionCode, SYSTEM_ROLE_SEEDS } = sharedTypes;
  const { RbacService } = rbacModule;

  // Suppress automatic schema indexing
  UserModel.schema.options.autoIndex = false;
  RoleModel.schema.options.autoIndex = false;

  await database.connectDatabase(undefined, { autoIndex: false, autoCreate: false });
  const diagnostics = database.getDatabaseDiagnostics();
  assertConnectedAdminDatabase(diagnostics);

  console.log(`[assign-super-admin] Confirmed connected database: ${diagnostics.name}`);

  const superAdminSeed = SYSTEM_ROLE_SEEDS.SUPER_ADMIN;
  if (!superAdminSeed || !Array.isArray(superAdminSeed.permissions)) {
    throw new Error('Canonical SUPER_ADMIN seed definition is invalid or missing.');
  }

  session = await mongoose.startSession();
  await session.withTransaction(async () => {
    // 1. Ensure canonical SUPER_ADMIN role exists in thehomez_admin_verify
    let role = await RoleModel.findOne({ code: superAdminSeed.code }).session(session);
    if (!role) {
      console.log(
        `[assign-super-admin] Seeding canonical ${superAdminSeed.code} role into ${expectedDatabase}...`,
      );
      const [createdRole] = await RoleModel.create(
        [
          {
            code: superAdminSeed.code,
            name: superAdminSeed.name,
            description: superAdminSeed.description,
            userType: superAdminSeed.userType,
            isSystemManaged: superAdminSeed.isSystemManaged,
            permissions: [...superAdminSeed.permissions],
          },
        ],
        { session },
      );
      role = createdRole;
    } else {
      console.log(`[assign-super-admin] Canonical ${superAdminSeed.code} role already exists.`);
    }

    if (!role || role.permissions.length !== superAdminSeed.permissions.length) {
      throw new Error('SUPER_ADMIN role verification failed: unexpected permission count.');
    }

    // 2. Query target user account with strict fail-closed constraints
    const users = await UserModel.find({ email: targetEmail }).session(session);
    if (users.length === 0) {
      throw new Error(`Target account '${targetEmail}' was not found in ${expectedDatabase}.`);
    }
    if (users.length > 1) {
      throw new Error(`Duplicate accounts found for '${targetEmail}' in ${expectedDatabase}.`);
    }

    const user = users[0];
    if (user.userType !== UserType.STAFF) {
      throw new Error(
        `Target account has unexpected identity type '${user.userType}'; must be STAFF.`,
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new Error(
        `Target account status is '${user.status}'; must be ACTIVE to assign SUPER_ADMIN.`,
      );
    }

    console.log(
      `[assign-super-admin] Found target account '${targetEmail}' (status: ${user.status}, current roles: [${user.roles.join(', ')}]).`,
    );

    // 3. Update roles to SUPER_ADMIN while preserving all sensitive credentials, MFA, phone, and metadata
    user.roles = [superAdminSeed.code];
    await user.save({ session });

    // 4. Verify that ADMIN_CATEGORY_READONLY role was not altered
    const readOnlyRole = await RoleModel.findOne({ code: 'ADMIN_CATEGORY_READONLY' })
      .session(session)
      .lean();
    if (
      readOnlyRole &&
      (readOnlyRole.permissions.length !== 1 ||
        readOnlyRole.permissions[0] !== PermissionCode.CATALOG_READ)
    ) {
      throw new Error('ADMIN_CATEGORY_READONLY role definition was unexpectedly modified.');
    }
  });

  // 5. Post-transaction verification: read back updated user and resolve effective permissions via RbacService
  const updatedUser = await UserModel.findOne({ email: targetEmail }).lean();
  if (!updatedUser) {
    throw new Error('Verification failed: updated user could not be re-queried.');
  }

  if (
    !Array.isArray(updatedUser.roles) ||
    !updatedUser.roles.includes('SUPER_ADMIN') ||
    updatedUser.userType !== UserType.STAFF ||
    updatedUser.status !== UserStatus.ACTIVE
  ) {
    throw new Error('Verification failed: account role or identity attributes mismatch.');
  }

  const rbacService = new RbacService();
  const effectivePermissions = await rbacService.getEffectivePermissions(updatedUser.roles);

  const expectedPermCount = superAdminSeed.permissions.length;
  if (effectivePermissions.length !== expectedPermCount) {
    throw new Error(
      `Permission verification mismatch: expected ${expectedPermCount} permissions, resolved ${effectivePermissions.length}.`,
    );
  }

  const hasCatalogRead = effectivePermissions.includes(PermissionCode.CATALOG_READ);
  const hasCatalogWrite = effectivePermissions.includes(PermissionCode.CATALOG_WRITE);
  const hasRbacManage = effectivePermissions.includes(PermissionCode.RBAC_MANAGE);

  if (!hasCatalogRead || !hasCatalogWrite || !hasRbacManage) {
    throw new Error(
      'Critical permissions missing from resolved SUPER_ADMIN effective permissions.',
    );
  }

  console.log('[assign-super-admin] SUCCESS: Platform Owner role assignment verified.');
  console.log(`[assign-super-admin] Account: ${targetEmail}`);
  console.log(`[assign-super-admin] User Type: ${updatedUser.userType}`);
  console.log(`[assign-super-admin] Status: ${updatedUser.status}`);
  console.log(`[assign-super-admin] Assigned Roles: [${updatedUser.roles.join(', ')}]`);
  console.log(
    `[assign-super-admin] Resolved Effective Permissions: ${effectivePermissions.length} / ${expectedPermCount} canonical permissions verified.`,
  );
  console.log(`[assign-super-admin] CATALOG_READ verified: ${hasCatalogRead}`);
  console.log(`[assign-super-admin] CATALOG_WRITE verified: ${hasCatalogWrite}`);
  console.log(`[assign-super-admin] RBAC_MANAGE verified: ${hasRbacManage}`);
} catch (error) {
  exitCode = 1;
  console.error('[assign-super-admin] FAILED:', error instanceof Error ? error.message : error);
} finally {
  if (session) {
    try {
      await session.endSession();
    } catch {
      exitCode = 1;
    }
  }
  if (database) {
    try {
      await database.disconnectDatabase();
    } catch {
      exitCode = 1;
    }
  }
}

if (exitCode !== 0) process.exitCode = exitCode;
