import React from 'react';
import { Row, Col, Alert } from 'antd';
import {
  ShoppingOutlined,
  DollarOutlined,
  CreditCardOutlined,
  ShopOutlined,
  BankOutlined,
  TeamOutlined,
  AuditOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type { IAdminDashboardSummaryDto } from '@thehomez/shared-types';
import { KpiCard } from './KpiCard.js';

interface KpiGridProps {
  summary: IAdminDashboardSummaryDto | null;
  loading: boolean;
  error: string | null;
}

export const KpiGrid: React.FC<KpiGridProps> = ({ summary, loading, error }) => {
  if (error) {
    return (
      <div style={{ marginBottom: 24 }}>
        <Alert type="error" showIcon message="Failed to load summary KPIs" description={error} />
      </div>
    );
  }

  return (
    <div className="kpi-grid-container" style={{ marginBottom: 24 }}>
      <Row gutter={[16, 16]}>
        {/* 1. Total Orders (SRS FR-ADM-001) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.orders.totalOrders}
            loading={loading}
            icon={<ShoppingOutlined />}
          />
        </Col>

        {/* 2. Gross Sales / GOV (SRS FR-ADM-001) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.sales.grossSalesPaise}
            loading={loading}
            icon={<DollarOutlined />}
            formatAsCurrency
          />
        </Col>

        {/* 3. Successful Payments (SRS FR-ADM-001) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.payments.successfulPayments}
            loading={loading}
            icon={<CreditCardOutlined />}
          />
        </Col>

        {/* 4. Active Partners (SRS FR-ADM-001) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.fulfilment.activePartners}
            loading={loading}
            icon={<ShopOutlined />}
          />
        </Col>

        {/* 5. Outstanding Settlements (SRS FR-ADM-001) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.settlements.outstandingSettlementPaise}
            loading={loading}
            icon={<BankOutlined />}
            formatAsCurrency
          />
        </Col>

        {/* 6. Registered Customers (SRS FR-ADM-003) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.customers.totalCustomers}
            loading={loading}
            icon={<TeamOutlined />}
          />
        </Col>

        {/* 7. Pending B2B Verifications (SRS FR-ADM-003) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.customers.pendingB2bVerifications}
            loading={loading}
            icon={<AuditOutlined />}
          />
        </Col>

        {/* 8. Catalog Master Products (SRS FR-ADM-002) */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <KpiCard
            metric={summary?.catalog.totalProducts}
            loading={loading}
            icon={<AppstoreOutlined />}
          />
        </Col>
      </Row>
    </div>
  );
};
