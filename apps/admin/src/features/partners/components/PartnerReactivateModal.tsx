import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from 'antd';
import { SafetyCertificateOutlined, WarningOutlined } from '@ant-design/icons';
import {
  PermissionCode,
  type IPartnerAdminDetailDto,
  type IReactivatePartnerDto,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { ApiError } from '../../../services/api-client.js';

interface PartnerReactivateModalProps {
  open: boolean;
  partner: IPartnerAdminDetailDto | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerAdminDetailDto) => void;
}

interface FormValues {
  reason: string;
  identityVerified: boolean;
  addressVerified: boolean;
  activeHubsConfirmed: boolean;
  applyWaiver?: boolean;
  waiverReason?: string;
}

export function PartnerReactivateModal({
  open,
  partner,
  onClose,
  onSuccess,
}: PartnerReactivateModalProps) {
  const { user } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);

  const canManageRbac = user?.permissions.includes(PermissionCode.RBAC_MANAGE) ?? false;
  const applyWaiverWatched = Form.useWatch('applyWaiver', form);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        reason: '',
        identityVerified: false,
        addressVerified: false,
        activeHubsConfirmed: false,
        applyWaiver: false,
        waiverReason: '',
      });
      setErrorAlert(null);
    }
  }, [open, form]);

  const handleSubmit = async (values: FormValues) => {
    if (!partner) return;

    setSubmitting(true);
    setErrorAlert(null);

    const dto: IReactivatePartnerDto = {
      reason: values.reason.trim(),
      attestations: {
        identityVerified: true,
        addressVerified: true,
        activeHubsConfirmed: true,
      },
      waiver:
        values.applyWaiver && values.waiverReason?.trim()
          ? {
              granted: true,
              reason: values.waiverReason.trim(),
            }
          : undefined,
    };

    try {
      const updated = await partnerClient.reactivatePartner(partner.id, dto);
      onSuccess(updated);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('An unexpected error occurred while reactivating the partner.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <SafetyCertificateOutlined style={{ color: '#52c41a' }} />
          <span>Reactivate Partner Organization</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={560}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={() => form.submit()}
          loading={submitting}
        >
          Confirm Reactivation
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Reactivating <strong>{partner?.businessName}</strong> will restore their vendor portal access
        and allow them to receive purchase orders. The partner must satisfy KYC requirements or have
        a supervisory waiver granted.
      </Typography.Paragraph>

      {errorAlert && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setErrorAlert(null)}
          message={errorAlert}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark="optional"
      >
        <Form.Item
          name="reason"
          label="Reactivation Justification"
          rules={[
            { required: true, message: 'Reactivation justification is required' },
            { min: 10, message: 'Justification must be at least 10 characters' },
            { max: 500, message: 'Justification cannot exceed 500 characters' },
          ]}
          help="Required for compliance and immutable audit logging."
        >
          <Input.TextArea
            rows={2}
            placeholder="e.g., Compliance verification completed and approved by legal counsel."
          />
        </Form.Item>

        <Divider orientation="left" plain>
          Mandatory Staff Attestations
        </Divider>

        <Form.Item
          name="identityVerified"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value ? Promise.resolve() : Promise.reject(new Error('You must attest to identity verification')),
            },
          ]}
        >
          <Checkbox>
            I attest that business identity has been verified against government records (GSTIN / PAN / Registration).
          </Checkbox>
        </Form.Item>

        <Form.Item
          name="addressVerified"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value ? Promise.resolve() : Promise.reject(new Error('You must attest to address verification')),
            },
          ]}
        >
          <Checkbox>
            I attest that the physical operating premise / warehouse address has been verified.
          </Checkbox>
        </Form.Item>

        <Form.Item
          name="activeHubsConfirmed"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value ? Promise.resolve() : Promise.reject(new Error('You must attest to active service hubs')),
            },
          ]}
        >
          <Checkbox>
            I confirm that the partner has at least one active fulfillment hub assigned.
          </Checkbox>
        </Form.Item>

        <Divider orientation="left" plain>
          Supervisory Waiver (Optional)
        </Divider>

        {canManageRbac ? (
          <>
            <Form.Item name="applyWaiver" valuePropName="checked">
              <Checkbox>
                Apply Supervisory Waiver (Bypass KYC proof requirements)
              </Checkbox>
            </Form.Item>

            {applyWaiverWatched && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                  message="Supervisory Override Invocation"
                  description="A supervisory waiver permits reactivation even if verified KYC document proofs are missing. This action is permanently attributed to your administrator account."
                  style={{ marginBottom: 16 }}
                />
                <Form.Item
                  name="waiverReason"
                  label="Supervisory Justification Reason"
                  rules={[
                    {
                      required: true,
                      message: 'Supervisory justification reason is required when waiver is applied',
                    },
                    {
                      min: 20,
                      message: 'Supervisory reason must be at least 20 characters',
                    },
                    {
                      max: 1000,
                      message: 'Supervisory reason cannot exceed 1000 characters',
                    },
                  ]}
                >
                  <Input.TextArea
                    rows={3}
                    placeholder="Provide full audit rationale for waiving standard KYC requirements..."
                  />
                </Form.Item>
              </>
            )}
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message="Supervisory Waiver Unavailable"
            description="Granting a supervisory waiver requires RBAC_MANAGE permission. Standard KYC proofs will be strictly validated upon reactivation."
          />
        )}
      </Form>
    </Modal>
  );
}
