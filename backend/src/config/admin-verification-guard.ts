/**
 * Dedicated guard constants and validation rules for Admin Verification runtime.
 *
 * This guard ensures that the backend can connect to the isolated verification
 * database (`thehomez_admin_verify`) on port 5001 without performing any
 * automatic database writes, role seeding, or schema index creation.
 */
import { URL } from 'node:url';
import mongoose, { type Mongoose } from 'mongoose';

export const ADMIN_VERIFICATION_DATABASE = 'thehomez_admin_verify';
export const ADMIN_VERIFICATION_PORT = 5001;
export const ADMIN_VERIFICATION_NODE_ENV = 'development';
export const ADMIN_VERIFICATION_MODE = 'admin-verification';

export class AdminVerificationGuardError extends Error {
  constructor(message: string) {
    super(`[admin-verification-guard] ${message}`);
    this.name = 'AdminVerificationGuardError';
  }
}

export interface GuardedAdminVerificationOptions {
  readonly mode: typeof ADMIN_VERIFICATION_MODE;
}

export interface AdminVerificationValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates the verification runtime environment against strict fail-closed constraints:
 * - NODE_ENV must be strictly 'development'
 * - PORT must be strictly '5001'
 * - MONGODB_URI must be present and parseable
 * - Protocol must be 'mongodb:' or 'mongodb+srv:'
 * - Pathname must be strictly '/thehomez_admin_verify'
 * - Search params must not override dbname with any other database
 */
export function validateAdminVerificationEnvironment(
  env: Record<string, string | undefined> = process.env,
): AdminVerificationValidationResult {
  if (env.NODE_ENV !== ADMIN_VERIFICATION_NODE_ENV) {
    return {
      valid: false,
      reason: `NODE_ENV must be '${ADMIN_VERIFICATION_NODE_ENV}', received '${env.NODE_ENV}'`,
    };
  }

  if (env.PORT !== String(ADMIN_VERIFICATION_PORT)) {
    return {
      valid: false,
      reason: `PORT must be '${ADMIN_VERIFICATION_PORT}', received '${env.PORT}'`,
    };
  }

  const mongoUri = env.MONGODB_URI;
  if (!mongoUri || typeof mongoUri !== 'string' || !mongoUri.trim()) {
    return { valid: false, reason: 'MONGODB_URI is required and cannot be empty' };
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    return { valid: false, reason: 'MONGODB_URI is not a valid URL' };
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol)) {
    return {
      valid: false,
      reason: `MONGODB_URI protocol must be mongodb: or mongodb+srv:, received '${parsedUri.protocol}'`,
    };
  }

  if (parsedUri.pathname !== `/${ADMIN_VERIFICATION_DATABASE}`) {
    return {
      valid: false,
      reason: `MONGODB_URI database path must be '/${ADMIN_VERIFICATION_DATABASE}', received '${parsedUri.pathname}'`,
    };
  }

  for (const [name, value] of parsedUri.searchParams) {
    if (name.toLowerCase() === 'dbname' && value !== ADMIN_VERIFICATION_DATABASE) {
      return {
        valid: false,
        reason: `MONGODB_URI dbname parameter conflicts with target database: '${value}'`,
      };
    }
  }

  return { valid: true };
}

/**
 * Asserts that the verification guard options and environment pass all fail-closed criteria.
 * Throws AdminVerificationGuardError if any condition is not met.
 */
export function assertAdminVerificationGuard(
  guard: unknown,
  env: Record<string, string | undefined> = process.env,
): asserts guard is GuardedAdminVerificationOptions {
  if (
    !guard ||
    typeof guard !== 'object' ||
    (guard as GuardedAdminVerificationOptions).mode !== ADMIN_VERIFICATION_MODE
  ) {
    throw new AdminVerificationGuardError(
      `Explicit verification startup mode '${ADMIN_VERIFICATION_MODE}' must be provided`,
    );
  }

  const validation = validateAdminVerificationEnvironment(env);
  if (!validation.valid) {
    throw new AdminVerificationGuardError(validation.reason ?? 'Configuration validation failed');
  }
}

/**
 * Asserts that the connected database diagnostics match the isolated target database.
 * Throws AdminVerificationGuardError if not connected or database name mismatch.
 */
export function assertConnectedAdminVerificationDatabase(
  diagnostics?: { status?: string; name?: string },
): void {
  if (
    !diagnostics ||
    diagnostics.status !== 'connected' ||
    diagnostics.name !== ADMIN_VERIFICATION_DATABASE
  ) {
    throw new AdminVerificationGuardError(
      `Connected database must be '${ADMIN_VERIFICATION_DATABASE}' with status 'connected', received '${diagnostics?.name}' (${diagnostics?.status})`,
    );
  }
}

export interface MongooseIndexSuppressionHandle {
  readonly suppressedCount: number;
  readonly restore: () => void;
}

/**
 * Genuinely suppresses automatic index creation (`autoIndex`) and automatic
 * collection creation (`autoCreate`) across all currently registered and future
 * Mongoose model schemas on the specified Mongoose instance.
 *
 * Rationale:
 * In Mongoose 8, `utils.getOption('autoIndex', schema.options, conn.config, ...)`
 * inspects `schema.options` with highest precedence. Passing `{ autoIndex: false }`
 * to `mongoose.connect()` is overridden by any model schema that hardcodes
 * `{ autoIndex: true }`. This function directly overrides `autoIndex` and `autoCreate`
 * on all model schemas before connection is opened, and hooks `mongoose.model` to intercept
 * any subsequent model compilation.
 */
export function suppressMongooseAutoIndexAndCreate(
  mongooseInstance: Mongoose = mongoose,
): MongooseIndexSuppressionHandle {
  const originalAutoIndex = mongooseInstance.get('autoIndex');
  const originalAutoCreate = mongooseInstance.get('autoCreate');
  mongooseInstance.set('autoIndex', false);
  mongooseInstance.set('autoCreate', false);

  const originalSchemaSettings = new Map<
    string,
    { autoIndex?: boolean; autoCreate?: boolean }
  >();

  // 1. Suppress on all currently registered models
  for (const modelName of mongooseInstance.modelNames()) {
    try {
      const model = mongooseInstance.model(modelName);
      if (model?.schema) {
        originalSchemaSettings.set(modelName, {
          autoIndex: model.schema.options.autoIndex,
          autoCreate: model.schema.options.autoCreate,
        });
        model.schema.set('autoIndex', false);
        model.schema.set('autoCreate', false);
        model.schema.options.autoIndex = false;
        model.schema.options.autoCreate = false;
      }
    } catch {
      // Model resolution error ignored
    }
  }

  // 2. Intercept future model compilation on this Mongoose instance
  const originalModelFn = mongooseInstance.model.bind(mongooseInstance);
  (mongooseInstance as any).model = function (
    name: string,
    schema?: any,
    collection?: string,
    skipInit?: boolean,
  ) {
    if (schema) {
      schema.set('autoIndex', false);
      schema.set('autoCreate', false);
      schema.options.autoIndex = false;
      schema.options.autoCreate = false;
    }
    return (originalModelFn as any)(name, schema, collection, skipInit);
  };

  return {
    suppressedCount: originalSchemaSettings.size,
    restore: () => {
      mongooseInstance.set('autoIndex', originalAutoIndex);
      mongooseInstance.set('autoCreate', originalAutoCreate);
      (mongooseInstance as any).model = originalModelFn;

      for (const [modelName, settings] of originalSchemaSettings.entries()) {
        try {
          const model = mongooseInstance.model(modelName);
          if (model?.schema) {
            model.schema.set('autoIndex', settings.autoIndex);
            model.schema.set('autoCreate', settings.autoCreate);
            model.schema.options.autoIndex = settings.autoIndex;
            model.schema.options.autoCreate = settings.autoCreate;
          }
        } catch {
          // Model resolution error ignored
        }
      }
    },
  };
}
