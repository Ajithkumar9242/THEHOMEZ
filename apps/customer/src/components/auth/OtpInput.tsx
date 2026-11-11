import React, { useEffect, useRef } from 'react';
import { OTP_LENGTH } from './auth-ui.types.js';

export interface OtpInputProps {
  value: string;
  onChange: (nextOtp: string) => void;
  onCompleteSubmit?: (completedOtp: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  idPrefix?: string;
}

/**
 * Accessible 6-digit OTP input component supporting:
 * - Auto-focus on first digit
 * - Keyboard navigation (ArrowLeft, ArrowRight, Home, End, Backspace, Delete, Enter)
 * - Clipboard paste of 6-digit codes (including formatted or SMS-wrapped text)
 * - WebOTP / SMS autocomplete (`one-time-code`)
 */
export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  onCompleteSubmit,
  disabled = false,
  hasError = false,
  autoFocus = true,
  describedBy,
  idPrefix = 'thz-otp-digit',
}) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Pad digits array to OTP_LENGTH
  const digits = Array.from({ length: OTP_LENGTH }, (_, idx) => value[idx] ?? '');
  const digitsRef = useRef(digits);
  digitsRef.current = digits;

  useEffect(() => {
    if (!autoFocus || disabled) return;
    // Focus first empty slot (or slot 0) on mount
    const firstEmptyIdx = digitsRef.current.findIndex((d) => !d);
    const targetIdx = firstEmptyIdx === -1 ? 0 : firstEmptyIdx;
    const el = inputRefs.current[targetIdx];
    if (el) {
      el.focus();
    }
  }, [autoFocus, disabled]);

  const focusSlot = (index: number) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, index));
    const el = inputRefs.current[clamped];
    if (el && !el.disabled) {
      el.focus();
      el.select();
    }
  };

  const commitDigits = (nextDigits: string[]) => {
    const joined = nextDigits.join('').slice(0, OTP_LENGTH);
    onChange(joined);
  };

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    const numericOnly = raw.replace(/\D/g, '');

    // Handle clearing a single digit via change event
    if (!numericOnly) {
      const next = [...digits];
      next[index] = '';
      commitDigits(next);
      return;
    }

    // Handle typing a single replacement digit when the slot already contained one
    if (numericOnly.length === 2 && digits[index]) {
      const replacement = numericOnly.startsWith(digits[index])
        ? numericOnly.slice(1)
        : numericOnly.slice(0, 1);
      const next = [...digits];
      next[index] = replacement;
      commitDigits(next);
      if (index < OTP_LENGTH - 1) {
        focusSlot(index + 1);
      }
      return;
    }

    // Handle multi-digit entry (SMS autofill or mobile keyboard suggestion)
    if (numericOnly.length > 1) {
      const next = [...digits];
      const startIndex = numericOnly.length >= OTP_LENGTH ? 0 : index;
      const sliced = numericOnly.slice(0, OTP_LENGTH - startIndex);
      for (let i = 0; i < sliced.length; i += 1) {
        next[startIndex + i] = sliced[i]!;
      }
      commitDigits(next);
      const nextFocus = Math.min(OTP_LENGTH - 1, startIndex + sliced.length);
      focusSlot(nextFocus);
      return;
    }

    // Standard single-digit input
    const next = [...digits];
    next[index] = numericOnly;
    commitDigits(next);

    if (index < OTP_LENGTH - 1) {
      focusSlot(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    switch (e.key) {
      case 'Backspace': {
        e.preventDefault();
        const next = [...digits];
        if (next[index]) {
          next[index] = '';
          commitDigits(next);
        } else if (index > 0) {
          next[index - 1] = '';
          commitDigits(next);
          focusSlot(index - 1);
        }
        break;
      }
      case 'Delete': {
        e.preventDefault();
        const next = [...digits];
        next[index] = '';
        commitDigits(next);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (index > 0) {
          focusSlot(index - 1);
        }
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (index < OTP_LENGTH - 1) {
          focusSlot(index + 1);
        }
        break;
      }
      case 'Home': {
        e.preventDefault();
        focusSlot(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        focusSlot(OTP_LENGTH - 1);
        break;
      }
      case 'Enter': {
        if (value.length === OTP_LENGTH && /^\d{6}$/.test(value) && onCompleteSubmit) {
          e.preventDefault();
          onCompleteSubmit(value);
        }
        break;
      }
      default:
        break;
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    const pastedText = e.clipboardData?.getData('text') ?? '';
    const pastedDigits = pastedText.replace(/\D/g, '');
    if (!pastedDigits) {
      return;
    }

    const next = [...digits];
    // Full 6-digit code (or longer SMS text containing digits) fills from index 0
    const startIdx = pastedDigits.length >= OTP_LENGTH ? 0 : index;
    const chars = pastedDigits.slice(0, OTP_LENGTH - startIdx);

    for (let i = 0; i < chars.length; i += 1) {
      next[startIdx + i] = chars[i]!;
    }

    commitDigits(next);

    const targetFocus = Math.min(OTP_LENGTH - 1, startIdx + chars.length - 1);
    const nextEmpty = next.findIndex((d, idx) => idx >= startIdx && !d);
    focusSlot(nextEmpty !== -1 ? nextEmpty : targetFocus);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  return (
    <div
      className="thz-auth-otp-grid"
      role="group"
      aria-label="6-digit verification code"
      aria-describedby={describedBy}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          id={`${idPrefix}-${index}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={OTP_LENGTH}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
          aria-invalid={hasError ? 'true' : undefined}
          className={`thz-auth-otp-digit${digit ? ' filled' : ''}${hasError ? ' error' : ''}`}
          onChange={(e) => handleInputChange(index, e)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={handleFocus}
        />
      ))}
    </div>
  );
};
