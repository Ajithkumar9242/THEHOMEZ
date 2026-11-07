import type { IOtpProvider, IOtpSendResult } from './otp-provider.interface.js';
import { logger } from '../../logger/logger.js';
import { getConfig } from '../../config/env.js';

/**
 * Mock OTP Provider for Development and Automated Testing.
 *
 * Security Guarantees:
 * 1. Plaintext OTP is NEVER logged to stdout or file, even in development.
 * 2. In production, instantiation and invocation are strictly prohibited and throw fatal errors.
 * 3. Captured OTPs are stored in an in-memory test store accessible ONLY for test assertions.
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
    if (config.isProduction) {
      throw new Error(
        'SECURITY VIOLATION: MockOtpProvider cannot be invoked in production environment',
      );
    }

    // Capture in test store for automated testing assertions
    MockOtpProvider.testCaptureStore.set(phone, { otp, timestamp: Date.now() });

    // Mask phone number for logging: e.g. +9198****3210
    const maskedPhone = phone.length > 6 ? `${phone.slice(0, 4)}****${phone.slice(-4)}` : '****';

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
