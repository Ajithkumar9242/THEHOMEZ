import { useEffect, useState } from 'react';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  ShopOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IServiceArea } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { usePartnerApplicationDetail } from '../hooks/usePartnerApplicationDetail.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PartnerApplicationStatusBadge } from '../components/PartnerApplicationStatusBadge.js';
import { PartnerApplicationAuditHistoryTable } from '../components/PartnerApplicationAuditHistoryTable.js';
import { PartnerApplicationReviewModal } from '../components/PartnerApplicationReviewModal.js';
import { PartnerApplicationRejectModal } from '../components/PartnerApplicationRejectModal.js';
import { PartnerApplicationWithdrawModal } from '../components/PartnerApplicationWithdrawModal.js';
import { PartnerApplicationApprovalModal } from '../components/PartnerApplicationApprovalModal.js';
import { PartnerApplicationError } from '../components/PartnerApplicationError.js';

export function PartnerApplicationDetailPage() {
  const { applicationId = '' } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canRead = user?.permissions.includes(PermissionCode.PARTNER_READ) ?? false;
  const canVerify = user?.permissions.includes(PermissionCode.PARTNER_VERIFY) ?? false;

  const { application, setApplication, loading, error, retry, refresh } =
    usePartnerApplicationDetail(applicationId, { enabled: canRead });

  // Service areas for friendly name lookup
  const [serviceAreas, setServiceAreas] = useState<IServiceArea[]>([]);

  // Modals state
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  // Load service areas for mapping
  useEffect(() => {
    let active = true;
    const loadAreas = async () => {
      try {
        const res = await serviceAreaClient.list({ limit: 100 });
        if (active && res?.items) {
          setServiceAreas(res.items);
        }
      } catch {
        // Non-fatal
      }
    };
    void loadAreas();
    return () => {
      active = false;
    };
  }, []);

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="PARTNER_READ permission required"
        description="Your account does not possess the permission required to inspect partner application details. The partner application API was not requested."
      />
    );
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 32 }}>
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  }

  if (error || !application) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 32 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/partner-applications')}
          style={{ marginBottom: 16 }}
        >
          Back to Applications Directory
        </Button>
        <PartnerApplicationError
          error={error || new Error('Partner application not found')}
          retry={retry}
        />
      </div>
    );
  }

  const isSubmitted = application.status === 'SUBMITTED';
  const isUnderReview = application.status === 'UNDER_REVIEW';
  const isApproved = application.status === 'APPROVED';
  const isRejected = application.status === 'REJECTED';
  const isWithdrawn = application.status === 'WITHDRAWN';

  const canReview = isSubmitted && canVerify;
  const canReject = (isSubmitted || isUnderReview) && canVerify;
  const canWithdraw = (isSubmitted || isUnderReview) && canVerify;
  const canApprove = (isSubmitted || isUnderReview) && canVerify;

  // Resolve assigned service areas
  const assignedAreas = (application.serviceAreaIds || []).map((id) => {
    const found = serviceAreas.find((sa) => sa.id === id);
    return (
      found || {
        id,
        code: id.substring(0, 8),
        name: `Service Area (${id})`,
        city: '—',
        state: '—',
        countryCode: 'IN',
        pincodes: [],
        isActive: false,
        createdAt: '',
        updatedAt: '',
      }
    );
  });

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto', paddingBottom: 40 }}>
      {/* Breadcrumb Navigation */}
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <a onClick={() => navigate('/partner-applications')}>Applications</a> },
          { title: application.businessName },
        ]}
      />

      {/* Header Bar */}
      <Card style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Space direction="vertical" size={2}>
            <Space align="center" size="middle">
              <Typography.Title level={3} style={{ marginBottom: 0 }}>
                {application.businessName}
              </Typography.Title>
              <PartnerApplicationStatusBadge status={application.status} />
              {isApproved && (
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  Operational Partner Created
                </Tag>
              )}
            </Space>
            <Typography.Text type="secondary">
              Application ID: <Typography.Text code copyable>{application.id}</Typography.Text>
              {' · '}Submitted:{' '}
              {new Date(application.createdAt).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Typography.Text>
          </Space>

          {/* Lifecycle Action Buttons */}
          <Space wrap size="small">
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              Refresh
            </Button>

            {/* Move to Review */}
            {canReview && (
              <Button
                icon={<FileSearchOutlined />}
                onClick={() => setReviewModalOpen(true)}
              >
                Start Review
              </Button>
            )}

            {/* Reject */}
            {canReject && (
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => setRejectModalOpen(true)}
              >
                Reject Application
              </Button>
            )}

            {/* Withdraw */}
            {canWithdraw && (
              <Button
                icon={<StopOutlined />}
                onClick={() => setWithdrawModalOpen(true)}
              >
                Withdraw
              </Button>
            )}

            {/* Approve Gate */}
            {canApprove && (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => setApprovalModalOpen(true)}
              >
                Approve &amp; Activate Partner
              </Button>
            )}

            {/* Link to Operational Partner if approved */}
            {isApproved && application.partnerId && (
              <Button
                type="primary"
                icon={<ShopOutlined />}
                onClick={() => navigate(`/partners/${application.partnerId}`)}
              >
                View Operational Partner Profile
              </Button>
            )}

            {!canVerify && !isApproved && (
              <Typography.Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
                (Verification permissions required to transition lifecycle states)
              </Typography.Text>
            )}
          </Space>
        </div>
      </Card>

      {/* Main Details Body */}
      <Row gutter={[20, 20]}>
        {/* Left Column: Organization & Operator Info */}
        <Col xs={24} lg={14}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {/* Rejection / Refusal Notice if rejected */}
            {isRejected && (
              <Alert
                type="error"
                showIcon
                message={
                  <span>
                    Application Rejected (Code: <code>{application.refusalReasonCode || 'REJECTED'}</code>)
                  </span>
                }
                description={
                  <div>
                    <Typography.Paragraph style={{ marginBottom: 4 }}>
                      <strong>Reason:</strong> {application.rejectionReason || 'No descriptive reason recorded.'}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      The applicant may submit a clean reapplication referencing this previous application ID.
                    </Typography.Text>
                  </div>
                }
              />
            )}

            {/* Withdrawal Notice if withdrawn */}
            {isWithdrawn && (
              <Alert
                type="warning"
                showIcon
                message="Application Withdrawn"
                description={
                  <div>
                    <Typography.Paragraph style={{ marginBottom: 4 }}>
                      <strong>Reason:</strong> {application.rejectionReason || 'Voluntary withdrawal.'}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      This onboarding record is closed without creating operational accounts.
                    </Typography.Text>
                  </div>
                }
              />
            )}

            {/* Reapplication Lineage Notice */}
            {application.previousApplicationId && (
              <Alert
                type="info"
                showIcon
                message="Linked Reapplication Lineage"
                description={
                  <span>
                    This application is a subsequent submission linked to previously rejected application{' '}
                    <Typography.Link onClick={() => navigate(`/partner-applications/${application.previousApplicationId}`)}>
                      <code>{application.previousApplicationId}</code>
                    </Typography.Link>
                    .
                  </span>
                }
              />
            )}

            {/* Business Information Card */}
            <Card title="Organization Business Profile">
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="Business Name">
                  <strong>{application.businessName}</strong>
                </Descriptions.Item>
                <Descriptions.Item label="Legal Entity Name">
                  {application.legalName || <Typography.Text type="secondary">Not specified</Typography.Text>}
                </Descriptions.Item>
                <Descriptions.Item label="Business Phone">
                  <Typography.Text copyable>{application.phone}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Business Email">
                  {application.email ? (
                    <Typography.Text copyable>{application.email}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">Not provided</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Delivery Model" span={2}>
                  <Tag color={application.deliveryMode === 'PARTNER_MANAGED' ? 'blue' : 'purple'}>
                    {application.deliveryMode === 'PARTNER_MANAGED'
                      ? 'Partner Managed (Merchant transports orders)'
                      : 'Platform Managed (TheHomez fleet fulfilment)'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* Primary Operator User Card */}
            <Card title="Primary Partner Operator User Account">
              <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                These contact credentials identify the initial account administrator who will be provisioned with the <code>PARTNER_OPERATOR</code> role upon approval.
              </Typography.Paragraph>
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="Contact Name">
                  <strong>{application.initialUser?.contactName || '—'}</strong>
                </Descriptions.Item>
                <Descriptions.Item label="Contact Phone">
                  <Typography.Text copyable>{application.initialUser?.phone || '—'}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Contact Email" span={2}>
                  {application.initialUser?.email ? (
                    <Typography.Text copyable>{application.initialUser.email}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">Not provided (Phone OTP auth)</Typography.Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* Compliance & Trade Metadata */}
            <Card title="Commercial &amp; Compliance Identifiers (Metadata)">
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="GSTIN">
                  {String(application.metadata?.gstin || '—')}
                </Descriptions.Item>
                <Descriptions.Item label="PAN">
                  {String(application.metadata?.pan || '—')}
                </Descriptions.Item>
                <Descriptions.Item label="Trade License" span={2}>
                  {String(application.metadata?.tradeLicense || '—')}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Space>
        </Col>

        {/* Right Column: Service Areas & Status Metadata */}
        <Col xs={24} lg={10}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {/* Assigned Service Areas Card */}
            <Card
              title={
                <Space>
                  <span>Assigned Service Areas</span>
                  <Tag color="cyan">{assignedAreas.length}</Tag>
                </Space>
              }
            >
              {assignedAreas.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Zero Service Areas Assigned"
                  description="Approval requires at least one active assigned service area."
                />
              ) : (
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {assignedAreas.map((sa) => (
                    <div
                      key={sa.id}
                      style={{
                        padding: '8px 12px',
                        border: '1px solid #f0f0f0',
                        borderRadius: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong>{sa.code}</strong> — {sa.name}
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>{sa.city}, {sa.state}</div>
                      </div>
                      <Tag color={sa.isActive ? 'green' : 'red'}>
                        {sa.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </Tag>
                    </div>
                  ))}
                </Space>
              )}
            </Card>

            {/* Lifecycle Status & Administrative Tracking */}
            <Card title="Lifecycle &amp; Operational Governance">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Current Status">
                  <PartnerApplicationStatusBadge status={application.status} />
                </Descriptions.Item>
                <Descriptions.Item label="Operational Partner ID">
                  {application.partnerId ? (
                    <Typography.Link onClick={() => navigate(`/partners/${application.partnerId}`)}>
                      <code>{application.partnerId}</code>
                    </Typography.Link>
                  ) : (
                    <Typography.Text type="secondary">Not yet provisioned</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Assigned Reviewer">
                  {application.assignedStaffUserId ? (
                    <code>{application.assignedStaffUserId}</code>
                  ) : (
                    <Typography.Text type="secondary">Unassigned</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Last Updated">
                  {new Date(application.updatedAt).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Space>
        </Col>

        {/* Full-Width Bottom: Application Evaluation Audit History */}
        <Col xs={24}>
          <Card title="Application Review &amp; Transition Audit History">
            <PartnerApplicationAuditHistoryTable entries={application.auditHistory || []} />
          </Card>
        </Col>
      </Row>

      {/* Action Modals */}
      <PartnerApplicationReviewModal
        open={reviewModalOpen}
        application={application}
        onClose={() => setReviewModalOpen(false)}
        onSuccess={(updated) => setApplication(updated)}
        onConcurrentModification={refresh}
      />

      <PartnerApplicationRejectModal
        open={rejectModalOpen}
        application={application}
        onClose={() => setRejectModalOpen(false)}
        onSuccess={(updated) => setApplication(updated)}
        onConcurrentModification={refresh}
      />

      <PartnerApplicationWithdrawModal
        open={withdrawModalOpen}
        application={application}
        onClose={() => setWithdrawModalOpen(false)}
        onSuccess={(updated) => setApplication(updated)}
        onConcurrentModification={refresh}
      />

      <PartnerApplicationApprovalModal
        open={approvalModalOpen}
        application={application}
        onClose={() => setApprovalModalOpen(false)}
        onSuccess={(res) => {
          setApplication(res.application);
          refresh();
        }}
        onConcurrentModification={refresh}
      />
    </div>
  );
}
