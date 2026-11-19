import { describe, it, expect, vi, beforeEach } from 'vitest';
import { partnerApplicationClient } from './partner-application-client.js';
import * as apiClient from '../../../services/api-client.js';
import {
  DeliveryMode,
  type IPartnerApplicationListResponseDto,
  type IPartnerApplicationDto,
  type CreatePartnerApplicationInput,
  type IRejectPartnerApplicationInput,
  type IWithdrawPartnerApplicationInput,
  type IApprovePartnerApplicationInput,
} from '@thehomez/shared-types';

describe('partnerApplicationClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('listApplications', () => {
    it('constructs correct query parameters and calls apiRequest', async () => {
      const mockResponse: IPartnerApplicationListResponseDto = {
        items: [
          {
            id: '6afeda40f3df3797cb1b2481',
            businessName: 'Apex Building Solutions',
            phone: '+919977000001',
            email: 'ops@apexinfra.com',
            status: 'SUBMITTED',
            deliveryMode: DeliveryMode.PARTNER_MANAGED,
            serviceAreaCount: 2,
            assignedStaffUserId: null,
            createdAt: '2026-11-19T00:00:00.000Z',
            updatedAt: '2026-11-19T00:00:00.000Z',
          },
        ],
        pagination: {
          total: 1,
          page: 2,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: true,
        },
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResponse);

      const result = await partnerApplicationClient.listApplications({
        page: 2,
        limit: 10,
        search: 'Apex',
        status: 'SUBMITTED',
        serviceAreaId: '507f1f77bcf86cd799439099',
        sortBy: 'businessName',
        sortOrder: 'asc',
      });

      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications?page=2&limit=10&search=Apex&status=SUBMITTED&serviceAreaId=507f1f77bcf86cd799439099&sortBy=businessName&sortOrder=asc',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('handles default empty query', async () => {
      const mockResponse: IPartnerApplicationListResponseDto = {
        items: [],
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResponse);

      const result = await partnerApplicationClient.listApplications();
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getApplicationById', () => {
    it('fetches application detail by ID with encoded path', async () => {
      const mockDetail: IPartnerApplicationDto = {
        id: '6afeda40f3df3797cb1b2481',
        businessName: 'Apex Building Solutions',
        legalName: 'Apex Infra Materials Ltd',
        phone: '+919977000001',
        email: 'ops@apexinfra.com',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        serviceAreaIds: ['sa-1'],
        metadata: { license: 'TL-1234' },
        initialUser: {
          contactName: 'John Builder',
          phone: '+919977000002',
          email: 'john@apexinfra.com',
        },
        status: 'SUBMITTED',
        refusalReasonCode: null,
        rejectionReason: null,
        previousApplicationId: null,
        assignedStaffUserId: null,
        partnerId: null,
        auditHistory: [],
        createdAt: '2026-11-19T00:00:00.000Z',
        updatedAt: '2026-11-19T00:00:00.000Z',
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockDetail);

      const result = await partnerApplicationClient.getApplicationById('6afeda40f3df3797cb1b2481');
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications/6afeda40f3df3797cb1b2481',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockDetail);
    });
  });

  describe('createApplication', () => {
    it('sends POST request with input payload', async () => {
      const input: CreatePartnerApplicationInput = {
        businessName: 'New Vendor Infra',
        phone: '+919988776655',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        serviceAreaIds: ['sa-1'],
        initialUser: {
          contactName: 'Vijay Kumar',
          phone: '+919988776654',
        },
      };

      const mockResult = { id: 'app-new-1', ...input } as unknown as IPartnerApplicationDto;
      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResult);

      const result = await partnerApplicationClient.createApplication(input);
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('reviewApplication', () => {
    it('sends POST /:id/review with empty body', async () => {
      const mockResult = {
        id: 'app-1',
        status: 'UNDER_REVIEW',
      } as unknown as IPartnerApplicationDto;
      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResult);

      const result = await partnerApplicationClient.reviewApplication('app-1');
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications/app-1/review',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
      expect(result.status).toBe('UNDER_REVIEW');
    });
  });

  describe('rejectApplication', () => {
    it('sends POST /:id/reject with refusal code and reason', async () => {
      const input: IRejectPartnerApplicationInput = {
        refusalReasonCode: 'INCOMPLETE_DOCUMENTATION',
        reason: 'Trade license document was expired and blurry.',
      };
      const mockResult = {
        id: 'app-1',
        status: 'REJECTED',
        ...input,
      } as unknown as IPartnerApplicationDto;
      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResult);

      const result = await partnerApplicationClient.rejectApplication('app-1', input);
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications/app-1/reject',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('withdrawApplication', () => {
    it('sends POST /:id/withdraw with reason', async () => {
      const input: IWithdrawPartnerApplicationInput = {
        reason: 'Applicant requested voluntary withdrawal due to restructuring.',
      };
      const mockResult = {
        id: 'app-1',
        status: 'WITHDRAWN',
      } as unknown as IPartnerApplicationDto;
      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResult);

      const result = await partnerApplicationClient.withdrawApplication('app-1', input);
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications/app-1/withdraw',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      expect(result.status).toBe('WITHDRAWN');
    });
  });

  describe('approveApplication', () => {
    it('sends POST /:id/approve with reason and affirmative checklist', async () => {
      const input: IApprovePartnerApplicationInput = {
        reason: 'All credentials, GSTIN, and service coverage verified satisfactorily.',
        checklist: {
          identityVerified: true,
          serviceAreaConfirmed: true,
          complianceConfirmed: true,
        },
      };

      const mockResponse = {
        application: { id: 'app-1', status: 'APPROVED', partnerId: 'ptr-1' },
        partner: { id: 'ptr-1', businessName: 'Apex Building Solutions', status: 'ACTIVE' },
      };
      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResponse);

      const result = await partnerApplicationClient.approveApplication('app-1', input);
      expect(spy).toHaveBeenCalledWith(
        '/admin/partner-applications/app-1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
