/**
 * Zero-Shift Skeleton Loading Placeholders
 */

import React from 'react';

export interface LoadingSkeletonProps {
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ count = 8 }) => {
  return (
    <div className="thz-product-grid" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="thz-skeleton-card" />
      ))}
    </div>
  );
};
