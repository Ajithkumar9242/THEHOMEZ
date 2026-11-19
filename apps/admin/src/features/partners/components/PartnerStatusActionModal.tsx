import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Space, Typography } from 'antd';
import { ExclamationCircleOutlined, StopOutlined } from '@ant-design/icons';
import type { IPartnerAdminDetailDto, PartnerStatus } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { partnerClient } from '../api/partner-client.js';
import { PartnerStatusBadge } from './PartnerStatusBadge.js';

export interface PartnerStatusActionModalProps {
  open: boolean;
  partner: IPartnerAdminDetailDto | null;
  targetStatus: PartnerStatus | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerAdminDetailDto) => void;
  onConcurrentModification?: () => void;
}

interface FormValues {
  reason: string;
}

export function PartnerStatusActionModal({
  open,
  partner,
  targetStatus,
  onClose,
  onSuccess,
  onConcurrentModification,
}: PartnerStatusActionModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setError(null);
      setSubmitting(false);
    }
  }, [open, form]);

  if (!partner || !targetStatus) return null;

  const isSuspension = targetStatus === 'SUSPENDED';
  const modalTitle = isSuspension ? 'Confirm Partner Suspension' : 'Confirm Partner Deactivation';

  const handleSubmit = async (values: FormValues) => {
    const trimmedReason = (values.reason || '').trim();

    if (trimmedReason.length < 10) {
      setError('Audit reason must contain at least 10 non-whitespace characters.');
      return;
    }
    if (trimmedReason.length > 500) {
      setError('Audit reason cannot exceed 500 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const updated = await partnerClient.updatePartnerStatus(partner.id, {
        status: targetStatus,
        reason: trimmedReason,
      });

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'CONCURRENT_MODIFICATION') {
          setError(
            'Concurrent modification conflict: Another administrator has modified this partner status. Please close this modal, review the refreshed state, and try again.',
          );
          onConcurrentModification?.();
          return;
        }
        if (err.code === 'PARTNER_VERIFICATION_REQUIRED') {
          setError(
            'Direct activation is prohibited: Transition to ACTIVE requires the dedicated Stage C-11 verification workflow.',
          );
          return;
        }
        if (err.code === 'INVALID_STATE_TRANSITION') {
          setError(
            err.message || 'The requested state transition is not allowed by lifecycle rules.',
          );
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError(
            'Access Denied: You do not possess the required permission for this status transition.',
          );
          return;
        }
        setError(err.message || `Operation failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update partner status. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Space align="center">
          {isSuspension ? (
            <StopOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          )}
          <span>{modalTitle}</span>
        </Space>
      }
      open={open}
      onCancel={() => {
        if (!submitting) onClose();
      }}
      destroyOnClose
      maskClosable={!submitting}
      closable={!submitting}
      footer={null}
      width={560}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 12 }}>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Partner Organization">
            <Typography.Text strong>{partner.businessName}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <PartnerStatusBadge status={partner.status} />
          </Descriptions.Item>
          <Descriptions.Item label="Requested Target Status">
            <PartnerStatusBadge status={targetStatus} />
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type={isSuspension ? 'error' : 'warning'}
          showIcon
          message="Operational Impact Notice"
          description={
            <Typography.Paragraph style={{ margin: 0, fontSize: 13 }}>
              Changing status to <strong>{targetStatus}</strong> will atomically revoke all active
              refresh tokens across all linked partner users ({partner.linkedUserCount} user
              accounts). Linked users will be immediately logged out and blocked from active
              operations until re-authorized. Individual user credentials and accounts remain intact
              and will not be deleted.
            </Typography.Paragraph>
          }
        />

        {error && (
          <Alert
            type="error"
            showIcon
            role="alert"
            message="Status Transition Failed"
            description={error}
          />
        )}

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="reason"
            label="Mandatory Audit & Operational Reason"
            rules={[
              { required: true, whitespace: true, message: 'Audit reason is required' },
              { min: 10, message: 'Audit reason must be at least 10 characters' },
              { max: 500, message: 'Audit reason cannot exceed 500 characters' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="Explain the regulatory, compliance, or operational reason for this lifecycle change..."
              maxLength={500}
              showCount
              disabled={submitting}
              aria-label="Audit reason"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="primary"
                danger={isSuspension}
                htmlType="submit"
                loading={submitting}
                disabled={submitting}
              >
                {isSuspension ? 'Confirm Suspension' : 'Confirm Inactivation'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
