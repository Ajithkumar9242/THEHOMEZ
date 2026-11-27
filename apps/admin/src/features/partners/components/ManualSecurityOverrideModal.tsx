import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from 'antd';
import { SafetyOutlined, WarningOutlined } from '@ant-design/icons';
import type {
  IPartnerDocumentDto,
  IScanOverrideRequestDto,
} from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { ApiError } from '../../../services/api-client.js';

interface ManualSecurityOverrideModalProps {
  open: boolean;
  partnerId: string;
  document: IPartnerDocumentDto | null;
  onClose: () => void;
  onSuccess: (updatedDoc: IPartnerDocumentDto) => void;
}

interface FormValues {
  reason: string;
}

export function ManualSecurityOverrideModal({
  open,
  partnerId,
  document,
  onClose,
  onSuccess,
}: ManualSecurityOverrideModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setErrorAlert(null);
    }
  }, [open, form]);

  const handleSubmit = async (values: FormValues) => {
    if (!document) return;

    setSubmitting(true);
    setErrorAlert(null);

    const dto: IScanOverrideRequestDto = {
      reason: values.reason.trim(),
    };

    try {
      const response = await partnerClient.overrideDocumentScanStatus(
        partnerId,
        document.id,
        dto,
      );
      onSuccess(response.document);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('An unexpected error occurred during security override.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <SafetyOutlined style={{ color: '#faad14' }} />
          <span>Manual Antivirus Security Override</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={520}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          danger
          onClick={() => form.submit()}
          loading={submitting}
        >
          Confirm Security Override
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        message="Dual-Authorization Clearance"
        description={
          <span>
            You are overriding the automated security scan status for{' '}
            <strong>{document?.originalFilename}</strong> (current scan status:{' '}
            <Typography.Text code>{document?.scanStatus}</Typography.Text>). This action is
            permanently recorded in the compliance audit trail.
          </span>
        }
        style={{ marginTop: 8, marginBottom: 16 }}
      />

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
          label="Security Override Justification"
          rules={[
            { required: true, message: 'Security override justification is required' },
            { min: 20, message: 'Justification must be at least 20 characters' },
            { max: 1000, message: 'Justification cannot exceed 1000 characters' },
          ]}
          help="Describe the forensic malware review and justification for clearing this file."
        >
          <Input.TextArea
            rows={4}
            placeholder="e.g., File verified in air-gapped sandbox; determined to be a false positive signature."
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
