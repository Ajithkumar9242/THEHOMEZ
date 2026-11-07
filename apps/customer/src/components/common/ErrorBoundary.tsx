/**
 * Error Display & Retry Component
 */

import React from 'react';

export interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message, onRetry }) => {
  return (
    <div
      className="thz-notice-banner"
      style={{
        backgroundColor: 'var(--thz-error-bg)',
        border: '1px solid var(--thz-error-border)',
        color: 'var(--thz-error-text)',
        margin: '24px 0',
      }}
      role="alert"
    >
      <span style={{ fontSize: '1.25rem' }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <strong>Error Loading Content</strong>
        <p style={{ fontSize: '0.9rem', marginTop: '4px' }}>{message}</p>
        {onRetry && (
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={onRetry}
            style={{
              marginTop: '12px',
              height: '38px',
              fontSize: '0.85rem',
              borderColor: 'var(--thz-error-border)',
              color: 'var(--thz-error-text)',
            }}
          >
            ↻ Retry Request
          </button>
        )}
      </div>
    </div>
  );
};
