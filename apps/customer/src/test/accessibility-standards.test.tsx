/**
 * Accessibility & Design System Standards Tests (AC-DISCOV-23 & AC-DISCOV-24)
 * Gate 3 Customer Frontend Accessibility Remediation — Workstream A
 *
 * Verifies:
 * - Touch target dimension rule: hit areas >= 44x44px (AC-DISCOV-23)
 * - Contrast remediation: --thz-text-secondary (#334155) on --thz-bg-well (#F1F5F9) >= 4.5:1 (AC-DISCOV-24)
 * - Prefers-reduced-motion support for animations and skeleton shimmer
 * - Visible :focus-visible outlines for interactive controls
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Calculates relative luminance for an sRGB hex color.
 * Standard formula from W3C WCAG 2.1 specifications.
 */
function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design System Standards & Accessibility Compliance (Workstream A)', () => {
  const cssPath = path.resolve(__dirname, '../styles/customer.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  it('enforces --thz-touch-target: 44px in customer.css across interactive controls (AC-DISCOV-23)', () => {
    // 1. Verify touch target custom property
    expect(cssContent).toMatch(/--thz-touch-target:\s*44px;/);

    // 2. Verify key interactive controls enforce >= 44px touch targets
    expect(cssContent).toMatch(
      /\.thz-btn-primary\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
    expect(cssContent).toMatch(
      /\.thz-btn-secondary\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
    expect(cssContent).toMatch(
      /\.thz-variant-chip\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
    expect(cssContent).toMatch(/\.thz-stepper-btn\s*\{[^}]*width:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toMatch(/\.thz-stepper-btn\s*\{[^}]*height:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toMatch(
      /\.thz-breadcrumb-btn\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
    expect(cssContent).toMatch(/\.thz-link-btn\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toMatch(
      /\.thz-location-pill\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
  });

  it('verifies Workstream A components contain no sub-44px inline minHeight overrides', () => {
    const pdpPath = path.resolve(__dirname, '../views/ProductDetailView.tsx');
    const locationModalPath = path.resolve(__dirname, '../components/location/LocationModal.tsx');
    const homeViewPath = path.resolve(__dirname, '../views/HomeView.tsx');

    const pdpContent = fs.readFileSync(pdpPath, 'utf8');
    const locationModalContent = fs.readFileSync(locationModalPath, 'utf8');
    const homeViewContent = fs.readFileSync(homeViewPath, 'utf8');

    // Neither file should have sub-44px minHeight (e.g. 36px, 38px)
    expect(pdpContent).not.toMatch(/minHeight:\s*['"]3[0-9]px['"]/);
    expect(locationModalContent).not.toMatch(/minHeight:\s*['"]3[0-9]px['"]/);
    expect(homeViewContent).not.toMatch(/minHeight:\s*['"]3[0-9]px['"]/);
  });

  it('verifies WCAG 2.1 AA color contrast >= 4.5:1 across core text pairings (AC-DISCOV-24)', () => {
    // 1. Primary Text (#0F172A) on Pure Canvas (#FFFFFF)
    const primaryOnWhite = getContrastRatio('#0F172A', '#FFFFFF');
    expect(primaryOnWhite).toBeGreaterThanOrEqual(4.5);

    // 2. Secondary Text (#334155) on Pure Canvas (#FFFFFF)
    const secondaryOnWhite = getContrastRatio('#334155', '#FFFFFF');
    expect(secondaryOnWhite).toBeGreaterThanOrEqual(4.5);

    // 3. Muted Text (#64748B) on Pure Canvas (#FFFFFF)
    const mutedOnWhite = getContrastRatio('#64748B', '#FFFFFF');
    expect(mutedOnWhite).toBeGreaterThanOrEqual(4.5);

    // 4. Inverse Text (#FFFFFF) on Primary Brand Terracotta (#8B2626)
    const whiteOnPrimary = getContrastRatio('#FFFFFF', '#8B2626');
    expect(whiteOnPrimary).toBeGreaterThanOrEqual(4.5);

    // 5. Success Text (#15803D) on Success Background (#F0FDF4)
    const successContrast = getContrastRatio('#15803D', '#F0FDF4');
    expect(successContrast).toBeGreaterThanOrEqual(4.5);

    // 6. Warning Text (#B45309) on Warning Background (#FFFBEB)
    const warningContrast = getContrastRatio('#B45309', '#FFFBEB');
    expect(warningContrast).toBeGreaterThanOrEqual(4.5);

    // 7. Error Text (#B91C1C) on Error Background (#FEF2F2)
    const errorContrast = getContrastRatio('#B91C1C', '#FEF2F2');
    expect(errorContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('empirically validates contrast remediation on --thz-bg-well (#F1F5F9)', () => {
    const bgWell = '#F1F5F9';
    const textMuted = '#64748B';
    const textSecondary = '#334155';

    // The un-remediated pairing fails WCAG AA 4.5:1 (< 4.5)
    const defectiveRatio = getContrastRatio(textMuted, bgWell);
    expect(defectiveRatio).toBeLessThan(4.5);
    expect(Number(defectiveRatio.toFixed(2))).toBe(4.34);

    // The remediated pairing exceeds WCAG AA 4.5:1 (>= 4.5:1, measured ~9.68:1)
    const remediatedRatio = getContrastRatio(textSecondary, bgWell);
    expect(remediatedRatio).toBeGreaterThanOrEqual(4.5);
    expect(remediatedRatio).toBeGreaterThan(9.0);

    // Verify customer.css uses --thz-text-secondary in .thz-card-image-placeholder
    expect(cssContent).toMatch(
      /\.thz-card-image-placeholder\s*\{[^}]*color:\s*var\(--thz-text-secondary\);/,
    );

    // Verify ProductDetailView uses var(--thz-text-secondary) for placeholder and empty pricing state
    const pdpPath = path.resolve(__dirname, '../views/ProductDetailView.tsx');
    const pdpContent = fs.readFileSync(pdpPath, 'utf8');
    expect(pdpContent).toContain("color: 'var(--thz-text-secondary)'");
    expect(pdpContent).not.toMatch(
      /color:\s*['"]var\(--thz-text-muted\)['"][^>]*>\s*Pricing details will appear/,
    );
  });

  it('verifies prefers-reduced-motion media query disables shimmer animation and speeds up transitions', () => {
    expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssContent).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(cssContent).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(cssContent).toMatch(/\.thz-skeleton-card\s*\{[^}]*animation:\s*none\s*!important;/);
    expect(cssContent).toMatch(
      /\.thz-skeleton-card\s*\{[^}]*background:\s*var\(--thz-bg-well\)\s*!important;/,
    );
  });

  it('verifies :focus-visible rules provide clear high-contrast focus rings for keyboard users', () => {
    expect(cssContent).toContain(':focus-visible');
    expect(cssContent).toMatch(/\.thz-btn-primary:focus-visible/);
    expect(cssContent).toMatch(/\.thz-btn-secondary:focus-visible/);
    expect(cssContent).toMatch(/\.thz-variant-chip:focus-visible/);
    expect(cssContent).toMatch(/\.thz-stepper-btn:focus-visible/);
    expect(cssContent).toMatch(/\.thz-breadcrumb-btn:focus-visible/);
    expect(cssContent).toMatch(/\.thz-link-btn:focus-visible/);
    expect(cssContent).toMatch(/outline:\s*2px solid/);
    expect(cssContent).toMatch(/outline-offset:\s*2px/);
  });
});
