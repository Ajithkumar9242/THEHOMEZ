/**
 * TheHomez Minimalist Structural Footer
 */

import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="thz-footer" role="contentinfo">
      <div className="thz-footer-inner">
        <div>
          <strong>TheHomez Construction Materials Marketplace</strong>
          <p style={{ marginTop: '4px', color: '#64748b' }}>
            Architectural Engineering • Structural Steel • Bulk Cement • Aggregates
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p>WCAG 2.1 AA Compliant • Mobile-First Responsive</p>
          <p style={{ marginTop: '4px', color: '#64748b' }}>
            Milestone 4: Catalogue & Storefront Discovery
          </p>
        </div>
      </div>
    </footer>
  );
};
