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

export const IMMUTABLE_COLLECTIONS: ReadonlySet<string> = new Set([
  'pricehistory',
  'partneravailabilityhistory',
  'partnerauditlog',
]);

/**
 * Normalizes a model or collection name deterministically.
 * Strips collection wrappers, 'model' suffix, punctuation, and plural endings.
 */
export function normalizeTarget(target: string): string {
  let norm = (target || '').toLowerCase().trim();
  norm = norm.replace(/^collection\((.+)\)$/, '$1');
  norm = norm.replace(/model$/, '');
  norm = norm.replace(/[._\-]/g, '');
  if (norm.endsWith('ies')) {
    norm = norm.slice(0, -3) + 'y';
  } else if (norm.endsWith('ses')) {
    norm = norm.slice(0, -2);
  } else if (norm.endsWith('s') && !norm.endsWith('ss')) {
    norm = norm.slice(0, -1);
  }
  return norm;
}

/**
 * In-Memory Fixture Ownership Registry
 *
 * Tracks every document ID created and saved during the current test execution process.
 * Deletion operations MUST prove positive ownership by demonstrating that all targeted IDs
 * were registered upon creation by the current process under the exact target collection/model.
 */
export class TestFixtureRegistry {
  private static instance: TestFixtureRegistry;
  private registry = new Map<string, Set<string>>();

  public static getInstance(): TestFixtureRegistry {
    if (!TestFixtureRegistry.instance) {
      TestFixtureRegistry.instance = new TestFixtureRegistry();
    }
    return TestFixtureRegistry.instance;
  }

  public registerCreatedFixture(target: string, id: any): void {
    if (!id) return;
    const rawId = (id && typeof id === 'object' && '_id' in id) ? (id as any)._id : id;
    if (!rawId) return;
    const strId = typeof rawId === 'object' ? rawId.toString() : String(rawId);
    if (!strId || strId === 'undefined' || strId === 'null') return;

    const norm = normalizeTarget(target);
    let set = this.registry.get(norm);
    if (!set) {
      set = new Set();
      this.registry.set(norm, set);
    }
    set.add(strId);
  }

  public isRegistered(target: string, id: any): boolean {
    if (!id) return false;
    const rawId = (id && typeof id === 'object' && '_id' in id) ? (id as any)._id : id;
    if (!rawId) return false;
    const strId = typeof rawId === 'object' ? rawId.toString() : String(rawId);

    const norm = normalizeTarget(target);
    const set = this.registry.get(norm);
    return Boolean(set && set.has(strId));
  }

  public validateOwnership(target: string, ids: any[]): void {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new TestDatabaseIsolationError(
        `Destructive deletion rejected on '${target}': No target IDs provided for ownership validation.`,
      );
    }
    const norm = normalizeTarget(target);
    for (const id of ids) {
      if (!this.isRegistered(norm, id)) {
        throw new TestDatabaseIsolationError(
          `Destructive deletion rejected on '${target}': Target ID '${id}' is not an explicitly registered fixture created by the current test run for target '${norm}'.`,
        );
      }
    }
  }

  public clear(): void {
    this.registry.clear();
  }
}

export function registerTestFixture(targetName: string, id: any): void {
  TestFixtureRegistry.getInstance().registerCreatedFixture(targetName, id);
}

/**
 * Strictly asserts that a deletion filter in test mode is constrained to explicitly owned test records.
 * Rejects empty filters, foreign keys, tokens, codes, phone numbers, broad wipes, and immutable targets.
 * Deletions MUST explicitly constrain '_id' to IDs registered under the exact target collection/model.
 */
export function assertSafeDeletionFilter(filter: any, targetName: string): void {
  if (!filter || typeof filter !== 'object') {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Filter must be a non-empty object specifying explicitly owned test documents.`,
    );
  }

  const normTarget = normalizeTarget(targetName);
  if (IMMUTABLE_COLLECTIONS.has(normTarget)) {
    const immutabilityCode = normTarget.includes('price')
      ? 'PRICE_HISTORY_IMMUTABLE'
      : normTarget.includes('partneravailability')
        ? 'PARTNER_AVAILABILITY_HISTORY_IMMUTABLE'
        : 'PARTNER_AUDIT_LOG_IMMUTABLE';
    throw new TestDatabaseIsolationError(
      `CRITICAL IMMUTABILITY VIOLATION [${immutabilityCode}]: Deletion rejected on immutable collection/model '${targetName}'. Audit and history records are permanently immutable and must never be deleted.`,
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

  // Deletion MUST explicitly constrain '_id'. Foreign keys, codes, tokens, slugs, phone numbers are strictly prohibited.
  if (!('_id' in filter)) {
    throw new TestDatabaseIsolationError(
      `Destructive broad deletion rejected on '${targetName}': Deletion filter must explicitly constrain '_id'. Deletions using foreign keys, tokens, codes, phone numbers, or broad queries are strictly prohibited.`,
    );
  }

  // Extract target IDs and validate runtime fixture ownership
  const val = filter._id;
  const targetIds: any[] = [];
  if (val instanceof mongoose.Types.ObjectId || typeof val === 'string') {
    targetIds.push(val);
  } else if (val && typeof val === 'object') {
    if ('$eq' in val && val.$eq) {
      targetIds.push(val.$eq);
    } else if ('$in' in val && Array.isArray(val.$in)) {
      targetIds.push(...val.$in);
    }
  }

  if (targetIds.length === 0) {
    throw new TestDatabaseIsolationError(
      `Destructive deletion rejected on '${targetName}': No valid '_id' values extracted from filter. Cleanups must specify explicit document IDs.`,
    );
  }

  TestFixtureRegistry.getInstance().validateOwnership(normTarget, targetIds);
}

let hooksRegistered = false;
let originalCollectionDeleteMany: any = null;
let originalCollectionDeleteOne: any = null;
let originalCollectionFindOneAndDelete: any = null;
let originalCollectionFindOneAndRemove: any = null;
let originalCollectionBulkWrite: any = null;
let originalCollectionInsertOne: any = null;
let originalCollectionInsertMany: any = null;
let originalCollectionDrop: any = null;
let originalConnectionDropDatabase: any = null;
let originalConnectionDropCollection: any = null;
const originalModelBulkWrites = new Map<string, any>();

function attachDeletionSafetyToSchema(schema: Schema): void {
  if ((schema as any).__testSafetyHooksAttached) return;
  (schema as any).__testSafetyHooksAttached = true;

  // 1. Intercept successful document creations via save()
  schema.post('save', function (doc: any) {
    if (isTestMode() && doc && doc._id) {
      const modelName = doc.constructor?.modelName || (this as any)?.constructor?.modelName || '';
      const collectionName = doc.collection?.name || (this as any)?.collection?.name || '';
      if (modelName) TestFixtureRegistry.getInstance().registerCreatedFixture(modelName, doc._id);
      if (collectionName) TestFixtureRegistry.getInstance().registerCreatedFixture(collectionName, doc._id);
    }
  });

  // 2. Intercept successful document creations via insertMany()
  schema.post('insertMany', function (docs: any) {
    if (isTestMode() && Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc && doc._id) {
          const modelName = doc.constructor?.modelName || (this as any)?.modelName || '';
          const collectionName = doc.collection?.name || (this as any)?.collection?.name || '';
          if (modelName) TestFixtureRegistry.getInstance().registerCreatedFixture(modelName, doc._id);
          if (collectionName) TestFixtureRegistry.getInstance().registerCreatedFixture(collectionName, doc._id);
        }
      }
    }
  });

  // 3. Intercept document creations/upserts via findOneAndUpdate()
  schema.post('findOneAndUpdate', function (doc: any) {
    if (isTestMode() && doc && doc._id) {
      const modelName = (this as any)?.model?.modelName || '';
      const collectionName = (this as any)?.model?.collection?.name || '';
      if (modelName) TestFixtureRegistry.getInstance().registerCreatedFixture(modelName, doc._id);
      if (collectionName) TestFixtureRegistry.getInstance().registerCreatedFixture(collectionName, doc._id);
    }
  });

  // 4. Intercept destructive operations
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

    // 5. Intercept native MongoDB collection findOneAndDelete
    originalCollectionFindOneAndDelete = mongooseInstance.mongo.Collection.prototype.findOneAndDelete;
    mongooseInstance.mongo.Collection.prototype.findOneAndDelete = function (filter: any, ...rest: any[]) {
      if (isTestMode()) {
        assertSafeDeletionFilter(filter, `Collection(${this.collectionName}).findOneAndDelete`);
      }
      return originalCollectionFindOneAndDelete.apply(this, [filter, ...rest]);
    };

    // 6. Intercept native MongoDB collection findOneAndRemove (if present on driver prototype)
    const collectionProto = mongooseInstance.mongo.Collection.prototype as any;
    if (typeof collectionProto.findOneAndRemove === 'function') {
      originalCollectionFindOneAndRemove = collectionProto.findOneAndRemove;
      collectionProto.findOneAndRemove = function (filter: any, ...rest: any[]) {
        if (isTestMode()) {
          assertSafeDeletionFilter(filter, `Collection(${this.collectionName}).findOneAndRemove`);
        }
        return originalCollectionFindOneAndRemove.apply(this, [filter, ...rest]);
      };
    }

    // 7. Intercept native MongoDB collection bulkWrite
    originalCollectionBulkWrite = mongooseInstance.mongo.Collection.prototype.bulkWrite;
    mongooseInstance.mongo.Collection.prototype.bulkWrite = function (ops: any[], ...rest: any[]) {
      if (isTestMode() && Array.isArray(ops)) {
        for (const op of ops) {
          if (op && op.deleteMany) {
            assertSafeDeletionFilter(op.deleteMany.filter, `Collection(${this.collectionName}).bulkWrite(deleteMany)`);
          }
          if (op && op.deleteOne) {
            assertSafeDeletionFilter(op.deleteOne.filter, `Collection(${this.collectionName}).bulkWrite(deleteOne)`);
          }
        }
      }
      return originalCollectionBulkWrite.apply(this, [ops, ...rest]);
    };

    // 8. Intercept native MongoDB collection insertOne to register created fixtures
    originalCollectionInsertOne = mongooseInstance.mongo.Collection.prototype.insertOne;
    mongooseInstance.mongo.Collection.prototype.insertOne = async function (doc: any, ...rest: any[]) {
      const res = await originalCollectionInsertOne.apply(this, [doc, ...rest]);
      if (isTestMode() && res && res.insertedId) {
        TestFixtureRegistry.getInstance().registerCreatedFixture(this.collectionName, res.insertedId);
      }
      return res;
    };

    // 9. Intercept native MongoDB collection insertMany to register created fixtures
    originalCollectionInsertMany = mongooseInstance.mongo.Collection.prototype.insertMany;
    mongooseInstance.mongo.Collection.prototype.insertMany = async function (docs: any[], ...rest: any[]) {
      const res = await originalCollectionInsertMany.apply(this, [docs, ...rest]);
      if (isTestMode() && res && res.insertedIds) {
        for (const id of Object.values(res.insertedIds)) {
          TestFixtureRegistry.getInstance().registerCreatedFixture(this.collectionName, id);
        }
      }
      return res;
    };

    // 10. Intercept native collection drop
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

  // 11. Intercept Connection.prototype.dropDatabase
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

    // 12. Intercept Connection.prototype.dropCollection
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
  if (originalCollectionFindOneAndDelete && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.findOneAndDelete = originalCollectionFindOneAndDelete;
    originalCollectionFindOneAndDelete = null;
  }
  if (originalCollectionFindOneAndRemove && mongooseInstance.mongo?.Collection?.prototype) {
    (mongooseInstance.mongo.Collection.prototype as any).findOneAndRemove = originalCollectionFindOneAndRemove;
    originalCollectionFindOneAndRemove = null;
  }
  if (originalCollectionBulkWrite && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.bulkWrite = originalCollectionBulkWrite;
    originalCollectionBulkWrite = null;
  }
  if (originalCollectionInsertOne && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.insertOne = originalCollectionInsertOne;
    originalCollectionInsertOne = null;
  }
  if (originalCollectionInsertMany && mongooseInstance.mongo?.Collection?.prototype) {
    mongooseInstance.mongo.Collection.prototype.insertMany = originalCollectionInsertMany;
    originalCollectionInsertMany = null;
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
    TestFixtureRegistry.getInstance().registerCreatedFixture(entityName, rawId);
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
