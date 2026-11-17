/**
 * Domain errors for administrative customer management.
 * Formatted consistently with the centralized error handler.
 */
export class AdminCustomerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AdminCustomerError';
  }
}
