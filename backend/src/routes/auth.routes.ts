import { Router } from 'express';
import { PermissionCode } from '@thehomez/shared-types';
import { AuthController } from '../controllers/auth.controller.js';
import {
  authenticate,
  authorize,
  createAuthRateLimiter,
  validateBody,
} from '../middleware/index.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  refreshTokenSchema,
  logoutSchema,
} from './auth.schemas.js';

export function createAuthRouter(controller?: AuthController): Router {
  const router = Router();
  const authController = controller || new AuthController();

  // Rate limiter specifically for OTP operations (scoped by IP + phone)
  const otpRateLimiter = createAuthRateLimiter();

  // Rate limiter for general auth operations (refresh, logout)
  const authRateLimiter = createAuthRateLimiter();

  // 1. Phone OTP Request (Public, Rate-Limited, Validated)
  router.post(
    '/otp/request',
    otpRateLimiter,
    validateBody(otpRequestSchema),
    authController.requestOtp,
  );

  // 2. Phone OTP Verification & Token Issuance (Public, Rate-Limited, Validated)
  router.post(
    '/otp/verify',
    otpRateLimiter,
    validateBody(otpVerifySchema),
    authController.verifyOtp,
  );

  // 3. Refresh Token Rotation (Rate-Limited, Validated)
  router.post(
    '/refresh',
    authRateLimiter,
    validateBody(refreshTokenSchema),
    authController.refreshToken,
  );

  // 4. Session Revocation / Logout (Rate-Limited, Validated)
  router.post('/logout', authRateLimiter, validateBody(logoutSchema), authController.logout);

  // 5. User Profile (Protected by JWT Authentication)
  router.get('/me', authenticate, authController.getMe);

  // 6. Administrative Role Discovery (Protected by JWT Authentication & RBAC_MANAGE Permission)
  router.get(
    '/roles',
    authenticate,
    authorize(PermissionCode.RBAC_MANAGE),
    authController.getRoles,
  );

  return router;
}

export const authRouter = createAuthRouter();
