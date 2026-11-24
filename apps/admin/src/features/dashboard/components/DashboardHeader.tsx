import React from 'react';
import { Space, Typography, Tag, Segmented, Button, Tooltip } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { DashboardDateRange } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';

interface DashboardHeaderProps {
  dateRange: DashboardDateRange;
  onDateRangeChange: (range: DashboardDateRange) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  dateRange,
  onDateRangeChange,
  onRefresh,
  isRefreshing,
}) => {
  const { user } = useAuth();

  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const userRole = user?.roles?.[0] || 'STAFF';

  return (
    <header className="dashboard-header-container" aria-label="Dashboard overview header">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '4px 0 12px 0',
        }}
      >
        <div>
          <Space size={8} style={{ marginBottom: 6 }}>
            <Typography.Text
              type="secondary"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#64748b',
              }}
            >
              ADMIN OPERATIONAL OVERVIEW
            </Typography.Text>
            <Tag
              bordered={false}
              color="blue"
              icon={<SafetyCertificateOutlined aria-hidden="true" />}
              style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                padding: '1px 8px',
                background: '#eff6ff',
                color: '#1d4ed8',
              }}
            >
              {userRole}
            </Tag>
          </Space>
          <Typography.Title
            level={1}
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: '-0.025em',
              color: '#0f172a',
              lineHeight: 1.25,
            }}
          >
            Operational Dashboard
          </Typography.Title>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, color: '#64748b', display: 'block', marginTop: 3 }}
          >
            {formattedDate} · Platform health and role-authorized metrics
          </Typography.Text>
        </div>

        <Space wrap size="middle" align="center" style={{ marginLeft: 'auto' }}>
          <Segmented<DashboardDateRange>
            value={dateRange}
            onChange={(val) => onDateRangeChange(val as DashboardDateRange)}
            options={[
              { label: 'Today', value: 'today' },
              { label: '7 Days', value: '7d' },
              { label: '30 Days', value: '30d' },
              { label: '90 Days', value: '90d' },
            ]}
          />
          <Tooltip title="Refresh dashboard data (Alt+R)">
            <Button
              icon={<ReloadOutlined spin={isRefreshing} aria-hidden="true" />}
              onClick={onRefresh}
              loading={isRefreshing}
              aria-label="Refresh operational metrics"
              style={{
                borderRadius: 8,
                height: 36,
                fontWeight: 500,
              }}
            >
              Refresh
            </Button>
          </Tooltip>
        </Space>
      </div>
    </header>
  );
};
