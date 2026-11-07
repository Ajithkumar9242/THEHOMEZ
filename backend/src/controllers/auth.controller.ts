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
} from '@thehomez/shared-types';
import { OtpService, OtpError } from '../services/otp/otp.service.js';
import { TokenService, TokenError } from '../services/token/token.service.js';
import { RbacService } from '../services/rbac/rbac.service.js';
import { UserModel, type IUserDocument } from '../models/user.model.js';
import { RoleModel } from '../models/role.model.js';
import type {
  OtpRequestDto,
  OtpVerifyDto,
  RefreshTokenDto,
  LogoutDto,
} from '../routes/auth.schemas.js';

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

  /**
   * POST /api/v1/auth/otp/verify
   * Verifies an OTP challenge, provisions CUSTOMER identity if new, and issues token pair.
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

      const authUser = this.formatAuthUser(user, permissions);

      const response: IApiResponse<IAuthResponse> = {
        success: true,
        data: {
          tokens,
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
   */
  public refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as RefreshTokenDto;

      const context = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.socket.remoteAddress,
      };

      const tokens = await this.tokenService.rotateRefreshToken(refreshToken, context);

      const response: IApiResponse<IRefreshTokenResponse> = {
        success: true,
        data: {
          tokens,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof TokenError) {
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
   * Safely revokes the active refresh token session.
   */
  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = (req.body || {}) as LogoutDto;

      if (refreshToken) {
        await this.tokenService.revokeRefreshToken(refreshToken);
      }

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
