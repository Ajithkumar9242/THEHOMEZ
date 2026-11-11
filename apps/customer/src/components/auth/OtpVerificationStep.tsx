import React from 'react';
import { OTP_LENGTH, type NormalizedAuthError } from './auth-ui.types.js';
import { formatCountdownSeconds } from './auth-utils.js';
import { OtpInput } from './OtpInput.js';

export interface OtpVerificationStepProps {
  formattedPhone: string;
  otp: string;
  onOtpChange: (nextOtp: string) => void;
  onVerify: (otpToVerify?: string) => void;
  onResendOtp: () => void;
  onChangePhone: () => void;
  isVerifying: boolean;
  isResending: boolean;
  resendCooldownLeft: number;
  lockoutSecondsLeft: number;
  otpExpiresInSeconds: number;
  apiError: NormalizedAuthError | null;
  titleId?: string;
}

/**
 * Screen 2: Six-Digit OTP Verification.
 *
 * Includes:
 * - Target phone number summary with "Change number" action
 * - Accessible 6-digit OTP input with auto-focus, keyboard navigation, and paste support
 * - Backend-driven resend OTP countdown
 * - Distinct Invalid OTP, Expired OTP, Account Locked, and Network Error alerts
 * - Loading and disabled states
 */
export const OtpVerificationStep: React.FC<OtpVerificationStepProps> = ({
  formattedPhone,
  otp,
  onOtpChange,
  onVerify,
  onResendOtp,
  onChangePhone,
  isVerifying,
  isResending,
  resendCooldownLeft,
  lockoutSecondsLeft,
  otpExpiresInSeconds,
  apiError,
  titleId,
}) => {
  const isLockedOut = lockoutSecondsLeft > 0;
  const isBusy = isVerifying || isResending;
  const isOtpComplete = otp.length === OTP_LENGTH && /^\d{6}$/.test(otp);
  const hasOtpError =
    apiError?.category === 'invalid_otp' ||
    apiError?.category === 'otp_expired' ||
    apiError?.category === 'validation_error';

  const canResend = resendCooldownLeft <= 0 && !isBusy && !isLockedOut;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOtpComplete || isBusy || isLockedOut) return;
    onVerify();
  };

  const validityMinutes = Math.max(1, Math.round(otpExpiresInSeconds / 60));

  const getAlertTitle = (err: NormalizedAuthError): string => {
    switch (err.category) {
      case 'otp_expired':
        return 'OTP expired';
      case 'invalid_otp':
        return 'Invalid OTP code';
      case 'account_locked':
        return 'Verification temporarily locked';
      case 'cooldown_active':
      case 'rate_limited':
        return 'Please wait';
      case 'network_error':
        return 'Connection error';
      default:
        return 'Verification failed';
    }
  };

  return (
    <div className="thz-auth-step">
      <div className="thz-auth-header-copy">
        <h2 id={titleId} className="thz-auth-title">
          Verify your mobile number
        </h2>
        <p className="thz-auth-subtitle">
          Enter the 6-digit verification code for{' '}
          <strong className="thz-auth-phone-highlight">{formattedPhone}</strong>.
        </p>
        {import.meta.env.DEV ? (
          <p className="thz-auth-helper" role="note" data-testid="thz-dev-otp-notice">
            Development mode: Check the backend terminal for the generated verification code.
          </p>
        ) : null}
        <div className="thz-auth-phone-meta">
          <button
            type="button"
            className="thz-auth-link-btn"
            onClick={onChangePhone}
            disabled={isBusy}
          >
            Change phone number
          </button>
          <span className="thz-auth-validity-pill">
            Valid for {validityMinutes} {validityMinutes === 1 ? 'min' : 'mins'}
          </span>
        </div>
      </div>

      {apiError ? (
        <div
          className={`thz-auth-alert ${
            apiError.category === 'otp_expired' || apiError.category === 'cooldown_active'
              ? 'warning'
              : 'error'
          }`}
          role="alert"
          aria-live="assertive"
        >
          <span className="thz-auth-alert-icon" aria-hidden="true">
            {apiError.category === 'network_error'
              ? '📡'
              : apiError.category === 'otp_expired'
                ? '⏱️'
                : '⚠️'}
          </span>
          <div className="thz-auth-alert-content">
            <strong>{getAlertTitle(apiError)}</strong>
            <p>
              {isLockedOut
                ? `Too many failed attempts. Try again in ${formatCountdownSeconds(lockoutSecondsLeft)}, or sign in with another number.`
                : apiError.message}
            </p>
          </div>
        </div>
      ) : null}

      <form className="thz-auth-form" onSubmit={handleFormSubmit} noValidate>
        <div className="thz-auth-field">
          <label className="thz-auth-label" id="thz-otp-group-label">
            6-digit OTP code
          </label>
          <OtpInput
            value={otp}
            onChange={onOtpChange}
            onCompleteSubmit={(completed) => {
              if (!isBusy && !isLockedOut) {
                onVerify(completed);
              }
            }}
            disabled={isBusy || isLockedOut}
            hasError={hasOtpError}
            autoFocus
            describedBy="thz-otp-helper"
          />
          <p id="thz-otp-helper" className="thz-auth-helper">
            You can type or paste all 6 digits directly.
          </p>
        </div>

        <button
          type="submit"
          className="thz-auth-submit-btn"
          disabled={!isOtpComplete || isBusy || isLockedOut}
          aria-busy={isVerifying}
        >
          {isVerifying ? (
            <>
              <span className="thz-auth-spinner" aria-hidden="true" />
              <span>Verifying OTP...</span>
            </>
          ) : (
            <span>Verify &amp; Continue</span>
          )}
        </button>
      </form>

      <div className="thz-auth-resend-row">
        <span className="thz-auth-resend-label">Didn&apos;t receive the code?</span>
        {isResending ? (
          <span className="thz-auth-resend-status" aria-live="polite">
            Sending new OTP...
          </span>
        ) : resendCooldownLeft > 0 ? (
          <span className="thz-auth-resend-timer">
            Resend OTP in <strong>{formatCountdownSeconds(resendCooldownLeft)}</strong>
          </span>
        ) : (
          <button
            type="button"
            className="thz-auth-link-btn"
            onClick={onResendOtp}
            disabled={!canResend}
          >
            Resend OTP
          </button>
        )}
      </div>
    </div>
  );
};
