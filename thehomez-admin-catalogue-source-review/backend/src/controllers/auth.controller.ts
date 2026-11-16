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
  UserType,
  UserStatus,
} from '@thehomez/shared-types';
import { OtpService, OtpError } from '../services/otp/otp.service.js';
import { TokenService, TokenError } from '../services/token/token.service.js';
import { RbacService } from '../services/rbac/rbac.service.js';
import { UserModel, type IUserDocument } from '../models/user.model.js';
import { RoleModel } from '../models/role.model.js';
import { getDatabaseDiagnostics } from '../database/database.js';
import { verifyPassword } from '../services/auth/password.service.js';
import type {
  AdminPasswordLoginDto,
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

  constructor(
    customOtpService?: OtpService,
    customTokenService?: TokenService,
    customRbacService?: RbacService,
  ) {
    this.otpService = customOtpService || new OtpService();
    this.tokenService = customTokenService || new TokenService();
    this.rbacService = customRbacService || new RbacService();
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

  /** Temporary development-only Admin sign-in, scoped to the isolated verification database. */
  public adminPasswordLogin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const diagnostics = getDatabaseDiagnostics();
      if (diagnostics.status !== 'connected' || diagnostics.name !== 'thehomez_admin_verify') {
        res.status(404).json({
          success: false,
          error: {
            code: 'AUTH_UNAVAILABLE',
            message: 'Temporary Admin sign-in is unavailable.',
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const { email, password } = req.body as AdminPasswordLoginDto;
      const user = await UserModel.findOne({ email, userType: UserType.STAFF }).select(
        '+passwordHash',
      );
      const passwordMatches = await verifyPassword(password, user?.passwordHash);

      if (!user || user.status !== UserStatus.ACTIVE || !passwordMatches) {
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

      const permissions = await this.rbacService.getEffectivePermissions(user.roles || []);
      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket.remoteAddress,
      };
      const tokens = await this.tokenService.generateTokenPair(user, context);
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
          user: this.formatAuthUser(user, permissions),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
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
}
