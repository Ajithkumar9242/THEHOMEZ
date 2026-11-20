import mongoose, { type ConnectOptions, type Model, type Schema } from 'mongoose';

/**
 * Test Database Isolation Guard
 *
 * Enforces strict safety rules during automated test runs:
 * 1. Ordinary unit tests must not connect to MongoDB.
 * 2. Remote Atlas / cloud MongoDB connections are rejected by default.
 * 3. Prohibits connecting to unverified database targets (empty path defaulting to 'test').
 * 4. Prohibits connecting to 'thehomez_admin_verify' (isolated Admin verification DB).
 * 5. Prohibits connecting to 'thehomez' (shared development DB).
 * 6. Prohibits connecting to 'test' (shared default DB on Atlas/local).
 * 7. Prohibits connecting to any production database.
 * 8. Requires explicit test database name conforming to approved pattern (equals 'thehomez_test' or ends with '_test').
 * 9. Reports connected database name safely without disclosing URI or credentials.
 * 10. Requires explicit, documented opt-in (ALLOW_REMOTE_TEST_DATABASE=true) for any remote test DB, retaining all name guards.
 * 11. Prohibits bare deleteMany({}) and un-scoped destructive wipes in test mode.
 * 12. Protects pre-compiled models, future models, bulkWrite, and native driver collection operations.
 */

export class TestDatabaseIsolationError extends Error {
  public readonly code = 'TEST_DATABASE_ISOLATION_VIOLATION';
  constructor(message: string) {
    super(`[TestDatabaseIsolationError] ${message}`);
    this.name = 'TestDatabaseIsolationError';
  }
}

export function isTestMode(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export interface ParsedMongoUri {
  protocol: string;
  hosts: string;
  dbName: string;
  isRemote: boolean;
  searchParams: URLSearchParams;
}

/**
 * Robustly parses a MongoDB URI without leaking credentials.
 * Supports mongodb://, mongodb+srv://, multi-host replica sets, and query options.
 */
export function parseMongoUri(uri: string): ParsedMongoUri {
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    throw new TestDatabaseIsolationError(
      'Database connection rejected in test mode: No test database URI provided. Set MONGODB_TEST_URI (e.g. mongodb://127.0.0.1:27017/thehomez_test) to run integration tests, or run unit tests.'
    );
  }

  const trimmed = uri.trim();
  const match = trimmed.match(
    /^([a-z0-9+.-]+):\/\/(?:[^@]+@)?([^\/?#]+)(?:\/([^?#]*))?(?:\?(.*))?$/i,
  );
  if (!match || !match[1] || !match[2]) {
    throw new TestDatabaseIsolationError(
      'Database connection rejected in test mode: Malformed MongoDB URI format.',
    );
  }

  const protocol = match[1].toLowerCase();
  const hosts = match[2];
  let dbName = match[3] ? decodeURIComponent(match[3]).trim() : '';
  const queryString = match[4] || '';
  const searchParams = new URLSearchParams(queryString);
  const dbNameParam = searchParams.get('dbName')?.trim();
  if (dbNameParam) {
    dbName = dbNameParam;
  }

  const isSrv = protocol === 'mongodb+srv';
  const hostList = hosts.split(',').map((h) => {
    const hostPart = h.split(':')[0];
    return (hostPart ?? '').trim().toLowerCase();
  });
  const isLocal = hostList.every(
    (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0',
  );
  const isRemote = isSrv || !isLocal;

  return {
    protocol,
    hosts,
    dbName,
    isRemote,
    searchParams,
  };
}

export const PROHIBITED_DATABASE_NAMES: readonly string[] = [
  'thehomez_admin_verify',
  'thehomez',
  'test',
  'admin',
  'local',
  'config',
];

/**
 * Validates a MongoDB connection target before any socket connection is opened in test mode.
 * Fails closed if the target is unverified, remote without explicit opt-in, or prohibited.
 */
export function validateTestDatabaseTarget(
  uri: string,
  customOptions?: ConnectOptions,
): { databaseName: string; isRemote: boolean } {
  const parsed = parseMongoUri(uri);
  const effectiveDbName = (customOptions?.dbName || parsed.dbName || '').trim();

  // Target must be explicit; empty database name defaulting to 'test' is prohibited
  if (!effectiveDbName) {
    throw new TestDatabaseIsolationError(
      'Automated tests must specify an explicit database name in the URI path or options. Defaulting to shared/implicit database is strictly prohibited.',
    );
  }

  const lowerDbName = effectiveDbName.toLowerCase();

  // Reject remote Atlas / cloud MongoDB by default
  if (parsed.isRemote) {
    const allowRemote = process.env.ALLOW_REMOTE_TEST_DATABASE === 'true';
    if (!allowRemote) {
      throw new TestDatabaseIsolationError(
        'Remote MongoDB connection rejected: Tests are prohibited from connecting to remote database clusters by default. Integration tests must use an isolated local database (e.g. mongodb://127.0.0.1:27017/thehomez_test) or explicitly set ALLOW_REMOTE_TEST_DATABASE=true.',
      );
    }
  }

  // Do not permit tests to target thehomez_admin_verify
  if (lowerDbName === 'thehomez_admin_verify') {
    throw new TestDatabaseIsolationError(
      "CRITICAL SAFETY VIOLATION: Automated tests are strictly prohibited from targeting the isolated Admin verification database ('thehomez_admin_verify').",
    );
  }

  // Do not permit tests to target the ordinary development database
  if (lowerDbName === 'thehomez') {
    throw new TestDatabaseIsolationError(
      "SAFETY VIOLATION: Automated tests are prohibited from targeting the ordinary development database ('thehomez'). Tests must use a dedicated isolated test database.",
    );
  }

  // Do not permit tests to target the default/shared 'test' database
  if (lowerDbName === 'test') {
    throw new TestDatabaseIsolationError(
      "SAFETY VIOLATION: Automated tests are prohibited from targeting the default/shared 'test' database. Tests must specify a dedicated isolated test database.",
    );
  }

  // Safeguards that prevent production targets
  if (lowerDbName.includes('production') || lowerDbName.includes('prod')) {
    throw new TestDatabaseIsolationError(
      'CRITICAL SAFETY VIOLATION: Automated tests are strictly prohibited from targeting production databases.',
    );
  }

  for (const prohibited of PROHIBITED_DATABASE_NAMES) {
    if (lowerDbName === prohibited) {
      throw new TestDatabaseIsolationError(
        `SAFETY VIOLATION: Automated tests are prohibited from targeting database '${effectiveDbName}'.`,
      );
    }
  }

  // Approved test database naming convention (equals 'thehomez_test' or ends with '_test' or starts with 'test_')
  const isValidTestDbName =
    lowerDbName === 'thehomez_test' ||
    lowerDbName.endsWith('_test') ||
    lowerDbName.startsWith('test_');

  if (!isValidTestDbName) {
    throw new TestDatabaseIsolationError(
      `SAFETY VIOLATION: Target database '${effectiveDbName}' does not match test database naming rules (must equal 'thehomez_test' or end with '_test').`,
    );
  }

  return {
    databaseName: effectiveDbName,
    isRemote: parsed.isRemote,
  };
}

/**
 * Validates connection diagnostics post-connection.
 * Asserts that the connected database name matches the verified target.
 * Reports the database name safely without credentials or URIs.
 */
export function verifyConnectedDatabaseDiagnostics(
  diagnostics: { status: string; name?: string; host?: string },
  expectedDatabaseName: string,
): void {
  if (diagnostics.status !== 'connected') {
    throw new TestDatabaseIsolationError(
      `Database connection failed verification: Status is '${diagnostics.status}', expected 'connected'.`,
    );
  }

  if (!diagnostics.name || diagnostics.name.toLowerCase() !== expectedDatabaseName.toLowerCase()) {
    throw new TestDatabaseIsolationError(
      `Database connection failed verification: Connected database name '${diagnostics.name || 'UNKNOWN'}' does not match verified target '${expectedDatabaseName}'.`,
    );
  }

  // Report selected database name without revealing URI or credentials
  console.info(`[test-database-guard] Verified isolated test database connected: ${diagnostics.name}`);
}

/**
 * Known foreign keys and positive ownership identifier fields.
 */
const KNOWN_OWNERSHIP_ID_FIELDS = new Set([
  '_id',
  'productId',
  'variantId',
  'partnerId',
  'userId',
  'targetUserId',
  'applicantId',
  'partnerProductId',
  'orderId',
  'parentOrderId',
  'cartId',
  'serviceAreaId',
  'categoryId',
  'addressId',
  'sessionId',
]);

const KNOWN_OWNERSHIP_TOKEN_FIELDS = new Set([
  'code',
  'slug',
  'sku',
  'phone',
  'tokenHash',
  'token',
  'applicantPhone',
]);

/**
 * Strictly asserts that a deletion filter in test mode is constrained to explicitly owned test records.
 * Rejects empty filters, pure $exists checks, broad enums, and global platform prefixes.
 */
export function assertSafeDeletionFilter(filter: any, targetName: string): void {
  if (!filter || typeof filter !== 'object') {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter must be a non-empty object specifying explicitly owned test documents.`,
    );
  }

  const keys = Object.keys(filter);
  if (keys.length === 0) {
    throw new TestDatabaseIsolationError(
      `Destructive broad collection wipe rejected on '${targetName}': Empty filter ({}) is prohibited in automated tests. Cleanups must specify explicitly owned documents.`,
    );
  }

  // Check compound $or: each branch of $or must be safely constrained
  if ('$or' in filter && Array.isArray(filter.$or)) {
    if (filter.$or.length === 0) {
      throw new TestDatabaseIsolationError(
        `Destructive broad deletion rejected on '${targetName}': Empty $or array is prohibited.`,
      );
    }
    for (const branch of filter.$or) {
      assertSafeDeletionFilter(branch, `${targetName}.$or`);
    }
    return;
  }

  // Check compound $and: at least one branch of $and must be safely constrained
  if ('$and' in filter && Array.isArray(filter.$and)) {
    if (filter.$and.length === 0) {
      throw new TestDatabaseIsolationError(
        `Destructive broad deletion rejected on '${targetName}': Empty $and array is prohibited.`,
      );
    }
    let hasSafeBranch = false;
    for (const branch of filter.$and) {
      try {
        assertSafeDeletionFilter(branch, `${targetName}.$and`);
        hasSafeBranch = true;
        break;
      } catch {
        // continue checking other branches
      }
    }
    if (!hasSafeBranch) {
      throw new TestDatabaseIsolationError(
        `Destructive broad deletion rejected on '${targetName}': No safe constraining clause found in $and condition.`,
      );
    }
    return;
  }

  // Reject pure $exists checks across all specified fields
  const isPureExists = keys.every((k) => {
    const val = filter[k];
    return val && typeof val === 'object' && '$exists' in val && Object.keys(val).length === 1;
  });
  if (isPureExists) {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter relies exclusively on existence checks ($exists) instead of explicit document identity. Cleanups must specify explicitly owned documents.`,
    );
  }

  // Reject pure negative checks ($ne: null, etc.) across all fields
  const isPureNegative = keys.every((k) => {
    const val = filter[k];
    return val && typeof val === 'object' && '$ne' in val && Object.keys(val).length === 1;
  });
  if (isPureNegative) {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter relies exclusively on negative checks ($ne) instead of explicit document identity.`,
    );
  }

  // Reject unconstrained enum checks (e.g. { pricingScope: { $in: [...] } } or { status: { $in: [...] } })
  if (keys.length === 1 && (keys[0] === 'pricingScope' || keys[0] === 'status' || keys[0] === 'entityType')) {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter relies exclusively on generic enum or type field '${keys[0]}' without document/entity identity.`,
    );
  }

  // Inspect regex patterns: must be anchored with ^ and must not match platform-wide data
  for (const k of keys) {
    const val = filter[k];
    let regexStr: string | null = null;
    if (val instanceof RegExp) {
      regexStr = val.source;
    } else if (val && typeof val === 'object' && typeof val.$regex === 'string') {
      regexStr = val.$regex;
    } else if (val && typeof val === 'object' && val.$regex instanceof RegExp) {
      regexStr = val.$regex.source;
    }

    if (regexStr) {
      if (!regexStr.startsWith('^')) {
        throw new TestDatabaseIsolationError(
          `Destructive broad deletion rejected on '${targetName}': Regex filter on '${k}' must be anchored with '^'.`,
        );
      }
      // Prohibit platform-wide standard prefixes that match production catalog data
      const platformPrefixes = [
        /^\^THZ-(?!TEST|UNIT|CT|AVAIL|SVC|PRICE|PNT)/i,
        /^\^BLR-/i,
        /^\^\(cement/i,
        /^\^cement/i,
        /^\^\(kaveri/i,
        /^\^kaveri/i,
      ];
      for (const forbidden of platformPrefixes) {
        if (forbidden.test(regexStr)) {
          throw new TestDatabaseIsolationError(
            `Destructive broad deletion rejected on '${targetName}': Regex pattern '${regexStr}' on '${k}' matches shared platform data rather than test-owned documents.`,
          );
        }
      }
    }
  }

  // Must contain at least one positive ownership constraint
  const hasOwnershipId = keys.some((k) => KNOWN_OWNERSHIP_ID_FIELDS.has(k));
  const hasOwnershipToken = keys.some((k) => KNOWN_OWNERSHIP_TOKEN_FIELDS.has(k));

  if (!hasOwnershipId && !hasOwnershipToken) {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter keys [${keys.join(
        ', ',
      )}] do not contain an approved document identity field (_id, foreign key, or test-scoped token).`,
    );
  }
}

let hooksRegistered = false;
let originalCollectionDeleteMany: any = null;
let originalCollectionDeleteOne: any = null;
let originalCollectionDrop: any = null;
let originalConnectionDropDatabase: any = null;
let originalConnectionDropCollection: any = null;
const originalModelBulkWrites = new Map<string, any>();

function attachDeletionSafetyToSchema(schema: Schema): void {
  if ((schema as any).__testSafetyHooksAttached) return;
  (schema as any).__testSafetyHooksAttached = true;

  const queryOps = ['deleteMany', 'deleteOne', 'findOneAndDelete', 'findOneAndRemove'] as const;
  for (const op of queryOps) {
    (schema as any).pre(op, function (this: any) {
      if (isTestMode()) {
        const filter = this.getFilter();
        const modelName = this.model?.modelName || 'MongooseModel';
        assertSafeDeletionFilter(filter, `${modelName}.${op}`);
      }
    });
  }
}

function interceptModelBulkWrite(model: Model<any>): void {
  if ((model as any).__testBulkWriteIntercepted) return;
  (model as any).__testBulkWriteIntercepted = true;

  const originalBulkWrite = model.bulkWrite.bind(model);
  originalModelBulkWrites.set(model.modelName, originalBulkWrite);

  model.bulkWrite = function (ops: any[], ...rest: any[]) {
    if (isTestMode() && Array.isArray(ops)) {
      for (const op of ops) {
        if (op.deleteMany) {
          assertSafeDeletionFilter(op.deleteMany.filter, `${model.modelName}.bulkWrite(deleteMany)`);
        }
        if (op.deleteOne) {
          assertSafeDeletionFilter(op.deleteOne.filter, `${model.modelName}.bulkWrite(deleteOne)`);
        }
      }
    }
    return originalBulkWrite(ops, ...rest);
  } as any;
}

/**
 * Intercepts Mongoose and native driver destructive operations in test mode.
 * Protects pre-compiled models, future models, bulkWrite, and native driver collection calls.
 */
export function registerTestDeletionSafetyHooks(mongooseInstance: typeof mongoose): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  // 1. Protect all models already compiled prior to this registration call
  if (mongooseInstance.models) {
    for (const model of Object.values(mongooseInstance.models)) {
      if (model && model.schema) {
        attachDeletionSafetyToSchema(model.schema);
      }
      if (model && typeof model.bulkWrite === 'function') {
        interceptModelBulkWrite(model);
      }
    }
  }

  // 2. Protect all future schemas via global Mongoose plugin
  mongooseInstance.plugin(attachDeletionSafetyToSchema);

  // 3. Intercept native MongoDB collection deleteMany
  if (mongooseInstance.mongo?.Collection?.prototype) {
    originalCollectionDeleteMany = mongooseInstance.mongo.Collection.prototype.deleteMany;
    mongooseInstance.mongo.Collection.prototype.deleteMany = function (filter: any, ...rest: any[]) {
      if (isTestMode()) {
        assertSafeDeletionFilter(filter, `Collection(${this.collectionName}).deleteMany`);
      }
      return originalCollectionDeleteMany.apply(this, [filter, ...rest]);
    };

    // 4. Intercept native MongoDB collection deleteOne
    originalCollectionDeleteOne = mongooseInstance.mongo.Collection.prototype.deleteOne;
    mongooseInstance.mongo.Collection.prototype.deleteOne = function (filter: any, ...rest: any[]) {
      if (isTestMode()) {
        assertSafeDeletionFilter(filter, `Collection(${this.collectionName}).deleteOne`);
      }
      return originalCollectionDeleteOne.apply(this, [filter, ...rest]);
    };

    // 5. Intercept native collection drop
    originalCollectionDrop = mongooseInstance.mongo.Collection.prototype.drop;
    mongooseInstance.mongo.Collection.prototype.drop = function (...args: any[]) {
      if (isTestMode()) {
        throw new TestDatabaseIsolationError(
          `Destructive collection drop rejected on '${this.collectionName}': Dropping collections is prohibited in automated tests.`,
        );
      }
      return originalCollectionDrop.apply(this, args);
    };
  }

  // 6. Intercept Connection.prototype.dropDatabase
  if (mongooseInstance.Connection?.prototype) {
    originalConnectionDropDatabase = mongooseInstance.Connection.prototype.dropDatabase;
    mongooseInstance.Connection.prototype.dropDatabase = function (...args: any[]) {
      if (isTestMode()) {
        throw new TestDatabaseIsolationError(
          'Destructive database drop rejected: dropDatabase() is prohibited in automated tests.',
        );
      }
      return originalConnectionDropDatabase.apply(this, args);
    };

    // 7. Intercept Connection.prototype.dropCollection
    originalConnectionDropCollection = mongooseInstance.Connection.prototype.dropCollection;
    mongooseInstance.Connection.prototype.dropCollection = function (name: string, ...args: any[]) {
      if (isTestMode()) {
        throw new TestDatabaseIsolationError(
          `Destructive dropCollection rejected on '${name}': Dropping collections is prohibited in automated tests.`,
        );
      }
      return originalConnectionDropCollection.apply(this, [name, ...args]);
    };
  }
}

/**
 * Restores original prototypes and methods (useful for isolating unit tests).
 */
export function restoreTestDeletionSafetyHooks(mongooseInstance: typeof mongoose): void {
  if (!hooksRegistered) return;

  if (originalCollectionDeleteMany && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.deleteMany = originalCollectionDeleteMany;
    originalCollectionDeleteMany = null;
  }
  if (originalCollectionDeleteOne && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.deleteOne = originalCollectionDeleteOne;
    originalCollectionDeleteOne = null;
  }
  if (originalCollectionDrop && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.drop = originalCollectionDrop;
    originalCollectionDrop = null;
  }
  if (originalConnectionDropDatabase && mongooseInstance.Connection?.prototype) {
    mongooseInstance.Connection.prototype.dropDatabase = originalConnectionDropDatabase;
    originalConnectionDropDatabase = null;
  }
  if (originalConnectionDropCollection && mongooseInstance.Connection?.prototype) {
    mongooseInstance.Connection.prototype.dropCollection = originalConnectionDropCollection;
    originalConnectionDropCollection = null;
  }

  for (const [modelName, originalBulkWrite] of originalModelBulkWrites.entries()) {
    const model = mongooseInstance.models[modelName];
    if (model) {
      model.bulkWrite = originalBulkWrite;
      delete (model as any).__testBulkWriteIntercepted;
    }
  }
  originalModelBulkWrites.clear();
  hooksRegistered = false;
}

/**
 * Helper class for tracking test-created document IDs and performing safe, owned cleanup.
 */
export class TestFixtureTracker {
  private trackedIds = new Map<string, Set<string>>();

  public track(entityName: string, id: any): void {
    if (!id) return;
    const rawId = (id && typeof id === 'object' && '_id' in id) ? (id as any)._id : id;
    if (!rawId) return;
    const strId = typeof rawId === 'object' ? rawId.toString() : String(rawId);
    let set = this.trackedIds.get(entityName);
    if (!set) {
      set = new Set();
      this.trackedIds.set(entityName, set);
    }
    set.add(strId);
  }

  public getIds(entityName: string): mongoose.Types.ObjectId[] {
    const set = this.trackedIds.get(entityName);
    if (!set || set.size === 0) return [];
    return Array.from(set).map((id) => new mongoose.Types.ObjectId(id));
  }

  public clear(): void {
    this.trackedIds.clear();
  }
}

// Auto-register immediately upon module load if in test mode
if (isTestMode()) {
  registerTestDeletionSafetyHooks(mongoose);
}
