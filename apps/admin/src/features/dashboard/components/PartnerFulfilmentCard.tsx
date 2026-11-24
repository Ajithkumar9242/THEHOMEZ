import React from 'react';
import { Card, Typography, Row, Col, Progress, Space, Button, Skeleton, Alert, Tag } from 'antd';
import { ShopOutlined, AuditOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { IPartnerOverviewDto } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { PermissionCode } from '@thehomez/shared-types';

interface PartnerFulfilmentCardProps {
  data: IPartnerOverviewDto | null;
  loading: boolean;
  error: string | null;
}

export const PartnerFulfilmentCard: React.FC<PartnerFulfilmentCardProps> = ({
  data,
  loading,
  error,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const canReadPartners =
    user?.roles?.includes('SUPER_ADMIN') ||
    user?.permissions?.includes(PermissionCode.PARTNER_READ);

  if (!canReadPartners) {
    return (
      <Card
        className="thz-modern-card"
        title="Partner & Fulfilment Operations"
        variant="outlined"
        style={{ height: '100%' }}
      >
        <Alert
          type="info"
          showIcon
          message="Role Restricted"
          description="Your administrator role does not include PARTNER_READ capability."
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        className="thz-modern-card"
        title="Partner & Fulfilment Operations"
        variant="outlined"
        style={{ height: '100%' }}
      >
        <Alert
          type="error"
          showIcon
          message="Failed to load partner overview"
          description={error}
        />
      </Card>
    );
  }

  const activeCount = data?.activePartnersCount || 0;
  const pendingCount = data?.pendingVerificationCount || 0;
  const suspendedCount = data?.suspendedPartnersCount || 0;
  const totalCount = activeCount + pendingCount + suspendedCount;

  const activePercent = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;

  return (
    <Card
      className="thz-modern-card"
      variant="outlined"
      title={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '2px 0',
          }}
        >
          <Space size={10}>
            <span
              className="thz-icon-badge"
              style={{ color: '#2563eb', background: '#eff6ff' }}
              aria-hidden="true"
            >
              <ShopOutlined />
            </span>
            <Typography.Text
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              Partner Network & Onboarding
            </Typography.Text>
          </Space>
          <Button
            type="link"
            size="small"
            icon={<ArrowRightOutlined aria-hidden="true" />}
            onClick={() => navigate('/partners')}
            aria-label="View Partner Directory"
            style={{ fontWeight: 600, color: '#2563eb' }}
          >
            Directory
          </Button>
        </div>
      }
      styles={{ body: { padding: '18px 22px' } }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div>
          <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
            <Col span={8}>
              <div
                style={{
                  background: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #f1f5f9',
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500, color: '#64748b', display: 'block' }}
                >
                  Active
                </Typography.Text>
                <span
                  style={{
                    color: '#15803d',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {activeCount}
                </span>
              </div>
            </Col>
            <Col span={8}>
              <div
                style={{
                  background: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #f1f5f9',
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500, color: '#64748b', display: 'block' }}
                >
                  Pending Review
                </Typography.Text>
                <span
                  style={{
                    color: '#d97706',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {data?.totalApplicationsCount || 0}
                </span>
              </div>
            </Col>
            <Col span={8}>
              <div
                style={{
                  background: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #f1f5f9',
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500, color: '#64748b', display: 'block' }}
                >
                  Suspended
                </Typography.Text>
                <span
                  style={{
                    color: '#b91c1c',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {suspendedCount}
                </span>
              </div>
            </Col>
          </Row>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Typography.Text style={{ fontSize: 12, fontWeight: 500, color: '#475569' }}>
                Network Active Ratio
              </Typography.Text>
              <Typography.Text strong style={{ fontSize: 12, color: '#0f172a' }}>
                {activePercent}%
              </Typography.Text>
            </div>
            <Progress
              percent={activePercent}
              showInfo={false}
              strokeColor="#16a34a"
              trailColor="#e2e8f0"
              size={['100%', 8]}
              aria-label={`Network active ratio: ${activePercent}%`}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              paddingTop: 4,
            }}
          >
            <Space wrap size={6}>
              {data?.deliveryModeBreakdown.map((item) => (
                <Tag
                  key={item.mode}
                  bordered={false}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    background: '#f1f5f9',
                    color: '#334155',
                  }}
                >
                  {item.mode}: {item.count}
                </Tag>
              ))}
            </Space>

            <Button
              size="small"
              icon={<AuditOutlined aria-hidden="true" />}
              onClick={() => navigate('/partner-applications')}
              aria-label="View Partner Applications"
              style={{ borderRadius: 6, fontWeight: 500 }}
            >
              Applications
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
