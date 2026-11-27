import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Select,
  Space,
} from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import {
  type IPartnerAdminDetailDto,
  type IUpdatePartnerProfileDto,
} from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { ApiError } from '../../../services/api-client.js';

interface EditPartnerProfileDrawerProps {
  open: boolean;
  partner: IPartnerAdminDetailDto | null;
  onClose: () => void;
  onSuccess: (updated: IPartnerAdminDetailDto) => void;
}

interface FormValues {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  deliveryMode: 'PARTNER_MANAGED' | 'PLATFORM_MANAGED';
  syncPrimaryOperatorPhone?: boolean;
  reason: string;
}

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function EditPartnerProfileDrawer({
  open,
  partner,
  onClose,
  onSuccess,
}: EditPartnerProfileDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const syncPhoneWatched = Form.useWatch('syncPrimaryOperatorPhone', form);

  useEffect(() => {
    if (open && partner) {
      form.setFieldsValue({
        businessName: partner.businessName,
        legalName: partner.legalName || '',
        phone: partner.phone,
        email: partner.email || '',
        deliveryMode: partner.deliveryMode,
        syncPrimaryOperatorPhone: false,
        reason: '',
      });
      setErrorAlert(null);
    }
  }, [open, partner, form]);

  const handleSubmit = async (values: FormValues) => {
    if (!partner) return;

    setSubmitting(true);
    setErrorAlert(null);

    const dto: IUpdatePartnerProfileDto = {
      businessName: values.businessName.trim(),
      legalName: values.legalName?.trim() || undefined,
      phone: values.phone.trim(),
      email: values.email?.trim() || undefined,
      deliveryMode: values.deliveryMode,
      syncPrimaryOperatorPhone: Boolean(values.syncPrimaryOperatorPhone),
      reason: values.reason.trim(),
    };

    try {
      const updated = await partnerClient.updatePartnerProfile(partner.id, dto);
      onSuccess(updated);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('An unexpected error occurred while updating the partner profile.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title="Edit Partner Profile"
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={() => form.submit()}
            loading={submitting}
          >
            Save Changes
          </Button>
        </Space>
      }
    >
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
          name="businessName"
          label="Business Name"
          rules={[
            { required: true, message: 'Business name is required' },
            { min: 2, message: 'Business name must be at least 2 characters' },
            { max: 100, message: 'Business name cannot exceed 100 characters' },
          ]}
        >
          <Input placeholder="Acme Building Materials Ltd" />
        </Form.Item>

        <Form.Item
          name="legalName"
          label="Legal Entity Name"
          rules={[
            { max: 100, message: 'Legal name cannot exceed 100 characters' },
          ]}
        >
          <Input placeholder="Acme Building Materials Private Limited" />
        </Form.Item>

        <Form.Item
          name="phone"
          label="Contact Mobile (Primary)"
          rules={[
            { required: true, message: 'Contact mobile is required' },
            {
              pattern: INDIAN_MOBILE_REGEX,
              message: 'Must be a valid 10-digit Indian mobile number (e.g., 9876543210)',
            },
          ]}
        >
          <Input placeholder="9876543210" maxLength={10} />
        </Form.Item>

        <Form.Item
          name="email"
          label="Contact Email"
          rules={[
            { type: 'email', message: 'Enter a valid email address' },
          ]}
        >
          <Input placeholder="contact@acme.example.com" />
        </Form.Item>

        <Form.Item
          name="deliveryMode"
          label="Delivery Model"
          rules={[{ required: true, message: 'Delivery model is required' }]}
        >
          <Select
            options={[
              {
                label: 'Platform Managed (TheHomez Logistics Fleet)',
                value: 'PLATFORM_MANAGED',
              },
              {
                label: 'Partner Managed (Vendor Fleet / Direct Drop)',
                value: 'PARTNER_MANAGED',
              },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="syncPrimaryOperatorPhone"
          valuePropName="checked"
        >
          <Checkbox>Sync phone number with primary partner user credentials</Checkbox>
        </Form.Item>

        {syncPhoneWatched && (
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Security Notice: Operator Credentials Sync"
            description="Updating the primary operator phone number will modify the login identifier and immediately revoke all existing active sessions for this operator."
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item
          name="reason"
          label="Audit Justification"
          rules={[
            { required: true, message: 'Audit justification reason is required' },
            { min: 10, message: 'Audit justification must be at least 10 characters' },
            { max: 500, message: 'Audit justification cannot exceed 500 characters' },
          ]}
          help="Describe the reason for modifying this partner profile for the immutable audit trail."
        >
          <Input.TextArea
            rows={3}
            placeholder="e.g., Updated contact phone per verified operator request via ticket #4582."
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
