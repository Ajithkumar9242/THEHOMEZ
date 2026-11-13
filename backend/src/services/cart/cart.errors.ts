/**
 * Domain Error for Customer Cart Operations (Milestone 5B.2).
 */
export class CartError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'CartError';
  }
}
