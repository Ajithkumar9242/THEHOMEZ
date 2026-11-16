import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('Admin temporary email/password authentication UI', () => {
  it('signs in, validates the backend identity and reaches the protected route', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'loginWithPassword').mockResolvedValue(staff);
    vi.spyOn(authApi, 'me').mockResolvedValue(staff);

    render(<TestApp />);
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Admin password'), {
      target: { value: 'development-test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Protected home')).toBeInTheDocument();
    expect(authApi.loginWithPassword).toHaveBeenCalledWith(
      'admin@example.test',
      'development-test-password',
    );
    expect(authApi.me).toHaveBeenCalledOnce();
  });

  it('shows a generic sign-in failure without entering the protected route', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue(null);
    vi.spyOn(authApi, 'loginWithPassword').mockRejectedValue(
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
});
