import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import {
  MAX_UNIT_DESCRIPTION_LENGTH,
  MAX_UNIT_NAME_LENGTH,
  UNIT_CODE_REGEX,
  type ICreateUnitDto,
  type IUnit,
  type IUpdateUnitDto,
  type UnitClassification,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { unitClient } from '../api/unit-client.js';

export interface UnitFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  unit?: IUnit | null;
  onClose: () => void;
  onSuccess: (savedUnit: IUnit) => void;
}

interface FormValues {
  code: string;
  name: string;
  symbol: string;
  singularLabel: string;
  pluralLabel: string;
  description?: string;
  classification: UnitClassification;
  isDiscrete: boolean;
  allowedMaxPrecision: number;
  isActive: boolean;
}

const classifications: UnitClassification[] = ['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME'];

export function UnitFormDrawer({
  open,
  mode,
  unit,
  onClose,
  onSuccess,
}: UnitFormDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedClassification = Form.useWatch('classification', form);
  const selectedIsDiscrete = Form.useWatch('isDiscrete', form);

  // Sync form initial values when open / unit changes
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setErrorMsg(null);
      return;
    }

    if (mode === 'edit' && unit) {
      form.setFieldsValue({
        code: unit.code,
        name: unit.name,
        symbol: unit.symbol,
        singularLabel: unit.singularLabel,
        pluralLabel: unit.pluralLabel,
        description: unit.description || '',
        classification: unit.classification,
        isDiscrete: unit.isDiscrete,
        allowedMaxPrecision: unit.allowedMaxPrecision,
        isActive: unit.isActive,
      });
    } else {
      form.setFieldsValue({
        code: '',
        name: '',
        symbol: '',
        singularLabel: '',
        pluralLabel: '',
        description: '',
        classification: 'MASS',
        isDiscrete: false,
        allowedMaxPrecision: 2,
        isActive: true,
      });
    }
    setErrorMsg(null);
  }, [open, mode, unit, form]);

  // Enforce discrete precision rules whenever classification or isDiscrete changes
  const handleClassificationChange = (classification: UnitClassification) => {
    if (classification === 'COUNT') {
      form.setFieldsValue({
        isDiscrete: true,
        allowedMaxPrecision: 0,
      });
    }
  };

  const handleDiscreteChange = (isDiscrete: boolean) => {
    if (isDiscrete) {
      form.setFieldsValue({ allowedMaxPrecision: 0 });
    } else {
      const current = form.getFieldValue('allowedMaxPrecision');
      form.setFieldsValue({ allowedMaxPrecision: current > 0 ? current : 2 });
    }
  };

  const isCount = selectedClassification === 'COUNT';
  const isDiscrete = isCount || selectedIsDiscrete;

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      if (mode === 'create') {
        const createDto: ICreateUnitDto = {
          code: values.code.trim().toUpperCase(),
          name: values.name.trim(),
          symbol: values.symbol.trim(),
          singularLabel: values.singularLabel.trim(),
          pluralLabel: values.pluralLabel.trim(),
          description: values.description?.trim() || undefined,
          classification: values.classification,
          isDiscrete: isCount ? true : values.isDiscrete,
          allowedMaxPrecision: isDiscrete ? 0 : values.allowedMaxPrecision,
          isActive: values.isActive,
        };

        const created = await unitClient.create(createDto);
        onSuccess(created);
        onClose();
      } else if (mode === 'edit' && unit) {
        const updateDto: IUpdateUnitDto = {
          name: values.name.trim(),
          symbol: values.symbol.trim(),
          singularLabel: values.singularLabel.trim(),
          pluralLabel: values.pluralLabel.trim(),
          description: values.description?.trim() || undefined,
          allowedMaxPrecision: unit.isDiscrete ? 0 : values.allowedMaxPrecision,
          isActive: values.isActive,
        };

        const updated = await unitClient.update(unit.code, updateDto);
        onSuccess(updated);
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'UNIT_CODE_ALREADY_EXISTS') {
          setErrorMsg(`Unit code "${values.code.trim().toUpperCase()}" is already registered. Unit codes must be globally unique.`);
        } else if (err.code === 'PRECISION_IN_USE_BY_PRODUCTS') {
          setErrorMsg('Cannot lower allowedMaxPrecision below precision already in use by active products or variants.');
        } else if (err.code === 'UNIT_IN_USE_BY_ACTIVE_PRODUCTS') {
          setErrorMsg('Cannot deactivate unit that is currently in use by active or published products or variants.');
        } else if (err.code === 'CANNOT_MODIFY_IMMUTABLE_UNIT_FIELD') {
          setErrorMsg('Unit code, classification, and quantity behavior are strictly immutable.');
        } else {
          setErrorMsg(err.message || 'Failed to save measurement unit.');
        }
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('An unexpected error occurred while saving the unit.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={mode === 'create' ? 'Create Measurement Unit' : `Edit Unit — ${unit?.code || ''}`}
      open={open}
      onClose={onClose}
      width={560}
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
            {mode === 'create' ? 'Create Unit' : 'Save Changes'}
          </Button>
        </Space>
      }
    >
      {errorMsg && (
        <Alert
          type="error"
          showIcon
          message="Unit Validation Error"
          description={errorMsg}
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setErrorMsg(null)}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark="optional"
      >
        <Row gutter={16}>
          <Col span={14}>
            <Form.Item
              name="code"
              label="Canonical Unit Code"
              tooltip="Unique uppercase identifier for catalogue data and API requests (e.g., PIECE, SQ_FT, TONNE)"
              rules={[
                { required: true, message: 'Unit code is required' },
                {
                  pattern: UNIT_CODE_REGEX,
                  message: 'Unit code must be 2–20 uppercase alphanumeric characters or underscores',
                },
              ]}
            >
              <Input
                placeholder="e.g. SQ_MTR"
                disabled={mode === 'edit'}
                onChange={(e) => {
                  const upper = e.target.value.toUpperCase();
                  form.setFieldValue('code', upper);
                }}
              />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item
              name="symbol"
              label="Symbol / Abbr."
              tooltip="Display abbreviation shown on pricing and carts (e.g. m², t, pc)"
              rules={[
                { required: true, message: 'Symbol is required' },
                { max: 10, message: 'Symbol cannot exceed 10 characters' },
              ]}
            >
              <Input placeholder="e.g. m²" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="name"
          label="Unit Name"
          rules={[
            { required: true, message: 'Unit name is required' },
            { max: MAX_UNIT_NAME_LENGTH, message: `Cannot exceed ${MAX_UNIT_NAME_LENGTH} characters` },
          ]}
        >
          <Input placeholder="e.g. Square Metre" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="singularLabel"
              label="Singular Label"
              tooltip="Used in customer-facing descriptions (e.g. 1 Square Metre)"
              rules={[
                { required: true, message: 'Singular label is required' },
                { max: 50, message: 'Cannot exceed 50 characters' },
              ]}
            >
              <Input placeholder="e.g. Square Metre" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="pluralLabel"
              label="Plural Label"
              tooltip="Used in customer-facing descriptions (e.g. 5 Square Metres)"
              rules={[
                { required: true, message: 'Plural label is required' },
                { max: 50, message: 'Cannot exceed 50 characters' },
              ]}
            >
              <Input placeholder="e.g. Square Metres" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="classification"
          label="Physical Dimension Classification"
          tooltip="Dimensional class for physical integrity and conversion gating"
          rules={[{ required: true, message: 'Classification is required' }]}
        >
          <Select
            disabled={mode === 'edit'}
            onChange={handleClassificationChange}
            options={classifications.map((c) => ({
              label: c,
              value: c,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="isDiscrete"
          label="Quantity Behavior"
          tooltip="Discrete units require whole integer quantities. Continuous units allow decimals up to maximum precision."
          rules={[{ required: true, message: 'Quantity behavior is required' }]}
        >
          <Radio.Group
            disabled={mode === 'edit' || isCount}
            onChange={(e) => handleDiscreteChange(e.target.value)}
          >
            <Radio value={true}>
              Discrete (Whole integer quantities only, 0 decimal places)
            </Radio>
            <Radio value={false} disabled={isCount}>
              Continuous (Permits decimal ordering quantities)
            </Radio>
          </Radio.Group>
        </Form.Item>

        {isCount && (
          <Alert
            type="info"
            showIcon
            message="Count units (e.g. items, packages) are strictly discrete and enforced to whole-integer quantities (0 decimals)."
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item
          name="allowedMaxPrecision"
          label="Allowed Maximum Precision"
          tooltip="Ceiling for decimal precision that products or variants using this unit may configure"
          rules={[{ required: true, message: 'Precision ceiling is required' }]}
        >
          {isDiscrete ? (
            <Input disabled value="0 decimal places (Whole numbers only)" />
          ) : (
            <Select
              options={[
                { label: '1 decimal place (0.1)', value: 1 },
                { label: '2 decimal places (0.01)', value: 2 },
                { label: '3 decimal places (0.001 — platform maximum)', value: 3 },
              ]}
            />
          )}
        </Form.Item>

        {mode === 'edit' && !unit?.isDiscrete && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Note: Lowering the precision ceiling below what is already configured on active products or variants will be rejected to protect catalogue integrity.
          </Typography.Paragraph>
        )}

        <Form.Item
          name="description"
          label="Description"
          rules={[{ max: MAX_UNIT_DESCRIPTION_LENGTH, message: `Cannot exceed ${MAX_UNIT_DESCRIPTION_LENGTH} characters` }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="Commercial or industrial context for this measurement unit"
          />
        </Form.Item>

        <Form.Item
          name="isActive"
          label="Active Status"
          valuePropName="checked"
          tooltip="Inactive units cannot be assigned to new products or variants."
        >
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>

        {mode === 'edit' && unit?.isSystem && (
          <Alert
            type="info"
            showIcon
            message="System Managed Unit"
            description="This is a core construction measurement unit. Core physical dimensions cannot be altered."
            style={{ marginTop: 12 }}
          />
        )}
      </Form>
    </Drawer>
  );
}
