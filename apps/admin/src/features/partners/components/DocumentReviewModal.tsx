import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import {
  DocumentReviewStatus,
  type IPartnerDocumentDto,
  type IReviewPartnerDocumentRequestDto,
} from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { ApiError } from '../../../services/api-client.js';

interface DocumentReviewModalProps {
  open: boolean;
  partnerId: string;
  document: IPartnerDocumentDto | null;
  onClose: () => void;
  onSuccess: (updatedDoc: IPartnerDocumentDto) => void;
}

interface FormValues {
  status: DocumentReviewStatus.VERIFIED | DocumentReviewStatus.REJECTED;
  rejectionReason?: string;
}

export function DocumentReviewModal({
  open,
  partnerId,
  document,
  onClose,
  onSuccess,
}: DocumentReviewModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const statusWatched = Form.useWatch('status', form);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        status: DocumentReviewStatus.VERIFIED,
        rejectionReason: '',
      });
      setErrorAlert(null);
    }
  }, [open, form]);

  const handleSubmit = async (values: FormValues) => {
    if (!document) return;

    setSubmitting(true);
    setErrorAlert(null);

    const dto: IReviewPartnerDocumentRequestDto = {
      status: values.status,
      rejectionReason:
        values.status === DocumentReviewStatus.REJECTED
          ? values.rejectionReason?.trim()
          : undefined,
    };

    try {
      const response = await partnerClient.reviewPartnerDocument(partnerId, document.id, dto);
      onSuccess(response.document);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('An unexpected error occurred while reviewing the document.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Review Partner KYC Document"
      open={open}
      onCancel={onClose}
      width={500}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          danger={statusWatched === DocumentReviewStatus.REJECTED}
          onClick={() => form.submit()}
          loading={submitting}
        >
          Submit Review
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Reviewing document: <strong>{document?.documentType}</strong> ({document?.originalFilename})
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
          name="status"
          label="Verification Decision"
          rules={[{ required: true, message: 'Please select a decision' }]}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value={DocumentReviewStatus.VERIFIED}>
              <Space>
                <CheckCircleOutlined />
                <span>Verify Document</span>
              </Space>
            </Radio.Button>
            <Radio.Button value={DocumentReviewStatus.REJECTED}>
              <Space>
                <CloseCircleOutlined />
                <span>Reject Document</span>
              </Space>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        {statusWatched === DocumentReviewStatus.REJECTED && (
          <Form.Item
            name="rejectionReason"
            label="Rejection Reason"
            rules={[
              { required: true, message: 'Rejection reason is required' },
              { min: 10, message: 'Rejection reason must be at least 10 characters' },
              { max: 500, message: 'Rejection reason cannot exceed 500 characters' },
            ]}
            help="Explain to the partner why this document was rejected so they can re-upload."
          >
            <Input.TextArea
              rows={3}
              placeholder="e.g., GSTIN certificate is illegible; name does not match legal entity."
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
