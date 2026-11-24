import React from 'react';
import { Row, Col } from 'antd';
import { useDashboardData } from '../hooks/useDashboardData.js';
import { DashboardHeader } from '../components/DashboardHeader.js';
import { KpiGrid } from '../components/KpiGrid.js';
import { OperationalExceptionsCard } from '../components/OperationalExceptionsCard.js';
import { PartnerFulfilmentCard } from '../components/PartnerFulfilmentCard.js';
import { CommerceLifecycleCard } from '../components/CommerceLifecycleCard.js';
import { RecentActivityCard } from '../components/RecentActivityCard.js';

export const DashboardOverviewPage: React.FC = () => {
  const {
    dateRange,
    setDateRange,
    summary,
    summaryLoading,
    summaryError,
    partnerOverview,
    partnerLoading,
    partnerError,
    exceptions,
    exceptionsLoading,
    exceptionsError,
    recentActivity,
    activityLoading,
    activityError,
    refreshAll,
    isRefreshing,
  } = useDashboardData();

  return (
    <main
      className="dashboard-overview-page"
      role="main"
      aria-label="Admin Operational Dashboard"
      style={{ padding: '4px 0' }}
    >
      {/* 1. Header with greeting, role badge, date, dateRange selector & refresh */}
      <DashboardHeader
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={() => void refreshAll()}
        isRefreshing={isRefreshing}
      />

      {/* 2. Top-level role-authorized KPI cards */}
      <KpiGrid summary={summary} loading={summaryLoading} error={summaryError} />

      {/* 3. Middle row: Actionable Exceptions & Partner Network Overview */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <OperationalExceptionsCard
            data={exceptions}
            loading={exceptionsLoading}
            error={exceptionsError}
          />
        </Col>
        <Col xs={24} lg={12}>
          <PartnerFulfilmentCard
            data={partnerOverview}
            loading={partnerLoading}
            error={partnerError}
          />
        </Col>
      </Row>

      {/* 4. Bottom row: Commerce Lifecycle Architecture & Real Audit Activity */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <CommerceLifecycleCard />
        </Col>
        <Col xs={24} lg={12}>
          <RecentActivityCard
            data={recentActivity}
            loading={activityLoading}
            error={activityError}
          />
        </Col>
      </Row>
    </main>
  );
};
