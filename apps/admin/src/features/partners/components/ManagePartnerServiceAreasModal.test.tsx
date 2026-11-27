import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IPartnerAdminDetailDto, IServiceArea } from '@thehomez/shared-types';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { partnerClient } from '../api/partner-client.js';
import { ManagePartnerServiceAreasModal } from './ManagePartnerServiceAreasModal.js';

vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: {
    list: vi.fn(),
  },
}));

vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    assignServiceAreas: vi.fn(),
  },
}));

const mockPartner: IPartnerAdminDetailDto = {
  id: '507f1f77bcf86cd799439011',
  businessName: 'Apex Building Solutions',
  legalName: 'Apex Infra Materials Ltd',
  phone: '9876543210',
  email: 'ops@apexinfra.com',
  status: 'ACTIVE',
  deliveryMode: 'PARTNER_MANAGED',
  serviceAreas: [
    {
      id: 'area-1',
      code: 'DEL-NORTH',
      name: 'Delhi North Central Hub',
      city: 'Delhi',
      state: 'Delhi',
      pincodeCount: 15,
      isActive: true,
    },
  ],
  linkedUserCount: 2,
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockAvailableAreas: IServiceArea[] = [
  {
    id: 'area-1',
    code: 'DEL-NORTH',
    name: 'Delhi North Central Hub',
    city: 'Delhi',
    state: 'Delhi',
    countryCode: 'IN',
    pincodes: ['110001', '110002'],
    deliveryRadiusKm: 25,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'area-2',
    code: 'DEL-SOUTH',
    name: 'Delhi South Distribution Hub',
    city: 'Delhi',
    state: 'Delhi',
    countryCode: 'IN',
    pincodes: ['110017', '110019'],
    deliveryRadiusKm: 30,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('ManagePartnerServiceAreasModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders available operational service areas', async () => {
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: mockAvailableAreas,
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    });

    render(
      <ManagePartnerServiceAreasModal
        open={true}
        partner={mockPartner}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('DEL-NORTH')).toBeInTheDocument();
      expect(screen.getByText('DEL-SOUTH')).toBeInTheDocument();
    });
  });

  it('submits updated service area selections and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: mockAvailableAreas,
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    });

    vi.mocked(partnerClient.assignServiceAreas).mockResolvedValue({
      partnerId: mockPartner.id,
      serviceAreaIds: ['area-1', 'area-2'],
    });

    render(
      <ManagePartnerServiceAreasModal
        open={true}
        partner={mockPartner}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('DEL-SOUTH')).toBeInTheDocument();
    });

    // Check second area checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    // Index 0 is select all, 1 is row 1, 2 is row 2
    if (checkboxes[2]) {
      fireEvent.click(checkboxes[2]);
    }

    const submitBtn = screen.getByRole('button', { name: /Save Service Hubs/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(partnerClient.assignServiceAreas).toHaveBeenCalledWith(
        mockPartner.id,
        expect.arrayContaining(['area-1', 'area-2']),
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
