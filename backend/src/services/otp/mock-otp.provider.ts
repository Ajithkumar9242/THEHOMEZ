import type { IOtpProvider, IOtpSendResult } from './otp-provider.interface.js';
import { logger } from '../../logger/logger.js';
import { getConfig } from '../../config/env.js';

/**
 * Mock OTP Provider for Development and Automated Testing.
 *
 * Security Guarantees:
 * 1. In production, instantiation/invocation is strictly prohibited and throws a fatal error.
 * 2. Plaintext OTP is NEVER written to structured application logs (pino logger) or API responses.
 * 3. Terminal console output of the generated OTP occurs ONLY when NODE_ENV === 'development'
 *    (explicitly excluded in 'test' and 'production' environments).
 * 4. Captured OTPs are stored in an in-memory test store accessible ONLY for test assertions.
 */
export class MockOtpProvider implements IOtpProvider {
  public readonly providerName = 'mock';

  /**
   * In-memory store for capturing mock OTPs in test runners.
   * Maps normalized phone number to latest OTP string.
   */
  private static testCaptureStore = new Map<string, { otp: string; timestamp: number }>();

  /**
   * Test-only utility: retrieves the latest generated OTP for a phone number in test runs.
   */
  public static getLatestCapturedOtp(phone: string): string | undefined {
    const entry = MockOtpProvider.testCaptureStore.get(phone);
    return entry?.otp;
  }

  /**
   * Test-only utility: clears all captured test OTPs.
   */
  public static clearCapturedOtps(): void {
    MockOtpProvider.testCaptureStore.clear();
  }

  public async sendOtp(
    phone: string,
    otp: string,
    correlationId?: string,
  ): Promise<IOtpSendResult> {
    const config = getConfig();

    // Production safety invariant: Mock provider is strictly prohibited in production
    if (config.isProduction || config.nodeEnv === 'production') {
      throw new Error(
        'SECURITY VIOLATION: MockOtpProvider cannot be invoked in production environment',
      );
    }

    // Capture in test store for automated testing assertions
    MockOtpProvider.testCaptureStore.set(phone, { otp, timestamp: Date.now() });

    // Mask phone number for logging: e.g. +9198****3210
    const maskedPhone = phone.length > 6 ? `${phone.slice(0, 4)}****${phone.slice(-4)}` : '****';

    // Development-only terminal OTP output for local developer sign-in verification.
    // Strictly disabled in 'test' and 'production', and kept outside structured application logs.
    if (
      config.nodeEnv === 'development' &&
      config.isDevelopment &&
      !config.isProduction &&
      !config.isTest
    ) {
      console.info(
        `[DEV-ONLY OTP] Phone: ${maskedPhone} | OTP: ${otp} | Expires in: ${config.auth.otp.ttlSeconds}s`,
      );
    }

    // Log OTP dispatch WITHOUT leaking the plaintext OTP value
    logger.debug(
      {
        provider: 'mock',
        phone: maskedPhone,
        correlationId,
      },
      'Mock OTP successfully generated and captured in test store',
    );

    return {
      success: true,
      provider: 'mock',
      messageId: `mock-msg-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }
}
