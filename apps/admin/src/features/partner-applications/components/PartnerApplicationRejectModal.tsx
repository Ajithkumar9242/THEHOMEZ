import { useEffect, useState } from 'react';
import { Alert, Descriptions, Form, Input, Modal, Typography } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import type { IPartnerApplicationDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationRejectModalProps {
  open: boolean;
  application: IPartnerApplicationDto | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerApplicationDto) => void;
  onConcurrentModification?: () => void;
}

interface FormValues {
  refusalReasonCode: string;
  reason: string;
}

export function PartnerApplicationRejectModal({
  open,
  application,
  onClose,
  onSuccess,
  onConcurrentModification,
}: PartnerApplicationRejectModalProps) {
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
    const trimmedCode = (values.refusalReasonCode || '').trim();
    const trimmedReason = (values.reason || '').trim();

    if (!trimmedCode) {
      setError('A structured refusal reason code is required.');
      return;
    }
    if (trimmedCode.length > 100) {
      setError('Refusal reason code cannot exceed 100 characters.');
      return;
    }
    if (trimmedReason.length < 10) {
      setError('Rejection narrative reason must contain at least 10 non-whitespace characters.');
      return;
    }
    if (trimmedReason.length > 500) {
      setError('Rejection reason cannot exceed 500 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const updated = await partnerApplicationClient.rejectApplication(application.id, {
        refusalReasonCode: trimmedCode,
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
              'Only applications in SUBMITTED or UNDER_REVIEW status may be rejected.',
          );
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError('Access Denied: You do not possess the required PARTNER_VERIFY permission.');
          return;
        }
        setError(err.message || `Rejection failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while rejecting the application.');
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
          <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
          Reject Partner Application
        </span>
      }
      okText="Confirm Rejection"
      okButtonProps={{ danger: true, loading: submitting }}
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
          Rejecting this application will transition its status to <strong>REJECTED</strong>. The
          applicant will be permitted to reapply under a new linked application document, but this
          record will be closed.
        </Typography.Paragraph>

        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Business Name">{application.businessName}</Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <PartnerApplicationStatusBadge status={application.status} />
          </Descriptions.Item>
        </Descriptions>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="refusalReasonCode"
            label="Refusal Reason Code"
            extra="Classification code (1–100 characters, e.g. INCOMPLETE_DOCUMENTATION). Note: Authoritative business refusal catalogue is pending Product Owner definition."
            rules={[
              { required: true, message: 'Please enter a refusal reason code' },
              {
                validator: (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!trimmed) return Promise.reject(new Error('Refusal reason code cannot be blank or whitespace-only'));
                  if (trimmed.length > 100) return Promise.reject(new Error('Refusal reason code cannot exceed 100 characters'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input
              maxLength={100}
              showCount
              placeholder="e.g. INCOMPLETE_DOCUMENTATION"
              aria-label="Refusal Reason Code"
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label="Detailed Rejection Narrative"
            extra="Minimum 10 non-whitespace characters, maximum 500 characters. Recorded in the application audit trail."
            rules={[
              { required: true, message: 'Please provide a detailed rejection reason' },
              {
                validator: (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!trimmed) return Promise.reject(new Error('Rejection reason cannot be blank or whitespace-only'));
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
              placeholder="State the detailed factual rationale for rejecting this application (e.g. Expired trade license provided...)"
              aria-label="Rejection Reason Narrative"
            />
          </Form.Item>
        </Form>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Rejection Failed"
            description={error}
            style={{ marginTop: 12 }}
          />
        )}
      </div>
    </Modal>
  );
}
