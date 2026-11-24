import React from 'react';
import { Card, Typography, Space, Steps, Tag, Alert } from 'antd';
import { ShoppingCartOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';

export const CommerceLifecycleCard: React.FC = () => {
  return (
    <Card
      className="thz-modern-card"
      variant="outlined"
      title={
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
          <Space size={10}>
            <span
              className="thz-icon-badge"
              style={{ color: '#0284c7', background: '#e0f2fe' }}
              aria-hidden="true"
            >
              <ShoppingCartOutlined />
            </span>
            <Typography.Text
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              Commerce & Order Pipeline Architecture
            </Typography.Text>
          </Space>
        </div>
      }
      styles={{ body: { padding: '18px 22px' } }}
    >
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}
      >
        Platform commerce progression per Technical Roadmap. Modules activate systematically as
        backend contracts are ratified.
      </Typography.Paragraph>

      <Steps
        direction="vertical"
        size="small"
        current={1}
        items={[
          {
            title: (
              <Space size={8}>
                <Typography.Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                  Milestone 5B.4 — Pre-Tax Checkout Preparation
                </Typography.Text>
                <Tag
                  bordered={false}
                  color="success"
                  icon={<CheckCircleOutlined aria-hidden="true" />}
                  style={{ borderRadius: 4, fontWeight: 600 }}
                >
                  Active
                </Tag>
              </Space>
            ),
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
                Server-authoritative pre-tax/pre-freight snapshot generation. Verified idempotency,
                PIN serviceability validation, and cart pricing engine.
              </Typography.Text>
            ),
          },
          {
            title: (
              <Space size={8}>
                <Typography.Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                  Milestone 5B.5 — Order Placement & Fulfilment Allocation
                </Typography.Text>
                <Tag
                  bordered={false}
                  color="processing"
                  icon={<ClockCircleOutlined aria-hidden="true" />}
                  style={{ borderRadius: 4, fontWeight: 600 }}
                >
                  Next Milestone
                </Tag>
              </Space>
            ),
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
                Parent Order and FulfilmentUnit state machines pending business decision
                ratification (Decisions #4, #6, #7).
              </Typography.Text>
            ),
          },
          {
            title: (
              <Space size={8}>
                <Typography.Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                  Phase 4 — Payments, Reconciliation & Payout Settlements
                </Typography.Text>
                <Tag bordered={false} color="default" style={{ borderRadius: 4, fontWeight: 600 }}>
                  Deferred
                </Tag>
              </Space>
            ),
            description: (
              <Typography.Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
                Razorpay payment gateway execution, statutory tax invoicing (Decision #32), refunds
                and escrow settlement release (Decisions #10, #14).
              </Typography.Text>
            ),
          },
        ]}
      />

      <Alert
        style={{
          marginTop: 18,
          borderRadius: 8,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
        }}
        type="info"
        showIcon
        message={
          <span style={{ fontWeight: 600, color: '#1e293b' }}>
            Strict Financial Definition Integrity
          </span>
        }
        description={
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Per SRS §14.5 and FR-REP-005, order revenue and payout metrics are locked from display
            until accounting definitions are ratified by platform stakeholders.
          </span>
        }
      />
    </Card>
  );
};
