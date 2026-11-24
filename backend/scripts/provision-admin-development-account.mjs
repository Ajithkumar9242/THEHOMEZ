import { createInterface } from 'node:readline/promises';
import console from 'node:console';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  ADMIN_PROVISIONING_DATABASE,
  assertConnectedAdminDatabase,
  assertProvisioningTargetsAvailable,
  validateAdminProvisioningEnvironment,
} from './admin-provisioning-guards.mjs';

const expectedDatabase = ADMIN_PROVISIONING_DATABASE;
const roleCode = 'SUPER_ADMIN';
const environmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.admin');
const invocationNodeEnv = process.env.NODE_ENV;

function readHidden(label) {
  return new Promise((resolveInput, rejectInput) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      rejectInput(new Error('An interactive terminal is required.'));
      return;
    }

    let value = '';
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) rejectInput(error);
      else resolveInput(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Input cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && character <= '~') value += character;
      }
    };
    input.on('data', onData);
  });
}

if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--confirm') {
  console.error('Refusing provisioning: rerun with the explicit --confirm flag.');
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

  const [
    databaseModule,
    mongooseModule,
    userModule,
    roleModule,
    sharedTypes,
    passwordModule,
    loggerModule,
  ] = await Promise.all([
    import('../src/database/database.ts'),
    import('mongoose'),
    import('../src/models/user.model.ts'),
    import('../src/models/role.model.ts'),
    import('@thehomez/shared-types'),
    import('../src/services/auth/password.service.ts'),
    import('../src/logger/logger.ts'),
  ]);
  database = databaseModule;
  mongoose = mongooseModule.default;
  const { UserModel } = userModule;
  const { RoleModel } = roleModule;
  // These schemas explicitly enable autoIndex; disable it before connection so no
  // index writes can occur before the connected database name is verified.
  UserModel.schema.options.autoIndex = false;
  RoleModel.schema.options.autoIndex = false;
  const { UserStatus, UserType, PermissionCode, SYSTEM_ROLE_SEEDS } = sharedTypes;
  const { normalizePhoneNumber } = await import('../src/services/phone.utils.ts');
  const { hashPassword } = passwordModule;
  loggerModule.logger.level = 'silent';

  await database.connectDatabase(undefined, { autoIndex: false, autoCreate: false });
  const diagnostics = database.getDatabaseDiagnostics();
  assertConnectedAdminDatabase(diagnostics);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await prompt.question('Admin email: ')).trim().toLowerCase();
  const rawPhone = (await prompt.question('Admin phone (required by UserModel): ')).trim();
  prompt.close();
  let password = await readHidden('Admin password (hidden, 12-128 characters): ');

  const emailParts = email.split('@');
  const emailLocal = emailParts[0];
  const emailDomain = emailParts[1];
  const emailTld = emailDomain?.split('.').at(-1) || '';
  if (
    email.length > 254 ||
    emailParts.length !== 2 ||
    !emailLocal ||
    !emailDomain ||
    emailLocal.includes(' ') ||
    emailDomain.includes(' ') ||
    !emailDomain.includes('.') ||
    emailTld.length < 2
  ) {
    throw new Error('Email validation failed.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password validation failed.');
  }
  const phone = normalizePhoneNumber(rawPhone);
  const passwordHash = await hashPassword(password);
  password = '';

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await rl.question(
    `Provision active development Platform Owner STAFF identity with canonical SUPER_ADMIN role in ${expectedDatabase}? Type YES: `,
  );
  rl.close();
  if (confirmation !== 'YES')
    throw new Error('Interactive provisioning confirmation was not given.');

  session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const existingUser = await UserModel.findOne({
      $or: [{ email }, { phone, userType: UserType.STAFF }],
    })
      .select('_id')
      .session(session)
      .lean();
    if (existingUser) {
      throw new Error(
        'An account with this email or phone already exists; existing accounts cannot be recreated or reset.',
      );
    }

    const superAdminSeed = SYSTEM_ROLE_SEEDS.SUPER_ADMIN;
    if (!superAdminSeed || !Array.isArray(superAdminSeed.permissions)) {
      throw new Error('Canonical SUPER_ADMIN seed definition is invalid or missing.');
    }

    let role = await RoleModel.findOne({ code: superAdminSeed.code }).session(session);
    if (!role) {
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
    }

    const [user] = await UserModel.create(
      [
        {
          phone,
          email,
          passwordHash,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: [superAdminSeed.code],
        },
      ],
      { session },
    );

    if (
      !role ||
      role.userType !== UserType.STAFF ||
      role.permissions.length !== superAdminSeed.permissions.length ||
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.userType !== UserType.STAFF ||
      !Array.isArray(user.roles) ||
      !user.roles.includes(superAdminSeed.code)
    ) {
      throw new Error('Provisioned account or role validation failed.');
    }
  });

  console.log(
    'Provisioning completed: active development Platform Owner STAFF identity provisioned with canonical SUPER_ADMIN role.',
  );
} catch {
  exitCode = 1;
  console.error('Provisioning failed or was refused; credentials were not printed.');
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
