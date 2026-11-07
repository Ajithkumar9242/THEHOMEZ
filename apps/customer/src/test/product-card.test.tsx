// @vitest-environment jsdom
/**
 * ProductCard Component Tests (AC-DISCOV-21, AC-DISCOV-23)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from '../components/catalog/ProductCard.js';
import { StorefrontProvider } from '../context/StorefrontContext.js';
import type {
  IStorefrontStandaloneProductCard,
  IStorefrontMultiVariantProductCard,
} from '@thehomez/shared-types';

describe('ProductCard Component', () => {
  const standaloneProduct: IStorefrontStandaloneProductCard = {
    id: 'prod-1',
    slug: 'ultratech-super-cement-50kg',
    title: 'UltraTech Super Cement (50kg)',
    brand: 'UltraTech',
    hasVariants: false,
    sku: 'CEM-ULT-50KG',
    category: { id: 'cat-1', slug: 'cement', name: 'Cement & Concrete' },
    subcategory: { id: 'sub-1', slug: 'opc-cement', name: 'OPC Cement' },
    images: ['https://example.com/cement.jpg'],
    unit: {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '500',
      stepIncrement: '5',
    },
    pricing: {
      customerSegment: 'B2C',
      pricePaise: 38000,
      mrpPaise: 42000,
      discountPercentage: 10,
      isRegionalOverride: false,
      hasVolumeTiers: false,
    },
    availability: {
      availabilityUnknown: false,
      isAvailable: true,
      serviceAreaId: 'area-1',
      minLeadTimeHours: 24,
      availablePartnerCount: 2,
    },
  };

  const multiVariantProduct: IStorefrontMultiVariantProductCard = {
    id: 'prod-2',
    slug: 'tata-tiscon-550d-tmt-bars',
    title: 'Tata Tiscon 550D TMT Rebars',
    brand: 'Tata Tiscon',
    hasVariants: true,
    variantCount: 5,
    category: { id: 'cat-2', slug: 'steel', name: 'Structural Steel' },
    subcategory: { id: 'sub-2', slug: 'tmt-rebars', name: 'TMT Rebars' },
    images: [],
    priceRange: {
      minPricePaise: 5400000,
      maxPricePaise: 5900000,
      currency: 'INR',
    },
    availability: {
      availabilityUnknown: false,
      isAvailable: true,
      serviceAreaId: 'area-1',
      minLeadTimeHours: 12,
      availablePartnerCount: 1,
    },
  };

  it('renders standalone product card with single price and MRP discount (AC-DISCOV-21)', () => {
    const { container } = render(
      <StorefrontProvider>
        <ProductCard product={standaloneProduct} />
      </StorefrontProvider>,
    );

    expect(screen.getByText('UltraTech Super Cement (50kg)')).toBeInTheDocument();
    expect(screen.getByText('UltraTech')).toBeInTheDocument();
    expect(container.querySelector('.thz-price-current')?.textContent).toContain('₹380.00');
    expect(container.querySelector('.thz-price-mrp')?.textContent).toContain('₹420.00');
    expect(screen.getByText('10% OFF')).toBeInTheDocument();
    expect(screen.getByText(/per\s+BAG/i)).toBeInTheDocument();
    expect(screen.getByText(/In Stock/i)).toBeInTheDocument();
  });

  it('renders multi-variant product container with price range and options count (AC-DISCOV-21)', () => {
    const { container } = render(
      <StorefrontProvider>
        <ProductCard product={multiVariantProduct} />
      </StorefrontProvider>,
    );

    expect(screen.getByText('Tata Tiscon 550D TMT Rebars')).toBeInTheDocument();
    expect(screen.getAllByText('Tata Tiscon').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.thz-price-current')?.textContent).toMatch(
      /₹54,000\.00\s*–\s*₹59,000\.00/,
    );
    expect(screen.getByText('5 Options Available')).toBeInTheDocument();
    expect(screen.getByText(/In Stock/i)).toBeInTheDocument();
  });

  it('renders unlocalized availability badge when PIN is not provided', () => {
    const unlocalizedItem: IStorefrontStandaloneProductCard = {
      ...standaloneProduct,
      availability: {
        availabilityUnknown: true,
        isAvailable: null,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      },
    };

    render(
      <StorefrontProvider>
        <ProductCard product={unlocalizedItem} />
      </StorefrontProvider>,
    );

    expect(screen.getByText('Enter PIN for availability')).toBeInTheDocument();
  });

  it('renders out-of-stock badge when area inventory is zero', () => {
    const oosItem: IStorefrontStandaloneProductCard = {
      ...standaloneProduct,
      availability: {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: 'area-1',
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      },
    };

    render(
      <StorefrontProvider>
        <ProductCard product={oosItem} />
      </StorefrontProvider>,
    );

    expect(screen.getByText('Out of Stock in area')).toBeInTheDocument();
  });

  it('renders unserviceable badge when delivery is not available', () => {
    const unserviceableItem: IStorefrontStandaloneProductCard = {
      ...standaloneProduct,
      availability: {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      },
    };

    render(
      <StorefrontProvider>
        <ProductCard product={unserviceableItem} />
      </StorefrontProvider>,
    );

    expect(screen.getByText('Delivery not available')).toBeInTheDocument();
  });
});
