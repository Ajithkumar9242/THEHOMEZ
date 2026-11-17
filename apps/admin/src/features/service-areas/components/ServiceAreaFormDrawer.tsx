import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  MAX_PINCODES_PER_SERVICE_AREA,
  PINCODE_REGEX,
  type ICreateServiceAreaDto,
  type IServiceArea,
  type IUpdateServiceAreaDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from '../api/service-area-client.js';

export interface ServiceAreaFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  serviceArea?: IServiceArea | null;
  onClose: () => void;
  onSuccess: (area: IServiceArea) => void;
}

interface FormValues {
  code?: string;
  name: string;
  city: string;
  state: string;
  countryCode?: string;
  deliveryRadiusKm?: number;
}

const SERVICE_AREA_CODE_REGEX = /^[A-Za-z0-9_-]{3,32}$/;

export function ServiceAreaFormDrawer({
  open,
  mode,
  serviceArea,
  onClose,
  onSuccess,
}: ServiceAreaFormDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // PIN Code Management State
  const [pincodes, setPincodes] = useState<string[]>([]);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Reset or populate form when drawer opens/closes or serviceArea changes
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setPincodes([]);
      setPinInput('');
      setPinError(null);
      setSubmitError(null);
      return;
    }

    setSubmitError(null);
    setPinError(null);

    if (mode === 'edit' && serviceArea) {
      form.setFieldsValue({
        code: serviceArea.code,
        name: serviceArea.name,
        city: serviceArea.city,
        state: serviceArea.state,
        countryCode: serviceArea.countryCode || 'IN',
        deliveryRadiusKm: serviceArea.deliveryRadiusKm,
      });
      setPincodes([...serviceArea.pincodes]);
    } else {
      form.setFieldsValue({
        code: '',
        name: '',
        city: '',
        state: '',
        countryCode: 'IN',
        deliveryRadiusKm: undefined,
      });
      setPincodes([]);
    }
  }, [open, mode, serviceArea, form]);

  const handleAddPincodes = () => {
    const rawTokens = pinInput
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (rawTokens.length === 0) return;

    const invalidTokens: string[] = [];
    const duplicateTokens: string[] = [];
    const newValidPins: string[] = [];
    const currentSet = new Set(pincodes);
    const seenInInput = new Set<string>();

    for (const token of rawTokens) {
      if (!PINCODE_REGEX.test(token)) {
        invalidTokens.push(token);
        continue;
      }
      if (currentSet.has(token) || seenInInput.has(token)) {
        duplicateTokens.push(token);
        continue;
      }
      seenInInput.add(token);
      newValidPins.push(token);
    }

    if (invalidTokens.length > 0) {
      setPinError(
        `Invalid PIN code format: "${invalidTokens.join(', ')}". Each PIN must be a valid 6-digit Indian postal code starting with 1-9.`,
      );
      return;
    }

    if (duplicateTokens.length > 0 && newValidPins.length === 0) {
      setPinError(`Duplicate PIN code: "${duplicateTokens.join(', ')}" is already added.`);
      return;
    }

    if (pincodes.length + newValidPins.length > MAX_PINCODES_PER_SERVICE_AREA) {
      setPinError(
        `Exceeded maximum allowed limit of ${MAX_PINCODES_PER_SERVICE_AREA} PIN codes per service area (currently ${pincodes.length}, attempting to add ${newValidPins.length}).`,
      );
      return;
    }

    setPincodes((prev) => [...prev, ...newValidPins]);
    setPinInput('');
    setPinError(null);
  };

  const handleRemovePincode = (pinToRemove: string) => {
    setPincodes((prev) => prev.filter((p) => p !== pinToRemove));
  };

  const handleSubmit = async (values: FormValues) => {
    if (pincodes.length === 0) {
      setPinError('At least one valid PIN code is required for the service area.');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      if (mode === 'create') {
        const createDto: ICreateServiceAreaDto = {
          code: (values.code || '').trim().toUpperCase(),
          name: values.name.trim(),
          city: values.city.trim(),
          state: values.state.trim(),
          countryCode: (values.countryCode?.trim() || 'IN').toUpperCase(),
          pincodes,
        };

        if (values.deliveryRadiusKm !== undefined && values.deliveryRadiusKm !== null) {
          createDto.deliveryRadiusKm = Number(values.deliveryRadiusKm);
        }

        const created = await serviceAreaClient.create(createDto);
        onSuccess(created);
        onClose();
      } else if (mode === 'edit' && serviceArea) {
        const updateDto: IUpdateServiceAreaDto = {
          name: values.name.trim(),
          city: values.city.trim(),
          state: values.state.trim(),
          countryCode: (values.countryCode?.trim() || 'IN').toUpperCase(),
          pincodes,
        };

        if (values.deliveryRadiusKm !== undefined && values.deliveryRadiusKm !== null) {
          updateDto.deliveryRadiusKm = Number(values.deliveryRadiusKm);
        }

        const updated = await serviceAreaClient.update(serviceArea.id, updateDto);
        onSuccess(updated);
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to save service area. Please verify inputs and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={mode === 'create' ? 'Create Service Area' : `Edit Service Area: ${serviceArea?.name}`}
      width={560}
      open={open}
      onClose={onClose}
      maskClosable={!submitting}
      closable={!submitting}
      extra={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={() => form.submit()}
            loading={submitting}
            disabled={submitting}
            aria-label="Submit service area form"
          >
            {mode === 'create' ? 'Create Area' : 'Save Changes'}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        disabled={submitting}
        requiredMark="optional"
      >
        {submitError && (
          <Alert
            type="error"
            showIcon
            message="Operation failed"
            description={submitError}
            style={{ marginBottom: 16 }}
          />
        )}

        {mode === 'create' ? (
          <Form.Item
            name="code"
            label="Service Area Code"
            rules={[
              { required: true, message: 'Service area code is required' },
              {
                validator(_, value: string) {
                  if (!value || SERVICE_AREA_CODE_REGEX.test(value.trim())) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error('Code must be 3-32 alphanumeric characters, hyphens, or underscores'),
                  );
                },
              },
            ]}
            extra="Unique identifier for this hub (e.g. BLR-NORTH). Automatically capitalized."
          >
            <Input
              placeholder="e.g. BLR-NORTH"
              maxLength={32}
              aria-label="Service area code"
              style={{ textTransform: 'uppercase' }}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label="Service Area Code"
            extra="Service area codes are immutable and cannot be modified after creation."
          >
            <Input value={serviceArea?.code} disabled aria-label="Service area code disabled" />
          </Form.Item>
        )}

        <Form.Item
          name="name"
          label="Display Name"
          rules={[
            { required: true, message: 'Display name is required' },
            { max: 100, message: 'Name cannot exceed 100 characters' },
          ]}
        >
          <Input
            placeholder="e.g. Bengaluru North (Yelahanka)"
            maxLength={100}
            aria-label="Service area name"
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="city"
              label="City"
              rules={[
                { required: true, message: 'City is required' },
                { max: 100, message: 'City cannot exceed 100 characters' },
              ]}
            >
              <Input placeholder="e.g. Bengaluru" maxLength={100} aria-label="Service area city" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="state"
              label="State"
              rules={[
                { required: true, message: 'State is required' },
                { max: 100, message: 'State cannot exceed 100 characters' },
              ]}
            >
              <Input placeholder="e.g. Karnataka" maxLength={100} aria-label="Service area state" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="countryCode"
              label="Country Code"
              rules={[
                { required: true, message: 'Country code is required' },
                { len: 2, message: 'Country code must be exactly 2 letters (ISO alpha-2)' },
              ]}
            >
              <Input
                placeholder="IN"
                maxLength={2}
                style={{ textTransform: 'uppercase' }}
                aria-label="Service area country code"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="deliveryRadiusKm"
              label="Delivery Radius (Optional)"
              rules={[
                {
                  validator(_, val) {
                    if (val === undefined || val === null || val === '') return Promise.resolve();
                    const num = Number(val);
                    if (Number.isNaN(num) || num < 0 || num > 500) {
                      return Promise.reject(new Error('Radius must be between 0 and 500 km'));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
              extra="Informational coverage radius in km"
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                max={500}
                addonAfter="km"
                placeholder="e.g. 25"
                aria-label="Delivery radius in kilometres"
              />
            </Form.Item>
          </Col>
        </Row>

        {/* PIN Code Coverage Management Section */}
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Typography.Text strong>
              PIN Code Coverage ({pincodes.length} / {MAX_PINCODES_PER_SERVICE_AREA})
            </Typography.Text>
            {pincodes.length > 0 && (
              <Button
                type="link"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => setPincodes([])}
                disabled={submitting}
                aria-label="Clear all PIN codes"
              >
                Clear all
              </Button>
            )}
          </div>

          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                if (pinError) setPinError(null);
              }}
              onPressEnter={(e) => {
                e.preventDefault();
                handleAddPincodes();
              }}
              placeholder="Enter 6-digit PIN code (or multiple separated by comma/space)"
              aria-label="PIN code input"
              disabled={submitting}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddPincodes}
              disabled={submitting || !pinInput.trim()}
              aria-label="Add PIN code button"
            >
              Add
            </Button>
          </Space.Compact>

          {pinError && (
            <Alert type="warning" showIcon message={pinError} style={{ marginTop: 8 }} />
          )}

          <div
            style={{
              marginTop: 12,
              maxHeight: 180,
              overflowY: 'auto',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              padding: 8,
              backgroundColor: '#fafafa',
            }}
            aria-label="Configured PIN codes list"
          >
            {pincodes.length === 0 ? (
              <Typography.Text
                type="secondary"
                style={{ fontStyle: 'italic', display: 'block', padding: 8 }}
              >
                No PIN codes added. Enter at least one valid 6-digit Indian PIN code above.
              </Typography.Text>
            ) : (
              <Space wrap size={[6, 6]}>
                {pincodes.map((pin) => (
                  <Tag
                    key={pin}
                    closable={!submitting}
                    onClose={() => handleRemovePincode(pin)}
                    aria-label={`PIN code ${pin}`}
                  >
                    {pin}
                  </Tag>
                ))}
              </Space>
            )}
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            Each PIN must be 6 numeric digits starting with 1–9. Up to{' '}
            {MAX_PINCODES_PER_SERVICE_AREA} PIN codes supported.
          </Typography.Paragraph>
        </div>
      </Form>
    </Drawer>
  );
}
