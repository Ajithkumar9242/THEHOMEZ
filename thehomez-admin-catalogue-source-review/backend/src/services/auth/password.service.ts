import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SCRYPT_COST = 1 << 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const SALT_BYTES = 16;

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

let dummyHashPromise: Promise<string> | undefined;

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  return scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: MAX_MEMORY,
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters.');
  }

  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${derivedKey.toString('hex')}`;
}

async function compareEncodedHash(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, salt, expectedHex, extra] =
    encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    Number(cost) !== SCRYPT_COST ||
    Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
    Number(parallelization) !== SCRYPT_PARALLELIZATION ||
    !salt ||
    !/^[a-f0-9]{32}$/i.test(salt) ||
    !expectedHex ||
    !/^[a-f0-9]{128}$/i.test(expectedHex) ||
    extra !== undefined
  ) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await deriveKey(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHashPromise;
}

/** Performs comparable KDF work for missing or malformed stored hashes. */
export async function verifyPassword(password: string, encodedHash?: string): Promise<boolean> {
  if (!encodedHash) {
    await compareEncodedHash(password, await getDummyHash());
    return false;
  }

  const valid = await compareEncodedHash(password, encodedHash);
  if (!valid && !encodedHash.startsWith(`scrypt$${SCRYPT_COST}$`)) {
    await compareEncodedHash(password, await getDummyHash());
  }
  return valid;
}
