import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UserStatus, UserType, type IAuthUser } from '@thehomez/shared-types';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  authApi,
  clearAccessToken,
  setUnauthorizedHandler,
} from '../services/api-client.js';

interface AuthContextValue {
  user: IAuthUser | null;
  status: 'loading' | 'signed-out' | 'signed-in';
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

function assertActiveStaff(user: IAuthUser): void {
  if (user.userType !== UserType.STAFF || user.status !== UserStatus.ACTIVE) {
    clearAccessToken();
    throw new ApiError('This account is not an active staff account.', 403, 'STAFF_REQUIRED');
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IAuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  const expire = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(expire);
    let active = true;
    void (async () => {
      const token = await authApi.refresh();
      if (!token) {
        if (active) setStatus('signed-out');
        return;
      }
      try {
        const identity = await authApi.me();
        assertActiveStaff(identity);
        if (active) {
          setUser(identity);
          setStatus('signed-in');
        }
      } catch {
        expire();
      }
    })();
    return () => {
      active = false;
      setUnauthorizedHandler(undefined);
    };
  }, [expire]);

  const signIn = useCallback(async (email: string, password: string) => {
    const verified = await authApi.loginWithPassword(email, password);
    assertActiveStaff(verified);
    const identity = await authApi.me();
    assertActiveStaff(identity);
    setUser(identity);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      expire();
    }
  }, [expire]);

  const value = useMemo(() => ({ user, status, signIn, signOut }), [user, status, signIn, signOut]);
  if (status === 'loading')
    return (
      <main className="auth-page">
        <Typography.Text>Checking staff session…</Typography.Text>
      </main>
    );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const submit = async (values: { email: string; password: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await signIn(values.email, values.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email or password is incorrect.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <Card className="signin-card" variant="borderless">
        <Typography.Text className="eyebrow">THEHOMEZ · ADMIN</Typography.Text>
        <Typography.Title level={2}>Admin sign in</Typography.Title>
        <Typography.Paragraph type="secondary">
          Sign in with an authorized development Admin account.
        </Typography.Paragraph>
        <Alert
          className="dev-alert"
          type="warning"
          showIcon
          message="Development authentication"
          description="Temporary development email/password authentication. MFA is not implemented, and production Admin authentication is not approved."
        />
        <Form layout="vertical" onFinish={submit} disabled={busy}>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Enter your email address.' },
              { type: 'email', message: 'Enter a valid email address.' },
            ]}
          >
            <Input autoComplete="username" aria-label="Admin email" maxLength={254} />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Enter your password.' }]}
          >
            <Input.Password
              autoComplete="current-password"
              aria-label="Admin password"
              maxLength={128}
              visibilityToggle
            />
          </Form.Item>
          {error && <Alert className="form-message" type="error" showIcon message={error} />}
          <Button type="primary" htmlType="submit" block loading={busy}>
            Sign in
          </Button>
        </Form>
      </Card>
    </main>
  );
}
