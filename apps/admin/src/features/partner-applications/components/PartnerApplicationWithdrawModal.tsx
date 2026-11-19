import { useEffect, useState } from 'react';
import { Alert, Descriptions, Form, Input, Modal, Typography } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import type { IPartnerApplicationDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationWithdrawModalProps {
  open: boolean;
  application: IPartnerApplicationDto | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerApplicationDto) => void;
  onConcurrentModification?: () => void;
}

interface FormValues {
  reason: string;
}

export function PartnerApplicationWithdrawModal({
  open,
  application,
  onClose,
  onSuccess,
  onConcurrentModification,
}: PartnerApplicationWithdrawModalProps) {
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

  if (!application) return null;

  const handleSubmit = async (values: FormValues) => {
    const trimmedReason = (values.reason || '').trim();

    if (trimmedReason.length < 10) {
      setError('Withdrawal reason must contain at least 10 non-whitespace characters.');
      return;
    }
    if (trimmedReason.length > 500) {
      setError('Withdrawal reason cannot exceed 500 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const updated = await partnerApplicationClient.withdrawApplication(application.id, {
        reason: trimmedReason,
      });

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'CONCURRENT_MODIFICATION') {
          setError(
            'Concurrent modification conflict: Another administrator has updated this application state. Please close this dialog and review the refreshed state.',
          );
          onConcurrentModification?.();
          return;
        }
        if (err.code === 'INVALID_STATE_TRANSITION') {
          setError(
            err.message ||
              'Only applications in SUBMITTED or UNDER_REVIEW status may be withdrawn.',
          );
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError('Access Denied: You do not possess the required PARTNER_VERIFY permission.');
          return;
        }
        setError(err.message || `Withdrawal failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while withdrawing the application.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <span>
          <StopOutlined style={{ color: '#8c8c8c', marginRight: 8 }} />
          Withdraw Partner Application
        </span>
      }
      okText="Confirm Withdrawal"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!submitting) {
          setError(null);
          onClose();
        }
      }}
      destroyOnClose
    >
      <div style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">
          Withdrawing this application transitions its status to <strong>WITHDRAWN</strong>.
          Withdrawal is an onboarding lifecycle action, distinct from operational partner suspension.
          No operational records are created.
        </Typography.Paragraph>

        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Business Name">{application.businessName}</Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <PartnerApplicationStatusBadge status={application.status} />
          </Descriptions.Item>
        </Descriptions>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="reason"
            label="Withdrawal Reason Narrative"
            extra="Minimum 10 non-whitespace characters, maximum 500 characters. Recorded in the application audit trail."
            rules={[
              { required: true, message: 'Please provide a withdrawal reason' },
              {
                validator: (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!trimmed) return Promise.reject(new Error('Withdrawal reason cannot be blank or whitespace-only'));
                  if (trimmed.length < 10) return Promise.reject(new Error('Reason must be at least 10 characters'));
                  if (trimmed.length > 500) return Promise.reject(new Error('Reason cannot exceed 500 characters'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input.TextArea
              rows={4}
              maxLength={500}
              showCount
              placeholder="State the reason for application withdrawal (e.g. Applicant requested voluntary cancellation...)"
              aria-label="Withdrawal Reason Narrative"
            />
          </Form.Item>
        </Form>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Withdrawal Failed"
            description={error}
            style={{ marginTop: 12 }}
          />
        )}
      </div>
    </Modal>
  );
}
