import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IServiceArea } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { serviceAreaClient } from '../api/service-area-client.js';
import { ServiceAreaError } from '../components/ServiceAreaError.js';
import { ServiceAreaStatus } from '../components/ServiceAreaStatus.js';

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function ServiceAreaDetailPage() {
  const { serviceAreaId = '' } = useParams();
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.SERVICE_AREA_READ) ?? false;
  const navigate = useNavigate();
  const [area, setArea] = useState<IServiceArea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canRead) {
      setArea(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void serviceAreaClient
      .get(serviceAreaId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setArea(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, serviceAreaId, attempt]);

  if (!canRead)
    return (
      <Alert
        type="error"
        showIcon
        message="SERVICE_AREA_READ permission required"
        description="Your account cannot inspect service areas. The service-area API was not requested."
      />
    );

  return (
    <div className="service-area-detail-page">
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/service-areas')}>
        Back to service areas
      </Button>
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">SERVICE AREA DETAILS</Typography.Text>
          <Typography.Title level={1}>{area?.name || 'Service Area'}</Typography.Title>
        </div>
        {area && <ServiceAreaStatus isActive={area.isActive} />}
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : error ? (
        <ServiceAreaError
          error={error}
          retry={() => setAttempt((current) => current + 1)}
          resource="service area"
        />
      ) : area ? (
        <Space direction="vertical" size="middle" className="catalogue-sections">
          {!area.isActive ? (
            <Alert
              className="service-area-state-note"
              type="warning"
              showIcon
              message="Inactive service area"
              description="These PINs are stored configuration only. The public PIN-check endpoint does not consider inactive service areas serviceable. PIN assignments may overlap other areas."
            />
          ) : (
            <Alert
              className="service-area-state-note"
              type="success"
              showIcon
              message="Active service area"
              description="The configured PINs belong to an active service area and are considered by the public PIN-check endpoint."
            />
          )}
          <Card variant="borderless" title="Area information">
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
              <Descriptions.Item label="Code">{area.code}</Descriptions.Item>
              <Descriptions.Item label="Name">{area.name}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <ServiceAreaStatus isActive={area.isActive} />
              </Descriptions.Item>
              <Descriptions.Item label="City">{area.city}</Descriptions.Item>
              <Descriptions.Item label="State">{area.state}</Descriptions.Item>
              <Descriptions.Item label="Country">{area.countryCode}</Descriptions.Item>
              <Descriptions.Item label="Delivery radius">
                {area.deliveryRadiusKm == null ? '—' : `${area.deliveryRadiusKm} km`}
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDate(area.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Last updated">
                {formatDate(area.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card
            variant="borderless"
            title={`Configured PIN codes (${area.pincodes.length})`}
            className="catalogue-card"
          >
            <Typography.Paragraph type="secondary">
              PIN codes are displayed as stored on this service area. No individual PIN status is
              available.
            </Typography.Paragraph>
            {area.pincodes.length ? (
              <Table<string>
                className="service-area-pin-table"
                size="small"
                rowKey={(pincode) => pincode}
                dataSource={area.pincodes}
                pagination={{
                  pageSize: 50,
                  showSizeChanger: false,
                  showTotal: (total) => `${total} configured PINs`,
                }}
                columns={[
                  {
                    title: 'PIN code',
                    dataIndex: 'pincode',
                    key: 'pincode',
                    render: (_: unknown, pincode: string) => <Tag>{pincode}</Tag>,
                  },
                ]}
              />
            ) : (
              <Empty description="No PIN codes are configured for this service area" />
            )}
          </Card>
        </Space>
      ) : (
        <Empty description="No service area details returned" />
      )}
    </div>
  );
}
