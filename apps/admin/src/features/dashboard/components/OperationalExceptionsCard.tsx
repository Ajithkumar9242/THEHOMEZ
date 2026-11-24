import React from 'react';
import { Card, Typography, List, Tag, Button, Empty, Skeleton, Alert, Space } from 'antd';
import {
  WarningOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { IOperationalExceptionsDto } from '@thehomez/shared-types';

interface OperationalExceptionsCardProps {
  data: IOperationalExceptionsDto | null;
  loading: boolean;
  error: string | null;
}

export const OperationalExceptionsCard: React.FC<OperationalExceptionsCardProps> = ({
  data,
  loading,
  error,
}) => {
  const navigate = useNavigate();

  if (error) {
    return (
      <Card
        className="thz-modern-card"
        title="Operational Exceptions"
        variant="outlined"
        style={{ height: '100%' }}
      >
        <Alert type="error" showIcon message="Failed to load exceptions" description={error} />
      </Card>
    );
  }

  const criticalCount = data?.criticalCount || 0;
  const totalCount = data?.totalCount || 0;

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
              style={{
                color: criticalCount > 0 ? '#b91c1c' : '#d97706',
                background: criticalCount > 0 ? '#fee2e2' : '#fef3c7',
              }}
              aria-hidden="true"
            >
              <WarningOutlined />
            </span>
            <Typography.Text
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              Actionable Operational Items
            </Typography.Text>
          </Space>
          {totalCount > 0 && (
            <Tag
              bordered={false}
              color={criticalCount > 0 ? 'error' : 'warning'}
              style={{
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 11,
                padding: '2px 8px',
              }}
            >
              {totalCount} item{totalCount !== 1 ? 's' : ''}
            </Tag>
          )}
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
              No operational exceptions found. All partner applications and accounts are in good
              standing.
            </span>
          }
          style={{ margin: '24px 0' }}
        >
          <Tag
            bordered={false}
            color="success"
            icon={<CheckCircleOutlined aria-hidden="true" />}
            style={{ borderRadius: 4, fontWeight: 600, padding: '2px 10px' }}
          >
            All Systems Healthy
          </Tag>
        </Empty>
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={data.items}
          renderItem={(item) => {
            let tagColor = 'default';
            let icon = <InfoCircleOutlined aria-hidden="true" />;
            if (item.severity === 'CRITICAL') {
              tagColor = 'error';
              icon = <ExclamationCircleOutlined aria-hidden="true" style={{ color: '#ef4444' }} />;
            } else if (item.severity === 'WARNING') {
              tagColor = 'warning';
              icon = <WarningOutlined aria-hidden="true" style={{ color: '#f59e0b' }} />;
            } else {
              tagColor = 'processing';
            }

            return (
              <List.Item
                className="thz-actionable-item"
                actions={[
                  <Button
                    key="action"
                    type="link"
                    size="small"
                    icon={<ArrowRightOutlined aria-hidden="true" />}
                    onClick={() => navigate(item.link)}
                    aria-label={`Inspect ${item.title}`}
                    style={{ fontWeight: 600, color: '#2563eb' }}
                  >
                    Inspect
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <span
                      style={{
                        fontSize: 16,
                        marginTop: 4,
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      {icon}
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
                        {item.title}
                      </Typography.Text>
                      <Tag
                        bordered={false}
                        color={tagColor}
                        style={{ fontSize: 10, fontWeight: 600, margin: 0, borderRadius: 3 }}
                      >
                        {item.severity}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
                      {item.description}
                    </Typography.Text>
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
