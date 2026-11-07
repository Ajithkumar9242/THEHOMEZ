/**
 * Pricing Domain Errors
 *
 * Strongly typed error hierarchy for the pricing engine, validation, and resolution.
 * Maps exact domain error codes to corresponding HTTP status codes.
 */
export class PricingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}
