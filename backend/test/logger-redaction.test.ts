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

  it('redacts X-Cart-Session-Token, Authorization, Cookie, and commerce session/refresh tokens across headers and nested objects', () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const testLogger = createLogger({ level: 'info' }, stream).child({
      correlationId: 'corr-stage0b-redaction',
    });

    const secrets = {
      guestCartHeader: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      guestCartMixedHeader: 'f1e2d3c4-b5a6-4987-8123-456789abcdef',
      bearerAuth: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig',
      cookieHeader: 'thz_refresh_token=family.secretCookieValue123',
      setCookieHeader: 'thz_refresh_token=family.rotatedCookieValue456; HttpOnly; Path=/api/v1/auth',
      refreshTok: 'fam123.rawRefreshSecret789',
      snakeRefreshTok: 'fam456.snakeRefreshSecret012',
      refreshHash: 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567',
      guestSessionTok: '11111111-2222-4333-8444-555555555555',
      cartSessionTok: '66666666-7777-4888-9999-aaaaaaaaaaaa',
      sessionTok: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      sessionTokHash: 'cafebabe0123456789abcdef0123456789abcdef0123456789abcdef01234567',
      cartTok: 'cart-secret-token-value',
      guestCartTok: 'guest-cart-secret-token-value',
      thzGuestCartTok: 'thz-guest-cart-secret-value',
      thzRefreshCookieVal: 'thz-refresh-cookie-secret',
    };

    testLogger.info(
      {
        req: {
          headers: {
            'x-cart-session-token': secrets.guestCartHeader,
            'X-Cart-Session-Token': secrets.guestCartMixedHeader,
            authorization: secrets.bearerAuth,
            Authorization: secrets.bearerAuth,
            cookie: secrets.cookieHeader,
            Cookie: secrets.cookieHeader,
            'x-correlation-id': 'corr-safe-value',
          },
          cookies: {
            thz_refresh_token: secrets.thzRefreshCookieVal,
          },
        },
        res: {
          headers: {
            'set-cookie': [secrets.setCookieHeader],
          },
        },
        headers: {
          'x-cart-session-token': secrets.guestCartHeader,
          'X-Cart-Session-Token': secrets.guestCartMixedHeader,
          'Set-Cookie': secrets.setCookieHeader,
        },
        payload: {
          refreshToken: secrets.refreshTok,
          refresh_token: secrets.snakeRefreshTok,
          refreshTokenHash: secrets.refreshHash,
          guestSessionToken: secrets.guestSessionTok,
          cartSessionToken: secrets.cartSessionTok,
          sessionToken: secrets.sessionTok,
          sessionTokenHash: secrets.sessionTokHash,
          cartToken: secrets.cartTok,
          guestCartToken: secrets.guestCartTok,
          thz_guest_cart_token: secrets.thzGuestCartTok,
          thz_refresh_token: secrets.thzRefreshCookieVal,
          pincode: '560001',
        },
        'x-cart-session-token': secrets.guestCartHeader,
        'X-Cart-Session-Token': secrets.guestCartMixedHeader,
        guestSessionToken: secrets.guestSessionTok,
        cartSessionToken: secrets.cartSessionTok,
        sessionToken: secrets.sessionTok,
      },
      'Commerce transport event',
    );

    expect(logs.length).toBe(1);
    const rawLogLine = logs[0]!;
    const parsedLog = JSON.parse(rawLogLine);

    // Verify no raw secret values ever appear anywhere in the serialized log line
    for (const secretValue of Object.values(secrets)) {
      expect(rawLogLine).not.toContain(secretValue);
    }

    // Verify structured redaction markers
    expect(parsedLog.req.headers['x-cart-session-token']).toBe('[REDACTED]');
    expect(parsedLog.req.headers['X-Cart-Session-Token']).toBe('[REDACTED]');
    expect(parsedLog.req.headers.authorization).toBe('[REDACTED]');
    expect(parsedLog.req.headers.Authorization).toBe('[REDACTED]');
    expect(parsedLog.req.headers.cookie).toBe('[REDACTED]');
    expect(parsedLog.req.headers.Cookie).toBe('[REDACTED]');
    expect(parsedLog.req.headers['x-correlation-id']).toBe('corr-safe-value');
    expect(parsedLog.req.cookies).toBe('[REDACTED]');
    expect(parsedLog.res.headers['set-cookie']).toBe('[REDACTED]');
    expect(parsedLog.headers['x-cart-session-token']).toBe('[REDACTED]');
    expect(parsedLog.headers['X-Cart-Session-Token']).toBe('[REDACTED]');
    expect(parsedLog.headers['Set-Cookie']).toBe('[REDACTED]');
    expect(parsedLog.payload.refreshToken).toBe('[REDACTED]');
    expect(parsedLog.payload.refresh_token).toBe('[REDACTED]');
    expect(parsedLog.payload.refreshTokenHash).toBe('[REDACTED]');
    expect(parsedLog.payload.guestSessionToken).toBe('[REDACTED]');
    expect(parsedLog.payload.cartSessionToken).toBe('[REDACTED]');
    expect(parsedLog.payload.sessionToken).toBe('[REDACTED]');
    expect(parsedLog.payload.sessionTokenHash).toBe('[REDACTED]');
    expect(parsedLog.payload.cartToken).toBe('[REDACTED]');
    expect(parsedLog.payload.guestCartToken).toBe('[REDACTED]');
    expect(parsedLog.payload.thz_guest_cart_token).toBe('[REDACTED]');
    expect(parsedLog.payload.thz_refresh_token).toBe('[REDACTED]');
    expect(parsedLog.payload.pincode).toBe('560001');
    expect(parsedLog['x-cart-session-token']).toBe('[REDACTED]');
    expect(parsedLog['X-Cart-Session-Token']).toBe('[REDACTED]');
    expect(parsedLog.guestSessionToken).toBe('[REDACTED]');
    expect(parsedLog.cartSessionToken).toBe('[REDACTED]');
    expect(parsedLog.sessionToken).toBe('[REDACTED]');
  });
});
