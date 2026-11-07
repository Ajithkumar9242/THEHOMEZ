import type { UserType } from './user-type.js';
import type { UserStatus } from './user-status.js';
import type { PermissionCode } from './permissions.js';

/**
 * Payload for requesting an authentication OTP.
 */
export interface IOtpRequestInput {
  phone: string;
  userType: UserType;
}

/**
 * Response payload returned after an OTP request.
 */
export interface IOtpRequestResponse {
  cooldownSeconds: number;
  expiresInSeconds: number;
  message: string;
}

/**
 * Payload for verifying an OTP and obtaining credentials.
 */
export interface IOtpVerifyInput {
  phone: string;
  otp: string;
  userType: UserType;
}

/**
 * Standard token pair returned upon successful authentication or rotation.
 */
export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Standard representation of an authenticated user identity.
 */
export interface IAuthUser {
  id: string;
  phone: string;
  email?: string;
  userType: UserType;
  status: UserStatus;
  roles: string[];
  permissions: (PermissionCode | string)[];
  partnerId?: string;
  customerId?: string;
  lastLoginAt?: Date | string;
  createdAt: Date | string;
}

/**
 * Combined authentication response containing tokens and identity.
 */
export interface IAuthResponse {
  tokens: IAuthTokens;
  user: IAuthUser;
}

/**
 * Payload for refreshing an access token via rotation.
 */
export interface IRefreshTokenInput {
  refreshToken: string;
}

/**
 * Response payload for token refresh.
 */
export interface IRefreshTokenResponse {
  tokens: IAuthTokens;
}

/**
 * Payload for logging out and revoking an active session.
 */
export interface ILogoutInput {
  refreshToken?: string;
}

/**
 * Standard response payload for logout.
 */
export interface ILogoutResponse {
  message: string;
}

/**
 * Response payload for identity profile lookup (/auth/me).
 */
export interface IUserProfileResponse {
  user: IAuthUser;
}
