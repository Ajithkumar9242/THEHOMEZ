import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';
import type { IApiErrorResponse, IApiErrorDetail } from '@thehomez/shared-types';

/**
 * Express middleware that validates incoming request body against a Zod schema.
 * Formats validation errors consistently according to IApiErrorResponse with HTTP 400.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: IApiErrorDetail[] = error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        const response: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: details[0]?.message || 'Invalid request payload',
            details,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };

        res.status(400).json(response);
        return;
      }
      next(error);
    }
  };
}

/**
 * Express middleware that validates incoming request query against a Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.query);
      req.query = parsed as unknown as Request['query'];
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: IApiErrorDetail[] = error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        const response: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: details[0]?.message || 'Invalid query parameters',
            details,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };

        res.status(400).json(response);
        return;
      }
      next(error);
    }
  };
}

/**
 * Express middleware that validates incoming request params against a Zod schema.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.params);
      req.params = parsed as Record<string, string>;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: IApiErrorDetail[] = error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        const response: IApiErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: details[0]?.message || 'Invalid URL parameters',
            details,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
          },
        };

        res.status(400).json(response);
        return;
      }
      next(error);
    }
  };
}
