import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/auth/password.service.js';
import { UserModel } from '../src/models/user.model.js';

describe('temporary Admin password hashing', () => {
  it('stores an scrypt hash and verifies only the matching password', async () => {
    const hash = await hashPassword('development-test-password');

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain('development-test-password');
    await expect(verifyPassword('development-test-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-development-password', hash)).resolves.toBe(false);
  });

  it('does comparable KDF work and returns false when no password hash exists', async () => {
    await expect(verifyPassword('development-test-password')).resolves.toBe(false);
  });

  it('excludes passwordHash from ordinary UserModel queries', () => {
    expect(UserModel.schema.path('passwordHash')?.options.select).toBe(false);
  });
});
