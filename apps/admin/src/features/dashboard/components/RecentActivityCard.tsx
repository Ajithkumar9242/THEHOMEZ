import React from 'react';
import { Card, Typography, List, Tag, Empty, Skeleton, Alert, Space } from 'antd';
import { HistoryOutlined, UserOutlined, ShopOutlined } from '@ant-design/icons';
import type { IRecentActivityDto } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { PermissionCode } from '@thehomez/shared-types';

interface RecentActivityCardProps {
  data: IRecentActivityDto | null;
  loading: boolean;
  error: string | null;
}

export const RecentActivityCard: React.FC<RecentActivityCardProps> = ({ data, loading, error }) => {
  const { user } = useAuth();
  const canReadAudit =
    user?.roles?.includes('SUPER_ADMIN') || user?.permissions?.includes(PermissionCode.AUDIT_READ);

  if (!canReadAudit) {
    return (
      <Card
        className="thz-modern-card"
        title="Recent Operational Activity"
        variant="outlined"
        style={{ height: '100%' }}
      >
        <Alert
          type="info"
          showIcon
          message="Role Restricted"
          description="Your administrator role does not include AUDIT_READ capability."
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        className="thz-modern-card"
        title="Recent Operational Activity"
        variant="outlined"
        style={{ height: '100%' }}
      >
        <Alert type="error" showIcon message="Failed to load activity logs" description={error} />
      </Card>
    );
  }

  return (
    <Card
      className="thz-modern-card"
      variant="outlined"
      title={
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
          <Space size={10}>
            <span
              className="thz-icon-badge"
              style={{ color: '#059669', background: '#ecfdf5' }}
              aria-hidden="true"
            >
              <HistoryOutlined />
            </span>
            <Typography.Text
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              Recent Operational Activity
            </Typography.Text>
          </Space>
        </div>
      }
      styles={{ body: { padding: '12px 18px' } }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : !data || data.items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: '#64748b', fontSize: 13 }}>
              No recent operational activity recorded in database audit collections.
            </span>
          }
          style={{ margin: '24px 0' }}
        />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={data.items}
          renderItem={(item) => {
            const isPartner = item.domain === 'PARTNER';
            const domainIcon = isPartner ? (
              <ShopOutlined aria-hidden="true" style={{ color: '#2563eb' }} />
            ) : (
              <UserOutlined aria-hidden="true" style={{ color: '#7c3aed' }} />
            );
            const formattedTime = new Date(item.timestamp).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <List.Item className="thz-actionable-item">
                <List.Item.Meta
                  avatar={
                    <span
                      className="thz-icon-badge"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: isPartner ? '#eff6ff' : '#f5f3ff',
                        fontSize: 14,
                        marginTop: 2,
                      }}
                    >
                      {domainIcon}
                    </span>
                  }
                  title={
                    <Space size={8}>
                      <Typography.Text
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#0f172a',
                        }}
                      >
                        {item.action.replace(/_/g, ' ')}
                      </Typography.Text>
                      <Tag
                        bordered={false}
                        color={isPartner ? 'blue' : 'purple'}
                        style={{ fontSize: 10, fontWeight: 600, margin: 0, borderRadius: 3 }}
                      >
                        {item.domain}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, color: '#475569', display: 'block' }}
                      >
                        {item.summary}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11, color: '#94a3b8' }}>
                        {formattedTime} {item.actorEmail ? `· by ${item.actorEmail}` : ''}
                      </Typography.Text>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};
