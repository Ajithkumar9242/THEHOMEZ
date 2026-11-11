import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UserStatus, UserType, type IAuthUser, type IOtpRequestResponse } from '@thehomez/shared-types';
import { AuthProvider, useAuth } from '../../context/AuthContext.js';
import {
  CustomerAuthBridgeProvider,
  CustomerAuthFlow,
  CustomerAuthModal,
  CustomerLoginView,
  type ICustomerAuthContextContract,
} from './index.js';

function createMockUser(overrides: Partial<IAuthUser> = {}): IAuthUser {
  return {
    id: 'user-cust-1',
    phone: '+919876543210',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: [],
    permissions: [],
    createdAt: '2026-11-11T00:00:00.000Z',
    ...overrides,
  };
}

function createMockAuth(
  overrides: Partial<ICustomerAuthContextContract> = {},
): ICustomerAuthContextContract {
  return {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    requestOtp: vi.fn().mockResolvedValue({
      cooldownSeconds: 60,
      expiresInSeconds: 300,
      message: 'OTP challenge dispatched successfully',
    }),
    verifyOtp: vi.fn().mockResolvedValue({
      tokens: {
        accessToken: 'jwt-access-token',
        expiresIn: 900,
        tokenType: 'Bearer',
      },
      user: createMockUser(),
    }),
    clearError: vi.fn(),
    ...overrides,
  };
}

describe('Customer Login & OTP UI (Milestone 5A.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Screen 1: Phone Number Login', () => {
    it('renders TheHomez branding, India (+91) default country code, OTP notice, and Continue button', () => {
      const auth = createMockAuth();
      render(<CustomerAuthFlow auth={auth} />);

      expect(screen.getByText('TheHomez')).toBeInTheDocument();
      const countrySelect = screen.getByLabelText(/Country code/i) as HTMLSelectElement;
      expect(countrySelect.value).toBe('+91');
      expect(screen.getByLabelText(/Mobile number/i)).toBeInTheDocument();
      expect(screen.getByText(/6-digit one-time verification code \(OTP\)/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();
    });

    it('validates Indian mobile numbers and rejects invalid formats', async () => {
      const auth = createMockAuth();
      render(<CustomerAuthFlow auth={auth} />);

      const phoneInput = screen.getByLabelText(/Mobile number/i);
      const continueBtn = screen.getByRole('button', { name: /Continue/i });

      // Empty submit
      fireEvent.click(continueBtn);
      expect(await screen.findByText(/Please enter your mobile number/i)).toBeInTheDocument();
      expect(auth.requestOtp).not.toHaveBeenCalled();

      // Short number
      fireEvent.change(phoneInput, { target: { value: '98765' } });
      fireEvent.click(continueBtn);
      expect(
        await screen.findByText(/Enter a valid 10-digit Indian mobile number/i),
      ).toBeInTheDocument();
      expect(auth.requestOtp).not.toHaveBeenCalled();

      // Invalid starting digit (< 6)
      fireEvent.change(phoneInput, { target: { value: '1234567890' } });
      fireEvent.click(continueBtn);
      expect(
        await screen.findByText(/Indian mobile numbers must start with 6, 7, 8, or 9/i),
      ).toBeInTheDocument();
      expect(auth.requestOtp).not.toHaveBeenCalled();
    });

    it('sanitizes pasted +91 numbers and submits canonical E.164 to AuthContext', async () => {
      const auth = createMockAuth();
      render(<CustomerAuthFlow auth={auth} />);

      const phoneInput = screen.getByLabelText(/Mobile number/i) as HTMLInputElement;
      fireEvent.change(phoneInput, { target: { value: '+91 98765 43210' } });
      expect(phoneInput.value).toBe('9876543210');

      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      await waitFor(() => {
        expect(auth.requestOtp).toHaveBeenCalledWith('+919876543210');
      });
    });

    it('supports switching country codes (e.g. UAE +971)', async () => {
      const auth = createMockAuth();
      render(<CustomerAuthFlow auth={auth} />);

      const countrySelect = screen.getByLabelText(/Country code/i);
      fireEvent.change(countrySelect, { target: { value: '+971' } });

      const phoneInput = screen.getByLabelText(/Mobile number/i);
      fireEvent.change(phoneInput, { target: { value: '501234567' } });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      await waitFor(() => {
        expect(auth.requestOtp).toHaveBeenCalledWith('+971501234567');
      });
    });

    it('displays loading state while requesting OTP and handles network errors', async () => {
      let rejectRequest: (err: unknown) => void = () => {};
      const auth = createMockAuth({
        requestOtp: vi.fn(
          () =>
            new Promise<IOtpRequestResponse>((_, reject) => {
              rejectRequest = reject;
            }),
        ),
      });

      render(<CustomerAuthFlow auth={auth} />);

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      const loadingBtn = await screen.findByRole('button', { name: /Sending OTP/i });
      expect(loadingBtn).toBeDisabled();
      expect(screen.getByLabelText(/Mobile number/i)).toBeDisabled();

      await act(async () => {
        rejectRequest(new TypeError('Failed to fetch'));
      });

      expect(await screen.findByText(/Connection error/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Unable to connect to TheHomez server/i),
      ).toBeInTheDocument();
    });
  });

  describe('Screen 2: OTP Verification & Auth States', () => {
    async function moveToOtpStep(auth: ICustomerAuthContextContract) {
      render(<CustomerAuthFlow auth={auth} />);
      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      await screen.findByText(/Verify your mobile number/i);
    }

    it('auto-focuses first OTP input, formats phone, and shows no fake OTP or bypass', async () => {
      const auth = createMockAuth();
      await moveToOtpStep(auth);

      expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
      const digit1 = screen.getByLabelText('Digit 1 of 6');
      expect(digit1).toHaveFocus();

      // Verify zero fake OTP or bypass controls
      expect(screen.queryByText(/dev otp/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/bypass/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/123456/)).not.toBeInTheDocument();
    });

    it('supports keyboard navigation across the 6 OTP inputs', async () => {
      const auth = createMockAuth();
      await moveToOtpStep(auth);

      const digits = [1, 2, 3, 4, 5, 6].map(
        (n) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement,
      );

      fireEvent.change(digits[0]!, { target: { value: '4' } });
      expect(digits[0]!.value).toBe('4');
      expect(digits[1]!).toHaveFocus();

      fireEvent.keyDown(digits[1]!, { key: 'ArrowLeft' });
      expect(digits[0]!).toHaveFocus();

      fireEvent.keyDown(digits[0]!, { key: 'End' });
      expect(digits[5]!).toHaveFocus();

      fireEvent.keyDown(digits[5]!, { key: 'Home' });
      expect(digits[0]!).toHaveFocus();

      // Backspace on empty slot 1 moves to slot 0 and clears it
      digits[1]!.focus();
      fireEvent.keyDown(digits[1]!, { key: 'Backspace' });
      expect(digits[0]!).toHaveFocus();
      expect(digits[0]!.value).toBe('');
    });

    it('supports pasting a 6-digit OTP code (including spaced/SMS text)', async () => {
      const auth = createMockAuth();
      await moveToOtpStep(auth);

      const digit1 = screen.getByLabelText('Digit 1 of 6');
      fireEvent.paste(digit1, {
        clipboardData: {
          getData: () => 'Your TheHomez OTP is 482 910',
        },
      });

      expect((screen.getByLabelText('Digit 1 of 6') as HTMLInputElement).value).toBe('4');
      expect((screen.getByLabelText('Digit 6 of 6') as HTMLInputElement).value).toBe('0');

      const verifyBtn = screen.getByRole('button', { name: /Verify & Continue/i });
      expect(verifyBtn).toBeEnabled();
    });

    it('handles invalid OTP, expired OTP, and account lockout error states', async () => {
      const verifyOtp = vi
        .fn()
        .mockRejectedValueOnce({
          code: 'INVALID_OTP',
          status: 400,
          message: 'Invalid or expired OTP code. Please check the code or request a new OTP',
        })
        .mockRejectedValueOnce({
          code: 'OTP_EXPIRED',
          status: 400,
          message: 'OTP has expired. Please request a new one',
        })
        .mockRejectedValueOnce({
          code: 'ACCOUNT_LOCKED',
          status: 429,
          message: 'Account temporarily locked due to repeated failed attempts.',
          details: { lockoutRemainingSeconds: 900 },
        });

      const auth = createMockAuth({ verifyOtp });
      await moveToOtpStep(auth);

      // Paste OTP
      fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
        clipboardData: { getData: () => '111111' },
      });

      const verifyBtn = screen.getByRole('button', { name: /Verify & Continue/i });

      // 1. Invalid OTP
      fireEvent.click(verifyBtn);
      expect(await screen.findByText(/Invalid OTP code/i)).toBeInTheDocument();

      // 2. Expired OTP
      fireEvent.click(verifyBtn);
      expect(await screen.findByText(/OTP expired/i)).toBeInTheDocument();
      expect(
        screen.getByText(/This OTP has expired\. Please request a new 6-digit code\./i),
      ).toBeInTheDocument();

      // 3. Account locked
      fireEvent.click(verifyBtn);
      expect(await screen.findByText(/Verification temporarily locked/i)).toBeInTheDocument();
      expect(verifyBtn).toBeDisabled();
      expect(screen.getByLabelText('Digit 1 of 6')).toBeDisabled();
    });

    it('respects backend resend cooldown countdown and allows resending once timer expires', async () => {
      vi.useFakeTimers();
      const requestOtp = vi
        .fn()
        .mockResolvedValueOnce({
          cooldownSeconds: 3,
          expiresInSeconds: 300,
          message: 'OTP challenge dispatched successfully',
        })
        .mockResolvedValueOnce({
          cooldownSeconds: 60,
          expiresInSeconds: 300,
          message: 'OTP challenge dispatched successfully',
        });

      const auth = createMockAuth({ requestOtp });
      render(<CustomerAuthFlow auth={auth} />);

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      });

      expect(screen.getByText(/Resend OTP in/i)).toBeInTheDocument();
      expect(screen.getByText('3s')).toBeInTheDocument();

      // Tick 3 seconds
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      const resendBtn = screen.getByRole('button', { name: /Resend OTP/i });
      expect(resendBtn).toBeEnabled();

      await act(async () => {
        fireEvent.click(resendBtn);
      });

      expect(requestOtp).toHaveBeenCalledTimes(2);
      expect(screen.getByText('60s')).toBeInTheDocument();
    });

    it('allows changing phone number and completes authentication on valid OTP', async () => {
      const mockUser = createMockUser();
      const onSuccess = vi.fn();
      const auth = createMockAuth({
        verifyOtp: vi.fn().mockResolvedValue({
          tokens: { accessToken: 'tok', expiresIn: 900, tokenType: 'Bearer' },
          user: mockUser,
        }),
      });

      render(<CustomerAuthFlow auth={auth} onSuccess={onSuccess} />);

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      await screen.findByText(/Verify your mobile number/i);

      // Change phone number back to Screen 1
      fireEvent.click(screen.getByRole('button', { name: /Change phone number/i }));
      expect(await screen.findByText(/Sign in with mobile number/i)).toBeInTheDocument();

      // Re-submit phone number
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      await screen.findByText(/Verify your mobile number/i);

      // Paste real OTP and verify
      fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
        clipboardData: { getData: () => '654321' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      await waitFor(() => {
        expect(auth.verifyOtp).toHaveBeenCalledWith('+919876543210', '654321');
        expect(onSuccess).toHaveBeenCalledWith(mockUser);
      });

      expect(screen.getByText(/Signed in to TheHomez/i)).toBeInTheDocument();
    });
  });

  describe('Modal, Bridge Provider & Accessibility Standards', () => {
    it('renders CustomerAuthModal as accessible dialog and closes on Escape', () => {
      const auth = createMockAuth();
      const onClose = vi.fn();

      const { rerender } = render(
        <CustomerAuthModal isOpen={false} onClose={onClose} auth={auth} />,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      rerender(<CustomerAuthModal isOpen onClose={onClose} auth={auth} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('consumes AuthContext via CustomerAuthBridgeProvider inside CustomerLoginView', async () => {
      const auth = createMockAuth();
      render(
        <CustomerAuthBridgeProvider value={auth}>
          <CustomerLoginView onBackToStorefront={vi.fn()} />
        </CustomerAuthBridgeProvider>,
      );

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      await waitFor(() => {
        expect(auth.requestOtp).toHaveBeenCalledWith('+919876543210');
      });
    });

    it('does not implement a fallback fetch client when AuthContext is not connected', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      render(<CustomerAuthFlow />);

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      expect(
        await screen.findByText(/Authentication service is not connected/i),
      ).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('integrates directly with Chat A AuthProvider without extra props', async () => {
      const mockUser = createMockUser();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              cooldownSeconds: 45,
              expiresInSeconds: 300,
              message: 'OTP challenge dispatched successfully',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              tokens: { accessToken: 'tok-123', expiresIn: 900, tokenType: 'Bearer' },
              user: mockUser,
            },
          }),
        });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const TriggerButton = () => {
        const { openAuthModal, isAuthenticated, user } = useAuth();
        return (
          <div>
            <button type="button" onClick={openAuthModal}>
              Open Sign In
            </button>
            <span data-testid="auth-state">{isAuthenticated ? user?.phone : 'guest'}</span>
          </div>
        );
      };

      render(
        <AuthProvider skipInitialRestore>
          <TriggerButton />
          <CustomerAuthModal />
        </AuthProvider>,
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Open Sign In/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Mobile number'), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      await screen.findByText(/Verify your mobile number/i);
      expect(screen.getByText('45s')).toBeInTheDocument();

      fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
        clipboardData: { getData: () => '918273' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      await waitFor(() => {
        expect(screen.getByTestId('auth-state')).toHaveTextContent('+919876543210');
      });
      expect(screen.getByText(/Signed in to TheHomez/i)).toBeInTheDocument();
    });

    it('enforces >= 44px touch targets, :focus-visible, and reduced-motion in auth.css', () => {
      const cssPath = path.resolve(__dirname, './auth.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      expect(css).toContain('var(--thz-touch-target, 44px)');
      expect(css).toContain(':focus-visible');
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('ISSUE-5A2-01: shows non-sensitive backend terminal notice only in development and uses delivery-neutral copy in production', async () => {
      const auth = createMockAuth();

      // 1. Development mode (Vitest default import.meta.env.DEV === true)
      const { unmount } = render(<CustomerAuthFlow auth={auth} />);

      const devPhoneNotice = screen.getByTestId('thz-dev-otp-notice');
      expect(devPhoneNotice).toHaveTextContent(/backend terminal/i);
      expect(devPhoneNotice.textContent).not.toMatch(/\b\d{6}\b/);
      expect(screen.queryByText(/sent via SMS/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/carrier rates/i)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Mobile number/i), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      await screen.findByText(/Verify your mobile number/i);

      const devOtpNotice = screen.getByTestId('thz-dev-otp-notice');
      expect(devOtpNotice).toHaveTextContent(/backend terminal/i);
      expect(devOtpNotice.textContent).not.toMatch(/\b\d{6}\b/);
      expect(screen.queryByText(/code sent to/i)).not.toBeInTheDocument();
      unmount();

      // 2. Production simulation (import.meta.env.DEV === false)
      vi.stubEnv('DEV', false);
      try {
        render(<CustomerAuthFlow auth={auth} />);
        expect(screen.queryByTestId('thz-dev-otp-notice')).not.toBeInTheDocument();
        expect(screen.queryByText(/backend terminal/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/sent via SMS/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/carrier rates/i)).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Mobile number/i), {
          target: { value: '9876543210' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        await screen.findByText(/Verify your mobile number/i);

        expect(screen.queryByTestId('thz-dev-otp-notice')).not.toBeInTheDocument();
        expect(screen.queryByText(/backend terminal/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/code sent to/i)).not.toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('ISSUE-5A2-02: dismissing CustomerAuthModal after failed login clears stale AuthContext error for sibling banners', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              cooldownSeconds: 60,
              expiresInSeconds: 300,
              message: 'OTP challenge dispatched successfully',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: false,
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid or expired OTP code. Please check the code or request a new OTP',
            },
          }),
        }) as unknown as typeof fetch;

      const SiblingBannerProbe = () => {
        const { openAuthModal, authError, isAuthModalOpen, isAuthenticated } = useAuth();
        return (
          <div>
            <button type="button" onClick={openAuthModal}>
              Open Sign In
            </button>
            {!isAuthenticated && !isAuthModalOpen && authError ? (
              <div role="alert" data-testid="leaked-session-banner">
                {authError.message}
              </div>
            ) : null}
          </div>
        );
      };

      render(
        <AuthProvider skipInitialRestore>
          <SiblingBannerProbe />
          <CustomerAuthModal />
        </AuthProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: /Open Sign In/i }));
      fireEvent.change(screen.getByLabelText('Mobile number'), {
        target: { value: '9876543210' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      await screen.findByText(/Verify your mobile number/i);

      fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
        clipboardData: { getData: () => '000000' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));
      expect(await screen.findByText(/Invalid OTP code/i)).toBeInTheDocument();

      // Dismiss modal via Escape
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leaked-session-banner')).not.toBeInTheDocument();
    });
  });
});
