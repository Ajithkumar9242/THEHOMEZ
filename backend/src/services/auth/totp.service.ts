import crypto from 'node:crypto';

// Standard RFC 4648 Base32 alphabet (A-Z, 2-7)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a buffer to RFC 4648 Base32 string (without padding for clean authenticator URIs).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string to a Buffer.
 * Ignores whitespace, hyphens, and padding '=' characters.
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s\-=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export interface IBackupCodeRecord {
  codeHash: string;
  usedAt?: Date;
}

export interface ITotpVerifyResult {
  valid: boolean;
  delta?: number;
  counter?: number;
}

export class TotpService {
  private readonly stepSeconds: number;
  private readonly digits: number;

  constructor(stepSeconds = 30, digits = 6) {
    this.stepSeconds = stepSeconds;
    this.digits = digits;
  }

  /**
   * Generates a 20-byte cryptographically secure random secret encoded as Base32.
   */
  public generateSecret(): string {
    const randomBytes = crypto.randomBytes(20);
    return base32Encode(randomBytes);
  }

  /**
   * Generates the standard otpauth URI compatible with Google Authenticator, Authy, etc.
   */
  public generateOtpAuthUri(account: string, secret: string, issuer = 'TheHomez'): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(account);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${this.digits}&period=${this.stepSeconds}`;
  }

  /**
   * Computes an RFC 4226 HOTP token for a given counter.
   */
  public generateHotp(secret: string, counter: number): string {
    const key = base32Decode(secret);

    // 8-byte big-endian counter buffer
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigInt64BE(BigInt(counter), 0);

    const hmac = crypto.createHmac('sha1', key);
    hmac.update(counterBuf);
    const digest = hmac.digest();

    // Dynamic Truncation (RFC 4226 Section 5.4)
    const offset = digest[digest.length - 1]! & 0x0f;
    const binary =
      ((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff);

    const otp = binary % 10 ** this.digits;
    return otp.toString().padStart(this.digits, '0');
  }

  /**
   * Computes RFC 6238 TOTP code for a given timestamp (in milliseconds, defaults to now).
   */
  public generateTotp(secret: string, timestampMs = Date.now()): string {
    const counter = Math.floor(timestampMs / 1000 / this.stepSeconds);
    return this.generateHotp(secret, counter);
  }

  /**
   * Verifies an RFC 6238 TOTP code with time-step drift tolerance.
   * Window = 1 means checking counter - 1, counter, counter + 1 (covering 90 seconds total).
   */
  public verifyTotp(
    token: string,
    secret: string,
    timestampMs = Date.now(),
    window = 1,
  ): ITotpVerifyResult {
    if (!token || typeof token !== 'string') {
      return { valid: false };
    }

    const cleanToken = token.trim();
    if (cleanToken.length !== this.digits || !/^\d+$/.test(cleanToken)) {
      return { valid: false };
    }

    const currentCounter = Math.floor(timestampMs / 1000 / this.stepSeconds);

    for (let delta = -window; delta <= window; delta++) {
      const counter = currentCounter + delta;
      const expectedToken = this.generateHotp(secret, counter);
      const tokenBuf = Buffer.from(cleanToken, 'utf8');
      const expectedBuf = Buffer.from(expectedToken, 'utf8');

      if (tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { valid: true, delta, counter };
      }
    }

    return { valid: false };
  }

  /**
   * Generates exactly 10 single-use cryptographically secure backup codes.
   * Returns plaintext codes (to display once to the user) and their SHA-256 hashes for storage.
   */
  public generateBackupCodes(count = 10): {
    plainCodes: string[];
    hashedRecords: IBackupCodeRecord[];
  } {
    const plainCodes: string[] = [];
    const hashedRecords: IBackupCodeRecord[] = [];

    for (let i = 0; i < count; i++) {
      // 5 bytes = 10 hex characters formatted as 5-5: e.g. "a1b2c-d3e4f"
      const rawHex = crypto.randomBytes(5).toString('hex').toLowerCase();
      const formattedCode = `${rawHex.slice(0, 5)}-${rawHex.slice(5)}`;

      const codeHash = this.hashBackupCode(formattedCode);
      plainCodes.push(formattedCode);
      hashedRecords.push({ codeHash });
    }

    return { plainCodes, hashedRecords };
  }

  /**
   * Computes SHA-256 hash of a normalized backup code.
   */
  public hashBackupCode(code: string): string {
    const normalized = code.toLowerCase().replace(/[\s-]/g, '');
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /**
   * Verifies and marks a single-use backup code as used.
   * Returns index of the matched code if valid and unused, or -1 if invalid/already used.
   */
  public consumeBackupCode(
    candidateCode: string,
    records: IBackupCodeRecord[],
  ): { valid: boolean; matchedIndex: number } {
    if (!candidateCode || typeof candidateCode !== 'string') {
      return { valid: false, matchedIndex: -1 };
    }

    const candidateHash = this.hashBackupCode(candidateCode);
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.usedAt) {
        continue; // Already consumed
      }

      const storedBuf = Buffer.from(rec.codeHash, 'hex');
      if (
        candidateBuf.length === storedBuf.length &&
        crypto.timingSafeEqual(candidateBuf, storedBuf)
      ) {
        return { valid: true, matchedIndex: i };
      }
    }

    return { valid: false, matchedIndex: -1 };
  }
}

export const totpService = new TotpService();
