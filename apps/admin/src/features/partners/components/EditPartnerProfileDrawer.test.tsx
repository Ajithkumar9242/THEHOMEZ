import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IPartnerAdminDetailDto } from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { EditPartnerProfileDrawer } from './EditPartnerProfileDrawer.js';

vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    updatePartnerProfile: vi.fn(),
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
  serviceAreas: [],
  linkedUserCount: 2,
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('EditPartnerProfileDrawer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders and prepopulates form fields from partner detail', () => {
    render(
      <EditPartnerProfileDrawer
        open={true}
        partner={mockPartner}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Apex Building Solutions')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Apex Infra Materials Ltd')).toBeInTheDocument();
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ops@apexinfra.com')).toBeInTheDocument();
  });

  it('displays security notice when toggling primary operator phone sync', async () => {
    render(
      <EditPartnerProfileDrawer
        open={true}
        partner={mockPartner}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /Sync phone number with primary partner user credentials/i,
    });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(
        screen.getByText(/Security Notice: Operator Credentials Sync/i),
      ).toBeInTheDocument();
    });
  });

  it('submits updated profile and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    vi.mocked(partnerClient.updatePartnerProfile).mockResolvedValue({
      ...mockPartner,
      businessName: 'Apex Building Solutions Updated',
    });

    render(
      <EditPartnerProfileDrawer
        open={true}
        partner={mockPartner}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const nameInput = screen.getByDisplayValue('Apex Building Solutions');
    fireEvent.change(nameInput, { target: { value: 'Apex Building Solutions Updated' } });

    const reasonInput = screen.getByPlaceholderText(
      /e\.g\., Updated contact phone per verified operator request/i,
    );
    fireEvent.change(reasonInput, {
      target: { value: 'Rebranding verified by administrative compliance review.' },
    });

    const submitBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(partnerClient.updatePartnerProfile).toHaveBeenCalledWith(
        mockPartner.id,
        expect.objectContaining({
          businessName: 'Apex Building Solutions Updated',
          reason: 'Rebranding verified by administrative compliance review.',
        }),
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
