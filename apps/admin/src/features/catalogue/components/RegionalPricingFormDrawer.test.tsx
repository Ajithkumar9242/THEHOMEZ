import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProductPricing,
  type IServiceArea,
  type MoneyPaise,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { pricingClient } from '../api/pricing-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import {
  RegionalPricingFormDrawer,
  type RegionalPricingFormDrawerProps,
} from './RegionalPricingFormDrawer.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/pricing-client.js', () => ({
  pricingClient: {
    setProductRegionalPricing: vi.fn(),
    setVariantRegionalPricing: vi.fn(),
  },
}));
vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));

const baseUser: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [
    PermissionCode.PRICING_READ,
    PermissionCode.PRICING_WRITE,
    PermissionCode.SERVICE_AREA_READ,
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function setupAuth(
  permissions: PermissionCode[] = [
    PermissionCode.PRICING_READ,
    PermissionCode.PRICING_WRITE,
    PermissionCode.SERVICE_AREA_READ,
  ],
) {
  vi.mocked(useAuth).mockReturnValue({
    user: { ...baseUser, permissions },
    status: 'signed-in',
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

const mockActiveAreas: IServiceArea[] = [
  {
    id: 'area-blr-north',
    name: 'Bengaluru North',
    code: 'BLR-N',
    city: 'Bengaluru',
    state: 'Karnataka',
    countryCode: 'IN',
    pincodes: ['560001', '560002'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'area-blr-south',
    name: 'Bengaluru South',
    code: 'BLR-S',
    city: 'Bengaluru',
    state: 'Karnataka',
    countryCode: 'IN',
    pincodes: ['560068', '560076'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const mockExistingRegionalPricing: IProductPricing = {
  id: 'price-regional-north',
  productId: 'prod-cement-1',
  variantId: null,
  serviceAreaId: 'area-blr-north',
  pricingScope: 'STANDALONE_REGIONAL',
  currency: 'INR',
  b2cPricePaise: 41000 as MoneyPaise, // ₹410.00
  b2cMrpPaise: 45000 as MoneyPaise, // ₹450.00
  b2bPricePaise: 39000 as MoneyPaise, // ₹390.00
  b2bTiers: [
    { minQuantity: '20', pricePaise: 38000 as MoneyPaise }, // ₹380.00
    { minQuantity: '50', pricePaise: 37000 as MoneyPaise }, // ₹370.00
  ],
  isActive: true,
  version: 2,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const defaultProps: RegionalPricingFormDrawerProps = {
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
  existingRegionalRecords: [],
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  onReloadLatest: vi.fn(),
};

async function selectServiceArea(areaLabelRegex = /Bengaluru South/i) {
  const combobox = screen.getByRole('combobox', { name: /Regional service area selector/i });
  fireEvent.mouseDown(combobox);
  const option = await screen.findByText(areaLabelRegex);
  fireEvent.click(option);
}

describe('RegionalPricingFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: mockActiveAreas,
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    } as never);
    vi.mocked(serviceAreaClient.get).mockImplementation(async (id) => {
      const found = mockActiveAreas.find((a) => a.id === id);
      if (found) return found;
      throw new ApiError('Not found', 404, 'SERVICE_AREA_NOT_FOUND');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Context & Mode Rendering', () => {
    it('renders standalone product context and create mode details', async () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      expect(screen.getByText('Add Product Regional Override')).toBeInTheDocument();
      expect(screen.getByText('UltraTech Super Cement 50kg')).toBeInTheDocument();
      expect(screen.getByText('CEM-ULT-50KG')).toBeInTheDocument();
      expect(screen.getByText('BAG')).toBeInTheDocument();
      expect(screen.getByText('0 decimals')).toBeInTheDocument();
      expect(screen.getByText('10 BAG')).toBeInTheDocument();
      expect(screen.getByText('5 BAG')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Regional Override/i })).toBeInTheDocument();
    });

    it('renders variant context with variant title, SKU and variant ID', () => {
      render(
        <RegionalPricingFormDrawer
          {...defaultProps}
          variantId="var-fe550-12mm"
          variantTitle="Fe550D TMT Rebar 12mm"
          variantSku="TMT-550-12MM"
        />,
      );

      expect(screen.getByText('Add Variant Regional Override')).toBeInTheDocument();
      expect(screen.getByText('Fe550D TMT Rebar 12mm')).toBeInTheDocument();
      expect(screen.getByText('TMT-550-12MM')).toBeInTheDocument();
      expect(screen.getByText('var-fe550-12mm')).toBeInTheDocument();
    });

    it('renders edit mode pre-populating regional values and locking service area selector', async () => {
      render(
        <RegionalPricingFormDrawer
          {...defaultProps}
          mode="edit"
          existingPricing={mockExistingRegionalPricing}
        />,
      );

      expect(screen.getByText('Edit Product Regional Override')).toBeInTheDocument();
      expect(screen.getByText('Revision 2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Update Regional Override/i })).toBeInTheDocument();

      // Check pre-populated inputs
      expect(screen.getByLabelText('Regional B2C selling price input')).toHaveValue('410.00');
      expect(screen.getByLabelText('Regional B2C MRP input')).toHaveValue('450.00');
      expect(screen.getByLabelText('Regional B2B base rate input')).toHaveValue('390.00');

      // Check pre-populated tiers strictly from regional record
      expect(screen.getByLabelText('Tier tier-0-20 min quantity input')).toHaveValue('20');
      expect(screen.getByLabelText('Tier tier-0-20 price input')).toHaveValue('380.00');
      expect(screen.getByLabelText('Tier tier-1-50 min quantity input')).toHaveValue('50');
      expect(screen.getByLabelText('Tier tier-1-50 price input')).toHaveValue('370.00');

      // Service area is locked in edit mode
      const areaInput = screen.getByLabelText('Regional service area selector');
      expect(areaInput).toBeDisabled();
    });
  });

  describe('Service Area Selection & Duplicate Prevention', () => {
    it('disables service areas that already have an override in create mode', async () => {
      render(
        <RegionalPricingFormDrawer
          {...defaultProps}
          existingRegionalRecords={[mockExistingRegionalPricing]} // area-blr-north is already configured
        />,
      );

      await waitFor(() => {
        expect(serviceAreaClient.list).toHaveBeenCalledWith({
          isActive: true,
          limit: 100,
          signal: expect.any(AbortSignal),
        });
      });

      const combobox = screen.getByRole('combobox', {
        name: /Regional service area selector/i,
      });
      fireEvent.mouseDown(combobox);

      expect(
        await screen.findByText(/Bengaluru North.*\[Override already exists\]/i),
      ).toBeInTheDocument();
    });
  });

  describe('Zero-Inheritance Rule', () => {
    it('renders zero-inheritance info alert emphasizing no fallback to global volume tiers', () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      expect(screen.getByText('Zero-Inheritance Volume Tier Rule')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Global volume tiers are NOT inherited. If you save this regional schedule without volume tiers, contractors in this region will receive no volume discounts./,
        ),
      ).toBeInTheDocument();
    });

    it('submits b2bTiers as empty array when no regional tiers are added', async () => {
      vi.mocked(pricingClient.setProductRegionalPricing).mockResolvedValue(
        mockExistingRegionalPricing,
      );
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Setting regional price without volume discounts' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      await waitFor(() => {
        expect(pricingClient.setProductRegionalPricing).toHaveBeenCalledWith('prod-cement-1', {
          serviceAreaId: 'area-blr-south',
          currency: 'INR',
          b2cPricePaise: 42000,
          b2cMrpPaise: null,
          b2bPricePaise: null,
          b2bTiers: [], // Exactly empty array!
          allowB2bExceedsB2c: false,
          changeReason: 'Setting regional price without volume discounts',
          expectedVersion: undefined,
        });
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });

  describe('Validation & Invariants', () => {
    it('rejects submission when B2C selling price is missing or non-positive', async () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Test change reason' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(await screen.findByText('Regional B2C selling price is required')).toBeInTheDocument();
      expect(pricingClient.setProductRegionalPricing).not.toHaveBeenCalled();
    });

    it('rejects MRP less than B2C selling price', async () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '450.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional B2C MRP input'), {
        target: { value: '400.00' }, // MRP < B2C!
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Test change reason' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(
        await screen.findByText(/Maximum Retail Price.*cannot be less than retail selling price/),
      ).toBeInTheDocument();
      expect(pricingClient.setProductRegionalPricing).not.toHaveBeenCalled();
    });

    it('requires clearance override checkbox when regional B2B price exceeds B2C price', async () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '300.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional B2B base rate input'), {
        target: { value: '350.00' }, // B2B > B2C!
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Clearance rate' },
      });

      expect(
        await screen.findByText(/Confirm regional wholesale rate exceeds retail rate/),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(
        await screen.findByText(/Wholesale base price exceeds B2C selling price/),
      ).toBeInTheDocument();
      expect(pricingClient.setProductRegionalPricing).not.toHaveBeenCalled();

      // Check clearance override checkbox
      fireEvent.click(screen.getByLabelText('Regional clearance override confirmation checkbox'));

      vi.mocked(pricingClient.setProductRegionalPricing).mockResolvedValue(
        mockExistingRegionalPricing,
      );
      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      await waitFor(() => {
        expect(pricingClient.setProductRegionalPricing).toHaveBeenCalledWith(
          'prod-cement-1',
          expect.objectContaining({
            allowB2bExceedsB2c: true,
          }),
        );
      });
    });

    it('enforces mandatory business justification changeReason (1-500 chars)', async () => {
      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '420.00' },
      });
      // Leaving changeReason empty

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(
        await screen.findByText('A change justification reason is mandatory'),
      ).toBeInTheDocument();
      expect(pricingClient.setProductRegionalPricing).not.toHaveBeenCalled();
    });
  });

  describe('Variant Parity & Edit Mode OCC Handling', () => {
    it('dispatches to setVariantRegionalPricing with expectedVersion for variant edit', async () => {
      const variantExistingPricing: IProductPricing = {
        ...mockExistingRegionalPricing,
        variantId: 'var-cement-25kg',
        pricingScope: 'VARIANT_REGIONAL',
        version: 5,
      };

      vi.mocked(pricingClient.setVariantRegionalPricing).mockResolvedValue(variantExistingPricing);

      render(
        <RegionalPricingFormDrawer
          {...defaultProps}
          mode="edit"
          variantId="var-cement-25kg"
          variantTitle="UltraTech Super Cement 25kg"
          variantSku="CEM-ULT-25KG"
          existingPricing={variantExistingPricing}
        />,
      );

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '430.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Updated 25kg bag regional rate for south zone' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Update Regional Override/i }));

      await waitFor(() => {
        expect(pricingClient.setVariantRegionalPricing).toHaveBeenCalledWith(
          'prod-cement-1',
          'var-cement-25kg',
          expect.objectContaining({
            serviceAreaId: 'area-blr-north',
            b2cPricePaise: 43000,
            expectedVersion: 5,
            changeReason: 'Updated 25kg bag regional rate for south zone',
          }),
        );
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });

    it('handles HTTP 409 concurrency conflict preserving form input and offering reload', async () => {
      vi.mocked(pricingClient.setProductRegionalPricing).mockRejectedValue(
        new ApiError('Pricing record version conflict', 409, 'PRICING_VERSION_CONFLICT'),
      );

      render(
        <RegionalPricingFormDrawer
          {...defaultProps}
          mode="edit"
          existingPricing={mockExistingRegionalPricing}
        />,
      );

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '435.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Conflict test update' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Update Regional Override/i }));

      expect(
        await screen.findByText(
          /This regional pricing record was modified by another administrator/,
        ),
      ).toBeInTheDocument();

      // Form values are preserved
      expect(screen.getByLabelText('Regional B2C selling price input')).toHaveValue('435.00');

      // Reload action is provided
      const reloadBtn = screen.getByRole('button', { name: /Reload Latest Pricing/i });
      expect(reloadBtn).toBeInTheDocument();
      fireEvent.click(reloadBtn);
      expect(defaultProps.onReloadLatest).toHaveBeenCalled();
    });
  });

  describe('Permissions & Error Handling', () => {
    it('disables save button when administrator lacks PRICING_WRITE permission', () => {
      setupAuth([PermissionCode.PRICING_READ]); // PRICING_WRITE is missing!

      render(<RegionalPricingFormDrawer {...defaultProps} />);

      const saveBtn = screen.getByRole('button', { name: /Save Regional Override/i });
      expect(saveBtn).toBeDisabled();
      expect(
        screen.getByText(/Your staff account lacks PRICING_WRITE capability/),
      ).toBeInTheDocument();
    });

    it('handles 400 SERVICE_AREA_INACTIVE error gracefully', async () => {
      vi.mocked(pricingClient.setProductRegionalPricing).mockRejectedValue(
        new ApiError('Service area inactive', 400, 'SERVICE_AREA_INACTIVE'),
      );

      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Test change reason' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(
        await screen.findByText(
          'The selected service area is inactive and cannot accept regional pricing.',
        ),
      ).toBeInTheDocument();
    });

    it('supports direct 24-character ObjectId input when SERVICE_AREA_READ is absent', async () => {
      setupAuth([PermissionCode.PRICING_READ, PermissionCode.PRICING_WRITE]); // SERVICE_AREA_READ absent!

      vi.mocked(pricingClient.setProductRegionalPricing).mockResolvedValue(
        mockExistingRegionalPricing,
      );

      render(<RegionalPricingFormDrawer {...defaultProps} />);

      const objectIdInput = screen.getByLabelText('Regional service area selector');
      fireEvent.change(objectIdInput, {
        target: { value: '507f1f77bcf86cd799439011' },
      });
      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Direct ObjectId override' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      await waitFor(() => {
        expect(pricingClient.setProductRegionalPricing).toHaveBeenCalledWith('prod-cement-1', {
          serviceAreaId: '507f1f77bcf86cd799439011',
          currency: 'INR',
          b2cPricePaise: 42000,
          b2cMrpPaise: null,
          b2bPricePaise: null,
          b2bTiers: [],
          allowB2bExceedsB2c: false,
          changeReason: 'Direct ObjectId override',
          expectedVersion: undefined,
        });
      });
    });

    it('preserves form inputs and displays error message upon network failure', async () => {
      vi.mocked(pricingClient.setProductRegionalPricing).mockRejectedValue(
        new Error('Network connection terminated unexpectedly'),
      );

      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '425.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'Network resilience test' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Regional Override/i }));

      expect(
        await screen.findByText('Network connection terminated unexpectedly'),
      ).toBeInTheDocument();

      // Form values are preserved without loss
      expect(screen.getByLabelText('Regional B2C selling price input')).toHaveValue('425.00');
      expect(screen.getByLabelText('Regional price change reason textarea')).toHaveValue(
        'Network resilience test',
      );
      // Drawer is still open (onClose not called)
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('disables submit button while submission is in-flight to prevent duplicate requests', async () => {
      let resolvePromise: (value: IProductPricing) => void;
      const inFlightPromise = new Promise<IProductPricing>((res) => {
        resolvePromise = res;
      });
      vi.mocked(pricingClient.setProductRegionalPricing).mockReturnValue(inFlightPromise);

      render(<RegionalPricingFormDrawer {...defaultProps} />);

      await selectServiceArea(/Bengaluru South/i);

      fireEvent.change(screen.getByLabelText('Regional B2C selling price input'), {
        target: { value: '420.00' },
      });
      fireEvent.change(screen.getByLabelText('Regional price change reason textarea'), {
        target: { value: 'In-flight double submission prevention' },
      });

      const saveBtn = screen.getByRole('button', { name: /Save Regional Override/i });
      fireEvent.click(saveBtn);

      // Button is immediately disabled during in-flight request
      await waitFor(() => {
        expect(saveBtn).toBeDisabled();
      });

      // Attempt second click while disabled
      fireEvent.click(saveBtn);
      expect(pricingClient.setProductRegionalPricing).toHaveBeenCalledTimes(1);

      // Resolve the pending promise
      resolvePromise!(mockExistingRegionalPricing);
      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalled();
      });
    });
  });
});
