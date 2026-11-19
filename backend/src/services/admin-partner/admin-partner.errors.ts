/**
 * Domain errors for administrative partner management.
 * Formatted consistently with the centralized error handler.
 */
export class AdminPartnerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AdminPartnerError';
  }
}
