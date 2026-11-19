import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type {
  IPartnerApplicationDto,
  IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import {
  partnerApplicationClient,
  type ApprovePartnerApplicationResponse,
} from '../api/partner-application-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationApprovalModalProps {
  open: boolean;
  application: IPartnerApplicationDto | null;
  onClose: () => void;
  onSuccess: (result: ApprovePartnerApplicationResponse) => void;
  onConcurrentModification?: () => void;
}

interface FormValues {
  identityVerified: boolean;
  serviceAreaConfirmed: boolean;
  complianceConfirmed: boolean;
  reason: string;
}

export function PartnerApplicationApprovalModal({
  open,
  application,
  onClose,
  onSuccess,
  onConcurrentModification,
}: PartnerApplicationApprovalModalProps) {
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAmbiguousCommit, setIsAmbiguousCommit] = useState(false);

  // Service Areas loading & inspection
  const [serviceAreas, setServiceAreas] = useState<IServiceArea[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(false);

  // Success result state
  const [successResult, setSuccessResult] = useState<ApprovePartnerApplicationResponse | null>(null);

  // Load service areas corresponding to application
  useEffect(() => {
    let active = true;
    if (open && application) {
      form.resetFields();
      setError(null);
      setIsAmbiguousCommit(false);
      setSubmitting(false);
      setSuccessResult(null);

      const loadAreas = async () => {
        setLoadingAreas(true);
        try {
          const res = await serviceAreaClient.list({ limit: 100 });
          if (active && res?.items) {
            setServiceAreas(res.items);
          }
        } catch {
          // Handled gracefully in UI
        } finally {
          if (active) setLoadingAreas(false);
        }
      };
      void loadAreas();
    }
    return () => {
      active = false;
    };
  }, [open, application, form]);

  if (!application) return null;

  // Filter service areas assigned to this application
  const assignedAreas = (application.serviceAreaIds || []).map((id) => {
    const found = serviceAreas.find((sa) => sa.id === id);
    return (
      found || {
        id,
        code: 'UNKNOWN',
        name: `Service Area ID: ${id}`,
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

  const hasAssignedAreas = assignedAreas.length > 0;
  const anyInactiveAssignedArea = assignedAreas.some((sa) => !sa.isActive);

  const handleSubmit = async (values: FormValues) => {
    const trimmedReason = (values.reason || '').trim();

    if (!values.identityVerified || !values.serviceAreaConfirmed || !values.complianceConfirmed) {
      setError('All three administrative attestations must be affirmatively confirmed before approval.');
      return;
    }
    if (trimmedReason.length < 10) {
      setError('Approval audit reason must contain at least 10 non-whitespace characters.');
      return;
    }
    if (trimmedReason.length > 500) {
      setError('Approval audit reason cannot exceed 500 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setIsAmbiguousCommit(false);

      const result = await partnerApplicationClient.approveApplication(application.id, {
        reason: trimmedReason,
        checklist: {
          identityVerified: true,
          serviceAreaConfirmed: true,
          complianceConfirmed: true,
        },
      });

      setSuccessResult(result);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'CONCURRENT_MODIFICATION') {
          setError(
            'Concurrent modification conflict: Another administrator has updated this application state. Please close this modal, reload to inspect current state, and retry if appropriate.',
          );
          onConcurrentModification?.();
          return;
        }
        if (err.code === 'INVALID_STATE_TRANSITION') {
          setError(
            err.message ||
              'Only applications in SUBMITTED or UNDER_REVIEW status may be approved.',
          );
          return;
        }
        if (err.code === 'NO_ACTIVE_SERVICE_AREA') {
          setError(
            err.message ||
              'Cannot approve: One or more assigned service areas are currently inactive or missing. Active service area coverage is strictly required.',
          );
          return;
        }
        if (err.code === 'PARTNER_PHONE_EXISTS') {
          setError(
            'Cannot approve: An operational partner organisation with this business phone already exists.',
          );
          return;
        }
        if (err.code === 'PHONE_ALREADY_REGISTERED') {
          setError(
            'Cannot approve: A partner operator user account with this primary contact phone already exists.',
          );
          return;
        }
        if (err.code === 'EMAIL_ALREADY_REGISTERED') {
          setError(
            'Cannot approve: A user account with this primary email address already exists on the platform.',
          );
          return;
        }
        if (err.code === 'NETWORK_ERROR') {
          setIsAmbiguousCommit(true);
          setError(
            'Network communication error encountered during approval. The transaction commit result is ambiguous. Do NOT resubmit immediately. Please close this modal and refresh the application to inspect whether the approval committed durably on the server oplog.',
          );
          return;
        }
        setError(err.message || `Approval failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while approving the partner application.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishSuccess = () => {
    if (successResult) {
      onSuccess(successResult);
    }
    onClose();
  };

  const handleViewPartner = () => {
    if (successResult?.partner?.id) {
      onSuccess(successResult);
      onClose();
      navigate(`/partners/${encodeURIComponent(successResult.partner.id)}`);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span>
          <SafetyCertificateOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          Transactional Approval Gate — Partner Onboarding
        </span>
      }
      width={720}
      footer={
        successResult ? (
          <Space>
            <Button onClick={handleFinishSuccess}>Close</Button>
            <Button type="primary" icon={<ShopOutlined />} onClick={handleViewPartner}>
              View Operational Partner Profile
            </Button>
          </Space>
        ) : (
          <Space>
            <Button
              disabled={submitting}
              onClick={() => {
                if (!submitting) {
                  setError(null);
                  onClose();
                }
              }}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={submitting}
              disabled={submitting || isAmbiguousCommit}
              onClick={() => form.submit()}
            >
              Approve &amp; Activate Partner
            </Button>
          </Space>
        )
      }
      onCancel={() => {
        if (!submitting) {
          if (successResult) handleFinishSuccess();
          else onClose();
        }
      }}
      destroyOnClose
    >
      {successResult ? (
        <Result
          status="success"
          title="Partner Application Approved Successfully"
          subTitle={
            <div>
              <Typography.Paragraph>
                The transactional approval gate committed cleanly in MongoDB. An operational Partner entity has been activated, and the primary Partner Operator user account has been provisioned.
              </Typography.Paragraph>
              <Card size="small" style={{ marginTop: 16, textAlign: 'left', backgroundColor: '#f6ffed' }}>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Operational Partner ID">
                    <Typography.Text copyable code>{successResult.partner.id}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Business Name">
                    <strong>{successResult.partner.businessName}</strong>
                  </Descriptions.Item>
                  <Descriptions.Item label="Operational Status">
                    <Tag color="success">ACTIVE</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Primary Operator Phone">
                    <Typography.Text copyable>{application.initialUser.phone}</Typography.Text> (Role: <Tag color="blue">PARTNER_OPERATOR</Tag>)
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </div>
          }
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          <Alert
            type="warning"
            showIcon
            message="Atomic Operational Creation Gate"
            description="Approving this application will execute a MongoDB multi-document transaction to atomically create an operational Partner record in ACTIVE status and provision the primary Partner Operator user. This action cannot be reverted to an application state."
            style={{ marginBottom: 16 }}
          />

          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Business Name">{application.businessName}</Descriptions.Item>
            <Descriptions.Item label="Legal Entity">{application.legalName || '—'}</Descriptions.Item>
            <Descriptions.Item label="Business Phone">{application.phone}</Descriptions.Item>
            <Descriptions.Item label="Business Email">{application.email || '—'}</Descriptions.Item>
            <Descriptions.Item label="Delivery Mode">
              <Tag color={application.deliveryMode === 'PARTNER_MANAGED' ? 'blue' : 'purple'}>
                {application.deliveryMode === 'PARTNER_MANAGED' ? 'Partner Managed' : 'Platform Managed'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Current Status">
              <PartnerApplicationStatusBadge status={application.status} />
            </Descriptions.Item>
          </Descriptions>

          {/* Primary Operator User Summary */}
          <Card
            size="small"
            title="Primary Partner Operator User Account to be Provisioned"
            style={{ marginBottom: 16 }}
          >
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Contact Person">
                <strong>{application.initialUser.contactName}</strong>
              </Descriptions.Item>
              <Descriptions.Item label="Contact Phone">
                <Typography.Text copyable>{application.initialUser.phone}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Contact Email">
                {application.initialUser.email || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Assigned Role">
                <Tag color="blue">PARTNER_OPERATOR</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Service Area Coverage Verification */}
          <Card
            size="small"
            title={
              <Space>
                <span>Assigned Service Areas</span>
                {loadingAreas && <Spin size="small" />}
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {!hasAssignedAreas ? (
              <Alert
                type="error"
                showIcon
                icon={<WarningOutlined />}
                message="Zero Assigned Service Areas"
                description="This application has no assigned service areas. Approval requires at least one active assigned service area."
              />
            ) : anyInactiveAssignedArea ? (
              <Alert
                type="error"
                showIcon
                icon={<WarningOutlined />}
                message="Inactive Service Area Assigned"
                description="One or more assigned service areas are currently inactive. All assigned service areas must be active in the system before approval can succeed."
                style={{ marginBottom: 12 }}
              />
            ) : null}

            <Space wrap size="small" style={{ marginTop: hasAssignedAreas ? 8 : 0 }}>
              {assignedAreas.map((sa) => (
                <Tag
                  key={sa.id}
                  color={sa.isActive ? 'green' : 'red'}
                  style={{ padding: '4px 8px', fontSize: 13 }}
                >
                  <strong>{sa.code}</strong> — {sa.name} ({sa.city}) [{sa.isActive ? 'ACTIVE' : 'INACTIVE'}]
                </Tag>
              ))}
            </Space>
          </Card>

          <Divider style={{ margin: '16px 0' }} />

          {/* Verification Checklist & Reason Form */}
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{
              identityVerified: false,
              serviceAreaConfirmed: false,
              complianceConfirmed: false,
              reason: '',
            }}
          >
            <Typography.Title level={5} style={{ marginBottom: 12 }}>
              Mandatory Affirmative Attestations
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
              The backend approval gate strictly asserts all three administrative attestations. Each attestation must be affirmatively confirmed before operational activation:
            </Typography.Paragraph>

            <Form.Item
              name="identityVerified"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error('Identity verification attestation must be affirmatively confirmed')),
                },
              ]}
              style={{ marginBottom: 8 }}
            >
              <Checkbox>
                <strong>Identity Verified:</strong> I affirmatively confirm that the partner organization&apos;s legal identity, PAN/GSTIN registration, and business legitimacy have been verified.
              </Checkbox>
            </Form.Item>

            <Form.Item
              name="serviceAreaConfirmed"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error('Service area coverage attestation must be affirmatively confirmed')),
                },
              ]}
              style={{ marginBottom: 8 }}
            >
              <Checkbox>
                <strong>Service Area Confirmed:</strong> I affirmatively confirm that the assigned service area(s) are active, eligible, and operationally viable for this partner.
              </Checkbox>
            </Form.Item>

            <Form.Item
              name="complianceConfirmed"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(new Error('Compliance confirmation attestation must be affirmatively confirmed')),
                },
              ]}
              style={{ marginBottom: 16 }}
            >
              <Checkbox>
                <strong>Compliance Confirmed:</strong> I affirmatively confirm that the partner complies with platform commerce rules, delivery SLA obligations, and merchant terms.
              </Checkbox>
            </Form.Item>

            <Form.Item
              name="reason"
              label="Approval Audit Reason Narrative"
              extra="Minimum 10 non-whitespace characters, maximum 500 characters. Recorded in both the application audit trail and operational PartnerAuditLog."
              rules={[
                { required: true, message: 'Please provide an approval audit reason' },
                {
                  validator: (_, value) => {
                    const trimmed = (value || '').trim();
                    if (!trimmed) return Promise.reject(new Error('Approval reason cannot be blank or whitespace-only'));
                    if (trimmed.length < 10) return Promise.reject(new Error('Reason must be at least 10 characters'));
                    if (trimmed.length > 500) return Promise.reject(new Error('Reason cannot exceed 500 characters'));
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                placeholder="Document the verification findings and administrative approval justification..."
                aria-label="Approval Audit Reason Narrative"
              />
            </Form.Item>
          </Form>

          {error && (
            <Alert
              type={isAmbiguousCommit ? 'warning' : 'error'}
              showIcon
              message={isAmbiguousCommit ? 'Ambiguous Transaction Result' : 'Approval Failed'}
              description={error}
              style={{ marginTop: 12 }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
