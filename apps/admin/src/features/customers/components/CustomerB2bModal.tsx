import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Space, Typography } from 'antd';
import { CloseCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { IAdminCustomerDetailDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { customerClient } from '../api/customer-client.js';
import { CustomerSegmentBadge } from './CustomerSegmentBadge.js';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export type CustomerB2bModalMode = 'grant' | 'update' | 'revoke';

export interface CustomerB2bModalProps {
  open: boolean;
  customer: IAdminCustomerDetailDto | null;
  mode: CustomerB2bModalMode | null;
  onClose: () => void;
  onSuccess: (updatedCustomer: IAdminCustomerDetailDto) => void;
}

interface FormValues {
  companyName?: string;
  gstin?: string;
  reason: string;
}

export function CustomerB2bModal({
  open,
  customer,
  mode,
  onClose,
  onSuccess,
}: CustomerB2bModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && customer) {
      setError(null);
      setSubmitting(false);

      if (mode === 'revoke') {
        form.setFieldsValue({
          companyName: undefined,
          gstin: undefined,
          reason: '',
        });
      } else {
        const metadata = (customer.metadata as Record<string, unknown>) || {};
        const existingCompanyName =
          typeof metadata.companyName === 'string' ? metadata.companyName : '';
        const existingGstin = typeof metadata.gstin === 'string' ? metadata.gstin : '';

        form.setFieldsValue({
          companyName: existingCompanyName,
          gstin: existingGstin,
          reason: '',
        });
      }
    }
  }, [open, customer, mode, form]);

  if (!customer || !mode) return null;

  const isRevoke = mode === 'revoke';

  const titleText =
    mode === 'revoke'
      ? 'Revoke B2B Wholesale Status'
      : mode === 'update'
        ? 'Update B2B Wholesale Details'
        : 'Verify B2B Wholesale Contractor';

  const submitButtonText =
    mode === 'revoke'
      ? 'Confirm B2B Revocation'
      : mode === 'update'
        ? 'Save B2B Details'
        : 'Grant B2B Status';

  const handleSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      setError(null);

      let updated: IAdminCustomerDetailDto;

      if (isRevoke) {
        updated = await customerClient.updateCustomerB2bStatus(customer.id, {
          isB2B: false,
          reason: values.reason.trim(),
        });
      } else {
        const trimmedGstin = values.gstin?.trim();
        updated = await customerClient.updateCustomerB2bStatus(customer.id, {
          isB2B: true,
          companyName: values.companyName?.trim(),
          gstin: trimmedGstin && trimmedGstin.length > 0 ? trimmedGstin.toUpperCase() : undefined,
          reason: values.reason.trim(),
        });
      }

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update B2B verification status. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          {isRevoke ? (
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
          )}
          <span>{titleText}</span>
        </Space>
      }
      onCancel={() => {
        if (!submitting) {
          onClose();
        }
      }}
      destroyOnHidden
      maskClosable={!submitting}
      closable={!submitting}
      footer={null}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 8 }}>
        {isRevoke ? (
          <Alert
            type="warning"
            showIcon
            message="B2B Wholesale Privileges Revocation"
            description="Revoking B2B status will remove the B2B_CUSTOMER role from this customer, resetting their account segment to B2C Retail. Wholesale contractor pricing and terms will no longer be available."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="Internal B2B Wholesale Classification"
            description="Granting B2B status authorizes wholesale customer privileges on TheHomez platform. Note: GSTIN format validation confirms pattern compliance only (15 alphanumeric characters) and does not represent an external GST portal tax verification."
          />
        )}

        <Descriptions
          size="small"
          column={1}
          bordered
          styles={{ label: { width: 140, fontWeight: 500 } }}
        >
          <Descriptions.Item label="Customer Phone">
            <Typography.Text strong>{customer.phone}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Customer ID">
            <Typography.Text copyable={{ text: customer.id }} style={{ fontFamily: 'monospace' }}>
              {customer.id}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Current Segment">
            <CustomerSegmentBadge segment={customer.customerSegment} />
          </Descriptions.Item>
        </Descriptions>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          {!isRevoke && (
            <>
              <Form.Item
                name="companyName"
                label="Company / Enterprise Name"
                rules={[
                  { required: true, whitespace: true, message: 'Company name is required' },
                  { min: 2, message: 'Company name must be at least 2 characters' },
                  { max: 100, message: 'Company name cannot exceed 100 characters' },
                ]}
              >
                <Input
                  placeholder="e.g. Apex Infra Projects Pvt Ltd"
                  maxLength={100}
                  disabled={submitting}
                />
              </Form.Item>

              <Form.Item
                name="gstin"
                label="GSTIN (Optional)"
                rules={[
                  {
                    pattern: GSTIN_REGEX,
                    message: 'Invalid GSTIN format (e.g. 29AAAAA0000A1Z5)',
                  },
                ]}
                extra="Format: 2 state digits + 10-digit PAN + 1 entity + 'Z' + 1 checksum (15 chars)"
              >
                <Input
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  maxLength={15}
                  style={{ textTransform: 'uppercase' }}
                  disabled={submitting}
                  onChange={(e) => {
                    form.setFieldsValue({ gstin: e.target.value.toUpperCase() });
                  }}
                />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="reason"
            label="Audit Reason"
            rules={[
              { required: true, whitespace: true, message: 'Audit reason is required' },
              { max: 500, message: 'Reason cannot exceed 500 characters' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder={
                isRevoke
                  ? 'State the reason for revoking B2B wholesale status (e.g., requested downgrade, business license expired, business closure)...'
                  : 'State the reason for verifying/updating B2B wholesale status (e.g., trade license verified, contractor agreement on file)...'
              }
              maxLength={500}
              showCount
              disabled={submitting}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="primary"
                danger={isRevoke}
                htmlType="submit"
                loading={submitting}
                disabled={submitting}
              >
                {submitButtonText}
              </Button>
            </Space>
          </Form.Item>
        </Form>

        {error && (
          <Alert
            type="error"
            showIcon
            role="alert"
            message="Failed to Update B2B Status"
            description={error}
          />
        )}
      </Space>
    </Modal>
  );
}
