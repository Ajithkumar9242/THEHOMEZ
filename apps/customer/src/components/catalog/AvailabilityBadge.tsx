/**
 * Localized Storefront Availability Badge
 *
 * Implements tri-state localization semantics:
 * - Unlocalized: "Enter PIN for availability" (AC-DISCOV-01)
 * - Serviceable & In Stock: "In Stock • Ready in Xh" (AC-DISCOV-02)
 * - Serviceable & Out of Stock: "Out of Stock in area" (AC-DISCOV-03)
 * - Unserviceable PIN: "Delivery not available" (AC-DISCOV-04 / AC-DISCOV-25)
 *
 * WCAG 2.1 AA Contrast Compliant (AC-DISCOV-24)
 */

import React from 'react';
import type { IStorefrontAvailabilityDto } from '@thehomez/shared-types';

export interface AvailabilityBadgeProps {
  availability: IStorefrontAvailabilityDto;
  className?: string;
}

export const AvailabilityBadge: React.FC<AvailabilityBadgeProps> = ({
  availability,
  className = '',
}) => {
  // 1. Unlocalized browsing
  if (availability.availabilityUnknown || availability.isAvailable === null) {
    return (
      <span
        className={`thz-avail-badge unlocalized ${className}`}
        aria-label="Availability unknown. Enter delivery PIN code to check local availability"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span>Enter PIN for availability</span>
      </span>
    );
  }

  // 2. Localized Serviceable & In Stock
  if (availability.isAvailable) {
    const leadTimeText =
      availability.minLeadTimeHours !== null ? ` • ${availability.minLeadTimeHours}h` : '';
    return (
      <span
        className={`thz-avail-badge in-stock ${className}`}
        aria-label={`In stock locally. Minimum lead time ${availability.minLeadTimeHours ?? 'standard'} hours.`}
      >
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }} aria-hidden="true" />
        <span>In Stock{leadTimeText}</span>
      </span>
    );
  }

  // 3. Unserviceable Area (serviceAreaId is null and isAvailable is false)
  if (availability.serviceAreaId === null) {
    return (
      <span
        className={`thz-avail-badge unserviceable ${className}`}
        aria-label="Delivery not available in this postal area."
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>Delivery not available</span>
      </span>
    );
  }

  // 4. Localized Serviceable & Out of Stock (serviceAreaId present, availablePartnerCount is 0)
  return (
    <span
      className={`thz-avail-badge out-of-stock ${className}`}
      aria-label="Out of stock in your area."
    >
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#EF4444', display: 'inline-block' }} aria-hidden="true" />
      <span>Out of Stock in area</span>
    </span>
  );
};
