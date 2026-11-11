import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('parses valid environment with default values', () => {
    const config = validateConfig({
      NODE_ENV: 'development',
    });

    expect(config.nodeEnv).toBe('development');
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(5000);
    expect(config.apiPrefix).toBe('/api/v1');
    expect(config.mongodb.minPoolSize).toBe(0);
    expect(config.mongodb.maxPoolSize).toBe(10);
    expect(config.mongodb.serverSelectionTimeoutMS).toBe(5000);
    expect(config.logging.level).toBe('info');
    expect(config.corsOrigins).toContain('http://localhost:3000');

    // Milestone 3: Auth & Identity defaults in development
    expect(config.auth.jwt.accessExpiresIn).toBe('15m');
    expect(config.auth.refreshToken.expiresIn).toBe('7d');
    expect(config.auth.jwt.accessSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.auth.otp.pepperSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.auth.otp.ttlSeconds).toBe(300);
    expect(config.auth.otp.resendCooldownSeconds).toBe(60);
    expect(config.auth.otp.maxAttempts).toBe(3);
    expect(config.auth.otp.provider).toBe('mock');
    expect(config.auth.rateLimit.windowMs).toBe(900000);
    expect(config.auth.rateLimit.maxRequests).toBe(100);
    expect(config.auth.rateLimit.authMaxRequests).toBe(10);
  });

  it('allows valid TCP ports below 1024 without restricting to 1024-65535', () => {
    const configPort80 = validateConfig({
      PORT: '80',
    });
    expect(configPort80.port).toBe(80);

    const configPort443 = validateConfig({
      PORT: '443',
    });
    expect(configPort443.port).toBe(443);

    const configPort65535 = validateConfig({
      PORT: '65535',
    });
    expect(configPort65535.port).toBe(65535);
  });

  it('rejects invalid ports without terminating test runner process', () => {
    expect(() =>
      validateConfig({
        PORT: '0',
      }),
    ).toThrow(/PORT must be at least 1/);

    expect(() =>
      validateConfig({
        PORT: '-5',
      }),
    ).toThrow(/PORT must be at least 1/);

    expect(() =>
      validateConfig({
        PORT: '70000',
      }),
    ).toThrow(/PORT must not exceed 65535/);

    expect(() =>
      validateConfig({
        PORT: 'invalid-port',
      }),
    ).toThrow(/PORT must be an integer/);
  });

  it('strictly requires MONGODB_URI and CORS_ORIGIN in production', () => {
    expect(() =>
      validateConfig({
        NODE_ENV: 'production',
        PORT: '8080',
      }),
    ).toThrow(/MONGODB_URI is strictly required in production environment/);

    expect(() =>
      validateConfig({
        NODE_ENV: 'production',
        PORT: '8080',
        MONGODB_URI: 'mongodb://prod-cluster.mongodb.net/thehomez',
      }),
    ).toThrow(/CORS_ORIGIN is strictly required in production environment/);
  });

  it('strictly validates production secrets, provider, and credentials', () => {
    const validProdBase = {
      NODE_ENV: 'production',
      PORT: '8080',
      MONGODB_URI: 'mongodb://prod-cluster.mongodb.net/thehomez',
      CORS_ORIGIN: 'https://thehomez.com,https://admin.thehomez.com',
    };

    // Missing JWT_ACCESS_SECRET in production
    expect(() =>
      validateConfig({
        ...validProdBase,
        OTP_PEPPER_SECRET: 'production_otp_pepper_secret_min_32_chars_long_2',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'auth_key_123',
        MSG91_TEMPLATE_ID: 'template_id_456',
      }),
    ).toThrow(/JWT_ACCESS_SECRET is strictly required in production environment/);

    // Missing OTP_PEPPER_SECRET in production
    expect(() =>
      validateConfig({
        ...validProdBase,
        JWT_ACCESS_SECRET: 'production_access_secret_min_32_chars_long_0',
        OTP_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'auth_key_123',
        MSG91_TEMPLATE_ID: 'template_id_456',
      }),
    ).toThrow(/OTP_PEPPER_SECRET is strictly required in production environment/);

    // Mock OTP provider strictly rejected in production
    expect(() =>
      validateConfig({
        ...validProdBase,
        JWT_ACCESS_SECRET: 'production_access_secret_min_32_chars_long_0',
        OTP_PEPPER_SECRET: 'production_otp_pepper_secret_min_32_chars_long_2',
        OTP_PROVIDER: 'mock',
      }),
    ).toThrow(/Mock OTP provider is not permitted in production environment/);

    // MSG91 provider requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID
    expect(() =>
      validateConfig({
        ...validProdBase,
        JWT_ACCESS_SECRET: 'production_access_secret_min_32_chars_long_0',
        OTP_PEPPER_SECRET: 'production_otp_pepper_secret_min_32_chars_long_2',
        OTP_PROVIDER: 'msg91',
      }),
    ).toThrow(/MSG91_AUTH_KEY is strictly required when OTP_PROVIDER is msg91/);

    // Successful valid production configuration
    const validProd = validateConfig({
      ...validProdBase,
      JWT_ACCESS_SECRET: 'production_access_secret_min_32_chars_long_0',
      OTP_PEPPER_SECRET: 'production_otp_pepper_secret_min_32_chars_long_2',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'valid_auth_key_123',
      MSG91_TEMPLATE_ID: 'valid_template_456',
    });

    expect(validProd.isProduction).toBe(true);
    expect(validProd.corsOrigins).toEqual(['https://thehomez.com', 'https://admin.thehomez.com']);
    expect(validProd.auth.jwt.accessSecret).toBe('production_access_secret_min_32_chars_long_0');
    expect(validProd.auth.otp.provider).toBe('msg91');
    expect(validProd.auth.otp.msg91?.authKey).toBe('valid_auth_key_123');
    expect(validProd.auth.otp.msg91?.templateId).toBe('valid_template_456');
  });

  it('enforces secret uniqueness between JWT access secret and OTP pepper secret', () => {
    const duplicateSecret = 'identical_secret_used_for_everything_min_32_chars_!';

    // Access secret === OTP pepper secret
    expect(() =>
      validateConfig({
        JWT_ACCESS_SECRET: duplicateSecret,
        OTP_PEPPER_SECRET: duplicateSecret,
      }),
    ).toThrow(/OTP_PEPPER_SECRET must be distinct from JWT_ACCESS_SECRET/);
  });

  it('validates secret strength when secrets are explicitly provided', () => {
    expect(() =>
      validateConfig({
        JWT_ACCESS_SECRET: 'short_secret',
      }),
    ).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters/);

    expect(() =>
      validateConfig({
        OTP_PEPPER_SECRET: 'short_secret',
      }),
    ).toThrow(/OTP_PEPPER_SECRET must be at least 32 characters/);
  });

  it('validates token duration formats', () => {
    expect(() =>
      validateConfig({
        JWT_ACCESS_EXPIRES_IN: 'invalid-duration',
      }),
    ).toThrow(/JWT_ACCESS_EXPIRES_IN must be a valid duration/);

    expect(() =>
      validateConfig({
        REFRESH_TOKEN_EXPIRES_IN: '999xyz',
      }),
    ).toThrow(/REFRESH_TOKEN_EXPIRES_IN must be a valid duration/);

    const validDurations = validateConfig({
      JWT_ACCESS_EXPIRES_IN: '30m',
      REFRESH_TOKEN_EXPIRES_IN: '14d',
    });
    expect(validDurations.auth.jwt.accessExpiresIn).toBe('30m');
    expect(validDurations.auth.refreshToken.expiresIn).toBe('14d');
  });

  it('validates OTP lifecycle parameters and cooldown rules', () => {
    // Cooldown cannot exceed TTL
    expect(() =>
      validateConfig({
        OTP_TTL_SECONDS: '60',
        OTP_RESEND_COOLDOWN_SECONDS: '120',
      }),
    ).toThrow(/OTP_RESEND_COOLDOWN_SECONDS cannot exceed OTP_TTL_SECONDS/);

    // Out-of-bounds TTL
    expect(() =>
      validateConfig({
        OTP_TTL_SECONDS: '20', // min 30
      }),
    ).toThrow(/OTP_TTL_SECONDS must be >= 30 seconds/);

    expect(() =>
      validateConfig({
        OTP_TTL_SECONDS: '1000', // max 900
      }),
    ).toThrow(/OTP_TTL_SECONDS must be <= 900 seconds/);

    // Out-of-bounds max attempts
    expect(() =>
      validateConfig({
        OTP_MAX_ATTEMPTS: '0',
      }),
    ).toThrow(/OTP_MAX_ATTEMPTS must be >= 1/);

    expect(() =>
      validateConfig({
        OTP_MAX_ATTEMPTS: '15',
      }),
    ).toThrow(/OTP_MAX_ATTEMPTS must be <= 10/);
  });

  it('rejects invalid pool configuration when minPoolSize > maxPoolSize', () => {
    expect(() =>
      validateConfig({
        MONGODB_MIN_POOL_SIZE: '20',
        MONGODB_MAX_POOL_SIZE: '10',
      }),
    ).toThrow(/MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE/);
  });

  it('rejects invalid log level', () => {
    expect(() =>
      validateConfig({
        LOG_LEVEL: 'verbose-unsupported',
      }),
    ).toThrow(/Invalid option|Invalid enum value/);
  });

  it('validates rate limit configurations', () => {
    expect(() =>
      validateConfig({
        RATE_LIMIT_WINDOW_MS: '500', // min 1000
      }),
    ).toThrow(/RATE_LIMIT_WINDOW_MS must be >= 1000ms/);

    expect(() =>
      validateConfig({
        RATE_LIMIT_MAX_REQUESTS: '0',
      }),
    ).toThrow(/RATE_LIMIT_MAX_REQUESTS must be >= 1/);

    expect(() =>
      validateConfig({
        AUTH_RATE_LIMIT_MAX_REQUESTS: '0',
      }),
    ).toThrow(/AUTH_RATE_LIMIT_MAX_REQUESTS must be >= 1/);

    expect(() =>
      validateConfig({
        OTP_IP_RATE_LIMIT_MAX_REQUESTS: '0',
      }),
    ).toThrow(/OTP_IP_RATE_LIMIT_MAX_REQUESTS must be >= 1/);

    const defaultConfig = validateConfig({ NODE_ENV: 'development' });
    expect(defaultConfig.auth.rateLimit.authMaxRequests).toBe(10);
    expect(defaultConfig.auth.rateLimit.otpIpMaxRequests).toBe(25);
  });

  it('configures trust proxy safely by environment and explicit TRUST_PROXY override', () => {
    const devConfig = validateConfig({ NODE_ENV: 'development' });
    expect(devConfig.trustProxy).toBe(false);

    const testConfig = validateConfig({ NODE_ENV: 'test' });
    expect(testConfig.trustProxy).toBe(false);

    const prodConfig = validateConfig({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://prod-cluster.mongodb.net/thehomez',
      CORS_ORIGIN: 'https://thehomez.com',
      JWT_ACCESS_SECRET: 'production_access_secret_min_32_chars_long_0',
      OTP_PEPPER_SECRET: 'production_otp_pepper_secret_min_32_chars_long_2',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'valid_auth_key_123',
      MSG91_TEMPLATE_ID: 'valid_template_456',
    });
    expect(prodConfig.trustProxy).toBe(1);

    expect(validateConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(validateConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(validateConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });
});
