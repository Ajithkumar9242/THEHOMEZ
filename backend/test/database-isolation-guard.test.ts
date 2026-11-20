import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  validateTestDatabaseTarget,
  verifyConnectedDatabaseDiagnostics,
  parseMongoUri,
  registerTestDeletionSafetyHooks,
  TestDatabaseIsolationError,
} from '../src/database/test-guard.js';
import { validateConfig } from '../src/config/env.js';

describe('Test Database Isolation Guard & Safety Verification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', VITEST: 'true' };
    delete process.env.ALLOW_REMOTE_TEST_DATABASE;
    delete process.env.MONGODB_TEST_URI;
    delete process.env.TEST_MONGODB_URI;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('URI Parsing & Format Validation', () => {
    it('parses local MongoDB connection URI accurately', () => {
      const parsed = parseMongoUri('mongodb://127.0.0.1:27017/thehomez_test');
      expect(parsed.protocol).toBe('mongodb');
      expect(parsed.hosts).toBe('127.0.0.1:27017');
      expect(parsed.dbName).toBe('thehomez_test');
      expect(parsed.isRemote).toBe(false);
    });

    it('parses multi-host local replica set URI accurately', () => {
      const parsed = parseMongoUri('mongodb://127.0.0.1:27017,127.0.0.1:27018/thehomez_test?replicaSet=rs0');
      expect(parsed.protocol).toBe('mongodb');
      expect(parsed.dbName).toBe('thehomez_test');
      expect(parsed.isRemote).toBe(false);
      expect(parsed.searchParams.get('replicaSet')).toBe('rs0');
    });

    it('identifies remote Atlas mongodb+srv connection URI as remote', () => {
      const parsed = parseMongoUri('mongodb+srv://user:pass@cluster0.5foyc0g.mongodb.net/thehomez_test');
      expect(parsed.protocol).toBe('mongodb+srv');
      expect(parsed.isRemote).toBe(true);
      expect(parsed.dbName).toBe('thehomez_test');
    });

    it('rejects empty or whitespace-only URI', () => {
      expect(() => parseMongoUri('')).toThrow(TestDatabaseIsolationError);
      expect(() => parseMongoUri('   ')).toThrow(TestDatabaseIsolationError);
    });

    it('rejects malformed URI string', () => {
      expect(() => parseMongoUri('not-a-mongo-uri')).toThrow(TestDatabaseIsolationError);
    });
  });

  describe('Remote Atlas Connection Protection', () => {
    const remoteAtlasUri = 'mongodb+srv://cluster0.5foyc0g.mongodb.net/thehomez_test';

    it('rejects remote Atlas MongoDB connections by default in test mode', () => {
      expect(() => validateTestDatabaseTarget(remoteAtlasUri)).toThrow(
        /Remote MongoDB connection rejected.*prohibited from connecting to remote database clusters by default/i,
      );
    });

    it('allows remote test database only when explicit opt-in is enabled', () => {
      process.env.ALLOW_REMOTE_TEST_DATABASE = 'true';
      const result = validateTestDatabaseTarget(remoteAtlasUri);
      expect(result.databaseName).toBe('thehomez_test');
      expect(result.isRemote).toBe(true);
    });
  });

  describe('Prohibited Database Target Enforcement', () => {
    it('strictly prohibits targeting the isolated Admin verification database (thehomez_admin_verify)', () => {
      process.env.ALLOW_REMOTE_TEST_DATABASE = 'true';
      expect(() =>
        validateTestDatabaseTarget('mongodb://127.0.0.1:27017/thehomez_admin_verify'),
      ).toThrow(/CRITICAL SAFETY VIOLATION.*thehomez_admin_verify/i);

      expect(() =>
        validateTestDatabaseTarget('mongodb+srv://cluster0.5foyc0g.mongodb.net/thehomez_admin_verify'),
      ).toThrow(/CRITICAL SAFETY VIOLATION.*thehomez_admin_verify/i);
    });

    it('strictly prohibits targeting the development database (thehomez)', () => {
      expect(() => validateTestDatabaseTarget('mongodb://127.0.0.1:27017/thehomez')).toThrow(
        /SAFETY VIOLATION.*ordinary development database/i,
      );
    });

    it('strictly prohibits targeting the shared default database (test)', () => {
      expect(() => validateTestDatabaseTarget('mongodb://127.0.0.1:27017/test')).toThrow(
        /SAFETY VIOLATION.*default\/shared 'test' database/i,
      );
    });

    it('strictly prohibits URIs with missing database path that would default to test', () => {
      expect(() => validateTestDatabaseTarget('mongodb://127.0.0.1:27017/')).toThrow(
        /Automated tests must specify an explicit database name/i,
      );

      expect(() => validateTestDatabaseTarget('mongodb://127.0.0.1:27017')).toThrow(
        /Automated tests must specify an explicit database name/i,
      );
    });

    it('strictly prohibits production database targets', () => {
      expect(() =>
        validateTestDatabaseTarget('mongodb://127.0.0.1:27017/thehomez_production'),
      ).toThrow(/CRITICAL SAFETY VIOLATION.*production databases/i);

      expect(() =>
        validateTestDatabaseTarget('mongodb://127.0.0.1:27017/prod_thehomez'),
      ).toThrow(/CRITICAL SAFETY VIOLATION.*production databases/i);
    });

    it('strictly enforces approved test database naming rules', () => {
      expect(() => validateTestDatabaseTarget('mongodb://127.0.0.1:27017/arbitrary_db')).toThrow(
        /does not match test database naming rules/i,
      );
    });
  });

  describe('Compliant Isolated Test Database Acceptance', () => {
    it('accepts compliant local test database (thehomez_test)', () => {
      const result = validateTestDatabaseTarget('mongodb://127.0.0.1:27017/thehomez_test');
      expect(result.databaseName).toBe('thehomez_test');
      expect(result.isRemote).toBe(false);
    });

    it('accepts compliant local test database ending with _test', () => {
      const result = validateTestDatabaseTarget('mongodb://127.0.0.1:27017/thehomez_integration_test');
      expect(result.databaseName).toBe('thehomez_integration_test');
      expect(result.isRemote).toBe(false);
    });

    it('honors dbName in ConnectOptions when provided', () => {
      const result = validateTestDatabaseTarget('mongodb://127.0.0.1:27017', {
        dbName: 'thehomez_test',
      });
      expect(result.databaseName).toBe('thehomez_test');
      expect(result.isRemote).toBe(false);
    });
  });

  describe('Post-Connection Diagnostic Verification', () => {
    it('passes when diagnostics match expected database name and status is connected', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      expect(() =>
        verifyConnectedDatabaseDiagnostics(
          { status: 'connected', name: 'thehomez_test' },
          'thehomez_test',
        ),
      ).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[test-database-guard] Verified isolated test database connected: thehomez_test'),
      );
    });

    it('fails closed when diagnostics status is not connected', () => {
      expect(() =>
        verifyConnectedDatabaseDiagnostics(
          { status: 'connecting', name: 'thehomez_test' },
          'thehomez_test',
        ),
      ).toThrow(TestDatabaseIsolationError);
    });

    it('fails closed when diagnostics name does not match verified target', () => {
      expect(() =>
        verifyConnectedDatabaseDiagnostics(
          { status: 'connected', name: 'thehomez_admin_verify' },
          'thehomez_test',
        ),
      ).toThrow(TestDatabaseIsolationError);
    });
  });

  describe('Environment Configuration Loading in Test Mode', () => {
    it('does not fall back to development database when MONGODB_TEST_URI is absent', () => {
      const config = validateConfig({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb+srv://cluster0.5foyc0g.mongodb.net', // simulate .env
      });
      // In test mode, must not silently inherit MONGODB_URI or default to thehomez
      expect(config.mongodb.uri).toBe('');
    });

    it('uses explicit MONGODB_TEST_URI when configured', () => {
      const config = validateConfig({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb+srv://cluster0.5foyc0g.mongodb.net',
        MONGODB_TEST_URI: 'mongodb://127.0.0.1:27017/thehomez_test',
      });
      expect(config.mongodb.uri).toBe('mongodb://127.0.0.1:27017/thehomez_test');
    });

    it('preserves development fallback when NODE_ENV is development', () => {
      const config = validateConfig({
        NODE_ENV: 'development',
      });
      expect(config.mongodb.uri).toContain('thehomez');
    });
  });

  describe('Destructive Broad Wipe Prevention', () => {
    it('registers pre deleteMany hook that rejects empty filter', async () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ name: String });
      const TestModel = testMongoose.model('SafetyHookTest', testSchema);

      let caughtError: any = null;
      try {
        await TestModel.deleteMany({});
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TestDatabaseIsolationError);
      expect(caughtError.message).toContain('Destructive broad collection wipe rejected');
    });

    it('rejects pure $exists filters', async () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ pricingScope: String });
      const TestModel = testMongoose.model('SafetyHookExistsTest', testSchema);

      let caughtError: any = null;
      try {
        await TestModel.deleteMany({ pricingScope: { $exists: true } });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TestDatabaseIsolationError);
      expect(caughtError.message).toContain('relies exclusively on existence checks ($exists)');
    });

    it('rejects generic enum filters without document identity', async () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ pricingScope: String });
      const TestModel = testMongoose.model('SafetyHookEnumTest', testSchema);

      let caughtError: any = null;
      try {
        await TestModel.deleteMany({
          pricingScope: { $in: ['STANDALONE_GLOBAL', 'VARIANT_GLOBAL'] },
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TestDatabaseIsolationError);
      expect(caughtError.message).toContain('relies exclusively on generic enum or type field');
    });

    it('rejects platform-wide standard prefixes (e.g. ^THZ- without test qualifier)', async () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ sku: String });
      const TestModel = testMongoose.model('SafetyHookPlatformPrefixTest', testSchema);

      let caughtError: any = null;
      try {
        await TestModel.deleteMany({ sku: /^THZ-CEM-53/ });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TestDatabaseIsolationError);
      expect(caughtError.message).toContain('matches shared platform data rather than test-owned documents');
    });

    it('protects models compiled BEFORE registerTestDeletionSafetyHooks is called', async () => {
      const testMongoose = new (mongoose.constructor as any)();

      // Compile model BEFORE registering hooks
      const preCompiledSchema = new testMongoose.Schema({ name: String });
      const PreCompiledModel = testMongoose.model('PreCompiledModelTest', preCompiledSchema);

      // Now register hooks
      registerTestDeletionSafetyHooks(testMongoose);

      let caughtError: any = null;
      try {
        await PreCompiledModel.deleteMany({});
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TestDatabaseIsolationError);
      expect(caughtError.message).toContain('Destructive broad collection wipe rejected');
    });

    it('permits deleteMany with explicitly owned document ID constraints', () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ productId: testMongoose.Schema.Types.ObjectId });
      const TestModel = testMongoose.model('SafetyHookPermittedIdTest', testSchema);

      const testId = new mongoose.Types.ObjectId();
      const query = TestModel.deleteMany({ productId: { $in: [testId] } });
      expect(query.getFilter()).toEqual({ productId: { $in: [testId] } });
    });

    it('permits deleteMany with anchored test-scoped tokens', () => {
      const testMongoose = new (mongoose.constructor as any)();
      registerTestDeletionSafetyHooks(testMongoose);

      const testSchema = new testMongoose.Schema({ code: String });
      const TestModel = testMongoose.model('SafetyHookPermittedTokenTest', testSchema);

      const query = TestModel.deleteMany({ code: /^UNIT_TEST_WRITER/ });
      expect(query.getFilter()).toEqual({ code: /^UNIT_TEST_WRITER/ });
    });
  });
});
