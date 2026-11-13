import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertConnectedAdminDatabase,
  assertProvisioningTargetsAvailable,
  validateAdminProvisioningEnvironment,
} from '../scripts/admin-provisioning-guards.mjs';

const scriptPath = fileURLToPath(
  new URL('../scripts/provision-admin-development-account.mjs', import.meta.url),
);

function validEnv(database = 'thehomez_admin_verify') {
  return {
    MONGODB_URI: `mongodb://127.0.0.1:27017/${database}`,
    PORT: '5001',
    NODE_ENV: 'development',
  };
}

function loadedEnvironment(env: Record<string, string>) {
  return { parsed: env } as never;
}

describe('Admin provisioning safeguards', () => {
  it('requires the explicit --confirm flag before loading environment or connecting', () => {
    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--confirm');
    expect(result.stdout + result.stderr).not.toMatch(/mongodb:\/\/|passwordHash|otp/i);
  });

  it('accepts only the explicit development configuration for the isolated database', () => {
    const env = validEnv();
    expect(validateAdminProvisioningEnvironment(loadedEnvironment(env), env, undefined)).toBe(true);
    expect(validateAdminProvisioningEnvironment(loadedEnvironment(env), env, 'production')).toBe(
      false,
    );
    const wrongDb = validEnv('thehomez');
    expect(
      validateAdminProvisioningEnvironment(loadedEnvironment(wrongDb), wrongDb, undefined),
    ).toBe(false);
  });

  it('refuses duplicate users or roles without overwriting either one', () => {
    expect(() => assertProvisioningTargetsAvailable(null, null)).not.toThrow();
    expect(() => assertProvisioningTargetsAvailable({ _id: 'existing' }, null)).toThrow(
      /already exists/,
    );
    expect(() => assertProvisioningTargetsAvailable(null, { _id: 'existing' })).toThrow(
      /already exists/,
    );
  });

  it('requires an established connection to the exact isolated database', () => {
    expect(() =>
      assertConnectedAdminDatabase({ status: 'connected', name: 'thehomez_admin_verify' }),
    ).not.toThrow();
    expect(() => assertConnectedAdminDatabase({ status: 'connected', name: 'thehomez' })).toThrow();
    expect(() =>
      assertConnectedAdminDatabase({ status: 'disconnected', name: 'thehomez_admin_verify' }),
    ).toThrow();
  });
});
