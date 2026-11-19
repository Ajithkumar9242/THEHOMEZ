import { describe, it, expect, vi, beforeEach } from 'vitest';
import { partnerClient } from './partner-client.js';
import * as apiClient from '../../../services/api-client.js';
import type {
  IAdminPartnerListResponseDto,
  IPartnerAdminDetailDto,
  IAdminPartnerAuditLogListResponseDto,
} from '@thehomez/shared-types';

describe('partnerClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('listPartners', () => {
    it('constructs correct query parameters and calls apiRequest', async () => {
      const mockResponse: IAdminPartnerListResponseDto = {
        items: [
          {
            id: '507f1f77bcf86cd799439011',
            businessName: 'Apex Building Solutions',
            legalName: 'Apex Infra Materials Ltd',
            phone: '+919977000001',
            email: 'ops@apexinfra.com',
            status: 'ACTIVE',
            deliveryMode: 'PARTNER_MANAGED',
            serviceAreaCount: 2,
            createdAt: '2026-11-19T00:00:00.000Z',
            updatedAt: '2026-11-19T00:00:00.000Z',
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockResponse);

      const result = await partnerClient.listPartners({
        page: 2,
        limit: 10,
        search: 'Apex',
        status: 'ACTIVE',
        serviceAreaId: '507f1f77bcf86cd799439099',
        sortBy: 'businessName',
        sortOrder: 'asc',
      });

      expect(spy).toHaveBeenCalledWith(
        '/admin/partners?page=2&limit=10&search=Apex&status=ACTIVE&serviceAreaId=507f1f77bcf86cd799439099&sortBy=businessName&sortOrder=asc',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('handles default empty query', async () => {
      const mockResponse: IAdminPartnerListResponseDto = {
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

      const result = await partnerClient.listPartners();
      expect(spy).toHaveBeenCalledWith(
        '/admin/partners',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPartnerById', () => {
    it('fetches partner detail by ID with encoded path', async () => {
      const mockDetail: IPartnerAdminDetailDto = {
        id: '507f1f77bcf86cd799439011',
        businessName: 'Apex Building Solutions',
        legalName: 'Apex Infra Materials Ltd',
        phone: '+919977000001',
        email: 'ops@apexinfra.com',
        status: 'ACTIVE',
        deliveryMode: 'PARTNER_MANAGED',
        serviceAreas: [],
        linkedUserCount: 3,
        metadata: { region: 'South' },
        createdAt: '2026-11-19T00:00:00.000Z',
        updatedAt: '2026-11-19T00:00:00.000Z',
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockDetail);

      const result = await partnerClient.getPartnerById('507f1f77bcf86cd799439011');
      expect(spy).toHaveBeenCalledWith(
        '/admin/partners/507f1f77bcf86cd799439011',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockDetail);
    });
  });

  describe('updatePartnerStatus', () => {
    it('sends PATCH request with payload body', async () => {
      const mockDetail: IPartnerAdminDetailDto = {
        id: '507f1f77bcf86cd799439011',
        businessName: 'Apex Building Solutions',
        legalName: 'Apex Infra Materials Ltd',
        phone: '+919977000001',
        email: 'ops@apexinfra.com',
        status: 'SUSPENDED',
        deliveryMode: 'PARTNER_MANAGED',
        serviceAreas: [],
        linkedUserCount: 3,
        metadata: {},
        createdAt: '2026-11-19T00:00:00.000Z',
        updatedAt: '2026-11-19T00:00:00.000Z',
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockDetail);

      const result = await partnerClient.updatePartnerStatus('507f1f77bcf86cd799439011', {
        status: 'SUSPENDED',
        reason: 'Compliance violation confirmed by audit committee',
      });

      expect(spy).toHaveBeenCalledWith(
        '/admin/partners/507f1f77bcf86cd799439011/status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            status: 'SUSPENDED',
            reason: 'Compliance violation confirmed by audit committee',
          }),
        }),
      );
      expect(result.status).toBe('SUSPENDED');
    });
  });

  describe('getPartnerAuditLogs', () => {
    it('fetches partner audit logs with pagination params', async () => {
      const mockLogs: IAdminPartnerAuditLogListResponseDto = {
        items: [
          {
            id: 'log-1',
            action: 'PARTNER_STATUS_CHANGED',
            previousState: { status: 'ACTIVE' },
            newState: { status: 'SUSPENDED' },
            reason: 'Audit compliance review',
            performedBy: {
              id: 'staff-1',
              email: 'admin@thehomez.in',
              phone: '+919977100001',
            },
            createdAt: '2026-11-19T00:00:00.000Z',
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };

      const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockLogs);

      const result = await partnerClient.getPartnerAuditLogs('507f1f77bcf86cd799439011', {
        page: 1,
        limit: 10,
      });

      expect(spy).toHaveBeenCalledWith(
        '/admin/partners/507f1f77bcf86cd799439011/audit-logs?page=1&limit=10',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockLogs);
    });
  });
});
