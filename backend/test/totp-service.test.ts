import { describe, expect, it } from 'vitest';
import {
  TotpService,
  base32Encode,
  base32Decode,
} from '../src/services/auth/totp.service.js';

describe('TotpService & Base32 Utilities', () => {
  describe('Base32 encoding and decoding', () => {
    it('encodes and decodes ascii strings symmetrically', () => {
      const inputs = [
        'Hello World',
        'TheHomez Admin MFA',
        'RFC 6238 compliance test',
        '12345678901234567890',
      ];

      for (const input of inputs) {
        const encoded = base32Encode(Buffer.from(input, 'utf8'));
        const decoded = base32Decode(encoded).toString('utf8');
        expect(decoded).toBe(input);
      }
    });

    it('handles decoding with spaces and lowercase characters', () => {
      const secret = 'JBSWY3DPEHPK3PXP'; // Base32 for "Hello!\xde\xad\xbe\xef"
      const withFormatting = 'jbsw y3dp-ehpk 3pxp';
      expect(base32Decode(withFormatting)).toEqual(base32Decode(secret));
    });

    it('throws on invalid base32 characters', () => {
      expect(() => base32Decode('INVALID!@#')).toThrow('Invalid Base32 character');
    });
  });

  describe('RFC 6238 Official Test Vectors (SHA1, 30s step, 6 digits)', () => {
    // RFC 6238 Appendix B test secret: "12345678901234567890" (ASCII, 20 bytes)
    // Base32 representation: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'utf8'));
    const totp = new TotpService(30, 6);

    const testVectors = [
      { timeSeconds: 59, expected: '287082' },
      { timeSeconds: 1111111109, expected: '081804' },
      { timeSeconds: 1111111111, expected: '050471' },
      { timeSeconds: 1234567890, expected: '005924' },
      { timeSeconds: 2000000000, expected: '279037' },
    ];

    for (const { timeSeconds, expected } of testVectors) {
      it(`generates ${expected} for timestamp ${timeSeconds}s`, () => {
        const code = totp.generateTotp(rfcSecret, timeSeconds * 1000);
        expect(code).toBe(expected);
      });
    }
  });

  describe('TOTP Verification with drift tolerance', () => {
    const totp = new TotpService(30, 6);
    const secret = totp.generateSecret();

    it('verifies valid code at exact current time (delta 0)', () => {
      const now = 1700000000000;
      const code = totp.generateTotp(secret, now);
      const result = totp.verifyTotp(code, secret, now, 1);
      expect(result.valid).toBe(true);
      expect(result.delta).toBe(0);
    });

    it('accepts valid code within +/- 1 time step (delta -1 and +1)', () => {
      const now = 1700000000000;
      // Code from 30s ago (step -1)
      const pastCode = totp.generateTotp(secret, now - 30_000);
      const pastResult = totp.verifyTotp(pastCode, secret, now, 1);
      expect(pastResult.valid).toBe(true);
      expect(pastResult.delta).toBe(-1);

      // Code from 30s in future (step +1)
      const futureCode = totp.generateTotp(secret, now + 30_000);
      const futureResult = totp.verifyTotp(futureCode, secret, now, 1);
      expect(futureResult.valid).toBe(true);
      expect(futureResult.delta).toBe(1);
    });

    it('rejects expired codes outside drift window (step -2)', () => {
      const now = 1700000000000;
      const expiredCode = totp.generateTotp(secret, now - 65_000);
      const result = totp.verifyTotp(expiredCode, secret, now, 1);
      expect(result.valid).toBe(false);
    });

    it('rejects malformed or invalid codes', () => {
      const now = 1700000000000;
      expect(totp.verifyTotp('12345', secret, now).valid).toBe(false);
      expect(totp.verifyTotp('abcdef', secret, now).valid).toBe(false);
      expect(totp.verifyTotp('', secret, now).valid).toBe(false);
      expect(totp.verifyTotp('999999', secret, now).valid).toBe(false);
    });

    it('generates standard Google Authenticator compatible otpauth URI', () => {
      const uri = totp.generateOtpAuthUri('admin@thehomez.com', secret, 'TheHomez');
      expect(uri).toContain('otpauth://totp/TheHomez:admin%40thehomez.com');
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('issuer=TheHomez');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });

  describe('Backup Codes lifecycle', () => {
    const totp = new TotpService();

    it('generates exactly 10 single-use codes with SHA-256 hashes', () => {
      const { plainCodes, hashedRecords } = totp.generateBackupCodes(10);
      expect(plainCodes).toHaveLength(10);
      expect(hashedRecords).toHaveLength(10);

      // Plain codes should be formatted like "abc12-def34"
      for (const code of plainCodes) {
        expect(code).toMatch(/^[a-f0-9]{5}-[a-f0-9]{5}$/);
      }

      // Hashes should be 64-char hex strings
      for (const rec of hashedRecords) {
        expect(rec.codeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(rec.usedAt).toBeUndefined();
      }

      // All codes in the set must be unique
      const uniquePlain = new Set(plainCodes);
      expect(uniquePlain.size).toBe(10);
    });

    it('consumes a backup code successfully and marks it invalid for reuse', () => {
      const { plainCodes, hashedRecords } = totp.generateBackupCodes(10);
      const codeToUse = plainCodes[3]!;

      // 1. First consumption succeeds
      const firstCheck = totp.consumeBackupCode(codeToUse, hashedRecords);
      expect(firstCheck.valid).toBe(true);
      expect(firstCheck.matchedIndex).toBe(3);

      // Mark it used
      hashedRecords[firstCheck.matchedIndex]!.usedAt = new Date();

      // 2. Second consumption of the exact same code fails (already used)
      const secondCheck = totp.consumeBackupCode(codeToUse, hashedRecords);
      expect(secondCheck.valid).toBe(false);
      expect(secondCheck.matchedIndex).toBe(-1);
    });

    it('allows formatting variance (spaces, uppercase, missing hyphen)', () => {
      const { plainCodes, hashedRecords } = totp.generateBackupCodes(5);
      const raw = plainCodes[0]!; // e.g. "a1b2c-d3e4f"
      const modifiedInput = raw.replace('-', '').toUpperCase(); // "A1B2CD3E4F"

      const result = totp.consumeBackupCode(modifiedInput, hashedRecords);
      expect(result.valid).toBe(true);
      expect(result.matchedIndex).toBe(0);
    });

    it('rejects invalid backup code', () => {
      const { hashedRecords } = totp.generateBackupCodes(5);
      const result = totp.consumeBackupCode('invalid-code', hashedRecords);
      expect(result.valid).toBe(false);
      expect(result.matchedIndex).toBe(-1);
    });
  });
});
