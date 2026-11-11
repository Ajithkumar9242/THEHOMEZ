import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { IAuthResponse, IAuthUser, IOtpRequestResponse } from '@thehomez/shared-types';
import {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
  DEFAULT_OTP_TTL_SECONDS,
  OTP_LENGTH,
  type AuthFlowStatus,
  type AuthStep,
  type ICustomerAuthContextContract,
  type NormalizedAuthError,
} from './auth-ui.types.js';
import {
  buildE164Phone,
  formatDisplayPhone,
  normalizeAuthError,
  sanitizePhoneInput,
} from './auth-utils.js';
import { useCustomerAuthBridge } from './AuthUiContext.js';
import { TheHomezBrandMark } from './TheHomezBrandMark.js';
import { PhoneLoginStep } from './PhoneLoginStep.js';
import { OtpVerificationStep } from './OtpVerificationStep.js';
import './auth.css';

export interface CustomerAuthFlowProps {
  /** Optional explicit AuthContext contract override (otherwise read from CustomerAuthBridgeProvider). */
  auth?: ICustomerAuthContextContract | null;
  /** Callback invoked when OTP verification succeeds. */
  onSuccess?: (user: IAuthUser | null) => void;
  /** Optional cancel/close callback (renders secondary continue/close actions when appropriate). */
  onClose?: () => void;
  /** Optional DOM id for the active heading (used by CustomerAuthModal aria-labelledby). */
  titleId?: string;
  /** Optional initial country dial code (defaults to +91). */
  initialCountryCode?: string;
  /** Optional initial local phone digits. */
  initialPhone?: string;
  /** Whether to show TheHomez brand header inside the card (default true). */
  showBrand?: boolean;
  /** Optional CSS class for the card wrapper. */
  className?: string;
}

function extractUserFromVerifyResult(
  result: IAuthResponse | IAuthUser | void,
  fallbackUser: IAuthUser | null,
): IAuthUser | null {
  if (!result || typeof result !== 'object') {
    return fallbackUser;
  }
  if ('user' in result && result.user) {
    return result.user;
  }
  if ('id' in result && 'phone' in result) {
    return result as IAuthUser;
  }
  return fallbackUser;
}

/**
 * Core 2-step Customer Phone Login & OTP Verification flow.
 *
 * State machine covers:
 * - idle
 * - requesting_otp
 * - otp_requested
 * - verifying_otp
 * - verification_failed
 * - authenticated
 * - network_error
 * - resend cooldown countdown driven by backend response
 */
export const CustomerAuthFlow: React.FC<CustomerAuthFlowProps> = ({
  auth: authProp,
  onSuccess,
  onClose,
  titleId = 'thz-auth-heading',
  initialCountryCode = DEFAULT_COUNTRY_CODE,
  initialPhone = '',
  showBrand = true,
  className = '',
}) => {
  const auth = useCustomerAuthBridge(authProp);

  const [step, setStep] = useState<AuthStep>('phone');
  const [status, setStatus] = useState<AuthFlowStatus>('idle');
  const [countryCode, setCountryCode] = useState<string>(initialCountryCode);
  const [phoneDigits, setPhoneDigits] = useState<string>(() =>
    sanitizePhoneInput(initialPhone, initialCountryCode),
  );
  const [activeE164Phone, setActiveE164Phone] = useState<string>('');
  const [otp, setOtp] = useState<string>('');
  const [isResending, setIsResending] = useState<boolean>(false);
  const [resendCooldownLeft, setResendCooldownLeft] = useState<number>(0);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number>(0);
  const [otpExpiresInSeconds, setOtpExpiresInSeconds] = useState<number>(DEFAULT_OTP_TTL_SECONDS);
  const [apiError, setApiError] = useState<NormalizedAuthError | null>(null);
  const [authenticatedUser, setAuthenticatedUser] = useState<IAuthUser | null>(null);

  const isMountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Resend OTP cooldown countdown timer
  useEffect(() => {
    if (resendCooldownLeft <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldownLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldownLeft]);

  // Temporary lockout countdown timer
  useEffect(() => {
    if (lockoutSecondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSecondsLeft]);

  const clearErrors = useCallback(() => {
    setApiError(null);
    auth?.clearError?.();
  }, [auth]);

  const handleRequestOtp = useCallback(
    async (isResend = false) => {
      if (!auth) {
        setApiError({
          category: 'not_connected',
          code: 'AUTH_CONTEXT_MISSING',
          message: 'Authentication service is not connected. Please refresh or try again later.',
        });
        return;
      }

      const targetE164 =
        isResend && activeE164Phone
          ? activeE164Phone
          : buildE164Phone(countryCode, phoneDigits);

      const currentSeq = ++requestSeqRef.current;

      clearErrors();
      if (isResend) {
        setIsResending(true);
      } else {
        setStatus('requesting_otp');
      }

      try {
        const result = (await auth.requestOtp(targetE164)) as IOtpRequestResponse | void;
        if (!isMountedRef.current || requestSeqRef.current !== currentSeq) return;

        const cooldown =
          result && typeof result.cooldownSeconds === 'number' && result.cooldownSeconds > 0
            ? Math.ceil(result.cooldownSeconds)
            : DEFAULT_OTP_RESEND_COOLDOWN_SECONDS;

        const expires =
          result && typeof result.expiresInSeconds === 'number' && result.expiresInSeconds > 0
            ? Math.ceil(result.expiresInSeconds)
            : DEFAULT_OTP_TTL_SECONDS;

        setActiveE164Phone(targetE164);
        setOtp('');
        setResendCooldownLeft(cooldown);
        setOtpExpiresInSeconds(expires);
        setLockoutSecondsLeft(0);
        setStep('otp');
        setStatus('otp_requested');
      } catch (err) {
        if (!isMountedRef.current || requestSeqRef.current !== currentSeq) return;
        const normalized = normalizeAuthError(err);

        if (normalized.category === 'cooldown_active' && normalized.remainingSeconds) {
          setResendCooldownLeft(normalized.remainingSeconds);
        }
        if (normalized.category === 'account_locked' && normalized.remainingSeconds) {
          setLockoutSecondsLeft(normalized.remainingSeconds);
        }

        setApiError(normalized);
        if (!isResend) {
          setStatus(normalized.category === 'network_error' ? 'network_error' : 'idle');
        } else {
          setStatus(
            normalized.category === 'network_error' ? 'network_error' : 'verification_failed',
          );
        }
      } finally {
        if (isMountedRef.current && requestSeqRef.current === currentSeq) {
          setIsResending(false);
        }
      }
    },
    [auth, activeE164Phone, countryCode, phoneDigits, clearErrors],
  );

  const handleVerifyOtp = useCallback(
    async (explicitOtp?: string) => {
      if (!auth) {
        setApiError({
          category: 'not_connected',
          code: 'AUTH_CONTEXT_MISSING',
          message: 'Authentication service is not connected. Please refresh or try again later.',
        });
        return;
      }

      const codeToVerify = explicitOtp ?? otp;
      if (codeToVerify.length !== OTP_LENGTH || !/^\d{6}$/.test(codeToVerify)) {
        return;
      }

      const targetE164 = activeE164Phone || buildE164Phone(countryCode, phoneDigits);
      const currentSeq = ++requestSeqRef.current;

      clearErrors();
      setStatus('verifying_otp');

      try {
        const res = await auth.verifyOtp(targetE164, codeToVerify);
        if (!isMountedRef.current || requestSeqRef.current !== currentSeq) return;

        const resolvedUser = extractUserFromVerifyResult(res, auth.user);
        setAuthenticatedUser(resolvedUser);
        setStep('success');
        setStatus('authenticated');
        onSuccess?.(resolvedUser);
      } catch (err) {
        if (!isMountedRef.current || requestSeqRef.current !== currentSeq) return;
        const normalized = normalizeAuthError(err);

        if (normalized.category === 'account_locked' && normalized.remainingSeconds) {
          setLockoutSecondsLeft(normalized.remainingSeconds);
        }

        setApiError(normalized);
        setStatus(
          normalized.category === 'network_error' ? 'network_error' : 'verification_failed',
        );
      }
    },
    [auth, otp, activeE164Phone, countryCode, phoneDigits, clearErrors, onSuccess],
  );

  const handleOtpChange = useCallback(
    (nextOtp: string) => {
      setOtp(nextOtp);
      if (apiError) {
        clearErrors();
        if (status === 'verification_failed' || status === 'network_error') {
          setStatus('otp_requested');
        }
      }
    },
    [apiError, clearErrors, status],
  );

  const handleChangePhone = useCallback(() => {
    requestSeqRef.current += 1;
    setStep('phone');
    setStatus('idle');
    setOtp('');
    setIsResending(false);
    setLockoutSecondsLeft(0);
    clearErrors();
  }, [clearErrors]);

  const formattedPhone = formatDisplayPhone(
    activeE164Phone || buildE164Phone(countryCode, phoneDigits),
    countryCode,
  );

  return (
    <div className={`thz-auth-card ${className}`.trim()} data-auth-status={status}>
      {showBrand ? (
        <div className="thz-auth-card-brand-row">
          <TheHomezBrandMark />
          <div className="thz-auth-step-indicator" aria-label="Authentication step">
            <span className={`thz-auth-step-pill${step === 'phone' ? ' active' : ' done'}`}>
              1. Mobile
            </span>
            <span className="thz-auth-step-sep" aria-hidden="true">
              /
            </span>
            <span
              className={`thz-auth-step-pill${
                step === 'otp' ? ' active' : step === 'success' ? ' done' : ''
              }`}
            >
              2. OTP
            </span>
          </div>
        </div>
      ) : null}

      {step === 'phone' ? (
        <PhoneLoginStep
          countryCode={countryCode}
          phoneNumber={phoneDigits}
          onCountryCodeChange={setCountryCode}
          onPhoneNumberChange={setPhoneDigits}
          onSubmit={() => {
            void handleRequestOtp(false);
          }}
          isSubmitting={status === 'requesting_otp'}
          apiError={apiError}
          onClearError={clearErrors}
          titleId={titleId}
          autoFocus
        />
      ) : null}

      {step === 'otp' ? (
        <OtpVerificationStep
          formattedPhone={formattedPhone}
          otp={otp}
          onOtpChange={handleOtpChange}
          onVerify={(code) => {
            void handleVerifyOtp(code);
          }}
          onResendOtp={() => {
            void handleRequestOtp(true);
          }}
          onChangePhone={handleChangePhone}
          isVerifying={status === 'verifying_otp'}
          isResending={isResending}
          resendCooldownLeft={resendCooldownLeft}
          lockoutSecondsLeft={lockoutSecondsLeft}
          otpExpiresInSeconds={otpExpiresInSeconds}
          apiError={apiError}
          titleId={titleId}
        />
      ) : null}

      {step === 'success' ? (
        <div className="thz-auth-success" role="status" aria-live="polite">
          <div className="thz-auth-success-icon" aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 id={titleId} className="thz-auth-title">
            Signed in to TheHomez
          </h2>
          <p className="thz-auth-subtitle">
            Verified account{' '}
            <strong>{authenticatedUser?.phone ?? formattedPhone}</strong>. Your session is active.
          </p>
          {onClose ? (
            <button type="button" className="thz-auth-submit-btn" onClick={onClose}>
              Continue to Storefront
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
