/**
 * Empty Catalog & Search Results State Component
 */

import React from 'react';
import { useStorefront } from '../../context/StorefrontContext.js';

export interface EmptyStateProps {
  title?: string;
  message?: string;
  onAction?: () => void;
  actionText?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No materials found',
  message = 'We could not find any active materials matching your search criteria or filters.',
  onAction,
  actionText = 'Browse All Materials',
}) => {
  const { navigateToPlp } = useStorefront();

  const handleAction = () => {
    if (onAction) {
      onAction();
    } else {
      navigateToPlp({});
    }
  };

  return (
    <div
      style={{
        textAlign: 'center',
        padding: '48px 24px',
        backgroundColor: 'var(--thz-white)',
        border: '1px solid var(--thz-border-subtle)',
        borderRadius: 'var(--thz-radius-lg)',
        margin: '24px 0',
      }}
      role="status"
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🧱</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--thz-text-primary)' }}>
        {title}
      </h3>
      <p
        style={{
          fontSize: '0.95rem',
          color: 'var(--thz-text-secondary)',
          maxWidth: '460px',
          margin: '8px auto 20px auto',
        }}
      >
        {message}
      </p>
      <button type="button" className="thz-btn-primary" onClick={handleAction}>
        {actionText}
      </button>
    </div>
  );
};
