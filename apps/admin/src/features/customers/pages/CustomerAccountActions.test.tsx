import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserStatus, type IAdminCustomerDetailDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { customerClient } from '../api/customer-client.js';
import { CustomerStatusActionModal } from '../components/CustomerStatusActionModal.js';
import { CustomerB2bModal } from '../components/CustomerB2bModal.js';

vi.mock('../api/customer-client.js', () => ({
  customerClient: {
    updateCustomerStatus: vi.fn(),
    updateCustomerB2bStatus: vi.fn(),
  },
}));

const mockActiveCustomer: IAdminCustomerDetailDto = {
  id: '507f1f77bcf86cd799439011',
  phone: '+919876543210',
  email: 'contractor@apexinfra.in',
  status: UserStatus.ACTIVE,
  roles: ['B2B_CUSTOMER'],
  customerSegment: 'B2B',
  metadata: {
    companyName: 'Apex Infra Projects Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
  },
  addresses: [],
  lastLoginAt: '2026-11-17T06:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-17T06:00:00.000Z',
};

const mockSuspendedB2cCustomer: IAdminCustomerDetailDto = {
  id: '507f1f77bcf86cd799439012',
  phone: '+919876543211',
  email: null,
  status: UserStatus.SUSPENDED,
  roles: [],
  customerSegment: 'B2C',
  metadata: {},
  addresses: [],
  lastLoginAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-17T06:00:00.000Z',
};

describe('Customer Account Actions & Modals (Stage C-6)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CustomerStatusActionModal', () => {
    it('returns null when modal is not configured or targetStatus is null', () => {
      const { container } = render(
        <CustomerStatusActionModal
          open={true}
          customer={mockActiveCustomer}
          targetStatus={null}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('opens suspension modal, displays impact warning, and allows cancellation without calling API', () => {
      const onClose = vi.fn();
      render(
        <CustomerStatusActionModal
          open={true}
          customer={mockActiveCustomer}
          targetStatus="SUSPENDED"
          onClose={onClose}
          onSuccess={vi.fn()}
        />,
      );

      expect(screen.getByText('Suspend Customer Account')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Suspending this account immediately revokes all active customer refresh tokens/i,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('+919876543210')).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(customerClient.updateCustomerStatus).not.toHaveBeenCalled();
    });

    it('validates that audit reason is required when confirming status change', async () => {
      render(
        <CustomerStatusActionModal
          open={true}
          customer={mockActiveCustomer}
          targetStatus="SUSPENDED"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
      fireEvent.click(confirmBtn);

      expect(await screen.findByText('Audit reason is required')).toBeInTheDocument();
      expect(customerClient.updateCustomerStatus).not.toHaveBeenCalled();
    });

    it('successfully calls updateCustomerStatus to suspend active customer and triggers onSuccess', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const suspendedCustomer = { ...mockActiveCustomer, status: UserStatus.SUSPENDED };
      vi.mocked(customerClient.updateCustomerStatus).mockResolvedValueOnce(suspendedCustomer);

      render(
        <CustomerStatusActionModal
          open={true}
          customer={mockActiveCustomer}
          targetStatus="SUSPENDED"
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      const reasonInput = screen.getByPlaceholderText(/State the reason for account suspension/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Repeated fraudulent chargebacks detected' },
      });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(customerClient.updateCustomerStatus).toHaveBeenCalledWith(
          '507f1f77bcf86cd799439011',
          {
            status: 'SUSPENDED',
            reason: 'Repeated fraudulent chargebacks detected',
          },
        );
      });

      expect(onSuccess).toHaveBeenCalledWith(suspendedCustomer);
      expect(onClose).toHaveBeenCalled();
    });

    it('successfully calls updateCustomerStatus to reactivate suspended customer and triggers onSuccess', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const reactivatedCustomer = { ...mockSuspendedB2cCustomer, status: UserStatus.ACTIVE };
      vi.mocked(customerClient.updateCustomerStatus).mockResolvedValueOnce(reactivatedCustomer);

      render(
        <CustomerStatusActionModal
          open={true}
          customer={mockSuspendedB2cCustomer}
          targetStatus="ACTIVE"
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByText('Reactivate Customer Account')).toBeInTheDocument();
      expect(
        screen.getByText(
          'The customer account will be reactivated. The customer may need to sign in again to regain access.',
        ),
      ).toBeInTheDocument();

      const reasonInput = screen.getByPlaceholderText(/State the reason for account reactivation/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Customer KYC verified and compliance cleared' },
      });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Reactivation' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(customerClient.updateCustomerStatus).toHaveBeenCalledWith(
          '507f1f77bcf86cd799439012',
          {
            status: 'ACTIVE',
            reason: 'Customer KYC verified and compliance cleared',
          },
        );
      });

      expect(onSuccess).toHaveBeenCalledWith(reactivatedCustomer);
      expect(onClose).toHaveBeenCalled();
    });

    it('handles status API failure by displaying error alert without closing modal', async () => {
      vi.mocked(customerClient.updateCustomerStatus).mockRejectedValueOnce(
        new ApiError('Database transaction failed on cluster', 500, 'DB_ERROR'),
      );

      render(
        <CustomerStatusActionModal
          open={true}
          customer={mockActiveCustomer}
          targetStatus="SUSPENDED"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      const reasonInput = screen.getByPlaceholderText(/State the reason for account suspension/i);
      fireEvent.change(reasonInput, { target: { value: 'Suspicious card testing' } });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
      fireEvent.click(confirmBtn);

      expect(await screen.findByText('Database transaction failed on cluster')).toBeInTheDocument();
    });
  });

  describe('CustomerB2bModal', () => {
    it('returns null when modal is not configured or mode is null', () => {
      const { container } = render(
        <CustomerB2bModal
          open={true}
          customer={mockActiveCustomer}
          mode={null}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('displays mandatory GST verification disclaimer notice without claiming external GST portal check', () => {
      render(
        <CustomerB2bModal
          open={true}
          customer={mockSuspendedB2cCustomer}
          mode="grant"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      expect(screen.getByText('Verify B2B Wholesale Contractor')).toBeInTheDocument();
      expect(
        screen.getByText(
          /GSTIN format validation confirms pattern compliance only \(15 alphanumeric characters\) and does not represent an external GST portal tax verification/i,
        ),
      ).toBeInTheDocument();
    });

    it('validates required company name and invalid GSTIN pattern during B2B grant', async () => {
      render(
        <CustomerB2bModal
          open={true}
          customer={mockSuspendedB2cCustomer}
          mode="grant"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      const gstinInput = screen.getByPlaceholderText(/e\.g\. 29ABCDE1234F1Z5/i);
      fireEvent.change(gstinInput, { target: { value: '12345' } });

      const grantBtn = screen.getByRole('button', { name: 'Grant B2B Status' });
      fireEvent.click(grantBtn);

      expect(await screen.findByText('Company name is required')).toBeInTheDocument();
      expect(
        await screen.findByText('Invalid GSTIN format (e.g. 29AAAAA0000A1Z5)'),
      ).toBeInTheDocument();
      expect(customerClient.updateCustomerB2bStatus).not.toHaveBeenCalled();
    });

    it('successfully calls updateCustomerB2bStatus with isB2B: true, companyName, uppercase GSTIN, and reason', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const b2bGrantedCustomer: IAdminCustomerDetailDto = {
        ...mockSuspendedB2cCustomer,
        customerSegment: 'B2B',
        roles: ['B2B_CUSTOMER'],
        metadata: {
          companyName: 'Apex Commercial Builders Pvt Ltd',
          gstin: '29AAAAA0000A1Z5',
        },
      };
      vi.mocked(customerClient.updateCustomerB2bStatus).mockResolvedValueOnce(b2bGrantedCustomer);

      render(
        <CustomerB2bModal
          open={true}
          customer={mockSuspendedB2cCustomer}
          mode="grant"
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      const companyInput = screen.getByPlaceholderText(/Apex Infra Projects Pvt Ltd/i);
      fireEvent.change(companyInput, { target: { value: 'Apex Commercial Builders Pvt Ltd' } });

      const gstinInput = screen.getByPlaceholderText(/e\.g\. 29ABCDE1234F1Z5/i);
      fireEvent.change(gstinInput, { target: { value: '29aaaaa0000a1z5' } });

      const reasonInput = screen.getByPlaceholderText(
        /State the reason for verifying\/updating B2B wholesale status/i,
      );
      fireEvent.change(reasonInput, { target: { value: 'Trade registration license confirmed' } });

      const grantBtn = screen.getByRole('button', { name: 'Grant B2B Status' });
      fireEvent.click(grantBtn);

      await waitFor(() => {
        expect(customerClient.updateCustomerB2bStatus).toHaveBeenCalledWith(
          '507f1f77bcf86cd799439012',
          {
            isB2B: true,
            companyName: 'Apex Commercial Builders Pvt Ltd',
            gstin: '29AAAAA0000A1Z5',
            reason: 'Trade registration license confirmed',
          },
        );
      });

      expect(onSuccess).toHaveBeenCalledWith(b2bGrantedCustomer);
      expect(onClose).toHaveBeenCalled();
    });

    it('successfully calls updateCustomerB2bStatus with isB2B: false and reason when revoking', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const b2bRevokedCustomer: IAdminCustomerDetailDto = {
        ...mockActiveCustomer,
        customerSegment: 'B2C',
        roles: [],
        metadata: {},
      };
      vi.mocked(customerClient.updateCustomerB2bStatus).mockResolvedValueOnce(b2bRevokedCustomer);

      render(
        <CustomerB2bModal
          open={true}
          customer={mockActiveCustomer}
          mode="revoke"
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );

      expect(screen.getByText('Revoke B2B Wholesale Status')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Revoking B2B status removes this customer's wholesale eligibility and associated wholesale pricing access/i,
        ),
      ).toBeInTheDocument();

      const reasonInput = screen.getByPlaceholderText(
        /State the reason for revoking B2B wholesale status/i,
      );
      fireEvent.change(reasonInput, {
        target: { value: 'Contractor requested downgrade to individual account' },
      });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm B2B Revocation' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(customerClient.updateCustomerB2bStatus).toHaveBeenCalledWith(
          '507f1f77bcf86cd799439011',
          {
            isB2B: false,
            reason: 'Contractor requested downgrade to individual account',
          },
        );
      });

      expect(onSuccess).toHaveBeenCalledWith(b2bRevokedCustomer);
      expect(onClose).toHaveBeenCalled();
    });

    it('handles B2B API failure by displaying error alert without closing modal', async () => {
      vi.mocked(customerClient.updateCustomerB2bStatus).mockRejectedValueOnce(
        new ApiError('GSTIN verification service timed out', 504, 'GATEWAY_TIMEOUT'),
      );

      render(
        <CustomerB2bModal
          open={true}
          customer={mockActiveCustomer}
          mode="revoke"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      const reasonInput = screen.getByPlaceholderText(
        /State the reason for revoking B2B wholesale status/i,
      );
      fireEvent.change(reasonInput, { target: { value: 'Audit review failed' } });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm B2B Revocation' });
      fireEvent.click(confirmBtn);

      expect(await screen.findByText('GSTIN verification service timed out')).toBeInTheDocument();
    });
  });

  describe('Stage C-6A: Business-Rule Alignment & Identity Verification', () => {
    describe('Correction A — Account Reactivation Messaging', () => {
      it('clarifies that customer may need to sign in again without promising session restoration', () => {
        render(
          <CustomerStatusActionModal
            open={true}
            customer={mockSuspendedB2cCustomer}
            targetStatus="ACTIVE"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(
          screen.getByText(
            'The customer account will be reactivated. The customer may need to sign in again to regain access.',
          ),
        ).toBeInTheDocument();

        // Ensure no promise of automatic session restoration exists
        expect(screen.queryByText(/restore active session/i)).toBeNull();
        expect(screen.queryByText(/tokens will be restored/i)).toBeNull();
      });

      it('retains clear explanation that suspended customer cannot continue using account', () => {
        render(
          <CustomerStatusActionModal
            open={true}
            customer={mockActiveCustomer}
            targetStatus="SUSPENDED"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(
          screen.getByText(
            /Suspending this account immediately revokes all active customer refresh tokens and terminates active customer sessions/i,
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            /The customer will be unable to log in, place new orders, or access their saved cart/i,
          ),
        ).toBeInTheDocument();
      });
    });

    describe('Correction B — B2B Revocation Messaging', () => {
      it('describes loss of wholesale eligibility and wholesale pricing without unsupported credit or billing claims', () => {
        render(
          <CustomerB2bModal
            open={true}
            customer={mockActiveCustomer}
            mode="revoke"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(
          screen.getByText(
            "Revoking B2B status removes this customer's wholesale eligibility and associated wholesale pricing access. The customer segment will revert to B2C Retail.",
          ),
        ).toBeInTheDocument();

        // Ensure unsupported claims do not appear
        expect(screen.queryByText(/credit/i)).toBeNull();
        expect(screen.queryByText(/net-30/i)).toBeNull();
        expect(screen.queryByText(/settlement/i)).toBeNull();
        expect(screen.queryByText(/billing facility/i)).toBeNull();
      });

      it('preserves GSTIN disclaimer during grant mode without external tax portal claim', () => {
        render(
          <CustomerB2bModal
            open={true}
            customer={mockSuspendedB2cCustomer}
            mode="grant"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(
          screen.getByText(
            /GSTIN format validation confirms pattern compliance only \(15 alphanumeric characters\) and does not represent an external GST portal tax verification/i,
          ),
        ).toBeInTheDocument();
      });
    });

    describe('Correction C — Customer Identity and Safe Name Handling', () => {
      it('displays customer phone as primary identity and renders optional email safely in status modal', () => {
        render(
          <CustomerStatusActionModal
            open={true}
            customer={mockActiveCustomer}
            targetStatus="SUSPENDED"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(screen.getByText('+919876543210')).toBeInTheDocument();
        expect(screen.getByText('contractor@apexinfra.in')).toBeInTheDocument();
        expect(screen.getByText('507f1f77bcf86cd799439011')).toBeInTheDocument();

        // Verify no fabricated customer personal name is rendered
        expect(screen.queryByText(/John Doe/i)).toBeNull();
        expect(screen.queryByText(/Customer Name/i)).toBeNull();
      });

      it('safely handles null email with fallback em-dash in status modal without crashing', () => {
        render(
          <CustomerStatusActionModal
            open={true}
            customer={mockSuspendedB2cCustomer}
            targetStatus="ACTIVE"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(screen.getByText('+919876543211')).toBeInTheDocument();
        expect(screen.getByText('507f1f77bcf86cd799439012')).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
      });

      it('displays customer phone and safe email in B2B modal and labels company name as enterprise information', () => {
        render(
          <CustomerB2bModal
            open={true}
            customer={mockActiveCustomer}
            mode="update"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(screen.getByText('+919876543210')).toBeInTheDocument();
        expect(screen.getByText('contractor@apexinfra.in')).toBeInTheDocument();

        // Label must be Company / Enterprise Name, not personal name
        expect(screen.getByText('Company / Enterprise Name')).toBeInTheDocument();
        expect(screen.queryByText('Customer Personal Name')).toBeNull();
      });

      it('safely renders B2B modal with null email without crashing', () => {
        render(
          <CustomerB2bModal
            open={true}
            customer={mockSuspendedB2cCustomer}
            mode="grant"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />,
        );

        expect(screen.getByText('+919876543211')).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
      });
    });
  });
});
