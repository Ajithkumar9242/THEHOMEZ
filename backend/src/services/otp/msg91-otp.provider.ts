import type { IOtpProvider, IOtpSendResult } from './otp-provider.interface.js';
import { logger } from '../../logger/logger.js';
import { getConfig } from '../../config/env.js';

/**
 * MSG91 OTP Provider Adapter (PENDING EXTERNAL INTEGRATION - STUB).
 *
 * Designed to interface with MSG91's SendOTP REST API v5.
 * In the current phase, this adapter is a validated stub until MSG91 production
 * SMS DLT templates and API credentials are provided by stakeholders.
 */
export class Msg91OtpProvider implements IOtpProvider {
  public readonly providerName = 'msg91';

  private readonly authKey: string;
  private readonly templateId: string;

  constructor(authKey?: string, templateId?: string) {
    const config = getConfig();
    this.authKey = authKey || config.auth.otp.msg91?.authKey || '';
    this.templateId = templateId || config.auth.otp.msg91?.templateId || '';

    if (!this.authKey || !this.templateId) {
      if (config.isProduction) {
        throw new Error(
          'MSG91 integration error: authKey and templateId must be configured in production',
        );
      }
    }
  }

  public async sendOtp(
    phone: string,
    _otp: string,
    correlationId?: string,
  ): Promise<IOtpSendResult> {
    const maskedPhone = phone.length > 6 ? `${phone.slice(0, 4)}****${phone.slice(-4)}` : '****';

    logger.info(
      {
        provider: 'msg91',
        phone: maskedPhone,
        templateId: this.templateId,
        correlationId,
      },
      'MSG91 OTP dispatch initiated (STUB: pending active external carrier integration)',
    );

    // In a live integration, an HTTP POST would be dispatched to https://control.msg91.com/api/v5/otp
    // Since external carrier credentials and TRAI DLT registration are pending stakeholder action,
    // this adapter returns a simulated dispatch receipt for configured tests.
    return {
      success: true,
      provider: 'msg91',
      messageId: `msg91-sim-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }
}
