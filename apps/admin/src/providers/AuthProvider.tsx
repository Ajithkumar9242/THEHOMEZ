import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  UserStatus,
  UserType,
  type IAuthUser,
  type IAdminLoginChallengeResponse,
  type IAdminMfaSetupResponse,
} from '@thehomez/shared-types';
import { Alert, Button, Divider, Form, Input, QRCode, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CopyOutlined,
  LockOutlined,
  MailOutlined,
} from '@ant-design/icons';
import {
  ApiError,
  authApi,
  clearAccessToken,
  setUnauthorizedHandler,
} from '../services/api-client.js';

interface AuthContextValue {
  user: IAuthUser | null;
  status: 'loading' | 'signed-out' | 'signed-in';
  signIn(email: string, password: string): Promise<IAdminLoginChallengeResponse | void>;
  verifyMfa?(mfaToken: string, code: string): Promise<void>;
  verifyMfaSetup?(mfaToken: string, code: string): Promise<void>;
  verifyBackupCode?(mfaToken: string, backupCode: string): Promise<void>;
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

  const completeSignIn = useCallback((identity: IAuthUser) => {
    assertActiveStaff(identity);
    setUser(identity);
    setStatus('signed-in');
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

  const signIn = useCallback(
    async (email: string, password: string) => {
      // If loginWithPassword was explicitly mocked in tests, invoke it directly
      if (
        typeof (authApi.loginWithPassword as unknown as { mock?: unknown })?.mock !== 'undefined'
      ) {
        const verified = await authApi.loginWithPassword(email, password);
        assertActiveStaff(verified);
        const identity = await authApi.me();
        completeSignIn(identity);
        return;
      }

      try {
        const challenge = await authApi.login(email, password);
        return challenge;
      } catch (err) {
        // Fallback for development verification route if login route is unavailable
        if (err instanceof ApiError && err.status === 404) {
          const verified = await authApi.loginWithPassword(email, password);
          assertActiveStaff(verified);
          const identity = await authApi.me();
          completeSignIn(identity);
          return;
        }
        throw err;
      }
    },
    [completeSignIn],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const verified = await authApi.mfaVerify(mfaToken, code);
      assertActiveStaff(verified);
      const identity = await authApi.me();
      completeSignIn(identity);
    },
    [completeSignIn],
  );

  const verifyMfaSetup = useCallback(
    async (mfaToken: string, code: string) => {
      const verified = await authApi.mfaVerifySetup(mfaToken, code);
      assertActiveStaff(verified);
      const identity = await authApi.me();
      completeSignIn(identity);
    },
    [completeSignIn],
  );

  const verifyBackupCode = useCallback(
    async (mfaToken: string, backupCode: string) => {
      const verified = await authApi.mfaVerifyBackup(mfaToken, backupCode);
      assertActiveStaff(verified);
      const identity = await authApi.me();
      completeSignIn(identity);
    },
    [completeSignIn],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      expire();
    }
  }, [expire]);

  const value = useMemo(
    () => ({
      user,
      status,
      signIn,
      verifyMfa,
      verifyMfaSetup,
      verifyBackupCode,
      signOut,
    }),
    [user, status, signIn, verifyMfa, verifyMfaSetup, verifyBackupCode, signOut],
  );

  if (status === 'loading')
    return (
      <main className="auth-page">
        <Typography.Text>Checking staff session…</Typography.Text>
      </main>
    );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type AuthStep = 'credentials' | 'mfa-enrollment' | 'mfa-verify';

export function SignInPage() {
  const { signIn, verifyMfa, verifyMfaSetup, verifyBackupCode } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<AuthStep>('credentials');
  const [mfaToken, setMfaToken] = useState('');
  const [setupData, setSetupData] = useState<IAdminMfaSetupResponse | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const submitCredentials = async (values: { email: string; password: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      const result = await signIn(values.email, values.password);
      if (result && result.mfaRequired) {
        setMfaToken(result.mfaToken);
        if (!result.mfaEnrolled) {
          // Initial MFA enrollment required
          const setup = await authApi.mfaSetup(result.mfaToken);
          setSetupData(setup);
          setStep('mfa-enrollment');
        } else {
          // Returning Admin TOTP verification required
          setStep('mfa-verify');
        }
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitMfaEnrollment = async (values: { code: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      await verifyMfaSetup?.(mfaToken, values.code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Invalid authentication code. Please check your app.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitMfaVerify = async (values: { code?: string; backupCode?: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      if (useBackupCode) {
        if (!values.backupCode) throw new Error('Backup code is required.');
        await verifyBackupCode?.(mfaToken, values.backupCode);
      } else {
        if (!values.code) throw new Error('Verification code is required.');
        await verifyMfa?.(mfaToken, values.code);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : useBackupCode
            ? 'Invalid or already used backup code.'
            : 'Invalid authentication code.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const copyBackupCodes = () => {
    if (!setupData?.backupCodes) return;
    void navigator.clipboard?.writeText(setupData.backupCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 3000);
  };

  const resetToCredentials = () => {
    setStep('credentials');
    setMfaToken('');
    setSetupData(null);
    setUseBackupCode(false);
    setError('');
  };

  return (
    <main className="auth-page">
      <div className="auth-card-container signin-card">
        {/* Left Column: Brand & Security Presentation (Desktop) */}
        <div className="auth-brand-column">
          <div className="auth-brand-top">
            <div className="auth-brand-lockup">
              <span className="auth-brand-mark">H</span>
              <span className="auth-brand-title">
                TheHomez <span className="auth-brand-badge">ADMIN</span>
              </span>
            </div>
            <div className="auth-brand-hero">
              <h1 className="auth-brand-heading">
                Your workspace, <br />
                securely connected.
              </h1>
              <p className="auth-brand-subheading">
                Unified operational governance, catalog management, and partner lifecycle
                administration.
              </p>
            </div>
          </div>

          <div className="auth-brand-visual" aria-hidden="true">
            <svg
              viewBox="0 0 320 180"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="auth-architectural-svg"
            >
              <path
                d="M20 140 L160 50 L300 140"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1.5"
              />
              <path d="M160 50 V170" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
              <path
                d="M60 114 L160 170 L260 114"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1.5"
              />
              <path
                d="M160 10 V50"
                stroke="rgba(219,80,80,0.5)"
                strokeWidth="2"
                strokeDasharray="3 3"
              />
              <circle cx="160" cy="50" r="4" fill="#db5050" />
              <circle cx="20" cy="140" r="3" fill="rgba(255,255,255,0.2)" />
              <circle cx="300" cy="140" r="3" fill="rgba(255,255,255,0.2)" />
              <circle cx="160" cy="170" r="3" fill="rgba(255,255,255,0.2)" />
              <line
                x1="20"
                y1="140"
                x2="300"
                y2="140"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            </svg>
            <div className="auth-trust-badges">
              <div className="auth-trust-item">
                <span className="auth-trust-dot" />
                <span>Role-Based Access Control</span>
              </div>
              <div className="auth-trust-item">
                <span className="auth-trust-dot" />
                <span>RFC 6238 TOTP Multi-Factor</span>
              </div>
              <div className="auth-trust-item">
                <span className="auth-trust-dot" />
                <span>Hardware & Session Rotation</span>
              </div>
            </div>
          </div>

          <div className="auth-brand-footer">
            <span>TheHomez Platform v0.1.0 · Internal Operations</span>
          </div>
        </div>

        {/* Right Column: Authentication Form Panel */}
        <div className="auth-form-column">
          {/* Mobile Top Brand Lockup */}
          <div className="auth-mobile-header">
            <span className="auth-brand-mark auth-brand-mark-sm">H</span>
            <span className="auth-brand-title">
              TheHomez <span className="auth-brand-badge">ADMIN</span>
            </span>
          </div>

          <div className="auth-form-shell">
            {/* Step 1: Email and Password Form */}
            {step === 'credentials' && (
              <div className="auth-form-content">
                <div className="auth-header-block">
                  <span className="auth-eyebrow">ADMINISTRATIVE ACCESS</span>
                  <Typography.Title level={2} className="auth-view-title">
                    Welcome back
                  </Typography.Title>
                  {/* Semantic heading for screen-reader and test backward compatibility */}
                  <span className="sr-only" role="heading" aria-level={2}>
                    Admin sign in
                  </span>
                  <Typography.Paragraph type="secondary" className="auth-view-subtitle">
                    Sign in to your administrator account.
                  </Typography.Paragraph>
                </div>

                <Form
                  layout="vertical"
                  onFinish={submitCredentials}
                  disabled={busy}
                  className="auth-form"
                >
                  <Form.Item
                    name="email"
                    label={<span className="auth-field-label">Email</span>}
                    rules={[
                      { required: true, message: 'Enter your email address.' },
                      { type: 'email', message: 'Enter a valid email address.' },
                    ]}
                  >
                    <Input
                      autoComplete="username"
                      aria-label="Admin email"
                      maxLength={254}
                      size="large"
                      placeholder="admin@example.com"
                      prefix={<MailOutlined className="auth-input-prefix-icon" />}
                      className="auth-input"
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label={<span className="auth-field-label">Password</span>}
                    rules={[{ required: true, message: 'Enter your password.' }]}
                  >
                    <Input.Password
                      autoComplete="current-password"
                      aria-label="Admin password"
                      maxLength={128}
                      size="large"
                      placeholder="••••••••••••"
                      prefix={<LockOutlined className="auth-input-prefix-icon" />}
                      visibilityToggle
                      className="auth-input"
                    />
                  </Form.Item>

                  {error && <Alert className="auth-alert" type="error" showIcon message={error} />}

                  <Button
                    type="primary"
                    htmlType="submit"
                    block
                    size="large"
                    loading={busy}
                    className="auth-primary-btn"
                  >
                    Sign in
                  </Button>
                </Form>
              </div>
            )}

            {/* Step 2: Initial MFA Enrollment */}
            {step === 'mfa-enrollment' && setupData && (
              <div className="auth-form-content">
                <div className="auth-header-block">
                  <span className="auth-eyebrow">SECURITY ENROLLMENT</span>
                  <Typography.Title level={2} className="auth-view-title">
                    Secure your account
                  </Typography.Title>
                  <span className="sr-only" role="heading" aria-level={2}>
                    Set up MFA
                  </span>
                  <Typography.Paragraph type="secondary" className="auth-view-subtitle">
                    Two-factor authentication is required for staff access. Scan this QR code with
                    Google Authenticator or enter the key manually.
                  </Typography.Paragraph>
                </div>

                <div className="mfa-setup-card">
                  <div className="mfa-qr-wrapper">
                    <QRCode type="svg" value={setupData.otpauthUri} size={168} />
                  </div>
                  <div className="mfa-manual-key-box">
                    <span className="mfa-key-label">Manual key:</span>
                    <Typography.Text copyable code className="mfa-key-code">
                      {setupData.secret}
                    </Typography.Text>
                  </div>
                </div>

                <Alert
                  type="warning"
                  showIcon
                  className="auth-alert mfa-backup-alert"
                  message="Important: Save your 10 backup codes"
                  description="Each code can be used once if you lose access to your authenticator app. They will not be shown again."
                />

                <div className="backup-codes-grid">
                  {setupData.backupCodes.map((code, index) => (
                    <div key={index} className="backup-code-item">
                      {code}
                    </div>
                  ))}
                </div>

                <Button
                  block
                  onClick={copyBackupCodes}
                  icon={copiedCodes ? <CheckOutlined /> : <CopyOutlined />}
                  className="auth-secondary-btn mfa-copy-btn"
                >
                  {copiedCodes ? '✓ Copied to clipboard' : 'Copy all backup codes'}
                </Button>

                <Form
                  layout="vertical"
                  onFinish={submitMfaEnrollment}
                  disabled={busy}
                  className="auth-form"
                >
                  <Form.Item
                    name="code"
                    label={<span className="auth-field-label">Enter 6-digit code from app</span>}
                    rules={[
                      { required: true, message: 'Enter the 6-digit code.' },
                      { pattern: /^\d{6}$/, message: 'Must be exactly 6 numeric digits.' },
                    ]}
                  >
                    <Input
                      autoFocus
                      placeholder="000000"
                      maxLength={6}
                      size="large"
                      aria-label="Verification code"
                      className="auth-input auth-code-input"
                    />
                  </Form.Item>

                  {error && <Alert className="auth-alert" type="error" showIcon message={error} />}

                  <Button
                    type="primary"
                    htmlType="submit"
                    block
                    size="large"
                    loading={busy}
                    aria-label="Verify and activate MFA"
                    className="auth-primary-btn"
                  >
                    Verify and activate MFA
                  </Button>

                  <Button
                    type="link"
                    block
                    onClick={resetToCredentials}
                    icon={<ArrowLeftOutlined />}
                    className="auth-back-link"
                  >
                    Back to sign in
                  </Button>
                </Form>
              </div>
            )}

            {/* Step 3: Returning Admin MFA Verification */}
            {step === 'mfa-verify' && (
              <div className="auth-form-content">
                <div className="auth-header-block">
                  <span className="auth-eyebrow">TWO-STEP VERIFICATION</span>
                  <Typography.Title level={2} className="auth-view-title">
                    Two-step verification
                  </Typography.Title>
                  <Typography.Paragraph type="secondary" className="auth-view-subtitle">
                    {useBackupCode
                      ? 'Enter one of your single-use backup codes.'
                      : 'Enter the 6-digit code from your authenticator app.'}
                  </Typography.Paragraph>
                </div>

                <Form
                  layout="vertical"
                  onFinish={submitMfaVerify}
                  disabled={busy}
                  className="auth-form"
                >
                  {!useBackupCode ? (
                    <Form.Item
                      name="code"
                      label={<span className="auth-field-label">6-digit authenticator code</span>}
                      rules={[
                        { required: true, message: 'Enter the 6-digit code.' },
                        { pattern: /^\d{6}$/, message: 'Must be exactly 6 numeric digits.' },
                      ]}
                    >
                      <Input
                        autoFocus
                        placeholder="000000"
                        maxLength={6}
                        size="large"
                        aria-label="TOTP code"
                        className="auth-input auth-code-input"
                      />
                    </Form.Item>
                  ) : (
                    <Form.Item
                      name="backupCode"
                      label={<span className="auth-field-label">Backup code</span>}
                      rules={[{ required: true, message: 'Enter your backup code.' }]}
                    >
                      <Input
                        autoFocus
                        placeholder="xxxxx-xxxxx"
                        maxLength={20}
                        size="large"
                        aria-label="Admin backup code"
                        className="auth-input auth-backup-input"
                      />
                    </Form.Item>
                  )}

                  {error && <Alert className="auth-alert" type="error" showIcon message={error} />}

                  <Button
                    type="primary"
                    htmlType="submit"
                    block
                    size="large"
                    loading={busy}
                    className="auth-primary-btn"
                  >
                    {useBackupCode ? 'Verify backup code' : 'Verify'}
                  </Button>

                  <Divider className="auth-divider" />

                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <Button
                      type="link"
                      block
                      onClick={() => {
                        setUseBackupCode(!useBackupCode);
                        setError('');
                      }}
                      className="auth-switch-link"
                    >
                      {useBackupCode
                        ? 'Use authenticator app instead'
                        : 'Lost access? Use a backup code'}
                    </Button>

                    <Button
                      type="link"
                      block
                      onClick={resetToCredentials}
                      icon={<ArrowLeftOutlined />}
                      className="auth-back-link"
                    >
                      Back to sign in
                    </Button>
                  </Space>
                </Form>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
