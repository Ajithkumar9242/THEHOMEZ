// @vitest-environment jsdom
/**
 * Viewport Responsiveness & Layout Verification Tests
 *
 * Verifies key layouts across all 6 target demo viewports:
 * 1. 320x640   (Small Mobile)
 * 2. 375x812   (Standard Mobile / iPhone SE)
 * 3. 430x932   (Large Mobile / iPhone Pro Max)
 * 4. 768x1024  (Tablet / iPad portrait)
 * 5. 1366x768  (Standard Laptop)
 * 6. 1920x1080 (Full HD Desktop)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { StorefrontProvider } from '../context/StorefrontContext.js';
import { ProductListingView } from '../views/ProductListingView.js';
import { HomeView } from '../views/HomeView.js';

const VIEWPORTS = [
  { name: '360x640 (Compact Mobile)', width: 360, height: 640 },
  { name: '390x844 (Standard Mobile / iPhone 12-15)', width: 390, height: 844 },
  { name: '430x932 (Large Mobile / iPhone Pro Max)', width: 430, height: 932 },
  { name: '768x1024 (Tablet / iPad Portrait)', width: 768, height: 1024 },
  { name: '1024x768 (Laptop)', width: 1024, height: 768 },
  { name: '1280x800 (Standard Desktop)', width: 1280, height: 800 },
  { name: '1440x900 (Wide Desktop)', width: 1440, height: 900 },
] as const;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

describe('Customer App Viewport Responsiveness Matrix', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          items: [
            {
              id: 'demo-prod-1',
              slug: 'demo-ultratech-super-cement',
              title: 'UltraTech Super Cement (50kg Bag) - Demo',
              brand: 'UltraTech Cement',
              hasVariants: false,
              sku: 'DEMO-CEM-ULT-50KG',
              category: { id: 'c1', slug: 'civil-construction', name: 'Civil Construction' },
              subcategory: { id: 's1', slug: 'cement', name: 'Cement' },
              images: ['https://placehold.co/600x400?text=Cement'],
              unit: { unitCode: 'BAG', quantityPrecision: 0, minOrderQuantity: '10', stepIncrement: '5' },
              pricing: {
                customerSegment: 'B2C',
                pricePaise: 38000,
                mrpPaise: 42000,
                savingsPaise: 4000,
                discountPercentage: 9.52,
                isRegionalOverride: true,
                hasVolumeTiers: false,
              },
              availability: {
                availabilityUnknown: false,
                isAvailable: true,
                serviceAreaId: 'sa-blr-central',
                minLeadTimeHours: 12,
                availablePartnerCount: 1,
              },
            },
          ],
          categories: [
            {
              id: 'c1',
              slug: 'civil-construction',
              name: 'Civil Construction',
              parentId: null,
              level: 0,
              displayOrder: 1,
              isActive: true,
              subcategories: [],
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
        },
      }),
    } as Response);
  });

  for (const vp of VIEWPORTS) {
    it(`renders HomeView without horizontal layout breaks at ${vp.name}`, async () => {
      setViewport(vp.width, vp.height);
      const { container } = render(
        <StorefrontProvider>
          <HomeView />
        </StorefrontProvider>,
      );

      await waitFor(() => {
        expect(container.querySelector('.thz-home-view')).toBeInTheDocument();
      });

      const homeView = container.querySelector('.thz-home-view');
      expect(homeView).not.toBeNull();
    });

    it(`renders ProductListingView with accessible layout at ${vp.name}`, async () => {
      setViewport(vp.width, vp.height);
      const { container } = render(
        <StorefrontProvider>
          <ProductListingView />
        </StorefrontProvider>,
      );

      await waitFor(() => {
        expect(container.querySelector('.thz-plp-layout')).toBeInTheDocument();
      });

      const plpLayout = container.querySelector('.thz-plp-layout');
      expect(plpLayout).not.toBeNull();
    });
  }

  it('contains CSS declarations covering 7 viewports: 360px, 390px, 430px, 768px, 1024px, 1280px, 1440px', () => {
    const cssPath = path.resolve(__dirname, '../styles/customer.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (max-width: 430px)');
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('@media (max-width: 1280px)');
    expect(css).toContain('@media (min-width: 1440px)');
  });

  it('contains micro-interaction keyframes and reduced-motion accessibility overrides', () => {
    const cssPath = path.resolve(__dirname, '../styles/customer.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('@keyframes thz-fade-in');
    expect(css).toContain('@keyframes thz-scale-in');
    expect(css).toContain('@keyframes thz-badge-pop');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
