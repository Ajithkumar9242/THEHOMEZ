import { describe, it, expect } from 'vitest';
import {
  PARTNER_APPLICATION_STATUSES,
  type IPartnerApplicationDto,
  type CreatePartnerApplicationInput,
} from '../src/index.js';

describe('PartnerApplication Shared Types & Contracts', () => {
  it('exports exactly the six approved PartnerApplicationStatus values', () => {
    expect(PARTNER_APPLICATION_STATUSES).toEqual([
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ]);
    expect(PARTNER_APPLICATION_STATUSES.length).toBe(6);
  });

  it('allows constructing valid type-safe DTO and Input objects', () => {
    const input: CreatePartnerApplicationInput = {
      businessName: 'Apex Materials Pvt Ltd',
      legalName: 'Apex Materials Corporation',
      phone: '+919876543210',
      email: 'onboarding@apexmaterials.com',
      deliveryMode: 'PARTNER_MANAGED',
      serviceAreaIds: ['60d5ecb8b5c9c62b3c8b4567'],
      previousApplicationId: '60d5ecb8b5c9c62b3c8b4566',
      metadata: {
        pan: 'ABCDE1234F',
        gstin: '29ABCDE1234F1Z5',
        tradeLicense: 'TL-2026-9988',
      },
      initialUser: {
        contactName: 'Rajesh Sharma',
        phone: '+919876543210',
        email: 'rajesh@apexmaterials.com',
      },
    };

    expect(input.businessName).toBe('Apex Materials Pvt Ltd');
    expect(input.initialUser.contactName).toBe('Rajesh Sharma');
    expect(input.metadata?.pan).toBe('ABCDE1234F');

    const dto: IPartnerApplicationDto = {
      id: '60d5ecb8b5c9c62b3c8b4568',
      businessName: input.businessName,
      legalName: input.legalName ?? null,
      phone: input.phone,
      email: input.email ?? null,
      deliveryMode: input.deliveryMode ?? 'PARTNER_MANAGED',
      serviceAreaIds: input.serviceAreaIds ?? [],
      metadata: input.metadata ?? {},
      initialUser: input.initialUser,
      status: 'SUBMITTED',
      refusalReasonCode: null,
      rejectionReason: null,
      previousApplicationId: input.previousApplicationId ?? null,
      assignedStaffUserId: null,
      partnerId: null,
      auditHistory: [
        {
          action: 'APPLICATION_SUBMITTED',
          performedBy: '60d5ecb8b5c9c62b3c8b4560',
          timestamp: new Date().toISOString(),
          newStatus: 'SUBMITTED',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(dto.status).toBe('SUBMITTED');
    expect(dto.auditHistory.length).toBe(1);
    expect(dto.auditHistory[0]!.action).toBe('APPLICATION_SUBMITTED');
  });
});
