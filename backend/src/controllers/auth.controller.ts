import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  type IApiResponse,
  type IApiErrorResponse,
  type IApiErrorDetail,
  type IOtpRequestResponse,
  type IAuthResponse,
  type IRefreshTokenResponse,
  type ILogoutResponse,
  type IUserProfileResponse,
  type IAuthUser,
  type PermissionCode,
  type IAdminLoginChallengeResponse,
  type IAdminMfaSetupResponse,
  type IAdminBackupCodesResponse,
  UserType,
  UserStatus,
} from '@thehomez/shared-types';
import { OtpService, OtpError } from '../services/otp/otp.service.js';
import { TokenService, TokenError } from '../services/token/token.service.js';
import { RbacService } from '../services/rbac/rbac.service.js';
import { TotpService, totpService as defaultTotpService } from '../services/auth/totp.service.js';
import { UserModel, type IUserDocument } from '../models/user.model.js';
import { RoleModel } from '../models/role.model.js';
import { verifyPassword } from '../services/auth/password.service.js';
import { logger } from '../logger/logger.js';
import type {
  AdminLoginDto,
  AdminMfaVerifyDto,
  AdminMfaVerifySetupDto,
  AdminMfaVerifyBackupDto,
  AdminRegenerateBackupCodesDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshTokenDto,
  LogoutDto,
} from '../routes/auth.schemas.js';

import {
  REFRESH_COOKIE_NAME,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  isBrowserClient,
} from '../services/token/cookie.utils.js';

export class AuthController {
  private readonly otpService: OtpService;
  private readonly tokenService: TokenService;
  private readonly rbacService: RbacService;
  private readonly totpService: TotpService;

  constructor(
    customOtpService?: OtpService,
    customTokenService?: TokenService,
    customRbacService?: RbacService,
    customTotpService?: TotpService,
  ) {
    this.otpService = customOtpService || new OtpService();
    this.tokenService = customTokenService || new TokenService();
    this.rbacService = customRbacService || new RbacService();
    this.totpService = customTotpService || defaultTotpService;
  }

  /**
   * Transforms a Mongoose user document and dynamic permissions into a safe client-facing IAuthUser.
   * Internal database fields, password hashes, and OTP records are never exposed.
   */
  private formatAuthUser(user: IUserDocument, permissions: (PermissionCode | string)[]): IAuthUser {
    return {
      id: user._id.toString(),
      phone: user.phone,
      email: user.email,
      userType: user.userType,
      status: user.status,
      roles: user.roles || [],
      permissions,
      partnerId: user.partnerId ? user.partnerId.toString() : undefined,
      customerId: user.customerId ? user.customerId.toString() : undefined,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : undefined,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * POST /api/v1/auth/otp/request
   * Requests an OTP challenge for phone + userType identity tuple.
   */
  public requestOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone, userType } = req.body as OtpRequestDto;

      const result = await this.otpService.requestOtp(phone, userType, req.correlationId);

      const response: IApiResponse<IOtpRequestResponse> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof OtpError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details as unknown as IApiErrorDetail[] } : {}),
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(error.statusCode).json(errorResponse);
        return;
      }
      next(error);
    }
  };

  private extractMfaToken(req: Request): string | undefined {
    const bodyToken = (req.body as { mfaToken?: string })?.mfaToken;
    if (typeof bodyToken === 'string' && bodyToken.trim().length > 0) {
      return bodyToken.trim();
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return undefined;
  }

  private async checkMfaLockout(
    user: IUserDocument,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (user.mfaLockedUntil) {
      const now = Date.now();
      if (user.mfaLockedUntil.getTime() > now) {
        const remainingSecs = Math.max(1, Math.ceil((user.mfaLockedUntil.getTime() - now) / 1000));
        res.status(429).json({
          success: false,
          error: {
            code: 'MFA_ACCOUNT_LOCKED',
            message: `Too many failed MFA attempts. Account temporarily locked for ${remainingSecs} seconds.`,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return true;
      }
      // Lockout duration expired: atomically clear lockout
      user.mfaFailedAttempts = 0;
      user.mfaLockedUntil = null;
      await user.save();
    }
    return false;
  }

  private async recordMfaFailure(userId: unknown): Promise<void> {
    const MAX_MFA_ATTEMPTS = 5;
    const MFA_LOCKOUT_MS = 15 * 60 * 1000;
    try {
      const updated = await UserModel.findByIdAndUpdate(
        userId,
        { $inc: { mfaFailedAttempts: 1 } },
        { new: true },
      );
      if (updated && (updated.mfaFailedAttempts || 0) >= MAX_MFA_ATTEMPTS) {
        await UserModel.findByIdAndUpdate(userId, {
          $set: { mfaLockedUntil: new Date(Date.now() + MFA_LOCKOUT_MS) },
        });
      }
    } catch {
      // Ignore background lockout recording failure
    }
  }

  /**
   * POST /api/v1/auth/admin/login
   * Validates Admin email + password. Returns temporary MFA challenge token.
   */
  public adminLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body as AdminLoginDto;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await UserModel.findOne({
        email: normalizedEmail,
        userType: UserType.STAFF,
      }).select('+passwordHash +mfaEnabled');

      const passwordMatches = await verifyPassword(password, user?.passwordHash);

      if (!user || user.status !== UserStatus.ACTIVE || !passwordMatches) {
        logger.warn(
          {
            email: normalizedEmail,
            ip: req.ip || req.socket?.remoteAddress,
            correlationId: req.correlationId,
          },
          'ADMIN_LOGIN_FAILURE: Invalid credentials or inactive account',
        );
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const challengeId = crypto.randomUUID();
      user.mfaCurrentChallengeId = challengeId;
      await user.save();

      const mfaEnrolled = Boolean(user.mfaEnabled);
      const purpose = mfaEnrolled ? 'mfa_verify' : 'mfa_setup';
      const mfaToken = this.tokenService.signMfaToken(user, purpose, challengeId);

      logger.info(
        {
          userId: user._id.toString(),
          email: normalizedEmail,
          mfaEnrolled,
          correlationId: req.correlationId,
        },
        'ADMIN_MFA_CHALLENGE_ISSUED: MFA challenge token generated',
      );

      const response: IApiResponse<IAdminLoginChallengeResponse> = {
        success: true,
        data: {
          mfaRequired: true,
          mfaEnrolled,
          mfaToken,
          message: mfaEnrolled
            ? 'TOTP multi-factor authentication required.'
            : 'Multi-factor authentication enrollment required.',
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/mfa/setup
   * Initiates MFA enrollment. Generates Base32 secret, otpauth URI, and 10 backup codes.
   */
  public adminMfaSetup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const mfaToken = this.extractMfaToken(req);
      if (!mfaToken) {
        res.status(401).json({
          success: false,
          error: {
            code: 'MFA_TOKEN_REQUIRED',
            message: 'MFA challenge token is required in body or Bearer header.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const decoded = this.tokenService.verifyMfaToken(mfaToken, 'mfa_setup');
      const user = await UserModel.findById(decoded.sub).select(
        '+mfaPendingSecret +mfaBackupCodes +mfaEnabled +mfaCurrentChallengeId +mfaLockedUntil +mfaFailedAttempts',
      );

      if (!user || user.status !== UserStatus.ACTIVE || user.userType !== UserType.STAFF) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authenticated account is invalid or inactive.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (await this.checkMfaLockout(user, req, res)) {
        return;
      }

      if (!user.mfaCurrentChallengeId || user.mfaCurrentChallengeId !== decoded.jti) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_MFA_TOKEN',
            message: 'MFA challenge token is invalid or has already been used.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (user.mfaEnabled) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MFA_ALREADY_ENROLLED',
            message: 'MFA is already enrolled for this account.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const secret = this.totpService.generateSecret();
      const otpauthUri = this.totpService.generateOtpAuthUri(
        user.email || user.phone,
        secret,
        'TheHomez',
      );
      const { plainCodes, hashedRecords } = this.totpService.generateBackupCodes(10);

      user.mfaPendingSecret = secret;
      user.mfaPendingCreatedAt = new Date();
      user.mfaBackupCodes = hashedRecords;
      await user.save();

      const response: IApiResponse<IAdminMfaSetupResponse> = {
        success: true,
        data: {
          secret,
          otpauthUri,
          backupCodes: plainCodes,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/mfa/verify-setup
   * Verifies the first TOTP code and activates MFA on the account.
   */
  public adminMfaVerifySetup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const mfaToken = this.extractMfaToken(req);
      if (!mfaToken) {
        res.status(401).json({
          success: false,
          error: {
            code: 'MFA_TOKEN_REQUIRED',
            message: 'MFA challenge token is required in body or Bearer header.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { code } = req.body as AdminMfaVerifySetupDto;
      const decoded = this.tokenService.verifyMfaToken(mfaToken, 'mfa_setup');
      const user = await UserModel.findById(decoded.sub).select(
        '+mfaPendingSecret +mfaSecret +mfaBackupCodes +mfaEnabled +mfaPendingCreatedAt +mfaCurrentChallengeId +mfaLockedUntil +mfaFailedAttempts +mfaLastTotpCounter',
      );

      if (!user || user.status !== UserStatus.ACTIVE || user.userType !== UserType.STAFF) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authenticated account is invalid or inactive.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (await this.checkMfaLockout(user, req, res)) {
        return;
      }

      if (!user.mfaCurrentChallengeId || user.mfaCurrentChallengeId !== decoded.jti) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_MFA_TOKEN',
            message: 'MFA challenge token is invalid or has already been used.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (!user.mfaPendingSecret) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MFA_SETUP_NOT_INITIATED',
            message: 'MFA enrollment has not been initiated. Please start setup again.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const PENDING_EXPIRY_MS = 15 * 60 * 1000;
      if (
        !user.mfaPendingCreatedAt ||
        Date.now() - user.mfaPendingCreatedAt.getTime() > PENDING_EXPIRY_MS
      ) {
        user.mfaPendingSecret = undefined;
        user.mfaPendingCreatedAt = undefined;
        await user.save();

        res.status(400).json({
          success: false,
          error: {
            code: 'MFA_SETUP_EXPIRED',
            message: 'MFA enrollment session has expired. Please initiate setup again.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const verifyResult = this.totpService.verifyTotp(code, user.mfaPendingSecret);
      if (!verifyResult.valid || typeof verifyResult.counter !== 'number') {
        await this.recordMfaFailure(user._id);
        logger.warn(
          {
            userId: user._id.toString(),
            ip: req.ip || req.socket?.remoteAddress,
            correlationId: req.correlationId,
          },
          'ADMIN_MFA_VERIFY_FAILURE: Invalid code during setup verification',
        );
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOTP_CODE',
            message:
              'Invalid authentication code. Please check your authenticator app and try again.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const updatedUser = await UserModel.findOneAndUpdate(
        {
          _id: user._id,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          mfaCurrentChallengeId: decoded.jti,
          $or: [
            { mfaLastTotpCounter: { $exists: false } },
            { mfaLastTotpCounter: null },
            { mfaLastTotpCounter: { $lt: verifyResult.counter } },
          ],
        },
        {
          $set: {
            mfaSecret: user.mfaPendingSecret,
            mfaEnabled: true,
            mfaLastTotpCounter: verifyResult.counter,
            mfaFailedAttempts: 0,
            mfaLockedUntil: null,
            lastLoginAt: new Date(),
          },
          $unset: {
            mfaPendingSecret: 1,
            mfaPendingCreatedAt: 1,
            mfaCurrentChallengeId: 1,
          },
        },
        { new: true },
      ).select('+mfaEnabled +roles');

      if (!updatedUser) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOTP_CODE',
            message: 'Invalid authentication code or challenge already consumed.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      logger.info(
        {
          userId: user._id.toString(),
          correlationId: req.correlationId,
        },
        'ADMIN_MFA_ENROLLED: Multi-factor authentication successfully activated',
      );

      const permissions = await this.rbacService.getEffectivePermissions(updatedUser.roles || []);
      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket?.remoteAddress,
      };
      const tokens = await this.tokenService.generateTokenPair(updatedUser, context);
      setRefreshTokenCookie(res, tokens.refreshToken);

      const responseTokens: IAuthResponse['tokens'] = isBrowserClient(req)
        ? {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType,
          }
        : tokens;

      const response: IApiResponse<IAuthResponse> = {
        success: true,
        data: {
          tokens: responseTokens,
          user: this.formatAuthUser(updatedUser, permissions),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/mfa/verify
   * Verifies returning Admin TOTP code and issues session tokens.
   */
  public adminMfaVerify = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const mfaToken = this.extractMfaToken(req);
      if (!mfaToken) {
        res.status(401).json({
          success: false,
          error: {
            code: 'MFA_TOKEN_REQUIRED',
            message: 'MFA challenge token is required in body or Bearer header.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { code } = req.body as AdminMfaVerifyDto;
      const decoded = this.tokenService.verifyMfaToken(mfaToken, 'mfa_verify');
      const user = await UserModel.findById(decoded.sub).select(
        '+mfaSecret +mfaEnabled +mfaCurrentChallengeId +mfaLockedUntil +mfaFailedAttempts +mfaLastTotpCounter',
      );

      if (!user || user.status !== UserStatus.ACTIVE || user.userType !== UserType.STAFF) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authenticated account is invalid or inactive.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (await this.checkMfaLockout(user, req, res)) {
        return;
      }

      if (!user.mfaCurrentChallengeId || user.mfaCurrentChallengeId !== decoded.jti) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_MFA_TOKEN',
            message: 'MFA challenge token is invalid or has already been used.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (!user.mfaEnabled || !user.mfaSecret) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MFA_NOT_ENROLLED',
            message: 'MFA is not enrolled for this account.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const verifyResult = this.totpService.verifyTotp(code, user.mfaSecret);
      if (!verifyResult.valid || typeof verifyResult.counter !== 'number') {
        await this.recordMfaFailure(user._id);
        logger.warn(
          {
            userId: user._id.toString(),
            ip: req.ip || req.socket?.remoteAddress,
            correlationId: req.correlationId,
          },
          'ADMIN_MFA_VERIFY_FAILURE: Invalid TOTP code supplied',
        );
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOTP_CODE',
            message:
              'Invalid authentication code. Please check your authenticator app and try again.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (
        typeof user.mfaLastTotpCounter === 'number' &&
        verifyResult.counter <= user.mfaLastTotpCounter
      ) {
        await this.recordMfaFailure(user._id);
        logger.warn(
          {
            userId: user._id.toString(),
            counter: verifyResult.counter,
            lastCounter: user.mfaLastTotpCounter,
            correlationId: req.correlationId,
          },
          'ADMIN_MFA_VERIFY_FAILURE: TOTP code replay detected',
        );
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOTP_CODE',
            message:
              'Invalid authentication code. Please check your authenticator app and try again.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const updatedUser = await UserModel.findOneAndUpdate(
        {
          _id: user._id,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          mfaCurrentChallengeId: decoded.jti,
          $or: [
            { mfaLastTotpCounter: { $exists: false } },
            { mfaLastTotpCounter: null },
            { mfaLastTotpCounter: { $lt: verifyResult.counter } },
          ],
        },
        {
          $set: {
            mfaLastTotpCounter: verifyResult.counter,
            mfaFailedAttempts: 0,
            mfaLockedUntil: null,
            lastLoginAt: new Date(),
          },
          $unset: {
            mfaCurrentChallengeId: 1,
          },
        },
        { new: true },
      ).select('+mfaEnabled +roles');

      if (!updatedUser) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOTP_CODE',
            message: 'Invalid authentication code or challenge already consumed.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      logger.info(
        {
          userId: user._id.toString(),
          correlationId: req.correlationId,
        },
        'ADMIN_LOGIN_SUCCESS: Staff signed in successfully via TOTP',
      );

      const permissions = await this.rbacService.getEffectivePermissions(updatedUser.roles || []);
      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket?.remoteAddress,
      };
      const tokens = await this.tokenService.generateTokenPair(updatedUser, context);
      setRefreshTokenCookie(res, tokens.refreshToken);

      const responseTokens: IAuthResponse['tokens'] = isBrowserClient(req)
        ? {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType,
          }
        : tokens;

      const response: IApiResponse<IAuthResponse> = {
        success: true,
        data: {
          tokens: responseTokens,
          user: this.formatAuthUser(updatedUser, permissions),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/mfa/verify-backup
   * Verifies a single-use Admin backup code and issues session tokens.
   */
  public adminMfaVerifyBackup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const mfaToken = this.extractMfaToken(req);
      if (!mfaToken) {
        res.status(401).json({
          success: false,
          error: {
            code: 'MFA_TOKEN_REQUIRED',
            message: 'MFA challenge token is required in body or Bearer header.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { backupCode } = req.body as AdminMfaVerifyBackupDto;
      const decoded = this.tokenService.verifyMfaToken(mfaToken, 'mfa_verify');
      const user = await UserModel.findById(decoded.sub).select(
        '+mfaBackupCodes +mfaEnabled +mfaCurrentChallengeId +mfaLockedUntil +mfaFailedAttempts',
      );

      if (!user || user.status !== UserStatus.ACTIVE || user.userType !== UserType.STAFF) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authenticated account is invalid or inactive.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (await this.checkMfaLockout(user, req, res)) {
        return;
      }

      if (!user.mfaCurrentChallengeId || user.mfaCurrentChallengeId !== decoded.jti) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_MFA_TOKEN',
            message: 'MFA challenge token is invalid or has already been used.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const targetHash = this.totpService.hashBackupCode(backupCode);

      const updatedUser = await UserModel.findOneAndUpdate(
        {
          _id: decoded.sub,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          mfaCurrentChallengeId: decoded.jti,
          mfaBackupCodes: {
            $elemMatch: {
              codeHash: targetHash,
              usedAt: null,
            },
          },
        },
        {
          $set: {
            'mfaBackupCodes.$.usedAt': new Date(),
            mfaFailedAttempts: 0,
            mfaLockedUntil: null,
            lastLoginAt: new Date(),
          },
          $unset: {
            mfaCurrentChallengeId: 1,
          },
        },
        { new: true },
      ).select('+mfaBackupCodes +mfaEnabled +roles');

      if (!updatedUser) {
        await this.recordMfaFailure(user._id);
        logger.warn(
          {
            userId: user._id.toString(),
            ip: req.ip || req.socket?.remoteAddress,
            correlationId: req.correlationId,
          },
          'ADMIN_MFA_VERIFY_FAILURE: Invalid or used backup code',
        );
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_BACKUP_CODE',
            message: 'Invalid or already used backup code.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      logger.info(
        {
          userId: user._id.toString(),
          correlationId: req.correlationId,
        },
        'ADMIN_BACKUP_CODE_USED: Staff signed in successfully via backup code',
      );

      const permissions = await this.rbacService.getEffectivePermissions(updatedUser.roles || []);
      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket?.remoteAddress,
      };
      const tokens = await this.tokenService.generateTokenPair(updatedUser, context);
      setRefreshTokenCookie(res, tokens.refreshToken);

      const responseTokens: IAuthResponse['tokens'] = isBrowserClient(req)
        ? {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType,
          }
        : tokens;

      const response: IApiResponse<IAuthResponse> = {
        success: true,
        data: {
          tokens: responseTokens,
          user: this.formatAuthUser(updatedUser, permissions),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/mfa/backup-codes/regenerate
   * Regenerates 10 new backup codes for an authenticated staff user.
   */
  public adminRegenerateBackupCodes = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const principal = req.user;
      if (!principal || principal.userType !== UserType.STAFF) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Administrative staff privileges required.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { password } = req.body as AdminRegenerateBackupCodesDto;
      const user = await UserModel.findById(principal.id).select('+passwordHash +mfaBackupCodes');

      if (!user || user.status !== UserStatus.ACTIVE) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User account is inactive.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const passwordMatches = await verifyPassword(password, user.passwordHash);
      if (!passwordMatches) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Current password confirmation failed.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { plainCodes, hashedRecords } = this.totpService.generateBackupCodes(10);
      user.mfaBackupCodes = hashedRecords;
      await user.save();

      logger.info(
        {
          userId: user._id.toString(),
          correlationId: req.correlationId,
        },
        'ADMIN_MFA_BACKUP_CODES_REGENERATED: 10 new backup codes generated',
      );

      const response: IApiResponse<IAdminBackupCodesResponse> = {
        success: true,
        data: {
          backupCodes: plainCodes,
          message: 'New backup codes generated successfully. Store them in a secure location.',
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Temporary development-only Admin sign-in has been permanently decommissioned.
   * Standard MFA-enforced login (/admin/login) is strictly required.
   */
  public adminPasswordLogin = async (req: Request, res: Response): Promise<void> => {
    res.status(404).json({
      success: false,
      error: {
        code: 'AUTH_UNAVAILABLE',
        message:
          'Temporary password-only Admin sign-in has been permanently decommissioned. Use standard MFA authentication.',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    });
  };

  /**
   * POST /api/v1/auth/otp/verify
   * Verifies an OTP challenge, provisions CUSTOMER identity if new, and issues token pair.
   * Sets HTTP-only secure cookie and suppresses refresh token from browser-facing JSON bodies.
   */
  public verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone, otp, userType } = req.body as OtpVerifyDto;

      const { user } = await this.otpService.verifyOtp(phone, otp, userType);

      // Resolve current permissions dynamically from database roles
      const permissions = await this.rbacService.getEffectivePermissions(user.roles || []);

      // Generate access token & opaque refresh token pair
      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket.remoteAddress,
      };
      const tokens = await this.tokenService.generateTokenPair(user, context);

      // Issue HTTP-only secure cookie for refresh token
      setRefreshTokenCookie(res, tokens.refreshToken);

      const authUser = this.formatAuthUser(user, permissions);

      // For browser clients, omit refreshToken from JSON response body to prevent JavaScript XSS exposure
      const responseTokens: IAuthResponse['tokens'] = isBrowserClient(req)
        ? {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType,
          }
        : tokens;

      const response: IApiResponse<IAuthResponse> = {
        success: true,
        data: {
          tokens: responseTokens,
          user: authUser,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof OtpError) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details as unknown as IApiErrorDetail[] } : {}),
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(error.statusCode).json(errorResponse);
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/refresh
   * Rotates an opaque refresh token atomically with automatic reuse detection.
   * Reads token from HTTP-only cookie or request body (for non-browser backward compatibility).
   */
  public refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const bodyToken = (req.body as RefreshTokenDto)?.refreshToken;
      const refreshToken = cookieToken || bodyToken;

      const hasRefreshCookie = cookieToken !== undefined;

      if (!refreshToken || typeof refreshToken !== 'string') {
        if (hasRefreshCookie) {
          clearRefreshTokenCookie(res);
        }
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Refresh token is required in cookie or request body',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
            details: [{ field: 'refreshToken', message: 'Refresh token is required' }],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate format
      const parts = refreshToken.split('.');
      if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
        if (hasRefreshCookie) {
          clearRefreshTokenCookie(res);
        }
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Malformed refresh token format',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
            details: [{ field: 'refreshToken', message: 'Malformed refresh token format' }],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket.remoteAddress,
      };

      const tokens = await this.tokenService.rotateRefreshToken(refreshToken, context);

      // Rotate HTTP-only cookie with the new token
      setRefreshTokenCookie(res, tokens.refreshToken);

      // Browser clients (including cookie-authenticated requests) must NEVER receive refreshToken in JSON
      const browserClient = isBrowserClient(req);
      const responseTokens: IRefreshTokenResponse['tokens'] = browserClient
        ? {
            accessToken: tokens.accessToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType,
          }
        : tokens;

      const response: IApiResponse<IRefreshTokenResponse> = {
        success: true,
        data: {
          tokens: responseTokens,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
        if (req.cookies?.[REFRESH_COOKIE_NAME]) {
          clearRefreshTokenCookie(res);
        }
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(error.statusCode).json(errorResponse);
        return;
      }
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/logout
   * Safely revokes the active refresh token session and clears the HTTP-only cookie.
   */
  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const bodyToken = (req.body as LogoutDto)?.refreshToken;
      const refreshToken = cookieToken || bodyToken;

      if (refreshToken && typeof refreshToken === 'string') {
        await this.tokenService.revokeRefreshToken(refreshToken);
      } else if (req.user?.id) {
        await this.tokenService.revokeAllUserSessions(req.user.id);
      } else {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Refresh token is required to log out',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
            details: [
              { field: 'refreshToken', message: 'Refresh token is required in cookie or body' },
            ],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Clear the HTTP-only cookie
      clearRefreshTokenCookie(res);

      const response: IApiResponse<ILogoutResponse> = {
        success: true,
        data: {
          message: 'Successfully logged out',
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/logout-all
   * Revokes all active sessions for the authenticated user and clears browser cookie.
   */
  public logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = req.user;
      if (!principal) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token is required',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(401).json(errorResponse);
        return;
      }

      await this.tokenService.revokeAllUserSessions(principal.id);
      clearRefreshTokenCookie(res);

      const response: IApiResponse<ILogoutResponse> = {
        success: true,
        data: {
          message: 'Successfully logged out from all devices',
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/auth/me
   * Returns current authenticated user identity and dynamically queried database permissions.
   */
  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = req.user;
      if (!principal) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token is required',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(401).json(errorResponse);
        return;
      }

      const user = await UserModel.findById(principal.id);
      if (!user) {
        const errorResponse: IApiErrorResponse = {
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User profile not found',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(404).json(errorResponse);
        return;
      }

      const authUser = this.formatAuthUser(user, principal.permissions);

      const response: IApiResponse<IUserProfileResponse> = {
        success: true,
        data: {
          user: authUser,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/auth/roles
   * Administrative role discovery endpoint guarded by RBAC_MANAGE permission.
   */
  public getRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = req.user;
      const query: Record<string, unknown> = {};

      // Restrict role scope to staff administration or requesting identity context
      if (principal?.userType !== UserType.STAFF) {
        query.userType = principal?.userType;
      }

      const roles = await RoleModel.find(query).sort({ code: 1 });

      const safeRoles = roles.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        userType: r.userType,
        isSystemManaged: r.isSystemManaged,
        permissions: r.permissions,
        createdAt: r.createdAt.toISOString(),
      }));

      const response: IApiResponse<{ roles: typeof safeRoles }> = {
        success: true,
        data: {
          roles: safeRoles,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/auth/admin/activity
   * Records explicit client-side Admin user activity and confirms active session status.
   */
  public recordAdminActivity = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const adminSession = req.adminSession;
      if (!adminSession) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_SESSION',
            message: 'Active Admin session required',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      await this.tokenService.recordAdminActivity(adminSession._id);

      res.status(200).json({
        success: true,
        data: {
          active: true,
          lastActivityAt: new Date().toISOString(),
          absoluteExpiresAt: adminSession.absoluteExpiresAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
