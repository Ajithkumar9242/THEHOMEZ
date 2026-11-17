import { Card, Descriptions, Empty, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CompassOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  StarFilled,
} from '@ant-design/icons';
import type { ICustomerAddressDto } from '@thehomez/shared-types';

interface CustomerAddressListProps {
  addresses: ICustomerAddressDto[];
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function CustomerAddressList({ addresses }: CustomerAddressListProps) {
  if (!addresses || addresses.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No saved delivery site addresses registered for this customer account."
      />
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {addresses.map((address) => (
        <Card
          key={address.id}
          size="small"
          className="customer-address-card"
          title={
            <Space align="center" wrap>
              <HomeOutlined style={{ color: '#1677ff' }} />
              <Typography.Text strong>{address.label || 'Delivery Site'}</Typography.Text>
              {address.isDefault && (
                <Tag color="blue" icon={<StarFilled />} aria-label="Default delivery site address">
                  Default Address
                </Tag>
              )}
            </Space>
          }
          extra={
            address.isServiceable === true ? (
              <Tag
                color="success"
                icon={<CheckCircleOutlined />}
                aria-label="Address is serviceable"
              >
                Serviceable
              </Tag>
            ) : address.isServiceable === false ? (
              <Tag
                color="error"
                icon={<CloseCircleOutlined />}
                aria-label="Address is out of delivery coverage"
              >
                Not Serviceable
              </Tag>
            ) : (
              <Tag
                color="default"
                icon={<InfoCircleOutlined />}
                aria-label="Address serviceability not provided"
              >
                Coverage Unchecked
              </Tag>
            )
          }
        >
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, lg: 3 }}
            bordered={false}
            styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
          >
            <Descriptions.Item label="Recipient">
              <Typography.Text>{address.recipientName || '—'}</Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Contact Phone">
              <Typography.Text>{address.phone || '—'}</Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Landmark">
              <Typography.Text type="secondary">{address.landmark || '—'}</Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Street Address" span={3}>
              <Typography.Text>{address.streetAddress || '—'}</Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Location" span={2}>
              <Typography.Text strong>
                {address.city}, {address.state} - {address.pincode}
              </Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Site Contact Person">
              {address.siteContactPerson &&
              (address.siteContactPerson.name || address.siteContactPerson.phone) ? (
                <Typography.Text>
                  {address.siteContactPerson.name || 'Site Contact'}{' '}
                  {address.siteContactPerson.phone && (
                    <Typography.Text type="secondary">
                      ({address.siteContactPerson.phone})
                    </Typography.Text>
                  )}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label="Heavy Vehicle Access" span={3}>
              <Typography.Text type="secondary">
                {address.heavyVehicleAccessInstructions || '—'}
              </Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Service Area Coverage" span={3}>
              {address.serviceArea ? (
                <Space wrap align="center">
                  <CompassOutlined style={{ color: '#52c41a' }} />
                  <Typography.Text strong>{address.serviceArea.name}</Typography.Text>
                  <Tag>{address.serviceArea.code}</Tag>
                  <Typography.Text type="secondary">
                    ({address.serviceArea.city}, {address.serviceArea.state})
                  </Typography.Text>
                </Space>
              ) : address.isServiceable === false ? (
                <Typography.Text type="danger">
                  Outside active service coverage (no active service area covering PIN{' '}
                  {address.pincode})
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  Serviceability information not provided for this address
                </Typography.Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label="Registered">
              <Typography.Text type="secondary">{formatDate(address.createdAt)}</Typography.Text>
            </Descriptions.Item>

            <Descriptions.Item label="Last Updated" span={2}>
              <Typography.Text type="secondary">{formatDate(address.updatedAt)}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ))}
    </Space>
  );
}
