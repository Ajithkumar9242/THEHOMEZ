import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import { AuthController } from '../controllers/auth.controller.js';
import { getConfig } from '../config/env.js';
import {
  authenticate,
  optionalAuthenticate,
  authorize,
  staffOnlyGuard,
  createAuthRateLimiter,
  createOtpIpRateLimiter,
  validateBody,
  csrfProtectionMiddleware,
} from '../middleware/index.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  adminLoginSchema,
  adminPasswordLoginSchema,
  adminMfaSetupSchema,
  adminMfaVerifySetupSchema,
  adminMfaVerifySchema,
  adminMfaVerifyBackupSchema,
  adminRegenerateBackupCodesSchema,
  refreshTokenSchema,
  logoutSchema,
} from './auth.schemas.js';

export function createAuthRouter(controller?: AuthController): Router {
  const router = Router();
  const defaultController = new AuthController();
  const authController = controller || defaultController;

  const adminLogin = authController.adminLogin || defaultController.adminLogin;
  const adminMfaSetup = authController.adminMfaSetup || defaultController.adminMfaSetup;
  const adminMfaVerifySetup = authController.adminMfaVerifySetup || defaultController.adminMfaVerifySetup;
  const adminMfaVerify = authController.adminMfaVerify || defaultController.adminMfaVerify;
  const adminMfaVerifyBackup = authController.adminMfaVerifyBackup || defaultController.adminMfaVerifyBackup;
  const adminRegenerateBackupCodes = authController.adminRegenerateBackupCodes || defaultController.adminRegenerateBackupCodes;
  const adminPasswordLogin = authController.adminPasswordLogin || defaultController.adminPasswordLogin;
  const requestOtp = authController.requestOtp || defaultController.requestOtp;
  const verifyOtp = authController.verifyOtp || defaultController.verifyOtp;
  const refreshToken = authController.refreshToken || defaultController.refreshToken;
  const logout = authController.logout || defaultController.logout;
  const logoutAll = authController.logoutAll || defaultController.logoutAll;
  const getMe = authController.getMe || defaultController.getMe;
  const getRoles = authController.getRoles || defaultController.getRoles;

  // Dual rate limiters for OTP operations: Global IP layer + Scoped Phone/IP layer
  const otpIpRateLimiter = createOtpIpRateLimiter();
  const otpVerifyIpRateLimiter = createOtpIpRateLimiter();
  const otpRateLimiter = createAuthRateLimiter();

  // Rate limiter for general auth operations (refresh, logout)
  const authRateLimiter = createAuthRateLimiter();

  // Admin Rate Limiter for Login and MFA challenges
  const adminAuthRateLimiter = createAuthRateLimiter({ limit: 10 });

  // Admin Authentication & MFA Endpoints
  router.post(
    '/admin/login',
    adminAuthRateLimiter,
    csrfProtectionMiddleware,
    validateBody(adminLoginSchema),
    adminLogin,
  );

  router.post(
    '/admin/mfa/setup',
    adminAuthRateLimiter,
    csrfProtectionMiddleware,
    validateBody(adminMfaSetupSchema),
    adminMfaSetup,
  );

  router.post(
    '/admin/mfa/verify-setup',
    adminAuthRateLimiter,
    csrfProtectionMiddleware,
    validateBody(adminMfaVerifySetupSchema),
    adminMfaVerifySetup,
  );

  router.post(
    '/admin/mfa/verify',
    adminAuthRateLimiter,
    csrfProtectionMiddleware,
    validateBody(adminMfaVerifySchema),
    adminMfaVerify,
  );

  router.post(
    '/admin/mfa/verify-backup',
    adminAuthRateLimiter,
    csrfProtectionMiddleware,
    validateBody(adminMfaVerifyBackupSchema),
    adminMfaVerifyBackup,
  );

  router.post(
    '/admin/mfa/backup-codes/regenerate',
    authenticate,
    staffOnlyGuard,
    validateBody(adminRegenerateBackupCodesSchema),
    adminRegenerateBackupCodes,
  );

  // Temporary Admin password auth is preserved for development and existing test compatibility.
  if (getConfig().isDevelopment || getConfig().isTest) {
    router.post(
      '/admin/password',
      createAuthRateLimiter(),
      csrfProtectionMiddleware,
      validateBody(adminPasswordLoginSchema),
      adminPasswordLogin,
    );
  }

  // 1. Phone OTP Request (Dual Rate-Limited: Global IP + Phone/IP, Validated)
  router.post(
    '/otp/request',
    otpIpRateLimiter,
    otpRateLimiter,
    validateBody(otpRequestSchema),
    requestOtp,
  );

  // 2. Phone OTP Verification & Token Issuance (Dual Rate-Limited: Global IP + Phone/IP, Validated)
  router.post(
    '/otp/verify',
    otpVerifyIpRateLimiter,
    otpRateLimiter,
    validateBody(otpVerifySchema),
    verifyOtp,
  );

  // 3. Refresh Token Rotation (Rate-Limited, CSRF-Protected for cookies, Validated)
  router.post(
    '/refresh',
    authRateLimiter,
    csrfProtectionMiddleware,
    validateBody(refreshTokenSchema),
    refreshToken,
  );

  // 4. Session Revocation / Logout (Rate-Limited, CSRF-Protected for cookies, Optional Auth, Validated)
  router.post(
    '/logout',
    authRateLimiter,
    csrfProtectionMiddleware,
    optionalAuthenticate,
    validateBody(logoutSchema),
    logout,
  );

  // 4b. Global Session Revocation / Logout All Devices (Protected by JWT Authentication)
  router.post('/logout-all', authenticate, logoutAll);

  // 5. User Profile (Protected by JWT Authentication)
  router.get('/me', authenticate, getMe);

  // 6. Administrative Role Discovery (Protected by JWT Authentication & RBAC_MANAGE Permission)
  router.get(
    '/roles',
    authenticate,
    authorize(PermissionCode.RBAC_MANAGE),
    getRoles,
  );

  return router;
}

export const authRouter = createAuthRouter();
