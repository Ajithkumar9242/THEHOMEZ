export interface IOtpSendResult {
  success: boolean;
  provider: 'mock' | 'msg91';
  messageId?: string;
  timestamp: string;
}

/**
 * Adapter interface for external SMS / OTP delivery providers.
 */
export interface IOtpProvider {
  readonly providerName: 'mock' | 'msg91';

  /**
   * Dispatches the generated OTP challenge to the recipient's phone number.
   * OTP values must NEVER be exposed in plaintext logs.
   */
  sendOtp(phone: string, otp: string, correlationId?: string): Promise<IOtpSendResult>;
}
