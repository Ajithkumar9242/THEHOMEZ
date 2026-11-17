import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProductPricing,
  type MoneyPaise,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { pricingClient } from '../api/pricing-client.js';
import { PricingFormDrawer, type PricingFormDrawerProps } from './PricingFormDrawer.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/pricing-client.js', () => ({
  pricingClient: {
    setProductPricing: vi.fn(),
    setVariantPricing: vi.fn(),
  },
}));

const baseUser: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.PRICING_READ, PermissionCode.PRICING_WRITE],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function setupAuth(permissions: PermissionCode[] = [PermissionCode.PRICING_WRITE]) {
  vi.mocked(useAuth).mockReturnValue({
    user: { ...baseUser, permissions },
    status: 'signed-in',
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

const mockExistingPricing: IProductPricing = {
  id: 'price-existing-1',
  productId: 'prod-cement-1',
  variantId: null,
  serviceAreaId: null,
  pricingScope: 'STANDALONE_GLOBAL',
  currency: 'INR',
  b2cPricePaise: 38000 as MoneyPaise, // ₹380.00
  b2cMrpPaise: 42000 as MoneyPaise, // ₹420.00
  b2bPricePaise: 36000 as MoneyPaise, // ₹360.00
  b2bTiers: [
    { minQuantity: '20', pricePaise: 35000 as MoneyPaise }, // ₹350.00
    { minQuantity: '50', pricePaise: 34000 as MoneyPaise }, // ₹340.00
  ],
  isActive: true,
  version: 3,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const defaultProps: PricingFormDrawerProps = {
  open: true,
  mode: 'create',
  productId: 'prod-cement-1',
  productTitle: 'UltraTech Super Cement 50kg',
  productSku: 'CEM-ULT-50KG',
  unitCode: 'BAG',
  quantityPrecision: 0,
  minOrderQuantity: '10',
  maxOrderQuantity: '1000',
  stepIncrement: '5',
  existingPricing: null,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onReloadLatest: vi.fn(),
};

describe('PricingFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Context & Mode Rendering', () => {
    it('renders standalone product context and create mode details', () => {
      render(<PricingFormDrawer {...defaultProps} />);

      expect(screen.getByText('Set Product Pricing')).toBeInTheDocument();
      expect(screen.getByText('UltraTech Super Cement 50kg')).toBeInTheDocument();
      expect(screen.getByText('CEM-ULT-50KG')).toBeInTheDocument();
      expect(screen.getByText('BAG')).toBeInTheDocument();
      expect(screen.getByText('0 decimals')).toBeInTheDocument();
      expect(screen.getByText('10 BAG')).toBeInTheDocument();
      expect(screen.getByText('5 BAG')).toBeInTheDocument();
      expect(screen.getByText('Unpriced')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Pricing/i })).toBeInTheDocument();
    });

    it('renders variant context with variant title and SKU', () => {
      render(
        <PricingFormDrawer
          {...defaultProps}
          variantId="var-fe550-12mm"
          variantTitle="Fe550D TMT Rebar 12mm"
          variantSku="TMT-550-12MM"
        />,
      );

      expect(screen.getByText('Set Variant Pricing')).toBeInTheDocument();
      expect(screen.getByText('Fe550D TMT Rebar 12mm')).toBeInTheDocument();
      expect(screen.getByText('TMT-550-12MM')).toBeInTheDocument();
      expect(screen.getByText('var-fe550-12mm')).toBeInTheDocument();
    });

    it('renders edit mode pre-populating existing pricing values and version badge', () => {
      render(
        <PricingFormDrawer {...defaultProps} mode="edit" existingPricing={mockExistingPricing} />,
      );

      expect(screen.getByText('Edit Product Pricing')).toBeInTheDocument();
      expect(screen.getByText('Revision 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Update Pricing/i })).toBeInTheDocument();

      // Check pre-populated inputs
      expect(screen.getByLabelText('B2C selling price input')).toHaveValue('380.00');
      expect(screen.getByLabelText('B2C MRP input')).toHaveValue('420.00');
      expect(screen.getByLabelText('B2B base rate input')).toHaveValue('360.00');

      // Check pre-populated tiers
      expect(screen.getByLabelText('Tier tier-0-20 min quantity input')).toHaveValue('20');
      expect(screen.getByLabelText('Tier tier-0-20 price input')).toHaveValue('350.00');
      expect(screen.getByLabelText('Tier tier-1-50 min quantity input')).toHaveValue('50');
      expect(screen.getByLabelText('Tier tier-1-50 price input')).toHaveValue('340.00');
    });
  });

  describe('B2C Pricing Validation', () => {
    it('shows validation error when B2C selling price is empty', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(await screen.findByText('B2C selling price is required')).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });

    it('rejects invalid rupee formats with more than 2 decimal places', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '380.555' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText(/Enter a valid non-negative rupee amount/),
      ).toBeInTheDocument();
    });

    it('rejects MRP less than selling price', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '400.00' },
      });
      fireEvent.change(screen.getByLabelText('B2C MRP input'), {
        target: { value: '350.00' },
      });
      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Test price reason' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText(/Maximum Retail Price.*cannot be less than retail selling price/),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });
  });

  describe('B2B Wholesale Baseline & Clearance Override', () => {
    it('shows clearance override warning and checkbox when B2B price exceeds B2C price', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '300.00' },
      });
      fireEvent.change(screen.getByLabelText('B2B base rate input'), {
        target: { value: '350.00' }, // B2B > B2C!
      });

      expect(
        await screen.findByLabelText('Permit wholesale rate exceeding retail rate checkbox'),
      ).toBeInTheDocument();
    });

    it('blocks submission when B2B price exceeds B2C without checking override', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '300.00' },
      });
      fireEvent.change(screen.getByLabelText('B2B base rate input'), {
        target: { value: '350.00' },
      });
      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Attempt clearance rate' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText(
          /Wholesale base price exceeds B2C selling price. Check clearance override/,
        ),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });
  });

  describe('Wholesale Volume Discount Tier Builder', () => {
    it('allows adding, editing, and deleting volume slabs', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      // Initially empty
      expect(screen.getByText(/No wholesale volume discount slabs configured/)).toBeInTheDocument();

      // Click Add
      fireEvent.click(screen.getByLabelText('Add first volume slab button'));

      expect(await screen.findByText('Slab')).toBeInTheDocument();
      expect(screen.getByText('#1')).toBeInTheDocument();

      // Enter tier values
      const minQtyInput = screen.getByPlaceholderText('> 10');
      fireEvent.change(minQtyInput, { target: { value: '25' } });
      const rateInput = screen.getByPlaceholderText('Rate per unit');
      fireEvent.change(rateInput, { target: { value: '350.00' } });

      // Click Add second tier
      fireEvent.click(screen.getByLabelText('Add volume tier button'));
      expect(await screen.findByText('#2')).toBeInTheDocument();

      // Delete second tier
      const deleteButtons = screen.getAllByRole('button', { name: /Delete tier/i });
      expect(deleteButtons).toHaveLength(2);
      fireEvent.click(deleteButtons[1]!);

      await waitFor(() => {
        expect(screen.queryByText('#2')).not.toBeInTheDocument();
      });
    });

    it('rejects volume tier if base B2B price is missing', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '380.00' },
      });
      // Do not enter B2B base rate
      fireEvent.click(screen.getByLabelText('Add first volume slab button'));

      const minQtyInput = await screen.findByPlaceholderText('> 10');
      fireEvent.change(minQtyInput, { target: { value: '25' } });
      const rateInput = screen.getByPlaceholderText('Rate per unit');
      fireEvent.change(rateInput, { target: { value: '350.00' } });

      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Attempting tier without base' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText(
          'Base B2B price is required as the baseline tier anchor when volume tiers are configured.',
        ),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });

    it('rejects volume tier with quantity less than or equal to MOQ', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '380.00' },
      });
      fireEvent.change(screen.getByLabelText('B2B base rate input'), {
        target: { value: '360.00' },
      });
      fireEvent.click(screen.getByLabelText('Add first volume slab button'));

      // MOQ is 10; entering 10 must be rejected
      const minQtyInput = await screen.findByPlaceholderText('> 10');
      fireEvent.change(minQtyInput, { target: { value: '10' } });
      const rateInput = screen.getByPlaceholderText('Rate per unit');
      fireEvent.change(rateInput, { target: { value: '350.00' } });

      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Tier at MOQ test' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText(/Tier volume quantity must be strictly greater than MOQ/),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });

    it('rejects volume tier with rate exceeding base B2B price', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '380.00' },
      });
      fireEvent.change(screen.getByLabelText('B2B base rate input'), {
        target: { value: '360.00' },
      });
      fireEvent.click(screen.getByLabelText('Add first volume slab button'));

      // Tier 1 rate is ₹370 (exceeds ₹360 base!)
      const minQtyInput = await screen.findByPlaceholderText('> 10');
      fireEvent.change(minQtyInput, { target: { value: '25' } });
      const rateInput = screen.getByPlaceholderText('Rate per unit');
      fireEvent.change(rateInput, { target: { value: '370.00' } });

      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Tier rate exceeds base test' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText('Tier 1 unit rate cannot exceed the base wholesale rate'),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });
  });

  describe('Change Reason Validation', () => {
    it('rejects empty or whitespace-only change reason', async () => {
      render(<PricingFormDrawer {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '380.00' },
      });
      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: '    ' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      expect(
        await screen.findByText('Change reason cannot be empty or whitespace only'),
      ).toBeInTheDocument();
      expect(pricingClient.setProductPricing).not.toHaveBeenCalled();
    });

    it('displays dynamic character count up to 500 characters', () => {
      render(<PricingFormDrawer {...defaultProps} />);

      expect(screen.getByText('0/500 characters')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Annual vendor renegotiation discount' },
      });

      expect(screen.getByText('36/500 characters')).toBeInTheDocument();
    });
  });

  describe('Optimistic Concurrency Control (OCC)', () => {
    it('passes expectedVersion on edit mode and handles 409 conflict gracefully', async () => {
      const reloadMock = vi.fn();
      vi.mocked(pricingClient.setProductPricing).mockRejectedValueOnce(
        new ApiError('Version mismatch', 409, 'PRICING_CONCURRENCY_CONFLICT'),
      );

      render(
        <PricingFormDrawer
          {...defaultProps}
          mode="edit"
          existingPricing={mockExistingPricing}
          onReloadLatest={reloadMock}
        />,
      );

      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Attempt revision update' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Update Pricing/i }));

      // Check OCC payload
      await waitFor(() => {
        expect(pricingClient.setProductPricing).toHaveBeenCalledWith(
          'prod-cement-1',
          expect.objectContaining({
            expectedVersion: 3,
            changeReason: 'Attempt revision update',
          }),
        );
      });

      // Conflict alert must be displayed
      expect(await screen.findByText('Optimistic Concurrency Conflict')).toBeInTheDocument();
      expect(
        screen.getByText(/Pricing was updated by another administrator while you were editing/),
      ).toBeInTheDocument();

      // Form values are preserved
      expect(screen.getByLabelText('B2C selling price input')).toHaveValue('380.00');

      // Click Reload Latest button
      fireEvent.click(screen.getByRole('button', { name: /Reload Latest Pricing/i }));
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  describe('Permission Guarding', () => {
    it('disables mutation controls and shows read-only banner when user lacks PRICING_WRITE', () => {
      setupAuth([PermissionCode.PRICING_READ]); // Read-only

      render(<PricingFormDrawer {...defaultProps} />);

      expect(screen.getByText('Read-Only Mode')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Pricing/i })).toBeDisabled();
    });
  });

  describe('Successful Mutation Workflow', () => {
    it('submits standalone product pricing and triggers onSuccess callback', async () => {
      const onSuccessMock = vi.fn();
      const onCloseMock = vi.fn();

      const savedRecord: IProductPricing = {
        ...mockExistingPricing,
        b2cPricePaise: 38500 as MoneyPaise,
        version: 4,
      };
      vi.mocked(pricingClient.setProductPricing).mockResolvedValueOnce(savedRecord);

      render(
        <PricingFormDrawer {...defaultProps} onSuccess={onSuccessMock} onClose={onCloseMock} />,
      );

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '385.00' },
      });
      fireEvent.change(screen.getByLabelText('B2C MRP input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Quarterly price schedule adjustment' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      await waitFor(() => {
        expect(pricingClient.setProductPricing).toHaveBeenCalledWith(
          'prod-cement-1',
          expect.objectContaining({
            b2cPricePaise: 38500,
            b2cMrpPaise: 42000,
            changeReason: 'Quarterly price schedule adjustment',
          }),
        );
        expect(onSuccessMock).toHaveBeenCalledWith(savedRecord);
        expect(onCloseMock).toHaveBeenCalled();
      });
    });

    it('submits variant pricing using setVariantPricing for variant target', async () => {
      const onSuccessMock = vi.fn();
      const onCloseMock = vi.fn();

      const savedVariantPricing: IProductPricing = {
        ...mockExistingPricing,
        variantId: 'var-1',
        b2cPricePaise: 42000 as MoneyPaise,
      };
      vi.mocked(pricingClient.setVariantPricing).mockResolvedValueOnce(savedVariantPricing);

      render(
        <PricingFormDrawer
          {...defaultProps}
          variantId="var-1"
          variantTitle="Variant 1"
          onSuccess={onSuccessMock}
          onClose={onCloseMock}
        />,
      );

      fireEvent.change(screen.getByLabelText('B2C selling price input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Price change reason textarea'), {
        target: { value: 'Initial variant rate' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Pricing/i }));

      await waitFor(() => {
        expect(pricingClient.setVariantPricing).toHaveBeenCalledWith(
          'prod-cement-1',
          'var-1',
          expect.objectContaining({
            b2cPricePaise: 42000,
            changeReason: 'Initial variant rate',
          }),
        );
        expect(onSuccessMock).toHaveBeenCalledWith(savedVariantPricing);
        expect(onCloseMock).toHaveBeenCalled();
      });
    });
  });
});
