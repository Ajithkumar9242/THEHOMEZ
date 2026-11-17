import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { IAdminCustomerDetailDto } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { customerClient } from '../api/customer-client.js';
import { CustomerStatusBadge } from './CustomerStatusBadge.js';

export interface CustomerStatusActionModalProps {
  open: boolean;
  customer: IAdminCustomerDetailDto | null;
  targetStatus: 'ACTIVE' | 'SUSPENDED' | null;
  onClose: () => void;
  onSuccess: (updatedCustomer: IAdminCustomerDetailDto) => void;
}

interface FormValues {
  reason: string;
}

export function CustomerStatusActionModal({
  open,
  customer,
  targetStatus,
  onClose,
  onSuccess,
}: CustomerStatusActionModalProps) {
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

  if (!customer || !targetStatus) return null;

  const isSuspend = targetStatus === 'SUSPENDED';

  const handleSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      setError(null);

      const updated = await customerClient.updateCustomerStatus(customer.id, {
        status: targetStatus,
        reason: values.reason.trim(),
      });

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update customer status. Please try again.');
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
          {isSuspend ? (
            <StopOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          )}
          <span>{isSuspend ? 'Suspend Customer Account' : 'Reactivate Customer Account'}</span>
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
        {isSuspend ? (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="Account Suspension Impact"
            description="Suspending this account immediately revokes all active customer refresh tokens and terminates active customer sessions. The customer will be unable to log in, place new orders, or access their saved cart."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Account Reactivation Impact"
            description="Reactivating this account will restore access to platform services, customer directory searchability, and order placement capabilities. The customer will need to authenticate anew."
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
          <Descriptions.Item label="Current Status">
            <CustomerStatusBadge status={customer.status} />
          </Descriptions.Item>
          <Descriptions.Item label="Target Status">
            <CustomerStatusBadge status={targetStatus} />
          </Descriptions.Item>
        </Descriptions>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
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
                isSuspend
                  ? 'State the reason for account suspension (e.g., suspicious activity, repeated failed verifications, requested by risk team)...'
                  : 'State the reason for account reactivation (e.g., identity verification completed, false alarm resolved, clearance confirmed)...'
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
                danger={isSuspend}
                htmlType="submit"
                loading={submitting}
                disabled={submitting}
              >
                {isSuspend ? 'Confirm Suspension' : 'Confirm Reactivation'}
              </Button>
            </Space>
          </Form.Item>
        </Form>

        {error && (
          <Alert
            type="error"
            showIcon
            role="alert"
            message="Failed to Update Account Status"
            description={error}
          />
        )}
      </Space>
    </Modal>
  );
}
