import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IServiceArea } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from '../api/service-area-client.js';
import { ServiceAreaFormDrawer } from './ServiceAreaFormDrawer.js';

vi.mock('../api/service-area-client.js', () => ({
  serviceAreaClient: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const mockArea: IServiceArea = {
  id: 'sa-blr-north',
  code: 'BLR-NORTH',
  name: 'Bengaluru North (Yelahanka)',
  city: 'Bengaluru',
  state: 'Karnataka',
  countryCode: 'IN',
  pincodes: ['560064', '560065'],
  deliveryRadiusKm: 25,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServiceAreaFormDrawer — Create Mode', () => {
  it('opens and renders required creation fields and default country code', () => {
    render(
      <ServiceAreaFormDrawer open={true} mode="create" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(screen.getByText('Create Service Area')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area code')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area name')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area city')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area state')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area country code')).toHaveValue('IN');
    expect(screen.getByLabelText('PIN code input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit service area form/i })).toBeInTheDocument();
  });

  it('validates required fields and prevents empty form submission', async () => {
    render(
      <ServiceAreaFormDrawer open={true} mode="create" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      const errorItems = document.querySelectorAll('.ant-form-item-has-error');
      expect(errorItems.length).toBeGreaterThan(0);
    });

    expect(serviceAreaClient.create).not.toHaveBeenCalled();
  });

  it('validates PIN code format and rejects invalid or duplicate PIN codes', () => {
    render(
      <ServiceAreaFormDrawer open={true} mode="create" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    const pinInput = screen.getByLabelText('PIN code input');
    const addButton = screen.getByLabelText('Add PIN code button');

    // Invalid PIN format (starts with 0, 5 digits, letters)
    fireEvent.change(pinInput, { target: { value: '056001, 12345, ABCDEF' } });
    fireEvent.click(addButton);

    expect(
      screen.getByText(/Invalid PIN code format: "056001, 12345, ABCDEF"/i),
    ).toBeInTheDocument();

    // Add a valid PIN
    fireEvent.change(pinInput, { target: { value: '560001' } });
    fireEvent.click(addButton);

    expect(screen.getByLabelText('PIN code 560001')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid PIN code format/i)).not.toBeInTheDocument();

    // Try adding the same PIN again (duplicate)
    fireEvent.change(pinInput, { target: { value: '560001' } });
    fireEvent.click(addButton);

    expect(screen.getByText(/Duplicate PIN code: "560001" is already added/i)).toBeInTheDocument();
  });

  it('submits exact create DTO on valid inputs and invokes callbacks', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();
    vi.mocked(serviceAreaClient.create).mockResolvedValueOnce(mockArea);

    render(
      <ServiceAreaFormDrawer
        open={true}
        mode="create"
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    // Fill form fields
    fireEvent.change(screen.getByLabelText('Service area code'), {
      target: { value: 'blr-north' },
    });
    fireEvent.change(screen.getByLabelText('Service area name'), {
      target: { value: 'Bengaluru North (Yelahanka)' },
    });
    fireEvent.change(screen.getByLabelText('Service area city'), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(screen.getByLabelText('Service area state'), {
      target: { value: 'Karnataka' },
    });
    fireEvent.change(screen.getByLabelText('Delivery radius in kilometres'), {
      target: { value: '25' },
    });

    // Add PINs (comma separated)
    const pinInput = screen.getByLabelText('PIN code input');
    fireEvent.change(pinInput, { target: { value: '560064, 560065' } });
    fireEvent.click(screen.getByLabelText('Add PIN code button'));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      expect(serviceAreaClient.create).toHaveBeenCalledWith({
        code: 'BLR-NORTH',
        name: 'Bengaluru North (Yelahanka)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        deliveryRadiusKm: 25,
        pincodes: ['560064', '560065'],
      });
      expect(handleSuccess).toHaveBeenCalledWith(mockArea);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('displays API conflict error (PIN_COVERAGE_CONFLICT) in Alert', async () => {
    const conflictMsg =
      'PIN code coverage conflict: PIN(s) [560064] are already assigned to active service area "BLR-CENTRAL".';
    vi.mocked(serviceAreaClient.create).mockRejectedValueOnce(
      new ApiError(conflictMsg, 409, 'PIN_COVERAGE_CONFLICT'),
    );

    render(
      <ServiceAreaFormDrawer open={true} mode="create" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Service area code'), { target: { value: 'BLR-NEW' } });
    fireEvent.change(screen.getByLabelText('Service area name'), { target: { value: 'New Hub' } });
    fireEvent.change(screen.getByLabelText('Service area city'), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(screen.getByLabelText('Service area state'), {
      target: { value: 'Karnataka' },
    });

    fireEvent.change(screen.getByLabelText('PIN code input'), { target: { value: '560064' } });
    fireEvent.click(screen.getByLabelText('Add PIN code button'));

    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      expect(screen.getByText(/PIN_COVERAGE_CONFLICT/i)).toBeInTheDocument();
      expect(screen.getByText(/PIN code coverage conflict/i)).toBeInTheDocument();
    });
  });

  it('displays API code collision error (SERVICE_AREA_CODE_EXISTS)', async () => {
    vi.mocked(serviceAreaClient.create).mockRejectedValueOnce(
      new ApiError(
        'Service area with code "BLR-NORTH" already exists',
        409,
        'SERVICE_AREA_CODE_EXISTS',
      ),
    );

    render(
      <ServiceAreaFormDrawer open={true} mode="create" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Service area code'), {
      target: { value: 'BLR-NORTH' },
    });
    fireEvent.change(screen.getByLabelText('Service area name'), {
      target: { value: 'Duplicate Hub' },
    });
    fireEvent.change(screen.getByLabelText('Service area city'), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(screen.getByLabelText('Service area state'), {
      target: { value: 'Karnataka' },
    });

    fireEvent.change(screen.getByLabelText('PIN code input'), { target: { value: '560070' } });
    fireEvent.click(screen.getByLabelText('Add PIN code button'));

    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      expect(screen.getByText(/SERVICE_AREA_CODE_EXISTS/i)).toBeInTheDocument();
    });
  });
});

describe('ServiceAreaFormDrawer — Edit Mode', () => {
  it('populates existing service area data and keeps code disabled/read-only', () => {
    render(
      <ServiceAreaFormDrawer
        open={true}
        mode="edit"
        serviceArea={mockArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(`Edit Service Area: ${mockArea.name}`)).toBeInTheDocument();

    const codeInput = screen.getByLabelText('Service area code disabled');
    expect(codeInput).toBeDisabled();
    expect(codeInput).toHaveValue('BLR-NORTH');
    expect(
      screen.getByText('Service area codes are immutable and cannot be modified after creation.'),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Service area name')).toHaveValue(mockArea.name);
    expect(screen.getByLabelText('Service area city')).toHaveValue(mockArea.city);
    expect(screen.getByLabelText('Service area state')).toHaveValue(mockArea.state);
    expect(screen.getByLabelText('PIN code 560064')).toBeInTheDocument();
    expect(screen.getByLabelText('PIN code 560065')).toBeInTheDocument();
  });

  it('submits update DTO without code or isActive and supports PIN modifications', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();
    const updatedArea: IServiceArea = {
      ...mockArea,
      name: 'Bengaluru North (Yelahanka Central)',
      deliveryRadiusKm: 30,
      pincodes: ['560064', '560066'],
    };
    vi.mocked(serviceAreaClient.update).mockResolvedValueOnce(updatedArea);

    render(
      <ServiceAreaFormDrawer
        open={true}
        mode="edit"
        serviceArea={mockArea}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    // Modify name
    fireEvent.change(screen.getByLabelText('Service area name'), {
      target: { value: 'Bengaluru North (Yelahanka Central)' },
    });

    // Modify delivery radius
    fireEvent.change(screen.getByLabelText('Delivery radius in kilometres'), {
      target: { value: '30' },
    });

    // Remove PIN 560065 (click close icon on tag)
    const pin560065Tag = screen.getByLabelText('PIN code 560065');
    const closeIcon = pin560065Tag.querySelector('.ant-tag-close-icon');
    if (closeIcon) {
      fireEvent.click(closeIcon);
    }

    // Add PIN 560066
    const pinInput = screen.getByLabelText('PIN code input');
    fireEvent.change(pinInput, { target: { value: '560066' } });
    fireEvent.click(screen.getByLabelText('Add PIN code button'));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      expect(serviceAreaClient.update).toHaveBeenCalledWith('sa-blr-north', {
        name: 'Bengaluru North (Yelahanka Central)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        deliveryRadiusKm: 30,
        pincodes: ['560064', '560066'],
      });
      expect(handleSuccess).toHaveBeenCalledWith(updatedArea);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('displays API error during update failure', async () => {
    vi.mocked(serviceAreaClient.update).mockRejectedValueOnce(
      new ApiError('Service area not found', 404, 'SERVICE_AREA_NOT_FOUND'),
    );

    render(
      <ServiceAreaFormDrawer
        open={true}
        mode="edit"
        serviceArea={mockArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit service area form/i }));

    await waitFor(() => {
      expect(screen.getByText(/SERVICE_AREA_NOT_FOUND/i)).toBeInTheDocument();
    });
  });
});
