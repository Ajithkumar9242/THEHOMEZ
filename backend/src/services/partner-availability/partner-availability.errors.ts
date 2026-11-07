/**
 * Partner Availability Domain Errors
 *
 * Strongly typed error hierarchy for partner product availability management,
 * validation, optimistic concurrency control, and service area resolution.
 * Maps exact domain error codes to corresponding HTTP status codes.
 */
export class PartnerAvailabilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'PartnerAvailabilityError';
  }
}
