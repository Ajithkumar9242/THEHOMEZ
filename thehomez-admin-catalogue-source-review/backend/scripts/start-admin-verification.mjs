import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verificationEnvPath = resolve(backendDirectory, '.env.admin');
const targetDatabase = 'thehomez_admin_verify';
const targetPort = 5001;
const adminOrigin = 'http://localhost:3001';

function fail(message) {
  console.error(`[admin-verification] ${message}`);
  process.exit(1);
}

if (!existsSync(verificationEnvPath)) {
  fail('Required verification environment file is missing; no connection was attempted.');
}

const loadedEnv = dotenv.config({ path: verificationEnvPath, override: true, quiet: true });
if (loadedEnv.error || !loadedEnv.parsed) {
  fail('Could not load the verification environment file; no connection was attempted.');
}

const requiredValues = [
  'MONGODB_URI',
  'PORT',
  'NODE_ENV',
  'JWT_ACCESS_SECRET',
  'OTP_PEPPER_SECRET',
];
for (const key of requiredValues) {
  if (!Object.hasOwn(loadedEnv.parsed, key) || !process.env[key]?.trim()) {
    fail('Required verification configuration is missing; no connection was attempted.');
  }
}

if (process.env.PORT !== String(targetPort) || process.env.NODE_ENV !== 'development') {
  fail('Verification port or environment did not match the required values; no connection was attempted.');
}

let parsedMongoUri;
try {
  parsedMongoUri = new URL(process.env.MONGODB_URI);
} catch {
  fail('MongoDB URI is invalid; no connection was attempted.');
}

if (!['mongodb:', 'mongodb+srv:'].includes(parsedMongoUri.protocol)) {
  fail('MongoDB URI scheme is not supported; no connection was attempted.');
}

if (parsedMongoUri.pathname !== `/${targetDatabase}`) {
  fail('MongoDB URI database path did not match the isolated database; no connection was attempted.');
}

for (const [name, value] of parsedMongoUri.searchParams) {
  if (name.toLowerCase() === 'dbname' && value !== targetDatabase) {
    fail('MongoDB URI database override conflicts with the isolated database; no connection was attempted.');
  }
}

let config;
let database;
let logger;
let getConfigFromEnvironment;
try {
  ({ getConfig: getConfigFromEnvironment } = await import('../src/config/env.ts'));
  config = getConfigFromEnvironment();
  if (
    config.port !== targetPort ||
    !config.isDevelopment ||
    !config.corsOrigins.includes(adminOrigin)
  ) {
    fail('Validated backend settings did not preserve the required port, development mode, or Admin origin.');
  }

  database = await import('../src/database/database.ts');
  ({ logger } = await import('../src/logger/logger.ts'));
} catch {
  fail('Verification configuration could not be validated; no connection was attempted.');
}

// Suppress connection diagnostics while credentials are in use. Restore the configured
// application log level only after the connected database name has passed the guard.
const configuredLogLevel = config.logging.level;
logger.level = 'silent';

try {
  await database.connectDatabase();
} catch {
  try {
    await database.disconnectDatabase();
  } catch {
    // Keep failure output static and credential-free.
  }
  fail('MongoDB connection failed; backend startup and role seeding were not run.');
}

let diagnostics;
try {
  diagnostics = database.getDatabaseDiagnostics();
} catch {
  try {
    await database.disconnectDatabase();
  } catch {
    // Keep failure output static and credential-free.
  }
  fail('Database diagnostics failed; backend startup and role seeding were not run.');
}

if (diagnostics?.status !== 'connected' || diagnostics?.name !== targetDatabase) {
  try {
    await database.disconnectDatabase();
  } catch {
    // Keep failure output static and credential-free.
  }
  fail('Connected database verification failed; backend startup and role seeding were not run.');
}

logger.level = configuredLogLevel;
console.info('[admin-verification] Isolated database verified; continuing with normal backend startup.');

try {
  const { startServer } = await import('../src/server.ts');
  await startServer();
} catch {
  try {
    await database.disconnectDatabase();
  } catch {
    // Keep failure output static and credential-free.
  }
  fail('Backend startup failed after database verification.');
}
