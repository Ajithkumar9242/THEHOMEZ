import React from 'react';
import { Card, Typography, Space, Tag, Tooltip, Skeleton } from 'antd';
import {
  InfoCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  LockOutlined,
} from '@ant-design/icons';
import type { IKpiMetric } from '@thehomez/shared-types';

interface KpiCardProps {
  metric?: IKpiMetric<any>;
  loading?: boolean;
  icon?: React.ReactNode;
  formatAsCurrency?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  metric,
  loading = false,
  icon,
  formatAsCurrency = false,
}) => {
  if (loading || !metric) {
    return (
      <Card
        className="thz-modern-card"
        variant="outlined"
        styles={{ body: { padding: '20px 22px' } }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Skeleton.Avatar active size={36} shape="square" style={{ borderRadius: 8 }} />
          <Skeleton.Button active size="small" style={{ width: 68, height: 20, borderRadius: 4 }} />
        </div>
        <Skeleton.Input
          active
          size="large"
          style={{ width: '55%', height: 32, marginBottom: 12, borderRadius: 6 }}
        />
        <Skeleton.Input active size="small" style={{ width: '90%', height: 16, borderRadius: 4 }} />
      </Card>
    );
  }

  const {
    value,
    label,
    isAvailable,
    status,
    definitionNote,
    grossOrNet,
    taxTreatment,
    deliveryFeeTreatment,
    sourceOfTruth,
    changePercentage,
  } = metric;

  // Format value display
  let displayValue: string = '0';
  if (!isAvailable) {
    displayValue = 'Restricted';
  } else if (status === 'pending_definition') {
    displayValue = 'TBD';
  } else if (status === 'deferred') {
    displayValue = 'Deferred';
  } else if (typeof value === 'number') {
    if (formatAsCurrency) {
      displayValue = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(value / 100);
    } else {
      displayValue = new Intl.NumberFormat('en-IN').format(value);
    }
  } else if (value !== null && value !== undefined) {
    displayValue = String(value);
  }

  // Status tag styling
  let tagColor = 'default';
  let tagText = 'Pending Definition';

  if (!isAvailable) {
    tagColor = 'warning';
    tagText = 'Role Restricted';
  } else if (status === 'active') {
    tagColor = 'success';
    tagText = 'Live';
  } else if (status === 'deferred') {
    tagColor = 'default';
    tagText = 'Phase 4';
  }

  const accountingTooltip = (
    <div style={{ maxWidth: 280, fontSize: 12, lineHeight: 1.5 }}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 6,
          color: '#ffffff',
          borderBottom: '1px solid rgba(255,255,255,0.15)',
          paddingBottom: 4,
        }}
      >
        Accounting Disclosure (SRS §14.5)
      </div>
      <div style={{ marginBottom: 4 }}>
        <strong style={{ color: '#cbd5e1' }}>Note:</strong> {definitionNote}
      </div>
      {grossOrNet !== 'NOT_APPLICABLE' && (
        <div style={{ marginBottom: 2 }}>
          <strong style={{ color: '#cbd5e1' }}>Basis:</strong> {grossOrNet}
        </div>
      )}
      {taxTreatment !== 'NOT_APPLICABLE' && (
        <div style={{ marginBottom: 2 }}>
          <strong style={{ color: '#cbd5e1' }}>Tax:</strong> {taxTreatment}
        </div>
      )}
      {deliveryFeeTreatment !== 'NOT_APPLICABLE' && (
        <div style={{ marginBottom: 2 }}>
          <strong style={{ color: '#cbd5e1' }}>Freight:</strong> {deliveryFeeTreatment}
        </div>
      )}
      <div>
        <strong style={{ color: '#cbd5e1' }}>Source of Truth:</strong> {sourceOfTruth}
      </div>
    </div>
  );

  return (
    <Card
      className="thz-modern-card"
      variant="outlined"
      tabIndex={0}
      role="region"
      aria-label={`${label}: ${displayValue}`}
      styles={{ body: { padding: '20px 22px' } }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <Space size={10}>
          {icon && (
            <span className="thz-icon-badge" aria-hidden="true">
              {icon}
            </span>
          )}
          <Typography.Text
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#475569',
              letterSpacing: '-0.01em',
            }}
          >
            {label}
          </Typography.Text>
        </Space>
        <Tooltip title={accountingTooltip} placement="topLeft">
          <button
            type="button"
            aria-label={`Accounting disclosure for ${label}`}
            style={{
              background: 'none',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              color: '#94a3b8',
              borderRadius: 4,
            }}
          >
            <InfoCircleOutlined style={{ fontSize: 14 }} />
          </button>
        </Tooltip>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Typography.Title
          level={3}
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: '-0.03em',
            color: isAvailable && status === 'active' ? '#0f172a' : '#64748b',
            lineHeight: 1.2,
          }}
        >
          {!isAvailable && (
            <LockOutlined
              style={{ fontSize: 19, marginRight: 8, color: '#d97706' }}
              aria-hidden="true"
            />
          )}
          {displayValue}
        </Typography.Title>

        <Tag
          bordered={false}
          color={tagColor}
          style={{
            marginRight: 0,
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 4,
            padding: '1px 8px',
          }}
        >
          {tagText}
        </Tag>
      </div>

      <div style={{ marginTop: 12, minHeight: 20, display: 'flex', alignItems: 'center' }}>
        {changePercentage !== null && changePercentage !== undefined ? (
          <Space size={6}>
            {changePercentage >= 0 ? (
              <span
                style={{
                  color: '#15803d',
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <ArrowUpOutlined style={{ marginRight: 2 }} aria-hidden="true" />+{changePercentage}
                %
              </span>
            ) : (
              <span
                style={{
                  color: '#b91c1c',
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <ArrowDownOutlined style={{ marginRight: 2 }} aria-hidden="true" />
                {changePercentage}%
              </span>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 11, color: '#64748b' }}>
              vs prior period
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text
            type="secondary"
            title={definitionNote}
            style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}
          >
            {definitionNote.length > 46 ? `${definitionNote.slice(0, 46)}…` : definitionNote}
          </Typography.Text>
        )}
      </div>
    </Card>
  );
};
