import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockOtpProvider } from '../src/services/otp/mock-otp.provider.js';
import { getConfig } from '../src/config/env.js';
import { logger } from '../src/logger/logger.js';

describe('MockOtpProvider — Environment & Security Guards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    MockOtpProvider.clearCapturedOtps();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    getConfig(true);
    vi.restoreAllMocks();
  });

  it('prints OTP to terminal console ONLY in development mode with masked phone and never logs OTP in pino logger', async () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_PROVIDER = 'mock';
    getConfig(true);

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    const provider = new MockOtpProvider();
    const result = await provider.sendOtp('+919876543210', '482910', 'corr-dev-1');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('mock');
    expect(MockOtpProvider.getLatestCapturedOtp('+919876543210')).toBe('482910');

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const consoleOutput = String(consoleInfoSpy.mock.calls[0]?.[0] ?? '');
    expect(consoleOutput).toContain('[DEV-ONLY OTP]');
    expect(consoleOutput).toContain('+919****3210');
    expect(consoleOutput).not.toContain('+919876543210');
    expect(consoleOutput).toContain('482910');

    // Normal structured logger must never receive plaintext OTP
    expect(loggerInfoSpy).not.toHaveBeenCalled();
    expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
    const loggedMeta = JSON.stringify(loggerDebugSpy.mock.calls[0]);
    expect(loggedMeta).not.toContain('482910');
    expect(loggedMeta).not.toContain('+919876543210');
  });

  it('does NOT print OTP to console in test mode while still capturing in test store', async () => {
    process.env.NODE_ENV = 'test';
    process.env.OTP_PROVIDER = 'mock';
    getConfig(true);

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const provider = new MockOtpProvider();
    await provider.sendOtp('+919876543210', '654321', 'corr-test-1');

    expect(MockOtpProvider.getLatestCapturedOtp('+919876543210')).toBe('654321');
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('throws SECURITY VIOLATION in production mode and never outputs OTP', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/thehomez';
    process.env.CORS_ORIGIN = 'https://thehomez.com';
    process.env.JWT_ACCESS_SECRET = 'prod_access_secret_at_least_32_characters_long_abc';
    process.env.OTP_PEPPER_SECRET = 'prod_otp_pepper_secret_at_least_32_characters_xyz';
    process.env.OTP_PROVIDER = 'msg91';
    process.env.MSG91_AUTH_KEY = 'dummy_key';
    process.env.MSG91_TEMPLATE_ID = 'dummy_template';
    getConfig(true);

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const provider = new MockOtpProvider();
    await expect(provider.sendOtp('+919876543210', '112233')).rejects.toThrow(
      /SECURITY VIOLATION: MockOtpProvider cannot be invoked in production environment/,
    );

    expect(MockOtpProvider.getLatestCapturedOtp('+919876543210')).toBeUndefined();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
