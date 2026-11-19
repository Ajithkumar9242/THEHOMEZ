import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Result,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PermissionCode,
  type IPartnerAdminDetailDto,
  type IPartnerServiceAreaDetailDto,
  type PartnerStatus,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { PartnerStatusBadge } from '../components/PartnerStatusBadge.js';
import { PartnerDeliveryModeBadge } from '../components/PartnerDeliveryModeBadge.js';
import { PartnerError } from '../components/PartnerError.js';
import { PartnerStatusActionModal } from '../components/PartnerStatusActionModal.js';
import { PartnerAuditHistoryTable } from '../components/PartnerAuditHistoryTable.js';
import { usePartnerDetail } from '../hooks/usePartnerDetail.js';
import { usePartnerAuditLogs } from '../hooks/usePartnerAuditLogs.js';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const EXCLUDED_METADATA_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokens',
  'secret',
  'apiSecretKey',
  'otp',
  'otpSecret',
  'refreshToken',
]);

export function PartnerDetailPage() {
  const { partnerId = '' } = useParams<{ partnerId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canRead = user?.permissions.includes(PermissionCode.PARTNER_READ) ?? false;
  const canVerify = user?.permissions.includes(PermissionCode.PARTNER_VERIFY) ?? false;
  const canSuspend = user?.permissions.includes(PermissionCode.PARTNER_SUSPEND) ?? false;

  const {
    partner,
    setPartner,
    loading,
    error,
    retry,
    refresh: refreshDetail,
  } = usePartnerDetail(partnerId, { enabled: canRead });

  const {
    items: auditLogs,
    total: auditTotal,
    page: auditPage,
    limit: auditLimit,
    setPagination: setAuditPagination,
    loading: auditLoading,
    refresh: refreshAuditLogs,
  } = usePartnerAuditLogs(partnerId, { enabled: canRead });

  const [modalOpen, setModalOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<PartnerStatus | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="PARTNER_READ permission required"
        description="Your account does not possess the permission required to inspect partner details. The partner API was not requested."
      />
    );
  }

  const isNotFound =
    error instanceof ApiError && (error.status === 404 || error.code === 'PARTNER_NOT_FOUND');

  const handleOpenStatusModal = (status: PartnerStatus) => {
    setFeedback(null);
    setTargetStatus(status);
    setModalOpen(true);
  };

  const handlePartnerUpdated = (updated: IPartnerAdminDetailDto) => {
    setPartner(updated);
    setFeedback({
      type: 'success',
      message: `Partner status successfully transitioned to ${updated.status}. Linked user active sessions have been revoked.`,
    });
    void refreshAuditLogs();
  };

  const handleConcurrentConflict = () => {
    void refreshDetail();
    void refreshAuditLogs();
  };

  // Safe metadata
  const safeMetadata = Object.entries(partner?.metadata || {}).filter(([key]) => {
    const lowerKey = key.toLowerCase();
    if (EXCLUDED_METADATA_KEYS.has(key)) return false;
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('otp')
    ) {
      return false;
    }
    return true;
  });

  // Calculate available status actions per Stage C-8A.8 lifecycle matrix:
  // PENDING_VERIFICATION -> INACTIVE, SUSPENDED
  // ACTIVE -> INACTIVE, SUSPENDED
  // INACTIVE -> SUSPENDED
  // SUSPENDED -> INACTIVE
  const canTransitionToInactive =
    canVerify &&
    (partner?.status === 'ACTIVE' ||
      partner?.status === 'PENDING_VERIFICATION' ||
      partner?.status === 'SUSPENDED');

  const canTransitionToSuspended =
    canSuspend &&
    (partner?.status === 'ACTIVE' ||
      partner?.status === 'PENDING_VERIFICATION' ||
      partner?.status === 'INACTIVE');

  const serviceAreaColumns: ColumnsType<IPartnerServiceAreaDetailDto> = [
    {
      title: 'Area Code',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => (
        <Typography.Text strong style={{ fontFamily: 'monospace' }}>
          {code}
        </Typography.Text>
      ),
    },
    {
      title: 'Hub Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
    },
    {
      title: 'State',
      dataIndex: 'state',
      key: 'state',
    },
    {
      title: 'Coverage Pincodes',
      dataIndex: 'pincodeCount',
      key: 'pincodeCount',
      align: 'right',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: 'Area Status',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? 'Operational' : 'Inactive'}</Tag>
      ),
    },
  ];

  return (
    <div className="partner-detail-page">
      <div style={{ marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/partners')}
          aria-label="Back to partner directory"
        >
          Back to Partners
        </Button>
      </div>

      {feedback && (
        <Alert
          type={feedback.type}
          showIcon
          closable
          onClose={() => setFeedback(null)}
          message={feedback.message}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading ? (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 10 }} />
        </Card>
      ) : isNotFound ? (
        <Card variant="borderless">
          <Result
            status="404"
            title="Partner Not Found"
            subTitle={`No partner organization was found with identifier "${partnerId}". The partner may have been removed or the ID is invalid.`}
            extra={
              <Button type="primary" onClick={() => navigate('/partners')}>
                Back to Partner Directory
              </Button>
            }
          />
        </Card>
      ) : error ? (
        <div style={{ marginTop: 16 }}>
          <PartnerError error={error} retry={retry} />
        </div>
      ) : partner ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* Header */}
          <div className="catalogue-heading">
            <div>
              <Typography.Text className="eyebrow">PARTNER PROFILE</Typography.Text>
              <Typography.Title level={1} style={{ margin: '4px 0' }}>
                {partner.businessName}
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Inspection view for registered vendor entity, service areas, and lifecycle actions.
              </Typography.Paragraph>
            </div>
            <Space align="center" wrap>
              <PartnerStatusBadge status={partner.status} />
              <PartnerDeliveryModeBadge deliveryMode={partner.deliveryMode} />
              <Tag style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 8px' }}>
                ID: {partner.id}
              </Tag>

              {/* Status Action Buttons */}
              {canTransitionToInactive && (
                <Button
                  icon={<ExclamationCircleOutlined />}
                  onClick={() => handleOpenStatusModal('INACTIVE')}
                  aria-label="Inactivate partner"
                >
                  Inactivate Partner
                </Button>
              )}

              {canTransitionToSuspended && (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => handleOpenStatusModal('SUSPENDED')}
                  aria-label="Suspend partner"
                >
                  Suspend Partner
                </Button>
              )}
            </Space>
          </div>

          {/* Section A: Business Overview */}
          <Card
            title="Section A: Business Overview"
            variant="borderless"
            className="catalogue-card"
          >
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              size="middle"
              bordered={false}
              styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
            >
              <Descriptions.Item label="Business Name">
                <Typography.Text strong copyable={{ text: partner.businessName }}>
                  {partner.businessName}
                </Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Legal Name">
                {partner.legalName ? (
                  <Typography.Text copyable={{ text: partner.legalName }}>
                    {partner.legalName}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )}
              </Descriptions.Item>

              <Descriptions.Item label="Contact Phone">
                <Typography.Text copyable={{ text: partner.phone }}>
                  {partner.phone}
                </Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Contact Email">
                {partner.email ? (
                  <Typography.Text copyable={{ text: partner.email }}>
                    {partner.email}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )}
              </Descriptions.Item>

              <Descriptions.Item label="Lifecycle Status">
                <PartnerStatusBadge status={partner.status} />
              </Descriptions.Item>

              <Descriptions.Item label="Delivery Model">
                <PartnerDeliveryModeBadge deliveryMode={partner.deliveryMode} />
              </Descriptions.Item>

              <Descriptions.Item label="Created Date">
                <Typography.Text>{formatDate(partner.createdAt)}</Typography.Text>
              </Descriptions.Item>

              <Descriptions.Item label="Last Updated">
                <Typography.Text type="secondary">{formatDate(partner.updatedAt)}</Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Section B: Service Areas */}
          <Card
            title={`Section B: Service Areas (${partner.serviceAreas?.length ?? 0})`}
            variant="borderless"
            className="catalogue-card"
          >
            <Table<IPartnerServiceAreaDetailDto>
              rowKey="id"
              columns={serviceAreaColumns}
              dataSource={partner.serviceAreas ?? []}
              pagination={false}
              size="small"
              locale={{
                emptyText: 'No service area fulfillment hubs assigned to this partner organization',
              }}
            />
          </Card>

          {/* Section C: Linked Accounts */}
          <Card
            title="Section C: Linked Tenant Accounts"
            variant="borderless"
            className="catalogue-card"
          >
            <Space align="center" size="middle">
              <UsergroupAddOutlined style={{ fontSize: 28, color: '#1677ff' }} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {partner.linkedUserCount} Linked Partner Account
                  {partner.linkedUserCount === 1 ? '' : 's'}
                </Typography.Title>
                <Typography.Text type="secondary">
                  Authorized operator credentials affiliated with this vendor organization tenant.
                </Typography.Text>
              </div>
            </Space>
          </Card>

          {/* Safe Metadata */}
          {safeMetadata.length > 0 && (
            <Card
              title="Additional Organization Metadata"
              variant="borderless"
              className="catalogue-card"
            >
              <Descriptions
                column={{ xs: 1, sm: 2, lg: 3 }}
                size="middle"
                bordered={false}
                styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
              >
                {safeMetadata.map(([key, val]) => (
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

          {/* Section D: Lifecycle Audit History */}
          <Card
            title={`Section D: Lifecycle Status Change History (${auditTotal})`}
            variant="borderless"
            className="catalogue-card"
          >
            <PartnerAuditHistoryTable
              items={auditLogs}
              loading={auditLoading}
              page={auditPage}
              limit={auditLimit}
              total={auditTotal}
              onPaginationChange={setAuditPagination}
            />
          </Card>

          {/* Status Mutation Modal */}
          <PartnerStatusActionModal
            open={modalOpen}
            partner={partner}
            targetStatus={targetStatus}
            onClose={() => {
              setModalOpen(false);
              setTargetStatus(null);
            }}
            onSuccess={handlePartnerUpdated}
            onConcurrentModification={handleConcurrentConflict}
          />
        </Space>
      ) : null}
    </div>
  );
}
