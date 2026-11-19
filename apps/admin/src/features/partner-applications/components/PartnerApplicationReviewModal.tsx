import { useState } from 'react';
import { Alert, Descriptions, Modal, Typography } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import type { IPartnerApplicationDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationReviewModalProps {
  open: boolean;
  application: IPartnerApplicationDto | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerApplicationDto) => void;
  onConcurrentModification?: () => void;
}

export function PartnerApplicationReviewModal({
  open,
  application,
  onClose,
  onSuccess,
  onConcurrentModification,
}: PartnerApplicationReviewModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!application) return null;

  const handleReview = async () => {
    try {
      setSubmitting(true);
      setError(null);

      const updated = await partnerApplicationClient.reviewApplication(application.id);
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
              'Only applications in SUBMITTED status may be transitioned to UNDER_REVIEW.',
          );
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError('Access Denied: You do not possess the required PARTNER_VERIFY permission.');
          return;
        }
        setError(err.message || `Operation failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while moving the application to review.');
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
          <FileSearchOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
          Move Application to Review
        </span>
      }
      okText="Confirm Review"
      confirmLoading={submitting}
      onOk={handleReview}
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
          Moving this application to <strong>Under Review</strong> confirms that identity,
          trade compliance, and service-area feasibility evaluation are actively underway.
        </Typography.Paragraph>

        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Business Name">{application.businessName}</Descriptions.Item>
          <Descriptions.Item label="Contact Phone">{application.phone}</Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <PartnerApplicationStatusBadge status={application.status} />
          </Descriptions.Item>
        </Descriptions>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Action Failed"
            description={error}
            style={{ marginTop: 12 }}
          />
        )}
      </div>
    </Modal>
  );
}
