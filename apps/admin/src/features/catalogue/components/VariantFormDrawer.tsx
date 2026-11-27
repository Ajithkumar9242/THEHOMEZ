import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CANONICAL_SKU_REGEX,
  DECIMAL_STRING_REGEX,
  ExactDecimalQuantity,
  MAX_ALLOWED_QUANTITY_PRECISION,
  type ICreateProductVariantDto,
  type IProduct,
  type IProductVariant,
  type IUnit,
  type IUpdateProductVariantDto,
  type ProductVariantStatus,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnits } from '../api/catalogue-lookups.js';
import { AttributeEditor } from './AttributeEditor.js';
import { VariantImageUploader } from './VariantImageUploader.js';

export interface VariantFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  parentProduct: IProduct | null;
  variant?: IProductVariant | null;
  onClose: () => void;
  onSuccess: (variant: IProductVariant) => void;
}

interface FormValues {
  title: string;
  sku?: string;
  status?: 'DRAFT' | 'INACTIVE';
  unitCode?: string;
  quantityPrecision?: number;
  minOrderQuantity?: string;
  maxOrderQuantity?: string;
  stepIncrement?: string;
}

const ERROR_MESSAGE_MAP: Record<string, string> = {
  VARIANT_SKU_EXISTS:
    'The specified SKU is already in use by another product or variant. SKUs must be globally unique across the catalogue.',
  DUPLICATE_VARIANT_ATTRIBUTES:
    'A sibling variant with this exact combination of attributes already exists for this product. Attributes must uniquely distinguish each variant.',
  PRODUCT_ARCHIVED:
    'The parent product is archived. Archived products cannot accept new variants or variant edits.',
  MAX_VARIANTS_EXCEEDED: 'Maximum limit of 50 non-archived variants reached for this product.',
  IMMUTABLE_SKU_MODIFICATION: 'Cannot modify SKU after the variant has been published.',
  IMMUTABLE_UNIT_MODIFICATION:
    'Cannot modify unit of measurement or quantity precision after the variant has been published.',
  EXISTING_TIERS_INCOMPATIBLE_WITH_UNIT_CHANGE:
    'The updated quantity boundaries are incompatible with existing active B2B volume tiers. Adjust or deactivate existing tiers first.',
  INVALID_PRODUCT_STATE_TRANSITION:
    'Invalid variant state transition. Archived variants cannot be edited.',
  CANNOT_CREATE_ACTIVE_VARIANT_WITHOUT_PRICING:
    'Variants cannot be created directly with ACTIVE status. Create as DRAFT or INACTIVE first, set pricing, and activate.',
};

const getStatusColor = (status?: ProductVariantStatus) => {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'INACTIVE':
      return 'warning';
    case 'ARCHIVED':
      return 'default';
    case 'DRAFT':
    default:
      return 'blue';
  }
};

export function VariantFormDrawer({
  open,
  mode,
  parentProduct,
  variant,
  onClose,
  onSuccess,
}: VariantFormDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [units, setUnits] = useState<IUnit[]>([]);
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [images, setImages] = useState<string[]>([]);

  const watchedUnitCode = Form.useWatch('unitCode', form);

  // Load units master data on drawer open
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    void getUnits(controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setUnits(res);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [open]);

  // Populate or reset form values
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setAttributes({});
      setImages([]);
      setSubmitError(null);
      return;
    }

    setSubmitError(null);

    if (mode === 'edit' && variant) {
      form.setFieldsValue({
        title: variant.title,
        sku: variant.sku || '',
        unitCode: variant.unitCode || undefined,
        quantityPrecision:
          variant.quantityPrecision !== null && variant.quantityPrecision !== undefined
            ? variant.quantityPrecision
            : undefined,
        minOrderQuantity: variant.minOrderQuantity || '',
        maxOrderQuantity: variant.maxOrderQuantity || '',
        stepIncrement: variant.stepIncrement || '',
      });
      setAttributes(variant.attributes || {});
      setImages(variant.images || []);
    } else {
      form.setFieldsValue({
        title: '',
        sku: '',
        status: 'DRAFT',
        unitCode: undefined,
        quantityPrecision: undefined,
        minOrderQuantity: '',
        maxOrderQuantity: '',
        stepIncrement: '',
      });
      setAttributes({});
      setImages([]);
    }
  }, [open, mode, variant, form]);

  const selectedUnit = useMemo(() => {
    if (!watchedUnitCode) return null;
    return units.find((u) => u.code === watchedUnitCode) || null;
  }, [units, watchedUnitCode]);

  const handleUnitChange = (code?: string) => {
    if (!code) {
      form.setFieldValue('quantityPrecision', undefined);
      return;
    }
    const unit = units.find((u) => u.code === code);
    if (unit?.isDiscrete) {
      form.setFieldValue('quantityPrecision', 0);
    }
  };

  const handleCopyParentUnitDefaults = () => {
    if (!parentProduct?.unitCode) return;
    form.setFieldsValue({
      unitCode: parentProduct.unitCode,
      quantityPrecision: parentProduct.quantityPrecision ?? 0,
      minOrderQuantity: parentProduct.minOrderQuantity ?? '',
      maxOrderQuantity: parentProduct.maxOrderQuantity ?? '',
      stepIncrement: parentProduct.stepIncrement ?? '',
    });
  };

  const isParentArchived = parentProduct?.status === 'ARCHIVED';
  const isVariantArchived = mode === 'edit' && variant?.status === 'ARCHIVED';
  const isSingleItemProduct = Boolean(parentProduct && !parentProduct.hasVariants);
  const isControlsDisabled = isParentArchived || isVariantArchived || isSingleItemProduct;

  // Immutability is strictly governed by the variant's own publication history (publishedAt !== null),
  // not by parent product state.
  const isVariantPublished = mode === 'edit' && Boolean(variant?.publishedAt);
  // SKU cannot be modified if the variant has ever been published OR is not in DRAFT status.
  const isSkuDisabled =
    isControlsDisabled || (mode === 'edit' && (isVariantPublished || variant?.status !== 'DRAFT'));
  // unitCode and quantityPrecision cannot be modified if the variant has ever been published.
  const isUnitImmutable = isControlsDisabled || isVariantPublished;

  const handleSubmit = async (values: FormValues) => {
    if (!parentProduct) {
      setSubmitError('Parent product is required.');
      return;
    }

    if (isSingleItemProduct) {
      setSubmitError('Variants cannot be added to a standalone product (hasVariants: false).');
      return;
    }

    if (isParentArchived) {
      setSubmitError('The parent product is archived. Archived products cannot accept variants.');
      return;
    }

    if (isVariantArchived) {
      setSubmitError('This variant is archived. Archived variants cannot be edited.');
      return;
    }

    const attributeEntries = Object.entries(attributes);
    if (attributeEntries.length === 0) {
      setSubmitError('At least one attribute is required for a product variant.');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      const cleanTitle = values.title.trim();
      const cleanSku = values.sku?.trim() ? values.sku.trim().toUpperCase() : undefined;

      if (mode === 'create') {
        const createDto: ICreateProductVariantDto = {
          title: cleanTitle,
          status: values.status || 'DRAFT',
          attributes,
          ...(images.length > 0 ? { images } : {}),
        };

        if (cleanSku) {
          createDto.sku = cleanSku;
        }

        if (values.unitCode?.trim()) {
          createDto.unitCode = values.unitCode.trim().toUpperCase();
        }
        if (values.quantityPrecision !== undefined && values.quantityPrecision !== null) {
          createDto.quantityPrecision = values.quantityPrecision;
        }
        if (values.minOrderQuantity?.trim()) {
          createDto.minOrderQuantity = values.minOrderQuantity.trim();
        }
        if (values.maxOrderQuantity?.trim()) {
          createDto.maxOrderQuantity = values.maxOrderQuantity.trim();
        }
        if (values.stepIncrement?.trim()) {
          createDto.stepIncrement = values.stepIncrement.trim();
        }

        const created = await variantClient.create(parentProduct.id, createDto);
        onSuccess(created);
        onClose();
      } else if (mode === 'edit' && variant) {
        const updateDto: IUpdateProductVariantDto = {
          title: cleanTitle,
          attributes,
          images,
        };

        if (!isSkuDisabled && cleanSku !== undefined) {
          updateDto.sku = cleanSku;
        }
        if (!isVariantPublished) {
          if (values.unitCode !== undefined) {
            updateDto.unitCode = values.unitCode ? values.unitCode.trim().toUpperCase() : null;
          }
          if (values.quantityPrecision !== undefined) {
            updateDto.quantityPrecision = values.quantityPrecision;
          }
        }

        if (values.minOrderQuantity !== undefined) {
          const trimmed = values.minOrderQuantity.trim();
          updateDto.minOrderQuantity = trimmed.length > 0 ? trimmed : null;
        }
        if (values.maxOrderQuantity !== undefined) {
          const trimmed = values.maxOrderQuantity.trim();
          updateDto.maxOrderQuantity = trimmed.length > 0 ? trimmed : null;
        }
        if (values.stepIncrement !== undefined) {
          const trimmed = values.stepIncrement.trim();
          updateDto.stepIncrement = trimmed.length > 0 ? trimmed : null;
        }

        const updated = await variantClient.update(parentProduct.id, variant.id, updateDto);
        onSuccess(updated);
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const mapped = ERROR_MESSAGE_MAP[err.code];
        setSubmitError(mapped ? `${mapped} (${err.code})` : `${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to save variant. Please verify fields and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={
        mode === 'create'
          ? `Add Variant to ${parentProduct?.title || 'Product'}`
          : `Edit Variant: ${variant?.title || ''}`
      }
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
      maskClosable={!submitting}
      extra={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={() => form.submit()}
            disabled={isControlsDisabled}
            aria-label="Save variant button"
          >
            {mode === 'create' ? 'Create Variant' : 'Save Changes'}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        onFinishFailed={() => setSubmitError('Please correct the validation errors in the form.')}
      >
        {submitError && (
          <Alert
            type="error"
            showIcon
            message="Operation Failed"
            description={submitError}
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setSubmitError(null)}
          />
        )}

        {isParentArchived && (
          <Alert
            type="warning"
            showIcon
            message="Parent Product Archived"
            description="The parent product is archived. Archived products cannot accept new variants or variant edits."
            style={{ marginBottom: 16 }}
          />
        )}

        {isVariantArchived && (
          <Alert
            type="warning"
            showIcon
            message="Variant Archived"
            description="This variant is archived. Archived variants are permanently immutable and cannot be edited."
            style={{ marginBottom: 16 }}
          />
        )}

        {isSingleItemProduct && (
          <Alert
            type="error"
            showIcon
            message="Single-Item Product"
            description="Variants cannot be added to or managed on a standalone product (hasVariants: false)."
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Basic Information */}
        <Card title="Basic Information" variant="borderless" style={{ marginBottom: 16 }}>
          <Form.Item
            name="title"
            label="Variant Title"
            rules={[
              { required: true, message: 'Variant title is required' },
              { max: 200, message: 'Title cannot exceed 200 characters' },
              {
                validator: async (_, val) => {
                  if (val && !val.trim()) {
                    return Promise.reject(new Error('Variant title cannot be whitespace only'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input
              placeholder="e.g. Tata Tiscon 12mm FE550D"
              maxLength={200}
              disabled={isControlsDisabled}
            />
          </Form.Item>

          {mode === 'create' ? (
            <Form.Item
              name="status"
              label="Initial Status"
              extra="Variants cannot be created directly as ACTIVE. Direct activation requires configured global B2C pricing and is performed as a separate operational step."
            >
              <Radio.Group disabled={isControlsDisabled}>
                <Radio value="DRAFT">Draft</Radio>
                <Radio value="INACTIVE">Inactive</Radio>
              </Radio.Group>
            </Form.Item>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                Current Status:
              </Typography.Text>
              <Tag color={getStatusColor(variant?.status)}>{variant?.status}</Tag>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                Lifecycle transitions (activation, deactivation, archival) are governed via separate
                operations.
              </Typography.Paragraph>
            </div>
          )}
        </Card>

        {/* SKU Governance */}
        <Card title="SKU Governance" variant="borderless" style={{ marginBottom: 16 }}>
          <Form.Item
            name="sku"
            label="Canonical SKU"
            extra={
              mode === 'edit' && isSkuDisabled
                ? isVariantPublished
                  ? 'SKU is permanently immutable once published.'
                  : 'SKU cannot be modified for non-draft variants.'
                : 'Leave blank for backend auto-generation (THZ-V-...). Must be 4–64 characters uppercase alphanumeric.'
            }
            rules={[
              {
                validator: async (_, val) => {
                  if (!val || !val.trim()) return Promise.resolve();
                  const trimmed = val.trim().toUpperCase();
                  if (!CANONICAL_SKU_REGEX.test(trimmed)) {
                    return Promise.reject(
                      new Error(
                        'SKU must be 4–64 characters, uppercase alphanumeric, hyphens/underscores, starting and ending with alphanumeric',
                      ),
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input
              placeholder="e.g. THZ-V-TMT-12MM (optional)"
              disabled={isSkuDisabled}
              maxLength={64}
              onChange={(e) => form.setFieldValue('sku', e.target.value.toUpperCase())}
            />
          </Form.Item>
        </Card>

        {/* Variant Attributes */}
        <Card
          title="Variant Attributes"
          variant="borderless"
          style={{ marginBottom: 16 }}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              1–20 differentiating key/value pairs
            </Typography.Text>
          }
        >
          <AttributeEditor
            value={attributes}
            onChange={setAttributes}
            disabled={isControlsDisabled}
          />
        </Card>

        {/* Unit & Quantity Configuration */}
        <Card
          title="Unit & Quantity Configuration"
          variant="borderless"
          style={{ marginBottom: 16 }}
        >
          {parentProduct?.unitCode ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Parent Unit Snapshot"
              action={
                !isUnitImmutable && !isControlsDisabled ? (
                  <Button size="small" onClick={handleCopyParentUnitDefaults}>
                    Copy Parent Unit Defaults
                  </Button>
                ) : undefined
              }
              description={
                <span>
                  Parent product specifies unit: <strong>{parentProduct.unitCode}</strong>
                  {parentProduct.quantityPrecision !== undefined &&
                    parentProduct.quantityPrecision !== null && (
                      <span> (Precision: {parentProduct.quantityPrecision}</span>
                    )}
                  {parentProduct.minOrderQuantity && (
                    <span>, MOQ: {parentProduct.minOrderQuantity}</span>
                  )}
                  {parentProduct.stepIncrement && (
                    <span>, Step: {parentProduct.stepIncrement}</span>
                  )}
                  {parentProduct.maxOrderQuantity && (
                    <span>, Max: {parentProduct.maxOrderQuantity}</span>
                  )}
                  ). If unit fields are left blank during creation, the backend will automatically
                  snapshot these parent settings.
                </span>
              }
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Parent Product Lacks Unit Configuration"
              description="The parent product has no unit configuration. You must explicitly configure Unit Code, Quantity Precision, Min Order Quantity, and Step Increment for this variant before activation can succeed."
            />
          )}

          {isVariantPublished && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Published Unit Immutability"
              description="Unit code and quantity precision are permanently immutable after publication. Order quantity boundaries (MOQ, max, step) can be modified, but changes may fail if existing active B2B volume tiers are incompatible."
            />
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="unitCode"
                label="Unit of Measurement"
                extra={
                  isVariantPublished
                    ? 'Unit code is immutable after initial publication.'
                    : 'Optional during creation; snapshots parent if omitted.'
                }
              >
                <Select
                  placeholder="Select construction unit"
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  disabled={isUnitImmutable}
                  onChange={handleUnitChange}
                  options={units.map((u) => ({
                    value: u.code,
                    label: `${u.name} (${u.symbol}) · ${u.code}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="quantityPrecision"
                label="Quantity Precision (Decimals)"
                extra={
                  isVariantPublished
                    ? 'Precision is immutable after initial publication.'
                    : selectedUnit?.isDiscrete
                      ? 'Discrete units require 0 precision (whole numbers only).'
                      : `Allowed precision: 0 to ${selectedUnit?.allowedMaxPrecision ?? MAX_ALLOWED_QUANTITY_PRECISION}.`
                }
                rules={[
                  {
                    validator: async (_, val) => {
                      if (val === undefined || val === null) return Promise.resolve();
                      if (selectedUnit?.isDiscrete && val > 0) {
                        return Promise.reject(
                          new Error(
                            `Discrete unit "${selectedUnit.code}" cannot have decimal precision`,
                          ),
                        );
                      }
                      if (selectedUnit && val > selectedUnit.allowedMaxPrecision) {
                        return Promise.reject(
                          new Error(
                            `Precision exceeds maximum allowed ${selectedUnit.allowedMaxPrecision} for unit "${selectedUnit.code}"`,
                          ),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <InputNumber
                  min={0}
                  max={selectedUnit?.allowedMaxPrecision ?? MAX_ALLOWED_QUANTITY_PRECISION}
                  disabled={isUnitImmutable || selectedUnit?.isDiscrete}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="minOrderQuantity"
                label="Min Order Qty (MOQ)"
                extra="Canonical decimal (e.g. 1 or 0.5)"
                rules={[
                  {
                    validator: async (_, val) => {
                      if (!val || !val.trim()) return Promise.resolve();
                      const trimmed = val.trim();
                      if (!DECIMAL_STRING_REGEX.test(trimmed)) {
                        return Promise.reject(
                          new Error('Must be a valid decimal string without exponents'),
                        );
                      }
                      if (Number(trimmed) <= 0) {
                        return Promise.reject(
                          new Error('Minimum order quantity must be greater than zero'),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder="1" maxLength={15} disabled={isControlsDisabled} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="maxOrderQuantity"
                label="Max Order Qty"
                extra="Optional ceiling limit"
                rules={[
                  {
                    validator: async (_, val) => {
                      if (!val || !val.trim()) return Promise.resolve();
                      const trimmed = val.trim();
                      if (!DECIMAL_STRING_REGEX.test(trimmed)) {
                        return Promise.reject(new Error('Must be a valid decimal string'));
                      }
                      const minVal = form.getFieldValue('minOrderQuantity');
                      if (minVal && minVal.trim() && DECIMAL_STRING_REGEX.test(minVal.trim())) {
                        const precision = form.getFieldValue('quantityPrecision') ?? 0;
                        try {
                          const minScaled = ExactDecimalQuantity.toScaledBigInt(
                            minVal.trim(),
                            precision,
                          );
                          const maxScaled = ExactDecimalQuantity.toScaledBigInt(trimmed, precision);
                          if (maxScaled < minScaled) {
                            return Promise.reject(
                              new Error(
                                'Maximum order quantity must be greater than or equal to minimum order quantity',
                              ),
                            );
                          }
                        } catch {
                          if (Number(trimmed) < Number(minVal.trim())) {
                            return Promise.reject(
                              new Error(
                                'Maximum order quantity must be greater than or equal to minimum order quantity',
                              ),
                            );
                          }
                        }
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input
                  placeholder="e.g. 500 (optional)"
                  maxLength={15}
                  disabled={isControlsDisabled}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="stepIncrement"
                label="Step Increment"
                extra="Quantity increment step"
                rules={[
                  {
                    validator: async (_, val) => {
                      if (!val || !val.trim()) return Promise.resolve();
                      const trimmed = val.trim();
                      if (!DECIMAL_STRING_REGEX.test(trimmed)) {
                        return Promise.reject(
                          new Error('Must be a valid decimal string without exponents'),
                        );
                      }
                      if (Number(trimmed) <= 0) {
                        return Promise.reject(
                          new Error('Step increment must be greater than zero'),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder="1" maxLength={15} disabled={isControlsDisabled} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Variant Images */}
        <Card title="Variant Images" variant="borderless" style={{ marginBottom: 16 }}>
          <VariantImageUploader value={images} onChange={setImages} disabled={isControlsDisabled} />
        </Card>
      </Form>
    </Drawer>
  );
}
