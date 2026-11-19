/**
 * Domain errors for partner application lifecycle management.
 * Formatted consistently with the centralized error handler and IApiErrorResponse.
 */
export class PartnerApplicationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'PartnerApplicationError';
  }
}
