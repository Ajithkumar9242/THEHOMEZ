/**
 * Delivery Responsibility Model
 * Defined in SRS Section 5.4 (FR-PART-004) and Section 5.13 (FR-FUL-001)
 */
export enum DeliveryMode {
  PLATFORM_MANAGED = 'PLATFORM_MANAGED', // TheHomez logistics fleet or integrated logistics carrier
  PARTNER_MANAGED = 'PARTNER_MANAGED', // Partner vendor direct drop / internal delivery fleet
}
