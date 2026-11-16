/**
 * Customer Address Book Domain Errors
 *
 * Maps domain error codes (including shared ADDRESS_ERROR_CODES)
 * to deterministic HTTP status codes without exposing internal details.
 */
export class CustomerAddressError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'CustomerAddressError';
  }
}
