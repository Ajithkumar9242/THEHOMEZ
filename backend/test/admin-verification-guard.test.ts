import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import {
  ADMIN_VERIFICATION_DATABASE,
  ADMIN_VERIFICATION_PORT,
  ADMIN_VERIFICATION_NODE_ENV,
  ADMIN_VERIFICATION_MODE,
  AdminVerificationGuardError,
  validateAdminVerificationEnvironment,
  assertAdminVerificationGuard,
  assertConnectedAdminVerificationDatabase,
  suppressMongooseAutoIndexAndCreate,
  type GuardedAdminVerificationOptions,
} from '../src/config/admin-verification-guard.js';
import * as databaseModule from '../src/database/database.js';
import * as appModule from '../src/app.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import {
  startAdminVerificationServer,
  startServer,
  _resetShutdownStateForTesting,
} from '../src/server.js';
import { getConfig } from '../src/config/env.js';

function createValidEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: ADMIN_VERIFICATION_NODE_ENV,
    PORT: String(ADMIN_VERIFICATION_PORT),
    MONGODB_URI: `mongodb://127.0.0.1:27017/${ADMIN_VERIFICATION_DATABASE}`,
    ...overrides,
  };
}

describe('Admin Verification Guard Environment Validation', () => {
  it('validates a correct development configuration targeting the isolated database', () => {
    const env = createValidEnv();
    const result = validateAdminVerificationEnvironment(env);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('validates a mongodb+srv URI targeting the isolated database', () => {
    const env = createValidEnv({
      MONGODB_URI: `mongodb+srv://user:pass@cluster.mongodb.net/${ADMIN_VERIFICATION_DATABASE}?retryWrites=true&w=majority`,
    });
    const result = validateAdminVerificationEnvironment(env);
    expect(result.valid).toBe(true);
  });

  it('rejects non-development NODE_ENV', () => {
    const prodResult = validateAdminVerificationEnvironment(createValidEnv({ NODE_ENV: 'production' }));
    expect(prodResult.valid).toBe(false);
    expect(prodResult.reason).toContain('NODE_ENV must be');

    const testResult = validateAdminVerificationEnvironment(createValidEnv({ NODE_ENV: 'test' }));
    expect(testResult.valid).toBe(false);
    expect(testResult.reason).toContain('NODE_ENV must be');
  });

  it('rejects ports other than 5001', () => {
    const port5000 = validateAdminVerificationEnvironment(createValidEnv({ PORT: '5000' }));
    expect(port5000.valid).toBe(false);
    expect(port5000.reason).toContain('PORT must be');

    const noPort = validateAdminVerificationEnvironment(createValidEnv({ PORT: undefined }));
    expect(noPort.valid).toBe(false);
    expect(noPort.reason).toContain('PORT must be');
  });

  it('rejects missing or empty MONGODB_URI', () => {
    const missing = validateAdminVerificationEnvironment(createValidEnv({ MONGODB_URI: undefined }));
    expect(missing.valid).toBe(false);
    expect(missing.reason).toContain('MONGODB_URI is required');

    const empty = validateAdminVerificationEnvironment(createValidEnv({ MONGODB_URI: '   ' }));
    expect(empty.valid).toBe(false);
    expect(empty.reason).toContain('MONGODB_URI is required');
  });

  it('rejects invalid or unsupported URI schemes', () => {
    const invalidUrl = validateAdminVerificationEnvironment(createValidEnv({ MONGODB_URI: 'not-a-url' }));
    expect(invalidUrl.valid).toBe(false);
    expect(invalidUrl.reason).toContain('not a valid URL');

    const httpUrl = validateAdminVerificationEnvironment(
      createValidEnv({ MONGODB_URI: `http://localhost:27017/${ADMIN_VERIFICATION_DATABASE}` }),
    );
    expect(httpUrl.valid).toBe(false);
    expect(httpUrl.reason).toContain('protocol must be');
  });

  it('rejects URIs pointing to any database other than the isolated target', () => {
    const testDb = validateAdminVerificationEnvironment(
      createValidEnv({ MONGODB_URI: 'mongodb://127.0.0.1:27017/test' }),
    );
    expect(testDb.valid).toBe(false);
    expect(testDb.reason).toContain("database path must be '/thehomez_admin_verify'");

    const prodDb = validateAdminVerificationEnvironment(
      createValidEnv({ MONGODB_URI: 'mongodb://127.0.0.1:27017/thehomez' }),
    );
    expect(prodDb.valid).toBe(false);
    expect(prodDb.reason).toContain("database path must be '/thehomez_admin_verify'");

    const emptyPath = validateAdminVerificationEnvironment(
      createValidEnv({ MONGODB_URI: 'mongodb://127.0.0.1:27017/' }),
    );
    expect(emptyPath.valid).toBe(false);
    expect(emptyPath.reason).toContain("database path must be '/thehomez_admin_verify'");
  });

  it('rejects URIs with conflicting dbname query parameter', () => {
    const conflicting = validateAdminVerificationEnvironment(
      createValidEnv({
        MONGODB_URI: `mongodb://127.0.0.1:27017/${ADMIN_VERIFICATION_DATABASE}?dbname=other_db`,
      }),
    );
    expect(conflicting.valid).toBe(false);
    expect(conflicting.reason).toContain('dbname parameter conflicts');
  });

  it('accepts matching dbname query parameter', () => {
    const matching = validateAdminVerificationEnvironment(
      createValidEnv({
        MONGODB_URI: `mongodb://127.0.0.1:27017/${ADMIN_VERIFICATION_DATABASE}?dbname=${ADMIN_VERIFICATION_DATABASE}`,
      }),
    );
    expect(matching.valid).toBe(true);
  });
});

describe('assertAdminVerificationGuard', () => {
  it('throws when guard object is missing or has incorrect mode', () => {
    const env = createValidEnv();
    expect(() => assertAdminVerificationGuard(null, env)).toThrow(AdminVerificationGuardError);
    expect(() => assertAdminVerificationGuard({}, env)).toThrow(AdminVerificationGuardError);
    expect(() => assertAdminVerificationGuard({ mode: 'normal' }, env)).toThrow(
      AdminVerificationGuardError,
    );
    expect(() => assertAdminVerificationGuard({ mode: 'admin-verification' }, env)).not.toThrow();
  });

  it('throws when environment validation fails', () => {
    const guard: GuardedAdminVerificationOptions = { mode: ADMIN_VERIFICATION_MODE };
    const invalidEnv = createValidEnv({ PORT: '5000' });
    expect(() => assertAdminVerificationGuard(guard, invalidEnv)).toThrow(
      AdminVerificationGuardError,
    );
  });
});

describe('assertConnectedAdminVerificationDatabase', () => {
  it('passes when diagnostics confirm connected to isolated database', () => {
    expect(() =>
      assertConnectedAdminVerificationDatabase({
        status: 'connected',
        name: ADMIN_VERIFICATION_DATABASE,
      }),
    ).not.toThrow();
  });

  it('throws when diagnostics are missing or disconnected', () => {
    expect(() => assertConnectedAdminVerificationDatabase(undefined)).toThrow(
      AdminVerificationGuardError,
    );
    expect(() =>
      assertConnectedAdminVerificationDatabase({
        status: 'disconnected',
        name: ADMIN_VERIFICATION_DATABASE,
      }),
    ).toThrow(AdminVerificationGuardError);
  });

  it('throws when connected database name does not match isolated database', () => {
    expect(() =>
      assertConnectedAdminVerificationDatabase({
        status: 'connected',
        name: 'test',
      }),
    ).toThrow(AdminVerificationGuardError);

    expect(() =>
      assertConnectedAdminVerificationDatabase({
        status: 'connected',
        name: 'thehomez',
      }),
    ).toThrow(AdminVerificationGuardError);
  });
});

describe('suppressMongooseAutoIndexAndCreate', () => {
  let suppressionHandle: { restore: () => void } | null = null;

  afterEach(() => {
    if (suppressionHandle) {
      suppressionHandle.restore();
      suppressionHandle = null;
    }
  });

  it('suppresses schemas with explicit autoIndex: true to false', () => {
    const schemaWithAutoIndex = new mongoose.Schema({ name: String }, { autoIndex: true });
    const modelName = `TestExplicitAutoIndex_${Date.now()}`;
    const Model = mongoose.model(modelName, schemaWithAutoIndex);

    expect(Model.schema.options.autoIndex).toBe(true);

    suppressionHandle = suppressMongooseAutoIndexAndCreate(mongoose);

    expect(Model.schema.options.autoIndex).toBe(false);
    expect(Model.schema.get('autoIndex')).toBe(false);
    expect(Model.schema.options.autoCreate).toBe(false);
    expect(Model.schema.get('autoCreate')).toBe(false);
  });

  it('suppresses schemas with default autoIndex and autoCreate to false', () => {
    const defaultSchema = new mongoose.Schema({ title: String });
    const modelName = `TestDefaultSchema_${Date.now()}`;
    const Model = mongoose.model(modelName, defaultSchema);

    suppressionHandle = suppressMongooseAutoIndexAndCreate(mongoose);

    expect(Model.schema.options.autoIndex).toBe(false);
    expect(Model.schema.options.autoCreate).toBe(false);
  });

  it('intercepts and suppresses any model registered after suppression is invoked', () => {
    suppressionHandle = suppressMongooseAutoIndexAndCreate(mongoose);

    const futureSchema = new mongoose.Schema({ email: String }, { autoIndex: true });
    const modelName = `TestFutureModel_${Date.now()}`;
    const FutureModel = mongoose.model(modelName, futureSchema);

    expect(FutureModel.schema.options.autoIndex).toBe(false);
    expect(FutureModel.schema.options.autoCreate).toBe(false);
  });

  it('restores original schema options when restore() is called', () => {
    const schema = new mongoose.Schema({ code: String }, { autoIndex: true });
    const modelName = `TestRestoreModel_${Date.now()}`;
    const Model = mongoose.model(modelName, schema);

    suppressionHandle = suppressMongooseAutoIndexAndCreate(mongoose);
    expect(Model.schema.options.autoIndex).toBe(false);

    suppressionHandle.restore();
    suppressionHandle = null;

    expect(Model.schema.options.autoIndex).toBe(true);
  });
});

describe('Guarded Admin Verification Startup Execution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    _resetShutdownStateForTesting();
    process.env.NODE_ENV = ADMIN_VERIFICATION_NODE_ENV;
    process.env.PORT = String(ADMIN_VERIFICATION_PORT);
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${ADMIN_VERIFICATION_DATABASE}`;
    getConfig(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    getConfig(true);
  });

  it('starts verification server with autoIndex and autoCreate suppressed across schemas and connection options', async () => {
    const connectDbSpy = vi
      .spyOn(databaseModule, 'connectDatabase')
      .mockResolvedValue({} as never);
    vi.spyOn(databaseModule, 'getDatabaseDiagnostics').mockReturnValue({
      readyState: 1,
      status: 'connected',
      name: ADMIN_VERIFICATION_DATABASE,
    });
    const seedDefaultRolesSpy = vi.spyOn(RbacService.prototype, 'seedDefaultRoles');

    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        if (cb) cb();
        return mockServer as unknown as Server;
      }),
      closeIdleConnections: vi.fn(),
    } as unknown as Server;

    const mockApp = {
      listen: vi.fn((_port: number, cb?: () => void) => {
        if (cb) cb();
        return mockServer;
      }),
    };
    vi.spyOn(appModule, 'createApp').mockReturnValue(mockApp as never);

    const running = await startAdminVerificationServer({ mode: ADMIN_VERIFICATION_MODE });

    // 1. connectDatabase called with autoIndex: false and autoCreate: false
    expect(connectDbSpy).toHaveBeenCalledTimes(1);
    expect(connectDbSpy).toHaveBeenCalledWith(undefined, {
      autoIndex: false,
      autoCreate: false,
    });

    // 2. seedDefaultRoles is NEVER called
    expect(seedDefaultRolesSpy).not.toHaveBeenCalled();

    // 3. app.listen called on port 5001
    expect(mockApp.listen).toHaveBeenCalledWith(ADMIN_VERIFICATION_PORT, expect.any(Function));
    expect(running.server).toBe(mockServer);

    // Clean up
    vi.spyOn(databaseModule, 'disconnectDatabase').mockResolvedValue();
    await running.close();
  });

  it('fails closed before attempting database connection if guard is invalid', async () => {
    const connectDbSpy = vi.spyOn(databaseModule, 'connectDatabase');

    // Wrong mode
    await expect(
      startAdminVerificationServer({ mode: 'wrong-mode' as never }),
    ).rejects.toThrow(AdminVerificationGuardError);

    // connectDatabase must NOT be called
    expect(connectDbSpy).not.toHaveBeenCalled();
  });

  it('fails closed and disconnects if connected database does not match target', async () => {
    vi.spyOn(databaseModule, 'connectDatabase').mockResolvedValue({} as never);
    vi.spyOn(databaseModule, 'getDatabaseDiagnostics').mockReturnValue({
      readyState: 1,
      status: 'connected',
      name: 'wrong_database',
    });
    const disconnectDbSpy = vi.spyOn(databaseModule, 'disconnectDatabase').mockResolvedValue();

    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        if (cb) cb();
        return mockServer as unknown as Server;
      }),
      closeIdleConnections: vi.fn(),
    } as unknown as Server;

    const mockApp = {
      listen: vi.fn((_port: number, cb?: () => void) => {
        if (cb) cb();
        return mockServer;
      }),
    };
    vi.spyOn(appModule, 'createApp').mockReturnValue(mockApp as never);

    await expect(
      startAdminVerificationServer({ mode: ADMIN_VERIFICATION_MODE }),
    ).rejects.toThrow(AdminVerificationGuardError);

    expect(disconnectDbSpy).toHaveBeenCalledTimes(1);
    expect(mockApp.listen).not.toHaveBeenCalled();
  });

  it('standard startServer preserves existing behavior by calling seedDefaultRoles', async () => {
    const connectDbSpy = vi
      .spyOn(databaseModule, 'connectDatabase')
      .mockResolvedValue({} as never);
    const seedDefaultRolesSpy = vi
      .spyOn(RbacService.prototype, 'seedDefaultRoles')
      .mockResolvedValue({ insertedCount: 0, existingCount: 5 });

    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        if (cb) cb();
        return mockServer as unknown as Server;
      }),
      closeIdleConnections: vi.fn(),
    } as unknown as Server;

    const mockApp = {
      listen: vi.fn((_port: number, cb?: () => void) => {
        if (cb) cb();
        return mockServer;
      }),
    };
    vi.spyOn(appModule, 'createApp').mockReturnValue(mockApp as never);

    const running = await startServer();

    // Normal startup calls connectDatabase without customOptions override
    expect(connectDbSpy).toHaveBeenCalledWith();

    // Normal startup calls seedDefaultRoles
    expect(seedDefaultRolesSpy).toHaveBeenCalledTimes(1);

    vi.spyOn(databaseModule, 'disconnectDatabase').mockResolvedValue();
    await running.close();
  });
});
