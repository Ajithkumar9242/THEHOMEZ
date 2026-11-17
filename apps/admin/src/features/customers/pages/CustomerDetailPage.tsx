import { Alert, Button, Card, Descriptions, Result, Skeleton, Space, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { CustomerStatusBadge } from '../components/CustomerStatusBadge.js';
import { CustomerSegmentBadge } from '../components/CustomerSegmentBadge.js';
import { CustomerAddressList } from '../components/CustomerAddressList.js';
import { CustomerError } from '../components/CustomerError.js';
import { useCustomerDetail } from '../hooks/useCustomerDetail.js';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function CustomerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CUSTOMER_READ) ?? false;

  const { customer, loading, error, retry } = useCustomerDetail(id, { enabled: canRead });

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="CUSTOMER_READ permission required"
        description="Your account does not have permission to view customer details. The customer API was not requested."
      />
    );
  }

  const isNotFound =
    error instanceof ApiError && (error.status === 404 || error.code === 'CUSTOMER_NOT_FOUND');

  return (
    <div className="customer-detail-page">
      <div style={{ marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/customers')}
          aria-label="Back to customer directory"
        >
          Back to Customers
        </Button>
      </div>

      {loading ? (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 10 }} />
        </Card>
      ) : isNotFound ? (
        <Card variant="borderless">
          <Result
            status="404"
            title="Customer Not Found"
            subTitle={`No customer account was found with identifier "${id}". The customer may have been deleted or the identifier is invalid.`}
            extra={
              <Button type="primary" onClick={() => navigate('/customers')}>
                Back to Customer Directory
              </Button>
            }
          />
        </Card>
      ) : error ? (
        <div role="alert" style={{ marginTop: 16 }}>
          <CustomerError error={error} retry={retry} />
        </div>
      ) : customer ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div className="catalogue-heading">
            <div>
              <Typography.Text className="eyebrow">CUSTOMER DETAILS</Typography.Text>
              <Typography.Title level={1} style={{ margin: '4px 0' }}>
                {customer.phone}
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Inspection view for registered customer identity and delivery site addresses.
              </Typography.Paragraph>
            </div>
            <Space align="center" wrap>
              <CustomerStatusBadge status={customer.status} />
              <CustomerSegmentBadge segment={customer.customerSegment} />
              <Tag
                style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 8px' }}
                aria-label="Customer identifier"
              >
                ID: {customer.id}
              </Tag>
            </Space>
          </div>

          <Card
            title="Customer Identity & Account Information"
            variant="borderless"
            className="catalogue-card"
          >
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              size="middle"
              bordered={false}
              styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
            >
              <Descriptions.Item label="Customer ID">
                <Typography.Text
                  copyable={{ text: customer.id }}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                >
                  {customer.id}
                </Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Phone Number">
                <Typography.Text strong copyable={{ text: customer.phone }}>
                  {customer.phone}
                </Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Email Address">
                {customer.email ? (
                  <Typography.Text copyable={{ text: customer.email }}>
                    {customer.email}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )}
              </Descriptions.Item>

              <Descriptions.Item label="Account Status">
                <CustomerStatusBadge status={customer.status} />
              </Descriptions.Item>

              <Descriptions.Item label="Customer Segment">
                <CustomerSegmentBadge segment={customer.customerSegment} />
              </Descriptions.Item>

              <Descriptions.Item label="Roles">
                {customer.roles && customer.roles.length > 0 ? (
                  <Space wrap size={[0, 4]}>
                    {customer.roles.map((role) => (
                      <Tag key={role}>{role}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )}
              </Descriptions.Item>

              <Descriptions.Item label="Registered Date">
                <Typography.Text>{formatDate(customer.createdAt)}</Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Last Login">
                <Typography.Text>
                  {customer.lastLoginAt ? formatDate(customer.lastLoginAt) : 'Never'}
                </Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Last Updated">
                <Typography.Text type="secondary">{formatDate(customer.updatedAt)}</Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {customer.metadata && Object.keys(customer.metadata).length > 0 && (
            <Card title="Account Metadata" variant="borderless" className="catalogue-card">
              <Descriptions
                column={{ xs: 1, sm: 2, lg: 3 }}
                size="middle"
                bordered={false}
                styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
              >
                {Object.entries(customer.metadata).map(([key, val]) => (
                  <Descriptions.Item key={key} label={key}>
                    <Typography.Text>
                      {val === null || val === undefined
                        ? '—'
                        : typeof val === 'object'
                          ? JSON.stringify(val)
                          : String(val)}
                    </Typography.Text>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          )}

          <Card
            title={`Delivery Site Address Book (${customer.addresses?.length ?? 0})`}
            variant="borderless"
            className="catalogue-card"
          >
            <CustomerAddressList addresses={customer.addresses ?? []} />
          </Card>
        </Space>
      ) : null}
    </div>
  );
}
