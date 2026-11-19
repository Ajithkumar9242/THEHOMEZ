import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Typography,
} from 'antd';
import { PlusCircleOutlined } from '@ant-design/icons';
import { DeliveryMode, type CreatePartnerApplicationInput, type IServiceArea } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';

interface CreatePartnerApplicationDrawerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (createdId: string) => void;
  serviceAreas: IServiceArea[];
}

interface FormValues {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  deliveryMode: DeliveryMode;
  serviceAreaIds?: string[];
  previousApplicationId?: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  pan?: string;
  gstin?: string;
  tradeLicense?: string;
}

export function CreatePartnerApplicationDrawer({
  open,
  onClose,
  onSuccess,
  serviceAreas,
}: CreatePartnerApplicationDrawerProps) {
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

  const handleSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      setError(null);

      const input: CreatePartnerApplicationInput = {
        businessName: values.businessName.trim(),
        legalName: values.legalName?.trim() || undefined,
        phone: values.phone.trim(),
        email: values.email?.trim() || undefined,
        deliveryMode: values.deliveryMode || DeliveryMode.PARTNER_MANAGED,
        serviceAreaIds: values.serviceAreaIds || [],
        previousApplicationId: values.previousApplicationId?.trim() || undefined,
        metadata: {
          pan: values.pan?.trim() || undefined,
          gstin: values.gstin?.trim() || undefined,
          tradeLicense: values.tradeLicense?.trim() || undefined,
        },
        initialUser: {
          contactName: values.contactName.trim(),
          phone: values.contactPhone.trim(),
          email: values.contactEmail?.trim() || undefined,
        },
      };

      const result = await partnerApplicationClient.createApplication(input);
      onSuccess(result.id);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'PARTNER_PHONE_EXISTS') {
          setError('A partner organization with this business phone already exists.');
          return;
        }
        if (err.code === 'PHONE_ALREADY_REGISTERED') {
          setError('A partner user account with this primary contact phone already exists.');
          return;
        }
        if (err.code === 'EMAIL_ALREADY_REGISTERED') {
          setError('A user account with this primary email address already exists.');
          return;
        }
        setError(err.message || `Creation failed (${err.code}).`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while submitting the application.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={
        <span>
          <PlusCircleOutlined style={{ color: '#1677ff', marginRight: 8 }} />
          New Partner Application (Intake)
        </span>
      }
      width={560}
      onClose={() => {
        if (!submitting) {
          setError(null);
          onClose();
        }
      }}
      destroyOnClose
      extra={
        <Space>
          <Button disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            Submit Application
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Submitting an application registers candidate partner credentials for evaluation in status <strong>SUBMITTED</strong>. No operational partner or user records are provisioned until formal administrative approval.
      </Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Submission Error"
          description={error}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ deliveryMode: DeliveryMode.PARTNER_MANAGED }}
      >
        <Typography.Title level={5}>Organization Details</Typography.Title>

        <Form.Item
          name="businessName"
          label="Trade / Business Name"
          rules={[
            { required: true, message: 'Business name is required' },
            { max: 120, message: 'Max 120 characters' },
          ]}
        >
          <Input placeholder="e.g. Apex Infra Material Supplies" />
        </Form.Item>

        <Form.Item name="legalName" label="Registered Legal Name" rules={[{ max: 150 }]}>
          <Input placeholder="e.g. Apex Infrastructure Pvt Ltd (optional)" />
        </Form.Item>

        <Form.Item
          name="phone"
          label="Organization Business Phone (E.164)"
          rules={[
            { required: true, message: 'Phone number is required' },
            { pattern: /^\+[1-9]\d{9,14}$/, message: 'Must be valid E.164 format (+919876543210)' },
          ]}
        >
          <Input placeholder="+919876543210" />
        </Form.Item>

        <Form.Item
          name="email"
          label="Organization Business Email"
          rules={[{ type: 'email', message: 'Must be valid email' }]}
        >
          <Input placeholder="partner@example.com (optional)" />
        </Form.Item>

        <Form.Item name="deliveryMode" label="Delivery Model" rules={[{ required: true }]}>
          <Select
            options={[
              { label: 'Partner Managed (Vendor handles transport)', value: DeliveryMode.PARTNER_MANAGED },
              { label: 'Platform Managed (TheHomez handles fleet)', value: DeliveryMode.PLATFORM_MANAGED },
            ]}
          />
        </Form.Item>

        <Form.Item name="serviceAreaIds" label="Target Service Area(s)">
          <Select
            mode="multiple"
            placeholder="Select service areas"
            options={serviceAreas.map((sa) => ({
              label: `${sa.code} · ${sa.name} (${sa.city})`,
              value: sa.id,
            }))}
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item
          name="previousApplicationId"
          label="Previous Rejected Application ID (Linked Reapplication)"
          rules={[{ pattern: /^[0-9a-fA-F]{24}$/, message: 'Must be valid 24-character ObjectId' }]}
        >
          <Input placeholder="24-character hex ID (optional)" />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 24 }}>
          Primary Partner Operator Details
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          These contact credentials will be provisioned as the primary partner operator account upon approval.
        </Typography.Paragraph>

        <Form.Item
          name="contactName"
          label="Contact Person Name"
          rules={[
            { required: true, message: 'Contact name is required' },
            { max: 100, message: 'Max 100 characters' },
          ]}
        >
          <Input placeholder="e.g. Ramesh Kumar" />
        </Form.Item>

        <Form.Item
          name="contactPhone"
          label="Operator Phone Number (E.164)"
          rules={[
            { required: true, message: 'Contact phone is required' },
            { pattern: /^\+[1-9]\d{9,14}$/, message: 'Must be valid E.164 format (+919876543210)' },
          ]}
        >
          <Input placeholder="+919876543211" />
        </Form.Item>

        <Form.Item
          name="contactEmail"
          label="Operator Email"
          rules={[{ type: 'email', message: 'Must be valid email' }]}
        >
          <Input placeholder="ramesh@example.com (optional)" />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 24 }}>
          Compliance &amp; Trade License (Metadata)
        </Typography.Title>

        <Form.Item name="gstin" label="GSTIN Number">
          <Input placeholder="e.g. 29ABCDE1234F1Z5 (optional)" />
        </Form.Item>

        <Form.Item name="pan" label="PAN Number">
          <Input placeholder="e.g. ABCDE1234F (optional)" />
        </Form.Item>

        <Form.Item name="tradeLicense" label="Trade License Number">
          <Input placeholder="e.g. TL-BLR-2026-9901 (optional)" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
