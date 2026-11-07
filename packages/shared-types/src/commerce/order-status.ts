/**
 * Suggested Parent Order Lifecycle States
 * Defined in SRS Section 8.1
 */
export enum ParentOrderStatus {
  DRAFT = 'DRAFT',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  PARTIALLY_FULFILLED = 'PARTIALLY_FULFILLED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}
