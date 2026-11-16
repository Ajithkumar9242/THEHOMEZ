import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const expectedDatabase = 'thehomez_admin_verify';
const environmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.admin');

function readHiddenPhone() {
  return new Promise((resolveInput, rejectInput) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      rejectInput(new Error('A local interactive terminal is required.'));
      return;
    }

    let value = '';
    process.stdout.write('Enter the STAFF phone number (input hidden): ');
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
        if (character === '\u0003') {
          finish(new Error('Input cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ' && character <= '~') {
          value += character;
        }
      }
    };

    input.on('data', onData);
  });
}

let database;
let exitCode = 0;
let result = {
  userRecordFound: false,
  userTypeStaff: false,
  accountActive: false,
  otpEligible: false,
};

try {
  const loadedEnvironment = dotenv.config({ path: environmentPath, override: true, quiet: true });
  const mongoUri = process.env.MONGODB_URI;
  let uriValid = false;

  if (typeof mongoUri === 'string' && mongoUri.trim()) {
    try {
      const parsedUri = new URL(mongoUri);
      uriValid =
        ['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol) &&
        parsedUri.pathname === `/${expectedDatabase}` &&
        [...parsedUri.searchParams].every(
          ([key, value]) => key.toLowerCase() !== 'dbname' || value === expectedDatabase,
        );
    } catch {
      uriValid = false;
    }
  }

  const environmentValid =
    !loadedEnvironment.error &&
    Boolean(loadedEnvironment.parsed) &&
    Object.hasOwn(loadedEnvironment.parsed ?? {}, 'MONGODB_URI') &&
    Boolean(mongoUri?.trim()) &&
    process.env.PORT === '5001' &&
    process.env.NODE_ENV === 'development' &&
    uriValid;

  if (!environmentValid) throw new Error('Isolated environment validation failed.');

  const rawPhone = await readHiddenPhone();
  const [
    { normalizePhoneNumber },
    { UserModel },
    { UserType, UserStatus },
    databaseModule,
    { logger },
  ] = await Promise.all([
    import('../src/services/phone.utils.ts'),
    import('../src/models/user.model.ts'),
    import('@thehomez/shared-types'),
    import('../src/database/database.ts'),
    import('../src/logger/logger.ts'),
  ]);
  database = databaseModule;
  logger.level = 'silent';

  const phone = normalizePhoneNumber(rawPhone);
  await database.connectDatabase();

  const diagnostics = database.getDatabaseDiagnostics();
  if (diagnostics.status !== 'connected' || diagnostics.name !== expectedDatabase) {
    throw new Error('Isolated database diagnostic check failed.');
  }

  const user = await UserModel.findOne({ phone, userType: UserType.STAFF })
    .select({ userType: 1, status: 1 })
    .lean()
    .exec();

  result.userRecordFound = Boolean(user);
  result.userTypeStaff = user?.userType === UserType.STAFF;
  result.accountActive = user?.status === UserStatus.ACTIVE;
  result.otpEligible = result.userTypeStaff && result.accountActive;
} catch {
  exitCode = 1;
} finally {
  if (database) {
    try {
      await database.disconnectDatabase();
    } catch {
      exitCode = 1;
    }
  }

  if (exitCode === 0) {
    console.log(`User record found: ${result.userRecordFound ? 'yes' : 'no'}`);
    console.log(`User type is STAFF: ${result.userTypeStaff ? 'yes' : 'no'}`);
    console.log(`Account active: ${result.accountActive ? 'yes' : 'no'}`);
    console.log(`OTP eligibility satisfied: ${result.otpEligible ? 'yes' : 'no'}`);
  } else {
    console.log('Diagnostic failed; no identity results produced.');
  }
}

if (exitCode !== 0) process.exitCode = exitCode;
