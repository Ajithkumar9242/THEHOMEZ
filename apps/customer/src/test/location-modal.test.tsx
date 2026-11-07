/**
 * LocationModal Tests (AC-DISCOV-20, AC-DISCOV-25 / Decision #50)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocationModal } from '../components/location/LocationModal.js';
import { StorefrontProvider, useStorefront } from '../context/StorefrontContext.js';

// Test wrapper that opens the modal by default
const ModalTestHarness: React.FC = () => {
  const { openLocationModal } = useStorefront();

  React.useEffect(() => {
    openLocationModal();
  }, [openLocationModal]);

  return <LocationModal />;
};

describe('LocationModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid PIN formats with helpful validation error', async () => {
    render(
      <StorefrontProvider>
        <ModalTestHarness />
      </StorefrontProvider>,
    );

    const input = screen.getByLabelText(/6-digit postal PIN code/i);
    const checkBtn = screen.getByRole('button', { name: /Check/i });

    // Try invalid PIN (less than 6 digits)
    fireEvent.change(input, { target: { value: '123' } });
    expect(checkBtn).toBeDisabled();

    // Try leading 0 (invalid Indian postal PIN)
    fireEvent.change(input, { target: { value: '056037' } });
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Please enter a valid 6-digit Indian postal PIN code/i),
      ).toBeInTheDocument();
    });
  });

  it('handles serviceable PIN code lookup (AC-DISCOV-20)', async () => {
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        data: {
          serviceable: true,
          pincode: '560037',
          serviceArea: {
            id: 'area-blr-east',
            code: 'BLR-EAST',
            name: 'Bengaluru East',
            city: 'Bengaluru',
            state: 'Karnataka',
          },
        },
      }),
    });

    render(
      <StorefrontProvider>
        <ModalTestHarness />
      </StorefrontProvider>,
    );

    const input = screen.getByLabelText(/6-digit postal PIN code/i);
    fireEvent.change(input, { target: { value: '560037' } });

    const checkBtn = screen.getByRole('button', { name: /Check/i });
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText(/Delivery Available/i)).toBeInTheDocument();
      expect(screen.getByText(/Covered by Bengaluru East/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set Location to 560037/i })).toBeInTheDocument();
    });
  });

  it('handles unserviceable PIN per Decision #50 / AC-DISCOV-25 (View-Only Mode, Zero Waitlist)', async () => {
    // Mock global fetch returning serviceable: false
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        data: {
          serviceable: false,
          pincode: '560099',
        },
      }),
    });

    render(
      <StorefrontProvider>
        <ModalTestHarness />
      </StorefrontProvider>,
    );

    const input = screen.getByLabelText(/6-digit postal PIN code/i);
    fireEvent.change(input, { target: { value: '560099' } });

    const checkBtn = screen.getByRole('button', { name: /Check/i });
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText(/Delivery not available in this area/i)).toBeInTheDocument();
      expect(
        screen.getByText(
          /We do not deliver to postal code 560099 yet. You can still browse materials in view-only mode/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Browse Catalogue in View-Only Mode/i }),
      ).toBeInTheDocument();
    });

    // Verify zero waitlist, contact capture, or email inputs exist
    expect(screen.queryByPlaceholderText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waitlist/i)).not.toBeInTheDocument();
  });
});
