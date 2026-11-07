import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, REDACT_PATHS } from '../src/logger/logger.js';
import { sanitizeMongoUri } from '../src/database/database.js';

describe('Pino Logger Sensitive Data Redaction', () => {
  it('has comprehensive redact paths configured', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('password');
    expect(REDACT_PATHS).toContain('otp');
    expect(REDACT_PATHS).toContain('accessToken');
    expect(REDACT_PATHS).toContain('refreshToken');
    expect(REDACT_PATHS).toContain('cardNumber');
    expect(REDACT_PATHS).toContain('cvv');
    expect(REDACT_PATHS).toContain('MONGODB_URI');
  });

  it('redacts sensitive fields in log payloads', async () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const testLogger = createLogger({ level: 'info' }, stream);

    testLogger.info(
      {
        authorization: 'Bearer secret-jwt-token-12345',
        password: 'SuperSecretPassword123!',
        otp: '123456',
        accessToken: 'access-token-abc',
        refreshToken: 'refresh-token-xyz',
        cardNumber: '4111111111111111',
        cvv: '123',
        MONGODB_URI: 'mongodb://user:pass@cluster0.mongodb.net/thehomez',
        safeMetadata: 'public-data',
      },
      'User operation processed',
    );

    expect(logs.length).toBeGreaterThan(0);
    const parsedLog = JSON.parse(logs[0]!);

    expect(parsedLog.authorization).toBe('[REDACTED]');
    expect(parsedLog.password).toBe('[REDACTED]');
    expect(parsedLog.otp).toBe('[REDACTED]');
    expect(parsedLog.accessToken).toBe('[REDACTED]');
    expect(parsedLog.refreshToken).toBe('[REDACTED]');
    expect(parsedLog.cardNumber).toBe('[REDACTED]');
    expect(parsedLog.cvv).toBe('[REDACTED]');
    expect(parsedLog.MONGODB_URI).toBe('[REDACTED]');
    expect(parsedLog.safeMetadata).toBe('public-data');
  });

  it('sanitizes MongoDB URIs with embedded credentials', () => {
    const rawUriWithCredentials =
      'mongodb://app_user:s3cr3t_p@ssw0rd@cluster0.mongodb.net:27017/thehomez?replicaSet=rs0';
    const sanitized = sanitizeMongoUri(rawUriWithCredentials);

    expect(sanitized).not.toContain('s3cr3t_p@ssw0rd');
    expect(sanitized).not.toContain('app_user');
    expect(sanitized).toContain('//***:***@cluster0.mongodb.net:27017/thehomez');
  });
});
