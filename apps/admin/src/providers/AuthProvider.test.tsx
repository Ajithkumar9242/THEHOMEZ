import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionCode, UserStatus, UserType, type IAuthUser } from '@thehomez/shared-types';
import { ApiError, authApi } from '../services/api-client.js';
import { AuthProvider, SignInPage, useAuth } from './AuthProvider.js';
import { ProtectedRoute } from '../routes/ProtectedRoute.js';

const staff: IAuthUser = {
  id: 'opaque-test-id',
  phone: '+919876543210',
  email: 'admin@example.test',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['ADMIN_CATEGORY_READONLY'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function SignOutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>Sign out</button>;
}

function TestApp({ initialPath = '/sign-in' }: { initialPath?: string }) {
  return (
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
            <Route path="/" element={<span>Protected home</span>} />
            <Route
              path="/protected"
              element={
                <>
                  <span>Protected catalogue</span>
                  <SignOutButton />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('Admin MFA authentication UI & fallback absence', () => {
  it('normal login proceeds to MFA challenge and does not grant direct session access', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      mfaRequired: true,
      mfaEnrolled: true,
      mfaToken: 'test-mfa-token',
      message: 'TOTP required',
    });

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'secure-admin-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Protected home')).not.toBeInTheDocument();
  });

  it('no password-only fallback occurs if the MFA login endpoint returns 404', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError('Endpoint not found', 404, 'NOT_FOUND'),
    );
    const fallbackSpy = vi.spyOn(authApi, 'loginWithPassword');

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'development-test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Endpoint not found')).toBeInTheDocument();
    expect(screen.queryByText('Protected home')).not.toBeInTheDocument();
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('shows a generic sign-in failure without entering the protected route', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError('Invalid email or password.', 401, 'INVALID_CREDENTIALS'),
    );

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'incorrect-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.queryByText('Protected catalogue')).not.toBeInTheDocument();
  });

  it('displays an appropriate error when invalid MFA code is submitted', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      mfaRequired: true,
      mfaEnrolled: true,
      mfaToken: 'test-verify-mfa-token',
      message: 'TOTP required',
    });
    vi.spyOn(authApi, 'mfaVerify').mockRejectedValue(
      new ApiError('Invalid or expired authentication code.', 401, 'INVALID_MFA_CODE'),
    );

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'secure-admin-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('TOTP code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid or expired authentication code.')).toBeInTheDocument();
    expect(screen.queryByText('Protected home')).not.toBeInTheDocument();
  });

  it('restores an existing cookie session and enforces the route permission', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue('memory-access-token');
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp initialPath="/protected" />);

    expect(await screen.findByText('Protected catalogue')).toBeInTheDocument();
    expect(authApi.refresh).toHaveBeenCalledOnce();
    expect(authApi.me).toHaveBeenCalledOnce();
  });

  it('redirects to sign-in after logout and clears the frontend session', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue('memory-access-token');
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);
    vi.spyOn(authApi, 'logout').mockResolvedValue({ message: 'Successfully logged out' });

    render(<TestApp initialPath="/protected" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(authApi.logout).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
  });

  it('shows the permission-required state for an authenticated STAFF without CATALOG_READ', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue('memory-access-token');
    vi.spyOn(authApi, 'me').mockResolvedValue({ ...staff, permissions: [] });

    render(<TestApp initialPath="/protected" />);

    expect(await screen.findByText('Permission required')).toBeInTheDocument();
  });

  it('guides unenrolled admin through mandatory MFA setup with QR, backup codes, and code verification', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      mfaRequired: true,
      mfaEnrolled: false,
      mfaToken: 'test-setup-mfa-token',
      message: 'MFA setup required',
    });
    vi.spyOn(authApi, 'mfaSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/TheHomez:admin%40example.test?secret=JBSWY3DPEHPK3PXP',
      backupCodes: [
        'code1-11111',
        'code2-22222',
        'code3-33333',
        'code4-44444',
        'code5-55555',
        'code6-66666',
        'code7-77777',
        'code8-88888',
        'code9-99999',
        'code0-00000',
      ],
    });
    vi.spyOn(authApi, 'mfaVerifySetup').mockResolvedValue(staff);
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'secure-admin-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // User should see the MFA setup screen
    expect(await screen.findByRole('heading', { name: 'Set up MFA' })).toBeInTheDocument();
    expect(screen.getByText('code1-11111')).toBeInTheDocument();
    expect(screen.getByText('code0-00000')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    // User enters 6-digit TOTP code
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and activate MFA' }));

    expect(await screen.findByText('Protected home')).toBeInTheDocument();
    expect(authApi.mfaVerifySetup).toHaveBeenCalledWith('test-setup-mfa-token', '123456');
  });

  it('prompts enrolled admin for TOTP verification and completes login on valid code', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      mfaRequired: true,
      mfaEnrolled: true,
      mfaToken: 'test-verify-mfa-token',
      message: 'TOTP required',
    });
    vi.spyOn(authApi, 'mfaVerify').mockResolvedValue(staff);
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'secure-admin-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // User should see the Two-step verification screen
    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();

    // User enters 6-digit TOTP code
    fireEvent.change(screen.getByLabelText('TOTP code'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Protected home')).toBeInTheDocument();
    expect(authApi.mfaVerify).toHaveBeenCalledWith('test-verify-mfa-token', '654321');
  });

  it('allows enrolled admin to authenticate via backup code recovery flow', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      mfaRequired: true,
      mfaEnrolled: true,
      mfaToken: 'test-backup-mfa-token',
      message: 'TOTP required',
    });
    vi.spyOn(authApi, 'mfaVerifyBackup').mockResolvedValue(staff);
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'secure-admin-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();

    // Toggle to backup code
    fireEvent.click(screen.getByRole('button', { name: 'Lost access? Use a backup code' }));

    // Enter backup code
    fireEvent.change(await screen.findByLabelText('Admin backup code'), {
      target: { value: 'code1-11111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify backup code' }));

    expect(await screen.findByText('Protected home')).toBeInTheDocument();
    expect(authApi.mfaVerifyBackup).toHaveBeenCalledWith('test-backup-mfa-token', 'code1-11111');
  });

  it('13. clears authentication state when frontend idle timeout is reached', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(authApi, 'refresh').mockResolvedValue('valid-token');
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp initialPath="/" />);

    expect(await screen.findByText('Protected home')).toBeInTheDocument();

    // Advance 30 minutes of inactivity
    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000 + 20000);
    });

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Protected home')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('background heartbeat is suppressed during unattended idle periods and does not keep session alive', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(authApi, 'refresh').mockResolvedValue('valid-token');
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);
    const activitySpy = vi.spyOn(authApi, 'recordActivity').mockResolvedValue(undefined);

    render(<TestApp initialPath="/" />);

    expect(await screen.findByText('Protected home')).toBeInTheDocument();

    // Advance 6 minutes without user interaction
    act(() => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });

    // Unattended session must NOT dispatch heartbeat
    expect(activitySpy).not.toHaveBeenCalled();

    // Advance to 30 minutes total inactivity
    act(() => {
      vi.advanceTimersByTime(25 * 60 * 1000);
    });

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Protected home')).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
