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
} catch {
  fail('Verification configuration could not be validated; no connection was attempted.');
}

try {
  const { startAdminVerificationServer } = await import('../src/server.ts');
  console.info('[admin-verification] Starting guarded Admin verification backend (no-seed, no-autoindex)...');
  await startAdminVerificationServer({ mode: 'admin-verification' });
} catch (error) {
  fail(`Guarded backend startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
}
