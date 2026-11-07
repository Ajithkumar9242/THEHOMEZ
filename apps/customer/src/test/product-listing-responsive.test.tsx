// @vitest-environment jsdom
/**
 * ProductListingView Responsive Layout & Styling Tests (Workstream B)
 *
 * Verifies:
 * - PLP grid responsive class .thz-plp-layout
 * - Mobile media query collapsing sidebar and product grid to single column (1fr)
 * - Desktop two-column grid definition preservation
 * - Breadcrumb touch targets and removal of sub-44px inline overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { ProductListingView } from '../views/ProductListingView.js';
import { StorefrontProvider } from '../context/StorefrontContext.js';

describe('ProductListingView Responsive Layout & Touch Target Verification (Workstream B)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          items: [],
          pagination: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
          facets: {
            brands: [],
          },
        },
      }),
    } as Response);
  });

  it('declares responsive .thz-plp-layout class with desktop grid and mobile media query', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // Verify .thz-plp-layout declaration
    expect(plpContent).toContain('.thz-plp-layout');
    expect(plpContent).toContain('<div className="thz-plp-layout">');

    // Verify desktop two-column grid
    expect(plpContent).toMatch(/grid-template-columns:\s*minmax\(240px,\s*280px\)\s*1fr;/);

    // Verify mobile media query collapsing to 1fr
    expect(plpContent).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{/);
    expect(plpContent).toMatch(/grid-template-columns:\s*1fr;/);

    // Verify that the old fixed inline style is gone
    expect(plpContent).not.toMatch(
      /style=\{\{\s*display:\s*['"]grid['"],\s*gridTemplateColumns:\s*['"]minmax\(240px,\s*280px\)\s*1fr['"]/,
    );
  });

  it('renders .thz-plp-layout container element in DOM', async () => {
    const { container } = render(
      <StorefrontProvider>
        <ProductListingView />
      </StorefrontProvider>,
    );

    await waitFor(() => {
      const plpLayout = container.querySelector('.thz-plp-layout');
      expect(plpLayout).toBeInTheDocument();
    });
  });

  it('verifies breadcrumbs use .thz-breadcrumb-btn and enforce accessible touch targets', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // Breadcrumb navigation uses .thz-breadcrumb-nav and .thz-breadcrumb-btn
    expect(plpContent).toContain('className="thz-breadcrumb-nav"');
    expect(plpContent).toContain('className="thz-breadcrumb-btn"');

    // No collapsed padding: 0 inline breadcrumb overrides
    expect(plpContent).not.toMatch(/padding:\s*0/);
  });

  it('verifies unserviceable Change PIN button has no sub-44px minHeight override', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // No minHeight: '36px'
    expect(plpContent).not.toMatch(/minHeight:\s*['"]3[0-9]px['"]/);
  });
});
