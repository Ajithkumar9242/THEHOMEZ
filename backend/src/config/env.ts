import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file if present
dotenv.config();

const durationRegex = /^(\d+)(s|m|h|d)$/;

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z
      .preprocess(
        (val) => {
          if (typeof val === 'string' && val.trim().length > 0) {
            const parsed = Number(val);
            return Number.isNaN(parsed) ? val : parsed;
          }
          return val;
        },
        z
          .number({ message: 'PORT must be an integer' })
          .int({ message: 'PORT must be an integer' })
          .min(1, { message: 'PORT must be at least 1' })
          .max(65535, { message: 'PORT must not exceed 65535' }),
      )
      .default(5000),
    API_PREFIX: z
      .string()
      .regex(/^\/[a-zA-Z0-9_\-/]*$/, {
        message: 'API_PREFIX must start with / and be a valid URI path segment',
      })
      .default('/api/v1'),
    CORS_ORIGIN: z.string().optional(),
    MONGODB_URI: z.string().optional(),
    MONGODB_MIN_POOL_SIZE: z.coerce
      .number()
      .int()
      .min(0, { message: 'MONGODB_MIN_POOL_SIZE must be >= 0' })
      .default(0),
    MONGODB_MAX_POOL_SIZE: z.coerce
      .number()
      .int()
      .min(1, { message: 'MONGODB_MAX_POOL_SIZE must be >= 1' })
      .default(10),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100, { message: 'MONGODB_SERVER_SELECTION_TIMEOUT_MS must be >= 100' })
      .default(5000),
    MONGODB_SOCKET_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000, { message: 'MONGODB_SOCKET_TIMEOUT_MS must be >= 1000' })
      .default(45000),
    MONGODB_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500, { message: 'MONGODB_CONNECT_TIMEOUT_MS must be >= 500' })
      .default(10000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),

    // Milestone 3: Authentication & Token Management
    // Access token is a signed JWT; Refresh token is an opaque cryptographically random string stored as SHA-256 hash.
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
      .optional(),
    JWT_ACCESS_EXPIRES_IN: z
      .string()
      .regex(durationRegex, {
        message: 'JWT_ACCESS_EXPIRES_IN must be a valid duration (e.g. 15m, 1h, 7d)',
      })
      .default('15m'),
    REFRESH_TOKEN_EXPIRES_IN: z
      .string()
      .regex(durationRegex, {
        message: 'REFRESH_TOKEN_EXPIRES_IN must be a valid duration (e.g. 7d, 30d)',
      })
      .default('7d'),

    // Milestone 3: OTP Authentication & Provider
    OTP_PEPPER_SECRET: z
      .string()
      .min(32, { message: 'OTP_PEPPER_SECRET must be at least 32 characters' })
      .optional(),
    OTP_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30, { message: 'OTP_TTL_SECONDS must be >= 30 seconds' })
      .max(900, { message: 'OTP_TTL_SECONDS must be <= 900 seconds (15 minutes)' })
      .default(300),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .min(10, { message: 'OTP_RESEND_COOLDOWN_SECONDS must be >= 10 seconds' })
      .max(300, { message: 'OTP_RESEND_COOLDOWN_SECONDS must be <= 300 seconds (5 minutes)' })
      .default(60),
    OTP_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1, { message: 'OTP_MAX_ATTEMPTS must be >= 1' })
      .max(10, { message: 'OTP_MAX_ATTEMPTS must be <= 10' })
      .default(3),
    OTP_PROVIDER: z.enum(['mock', 'msg91']).default('mock'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),

    // Milestone 3: Rate Limiting
    // In-memory rate limiting is suitable ONLY for single-process development/testing.
    // Multi-instance / clustered production deployments MUST configure a shared distributed store (e.g. Redis).
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000, { message: 'RATE_LIMIT_WINDOW_MS must be >= 1000ms' })
      .default(900000), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .min(1, { message: 'RATE_LIMIT_MAX_REQUESTS must be >= 1' })
      .default(100),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .min(1, { message: 'AUTH_RATE_LIMIT_MAX_REQUESTS must be >= 1' })
      .default(10),
  })
  .superRefine((data, ctx) => {
    // In production, MONGODB_URI and CORS_ORIGIN are mandatory
    if (data.NODE_ENV === 'production') {
      if (!data.MONGODB_URI || data.MONGODB_URI.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_URI'],
          message: 'MONGODB_URI is strictly required in production environment',
        });
      }
      if (!data.CORS_ORIGIN || data.CORS_ORIGIN.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN is strictly required in production environment',
        });
      }

      // Production strictly requires dedicated high-entropy secrets
      if (!data.JWT_ACCESS_SECRET || data.JWT_ACCESS_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET is strictly required in production environment',
        });
      }
      if (!data.OTP_PEPPER_SECRET || data.OTP_PEPPER_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_PEPPER_SECRET'],
          message: 'OTP_PEPPER_SECRET is strictly required in production environment',
        });
      }

      // In production, mock OTP provider is strictly prohibited
      if (data.OTP_PROVIDER === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_PROVIDER'],
          message: 'Mock OTP provider is not permitted in production environment',
        });
      }
    }

    // Secret uniqueness: JWT access secret and OTP pepper secret must never be identical
    const accessSecret = data.JWT_ACCESS_SECRET;
    const otpPepperSecret = data.OTP_PEPPER_SECRET;

    if (accessSecret && otpPepperSecret && accessSecret === otpPepperSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_PEPPER_SECRET'],
        message: 'OTP_PEPPER_SECRET must be distinct from JWT_ACCESS_SECRET',
      });
    }

    // MSG91 provider requires valid credentials
    if (data.OTP_PROVIDER === 'msg91') {
      if (!data.MSG91_AUTH_KEY || data.MSG91_AUTH_KEY.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MSG91_AUTH_KEY'],
          message: 'MSG91_AUTH_KEY is strictly required when OTP_PROVIDER is msg91',
        });
      }
      if (!data.MSG91_TEMPLATE_ID || data.MSG91_TEMPLATE_ID.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MSG91_TEMPLATE_ID'],
          message: 'MSG91_TEMPLATE_ID is strictly required when OTP_PROVIDER is msg91',
        });
      }
    }

    // Pool configuration check
    if (data.MONGODB_MIN_POOL_SIZE > data.MONGODB_MAX_POOL_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGODB_MIN_POOL_SIZE'],
        message: 'MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE',
      });
    }

    // OTP cooldown must not exceed OTP TTL
    if (data.OTP_RESEND_COOLDOWN_SECONDS > data.OTP_TTL_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_RESEND_COOLDOWN_SECONDS'],
        message: 'OTP_RESEND_COOLDOWN_SECONDS cannot exceed OTP_TTL_SECONDS',
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  mongodb: {
    uri: string;
    minPoolSize: number;
    maxPoolSize: number;
    serverSelectionTimeoutMS: number;
    socketTimeoutMS: number;
    connectTimeoutMS: number;
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  };
  auth: {
    jwt: {
      accessSecret: string;
      accessExpiresIn: string;
    };
    refreshToken: {
      expiresIn: string;
    };
    otp: {
      pepperSecret: string;
      ttlSeconds: number;
      resendCooldownSeconds: number;
      maxAttempts: number;
      provider: 'mock' | 'msg91';
      msg91?: {
        authKey: string;
        templateId: string;
      };
    };
    rateLimit: {
      windowMs: number;
      maxRequests: number;
      authMaxRequests: number;
    };
  };
}

/**
 * Validates and transforms an environment record into a strongly-typed AppConfig.
 * Does NOT call process.exit() so that unit tests can verify invalid configurations cleanly.
 */
export function validateConfig(rawEnv: Record<string, unknown> = process.env): AppConfig {
  const result = rawEnvSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment configuration validation failed:\n${errorDetails}`);
  }

  const { data } = result;

  // Process CORS origins
  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
  ];

  const parsedCorsOrigins: string[] = data.CORS_ORIGIN
    ? data.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : data.NODE_ENV === 'production'
      ? []
      : defaultDevOrigins;

  // Process MongoDB URI default based on environment
  const defaultDevUri = 'mongodb://127.0.0.1:27017/thehomez?replicaSet=rs0&directConnection=true';
  const mongoUri =
    data.MONGODB_URI && data.MONGODB_URI.trim().length > 0
      ? data.MONGODB_URI.trim()
      : defaultDevUri;

  // Distinct dev/test fallback secrets (>= 32 characters, unique, safe for dev and test)
  const defaultDevJwtAccessSecret = 'dev_thehomez_jwt_access_secret_min_32_characters_1234!';
  const defaultDevOtpPepperSecret = 'dev_thehomez_otp_pepper_secret_min_32_characters_9012!';

  const jwtAccessSecret =
    data.JWT_ACCESS_SECRET && data.JWT_ACCESS_SECRET.trim().length > 0
      ? data.JWT_ACCESS_SECRET.trim()
      : defaultDevJwtAccessSecret;

  const otpPepperSecret =
    data.OTP_PEPPER_SECRET && data.OTP_PEPPER_SECRET.trim().length > 0
      ? data.OTP_PEPPER_SECRET.trim()
      : defaultDevOtpPepperSecret;

  return {
    nodeEnv: data.NODE_ENV,
    isProduction: data.NODE_ENV === 'production',
    isDevelopment: data.NODE_ENV === 'development',
    isTest: data.NODE_ENV === 'test',
    port: data.PORT,
    apiPrefix: data.API_PREFIX,
    corsOrigins: parsedCorsOrigins,
    mongodb: {
      uri: mongoUri,
      minPoolSize: data.MONGODB_MIN_POOL_SIZE,
      maxPoolSize: data.MONGODB_MAX_POOL_SIZE,
      serverSelectionTimeoutMS: data.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: data.MONGODB_SOCKET_TIMEOUT_MS,
      connectTimeoutMS: data.MONGODB_CONNECT_TIMEOUT_MS,
    },
    logging: {
      level: data.LOG_LEVEL ?? (data.NODE_ENV === 'test' ? 'silent' : 'info'),
    },
    auth: {
      jwt: {
        accessSecret: jwtAccessSecret,
        accessExpiresIn: data.JWT_ACCESS_EXPIRES_IN,
      },
      refreshToken: {
        expiresIn: data.REFRESH_TOKEN_EXPIRES_IN,
      },
      otp: {
        pepperSecret: otpPepperSecret,
        ttlSeconds: data.OTP_TTL_SECONDS,
        resendCooldownSeconds: data.OTP_RESEND_COOLDOWN_SECONDS,
        maxAttempts: data.OTP_MAX_ATTEMPTS,
        provider: data.OTP_PROVIDER,
        ...(data.OTP_PROVIDER === 'msg91' && data.MSG91_AUTH_KEY && data.MSG91_TEMPLATE_ID
          ? {
              msg91: {
                authKey: data.MSG91_AUTH_KEY,
                templateId: data.MSG91_TEMPLATE_ID,
              },
            }
          : {}),
      },
      rateLimit: {
        windowMs: data.RATE_LIMIT_WINDOW_MS,
        maxRequests: data.RATE_LIMIT_MAX_REQUESTS,
        authMaxRequests: data.AUTH_RATE_LIMIT_MAX_REQUESTS,
      },
    },
  };
}

let cachedConfig: AppConfig | null = null;

/**
 * Returns the singleton application configuration for the running process.
 * Can be reset or reloaded in tests by passing reload=true.
 */
export function getConfig(reload = false): AppConfig {
  if (!cachedConfig || reload) {
    cachedConfig = validateConfig(process.env);
  }
  return cachedConfig;
}
