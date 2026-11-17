import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Skeleton, Space, Tag, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, UserStatus, type IAdminCustomerDetailDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { CustomerStatusBadge } from '../components/CustomerStatusBadge.js';
import { CustomerSegmentBadge } from '../components/CustomerSegmentBadge.js';
import { CustomerAddressList } from '../components/CustomerAddressList.js';
import { CustomerError } from '../components/CustomerError.js';
import { CustomerStatusActionModal } from '../components/CustomerStatusActionModal.js';
import { CustomerB2bModal, type CustomerB2bModalMode } from '../components/CustomerB2bModal.js';
import { useCustomerDetail } from '../hooks/useCustomerDetail.js';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const EXCLUDED_METADATA_KEYS = new Set([
  'companyName',
  'gstin',
  'b2bVerification',
  'password',
  'passwordHash',
  'token',
  'tokens',
  'secret',
  'otp',
  'refreshToken',
]);

export function CustomerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canRead = user?.permissions.includes(PermissionCode.CUSTOMER_READ) ?? false;
  const canSuspend = user?.permissions.includes(PermissionCode.CUSTOMER_SUSPEND) ?? false;
  const canVerifyB2b = user?.permissions.includes(PermissionCode.B2B_VERIFY) ?? false;

  const { customer, loading, error, retry, setCustomer } = useCustomerDetail(id, {
    enabled: canRead,
  });

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'SUSPENDED' | null>(null);

  const [b2bModalOpen, setB2bModalOpen] = useState(false);
  const [b2bMode, setB2bMode] = useState<CustomerB2bModalMode | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

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

  const handleOpenStatusModal = (status: 'ACTIVE' | 'SUSPENDED') => {
    setFeedback(null);
    setTargetStatus(status);
    setStatusModalOpen(true);
  };

  const handleOpenB2bModal = (mode: CustomerB2bModalMode) => {
    setFeedback(null);
    setB2bMode(mode);
    setB2bModalOpen(true);
  };

  const handleCustomerUpdated = (updated: IAdminCustomerDetailDto, successMessage: string) => {
    setCustomer(updated);
    setFeedback({ type: 'success', message: successMessage });
  };

  const otherMetadata = Object.entries(customer?.metadata || {}).filter(([key]) => {
    const lowerKey = key.toLowerCase();
    if (EXCLUDED_METADATA_KEYS.has(key)) return false;
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret')
    ) {
      return false;
    }
    return true;
  });

  const b2bVerification =
    customer?.metadata?.b2bVerification && typeof customer.metadata.b2bVerification === 'object'
      ? (customer.metadata.b2bVerification as Record<string, unknown>)
      : null;

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
                Inspection view for registered customer identity, account actions, and delivery
                sites.
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

              {/* Account Status Actions */}
              {canSuspend && customer.status === UserStatus.ACTIVE && (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => handleOpenStatusModal('SUSPENDED')}
                  aria-label="Suspend customer account"
                >
                  Suspend Account
                </Button>
              )}
              {canSuspend && customer.status === UserStatus.SUSPENDED && (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleOpenStatusModal('ACTIVE')}
                  aria-label="Reactivate customer account"
                >
                  Reactivate Account
                </Button>
              )}

              {/* B2B Verification Actions */}
              {canVerifyB2b && customer.customerSegment === 'B2C' && (
                <Button
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => handleOpenB2bModal('grant')}
                  aria-label="Verify B2B contractor"
                >
                  Verify B2B Contractor
                </Button>
              )}
              {canVerifyB2b && customer.customerSegment === 'B2B' && (
                <Space wrap>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => handleOpenB2bModal('update')}
                    aria-label="Update B2B details"
                  >
                    Update B2B Details
                  </Button>
                  <Button
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => handleOpenB2bModal('revoke')}
                    aria-label="Revoke B2B status"
                  >
                    Revoke B2B Status
                  </Button>
                </Space>
              )}
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

          <Card
            title="B2B Wholesale Contractor Verification"
            variant="borderless"
            className="catalogue-card"
          >
            {customer.customerSegment === 'B2B' ? (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Descriptions
                  column={{ xs: 1, sm: 2, lg: 3 }}
                  size="middle"
                  bordered={false}
                  styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
                >
                  <Descriptions.Item label="Company Name">
                    <Typography.Text strong>
                      {typeof customer.metadata?.companyName === 'string'
                        ? customer.metadata.companyName
                        : '—'}
                    </Typography.Text>
                  </Descriptions.Item>

                  <Descriptions.Item label="GSTIN">
                    {typeof customer.metadata?.gstin === 'string' && customer.metadata.gstin ? (
                      <Typography.Text
                        copyable={{ text: customer.metadata.gstin }}
                        style={{ fontFamily: 'monospace' }}
                      >
                        {customer.metadata.gstin}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">Not provided</Typography.Text>
                    )}
                  </Descriptions.Item>

                  <Descriptions.Item label="Classification">
                    <Tag color="purple">Verified B2B Wholesale</Tag>
                  </Descriptions.Item>

                  {b2bVerification && (
                    <>
                      <Descriptions.Item label="Verified At">
                        <Typography.Text>
                          {formatDate(b2bVerification.verifiedAt as string)}
                        </Typography.Text>
                      </Descriptions.Item>

                      <Descriptions.Item label="Verified By Staff">
                        <Typography.Text style={{ fontFamily: 'monospace' }}>
                          {String(b2bVerification.verifiedByStaffId || '—')}
                        </Typography.Text>
                      </Descriptions.Item>

                      <Descriptions.Item label="Verification Reason">
                        <Typography.Text>{String(b2bVerification.reason || '—')}</Typography.Text>
                      </Descriptions.Item>
                    </>
                  )}
                </Descriptions>

                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  Note: GSTIN format is validated syntactically for format compliance only (15
                  alphanumeric characters). This record reflects internal contractor classification
                  and does not represent external GST portal verification.
                </Typography.Paragraph>
              </Space>
            ) : (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  This customer is currently classified as a retail (B2C) consumer. Wholesale
                  contractor pricing and commercial trade billing are not enabled for this account.
                </Typography.Text>
                {canVerifyB2b && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
                    Authorized staff may verify contractor enterprise details and tax credentials to
                    upgrade this account to B2B Wholesale status.
                  </Typography.Paragraph>
                )}
              </Space>
            )}
          </Card>

          {otherMetadata.length > 0 && (
            <Card
              title="Additional Account Metadata"
              variant="borderless"
              className="catalogue-card"
            >
              <Descriptions
                column={{ xs: 1, sm: 2, lg: 3 }}
                size="middle"
                bordered={false}
                styles={{ label: { fontWeight: 500, color: 'rgba(0, 0, 0, 0.65)' } }}
              >
                {otherMetadata.map(([key, val]) => (
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

          <CustomerStatusActionModal
            open={statusModalOpen}
            customer={customer}
            targetStatus={targetStatus}
            onClose={() => {
              setStatusModalOpen(false);
              setTargetStatus(null);
            }}
            onSuccess={(updated) => {
              const actionText =
                updated.status === UserStatus.SUSPENDED ? 'suspended' : 'reactivated';
              handleCustomerUpdated(
                updated,
                `Customer account has been successfully ${actionText}.`,
              );
            }}
          />

          <CustomerB2bModal
            open={b2bModalOpen}
            customer={customer}
            mode={b2bMode}
            onClose={() => {
              setB2bModalOpen(false);
              setB2bMode(null);
            }}
            onSuccess={(updated) => {
              const isB2b = updated.customerSegment === 'B2B';
              handleCustomerUpdated(
                updated,
                isB2b
                  ? 'B2B wholesale contractor status has been successfully granted.'
                  : 'B2B wholesale status has been revoked. Customer is now B2C retail.',
              );
            }}
          />
        </Space>
      ) : null}
    </div>
  );
}
