import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const expectedDatabase = 'thehomez_admin_verify';
const environmentPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.admin');

let configurationValid = false;
let connectionEstablished = false;
let databaseMatched = false;
let failed = false;
let database;

try {
  const loadedEnvironment = dotenv.config({ path: environmentPath, override: true, quiet: true });
  const mongoUri = process.env.MONGODB_URI;
  const portValid = process.env.PORT === '5001';
  const environmentValid = process.env.NODE_ENV === 'development';

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

  configurationValid =
    !loadedEnvironment.error &&
    Boolean(loadedEnvironment.parsed) &&
    Object.hasOwn(loadedEnvironment.parsed ?? {}, 'MONGODB_URI') &&
    Boolean(mongoUri?.trim()) &&
    portValid &&
    environmentValid &&
    uriValid;

  if (!configurationValid) {
    failed = true;
  } else {
    database = await import('../src/database/database.ts');
    await database.connectDatabase();
    connectionEstablished = true;

    const diagnostics = database.getDatabaseDiagnostics();
    databaseMatched =
      diagnostics?.status === 'connected' && diagnostics?.name === expectedDatabase;
    if (!databaseMatched) failed = true;
  }
} catch {
  failed = true;
} finally {
  if (database) {
    try {
      await database.disconnectDatabase();
    } catch {
      failed = true;
    }
  }

  console.log(`Configuration validation ${configurationValid ? 'passed' : 'failed'}.`);
  console.log(`Connection ${connectionEstablished ? 'established' : 'failed'}.`);
  console.log(`Expected database name ${databaseMatched ? 'matched' : 'not matched'}.`);
}

if (failed) process.exitCode = 1;
