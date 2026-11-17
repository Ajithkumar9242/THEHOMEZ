import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DollarOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  MAX_B2B_VOLUME_TIERS,
  PermissionCode,
  type IB2BVolumeTier,
  type IProductPricing,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { pricingClient, type SetPricingPayload } from '../api/pricing-client.js';
import {
  paiseToRupeeString,
  parseRupeesToPaise,
  RUPEE_STRING_REGEX,
} from '../utils/money-utils.js';
import { validateVolumeTiers, type UnitRules } from '../utils/quantity-utils.js';

export interface PricingFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  productId: string;
  productTitle?: string;
  productSku?: string | null;
  variantId?: string;
  variantTitle?: string;
  variantSku?: string | null;
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
  existingPricing?: IProductPricing | null;
  onClose: () => void;
  onSuccess: (pricing: IProductPricing) => void;
  onReloadLatest?: () => void;
}

interface FormValues {
  b2cPriceRupees: string;
  b2cMrpRupees?: string;
  b2bPriceRupees?: string;
  allowB2bExceedsB2c?: boolean;
  changeReason: string;
}

interface TierRow {
  key: string;
  minQuantity: string;
  priceRupees: string;
}

export function PricingFormDrawer({
  open,
  mode,
  productId,
  productTitle,
  productSku,
  variantId,
  variantTitle,
  variantSku,
  unitCode,
  quantityPrecision,
  minOrderQuantity,
  maxOrderQuantity,
  stepIncrement,
  existingPricing,
  onClose,
  onSuccess,
  onReloadLatest,
}: PricingFormDrawerProps) {
  const { user } = useAuth();
  const canWrite = user?.permissions.includes(PermissionCode.PRICING_WRITE) ?? false;

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);

  // Volume Tiers Builder State
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [tierError, setTierError] = useState<string | null>(null);

  // Watch Form Values for Live Cross-Field Validation & Warnings
  const watchedB2cRupees = Form.useWatch('b2cPriceRupees', form);
  const watchedB2bRupees = Form.useWatch('b2bPriceRupees', form);
  const watchedChangeReason = Form.useWatch('changeReason', form) || '';

  const unitRules: UnitRules = useMemo(
    () => ({
      unitCode,
      quantityPrecision,
      minOrderQuantity,
      maxOrderQuantity,
      stepIncrement,
    }),
    [unitCode, quantityPrecision, minOrderQuantity, maxOrderQuantity, stepIncrement],
  );

  const unitRulesIncomplete = useMemo(
    () => !unitCode || !minOrderQuantity || !stepIncrement || quantityPrecision == null,
    [unitCode, minOrderQuantity, stepIncrement, quantityPrecision],
  );

  // Parse Live B2C and B2B Rupees safely for helper badges
  const b2bExceedsB2c = useMemo(() => {
    try {
      if (!watchedB2cRupees || !watchedB2bRupees) return false;
      const b2c = parseRupeesToPaise(watchedB2cRupees);
      const b2b = parseRupeesToPaise(watchedB2bRupees);
      return b2b > b2c;
    } catch {
      return false;
    }
  }, [watchedB2cRupees, watchedB2bRupees]);

  // Pre-populate or Reset Form when Drawer Opens/Closes or target record changes
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setTiers([]);
      setTierError(null);
      setSubmitError(null);
      setConcurrencyConflict(false);
      return;
    }

    setSubmitError(null);
    setTierError(null);
    setConcurrencyConflict(false);

    if (mode === 'edit' && existingPricing) {
      form.setFieldsValue({
        b2cPriceRupees: paiseToRupeeString(existingPricing.b2cPricePaise),
        b2cMrpRupees: paiseToRupeeString(existingPricing.b2cMrpPaise),
        b2bPriceRupees: paiseToRupeeString(existingPricing.b2bPricePaise),
        allowB2bExceedsB2c: false,
        changeReason: '',
      });

      const initialTiers: TierRow[] = (existingPricing.b2bTiers || []).map((t, idx) => ({
        key: `tier-${idx}-${t.minQuantity}`,
        minQuantity: t.minQuantity,
        priceRupees: paiseToRupeeString(t.pricePaise),
      }));
      setTiers(initialTiers);
    } else {
      form.resetFields();
      setTiers([]);
    }
  }, [open, mode, existingPricing, form]);

  // Tier Management Actions
  const handleAddTier = () => {
    if (tiers.length >= MAX_B2B_VOLUME_TIERS) {
      return;
    }
    const nextIndex = tiers.length;
    setTiers((prev) => [
      ...prev,
      {
        key: `tier-new-${Date.now()}-${nextIndex}`,
        minQuantity: '',
        priceRupees: '',
      },
    ]);
    setTierError(null);
  };

  const handleRemoveTier = (key: string) => {
    setTiers((prev) => prev.filter((t) => t.key !== key));
    setTierError(null);
  };

  const handleTierQuantityChange = (key: string, value: string) => {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, minQuantity: value } : t)));
    setTierError(null);
  };

  const handleTierPriceChange = (key: string, value: string) => {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, priceRupees: value } : t)));
    setTierError(null);
  };

  // Form Submit Handler
  const handleSubmit = async () => {
    if (!canWrite) {
      setSubmitError('You do not possess administrative PRICING_WRITE permission.');
      return;
    }

    setSubmitError(null);
    setTierError(null);
    setConcurrencyConflict(false);

    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      const fieldErrors = form.getFieldsError();
      const firstError = fieldErrors.find((f) => f.errors.length > 0)?.errors[0];
      setSubmitError(firstError || 'Please correct the validation errors in the form.');
      return;
    }

    // 1. Validate & Parse B2C Price
    let b2cPricePaise: number;
    try {
      b2cPricePaise = parseRupeesToPaise(values.b2cPriceRupees);
      if (b2cPricePaise <= 0) {
        const msg = 'B2C selling price must be greater than zero';
        form.setFields([{ name: 'b2cPriceRupees', errors: [msg] }]);
        setSubmitError(msg);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid B2C selling price format';
      form.setFields([{ name: 'b2cPriceRupees', errors: [msg] }]);
      setSubmitError(msg);
      return;
    }

    // 2. Validate & Parse Optional B2C MRP
    let b2cMrpPaise: number | null = null;
    if (values.b2cMrpRupees && values.b2cMrpRupees.trim().length > 0) {
      try {
        b2cMrpPaise = parseRupeesToPaise(values.b2cMrpRupees);
        if (b2cMrpPaise < b2cPricePaise) {
          const msg = `Maximum Retail Price (₹${values.b2cMrpRupees}) cannot be less than retail selling price (₹${values.b2cPriceRupees})`;
          form.setFields([{ name: 'b2cMrpRupees', errors: [msg] }]);
          setSubmitError(msg);
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid MRP format';
        form.setFields([{ name: 'b2cMrpRupees', errors: [msg] }]);
        setSubmitError(msg);
        return;
      }
    }

    // 3. Validate & Parse Optional B2B Baseline Price
    let b2bPricePaise: number | null = null;
    if (values.b2bPriceRupees && values.b2bPriceRupees.trim().length > 0) {
      try {
        b2bPricePaise = parseRupeesToPaise(values.b2bPriceRupees);
        if (b2bPricePaise > b2cPricePaise && !values.allowB2bExceedsB2c) {
          form.setFields([
            {
              name: 'b2bPriceRupees',
              errors: [
                'Wholesale base price exceeds B2C selling price. Check clearance override to confirm this rate.',
              ],
            },
          ]);
          return;
        }
      } catch (err) {
        form.setFields([
          {
            name: 'b2bPriceRupees',
            errors: [err instanceof Error ? err.message : 'Invalid B2B price format'],
          },
        ]);
        return;
      }
    }

    // 4. Validate B2B Volume Tiers
    if (tiers.length > 0) {
      if (b2bPricePaise === null) {
        form.setFields([
          {
            name: 'b2bPriceRupees',
            errors: [
              'Base B2B price is required as the baseline tier anchor when volume tiers are configured',
            ],
          },
        ]);
        setTierError(
          'Base B2B price is required as the baseline tier anchor when volume tiers are configured.',
        );
        return;
      }

      if (unitRulesIncomplete) {
        setTierError(
          'Cannot submit volume tiers: Physical unit configuration on this product is incomplete.',
        );
        return;
      }

      const parsedTiers: IB2BVolumeTier[] = [];
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i]!;
        if (!tier.minQuantity || tier.minQuantity.trim().length === 0) {
          setTierError(`Tier ${i + 1}: Minimum qualifying quantity is required.`);
          return;
        }
        if (!tier.priceRupees || tier.priceRupees.trim().length === 0) {
          setTierError(`Tier ${i + 1}: Unit price is required.`);
          return;
        }

        let tierPaise: number;
        try {
          tierPaise = parseRupeesToPaise(tier.priceRupees);
        } catch {
          setTierError(`Tier ${i + 1}: Unit price format is invalid.`);
          return;
        }

        parsedTiers.push({
          minQuantity: tier.minQuantity.trim(),
          pricePaise: tierPaise,
        });
      }

      const validationResult = validateVolumeTiers(parsedTiers, b2bPricePaise, unitRules);
      if (!validationResult.isValid) {
        setTierError(validationResult.error || 'Volume discount tiers are invalid.');
        return;
      }
    }

    // 5. Validate Change Reason
    const changeReason = (values.changeReason || '').trim();
    if (changeReason.length === 0) {
      form.setFields([
        {
          name: 'changeReason',
          errors: ['A business justification reason is mandatory for all price modifications'],
        },
      ]);
      return;
    }
    if (changeReason.length > 500) {
      form.setFields([
        { name: 'changeReason', errors: ['Change reason cannot exceed 500 characters'] },
      ]);
      return;
    }

    // 6. Assemble Payload
    const parsedTiers: IB2BVolumeTier[] = tiers.map((t) => ({
      minQuantity: t.minQuantity.trim(),
      pricePaise: parseRupeesToPaise(t.priceRupees),
    }));

    const payload: SetPricingPayload = {
      currency: 'INR',
      b2cPricePaise,
      b2cMrpPaise,
      b2bPricePaise,
      b2bTiers: parsedTiers,
      allowB2bExceedsB2c: values.allowB2bExceedsB2c ?? false,
      changeReason,
      expectedVersion:
        mode === 'edit' && existingPricing?.version !== undefined
          ? existingPricing.version
          : undefined,
    };

    // 7. Dispatch to API
    setSubmitting(true);
    try {
      const result = variantId
        ? await pricingClient.setVariantPricing(productId, variantId, payload)
        : await pricingClient.setProductPricing(productId, payload);

      message.success(
        mode === 'create'
          ? 'Commercial pricing record defined successfully.'
          : 'Commercial pricing record updated successfully.',
      );
      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConcurrencyConflict(true);
          setSubmitError(
            'Pricing was updated by another administrator while you were editing. Your changes have not been saved.',
          );
        } else if (err.status === 403) {
          setSubmitError('Permission denied: Your account lacks PRICING_WRITE permission.');
        } else {
          setSubmitError(err.message || 'Failed to save pricing configuration.');
        }
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('An unexpected error occurred while communicating with the server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isVariant = Boolean(variantId);
  const targetLabel = isVariant ? 'Variant Pricing' : 'Product Pricing';
  const drawerTitle = mode === 'create' ? `Set ${targetLabel}` : `Edit ${targetLabel}`;

  return (
    <Drawer
      title={drawerTitle}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
      maskClosable={!submitting}
      closable={!submitting}
      extra={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canWrite || submitting}
            icon={<DollarOutlined />}
          >
            {mode === 'create' ? 'Save Pricing' : 'Update Pricing'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Permission Warning */}
        {!canWrite && (
          <Alert
            type="error"
            showIcon
            message="Read-Only Mode"
            description="Your staff account lacks PRICING_WRITE capability. Creating and updating commercial pricing is prohibited."
          />
        )}

        {/* OCC Conflict Alert */}
        {concurrencyConflict && (
          <Alert
            type="error"
            showIcon
            message="Optimistic Concurrency Conflict"
            description={
              <Space direction="vertical">
                <Typography.Text>
                  Pricing was updated by another administrator while you were editing. Your changes
                  have not been saved to avoid overwriting newer data.
                </Typography.Text>
                {onReloadLatest && (
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      setConcurrencyConflict(false);
                      setSubmitError(null);
                      onReloadLatest();
                    }}
                  >
                    Reload Latest Pricing
                  </Button>
                )}
              </Space>
            }
          />
        )}

        {/* General Submit Error */}
        {submitError && !concurrencyConflict && (
          <Alert
            type="error"
            showIcon
            message="Submission Failed"
            description={submitError}
            closable
            onClose={() => setSubmitError(null)}
          />
        )}

        {/* GST-Exclusive Notice */}
        <Alert
          type="info"
          showIcon
          message="GST-Exclusive Net Commercial Pricing"
          description="All catalogue rates entered here are strictly GST-exclusive net amounts per Business Decision #32. Taxes are applied separately during checkout."
        />

        {/* SECTION A: Context Overview */}
        <Card size="small" title="Target Catalogue Context" variant="borderless">
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Product Title">
              <Typography.Text strong>{productTitle || productId}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Product Reference">
              <Typography.Text copyable>{productId}</Typography.Text>
            </Descriptions.Item>
            {productSku && (
              <Descriptions.Item label="Product SKU">
                <Tag>{productSku}</Tag>
              </Descriptions.Item>
            )}
            {isVariant && (
              <>
                <Descriptions.Item label="Variant Title">
                  <Typography.Text strong>{variantTitle || variantId}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Variant Reference">
                  <Typography.Text copyable>{variantId}</Typography.Text>
                </Descriptions.Item>
                {variantSku && (
                  <Descriptions.Item label="Variant SKU">
                    <Tag>{variantSku}</Tag>
                  </Descriptions.Item>
                )}
              </>
            )}
            <Descriptions.Item label="Unit of Measure">
              <Tag color="blue">{unitCode || 'Not Specified'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Unit Precision">
              {quantityPrecision != null ? `${quantityPrecision} decimals` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Minimum Order Qty (MOQ)">
              {minOrderQuantity ? `${minOrderQuantity} ${unitCode || ''}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Step Increment">
              {stepIncrement ? `${stepIncrement} ${unitCode || ''}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Current Version">
              {existingPricing ? (
                <Tag color="cyan">Revision {existingPricing.version}</Tag>
              ) : (
                <Tag>Unpriced</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Scope">
              <Tag color="purple">Global Catalogue Master</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Form Body */}
        <Form
          form={form}
          layout="vertical"
          disabled={!canWrite || submitting}
          requiredMark="optional"
        >
          {/* SECTION B: B2C Pricing */}
          <Divider orientation="left">B2C Retail Pricing (Consumer)</Divider>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="b2cPriceRupees"
                label="B2C Selling Price (₹ Net)"
                tooltip="The authoritative selling price per unit charged to retail customers on the storefront."
                rules={[
                  { required: true, message: 'B2C selling price is required' },
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 380 or 380.50)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 380.00"
                  size="large"
                  aria-label="B2C selling price input"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="b2cMrpRupees"
                label="B2C Maximum Retail Price (MRP ₹ Net)"
                tooltip="Optional printed maximum retail price on packaging. If provided, must be greater than or equal to the selling price."
                rules={[
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 420 or 420.00)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 420.00 (Optional)"
                  size="large"
                  aria-label="B2C MRP input"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* SECTION C: B2B Wholesale Pricing */}
          <Divider orientation="left">B2B Wholesale Baseline Pricing (Contractors)</Divider>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="b2bPriceRupees"
                label="B2B Baseline Rate (₹ Net)"
                tooltip="Baseline net rate per unit for verified trade contractors. Required if wholesale volume discount tiers are configured."
                rules={[
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 360 or 360.00)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 360.00 (Optional)"
                  size="large"
                  aria-label="B2B base rate input"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              {b2bExceedsB2c && (
                <div style={{ marginTop: 28 }}>
                  <Form.Item name="allowB2bExceedsB2c" valuePropName="checked">
                    <Checkbox aria-label="Permit wholesale rate exceeding retail rate checkbox">
                      <Typography.Text type="danger">
                        <WarningOutlined /> Confirm wholesale rate exceeds retail rate (Clearance
                        Override)
                      </Typography.Text>
                    </Checkbox>
                  </Form.Item>
                </div>
              )}
            </Col>
          </Row>

          {/* SECTION D: Wholesale Volume Tiers */}
          <Divider orientation="left">
            B2B Wholesale Volume Discount Tiers (Up to {MAX_B2B_VOLUME_TIERS} Slabs)
          </Divider>

          {unitRulesIncomplete && (
            <Alert
              type="warning"
              showIcon
              message="Unit configuration incomplete"
              description="This catalogue item is missing unit MOQ or step increment rules. Volume discount tiers cannot be evaluated."
              style={{ marginBottom: 16 }}
            />
          )}

          {tierError && (
            <Alert
              type="error"
              showIcon
              message="Volume Tier Validation Error"
              description={tierError}
              style={{ marginBottom: 16 }}
            />
          )}

          <div style={{ marginBottom: 16 }}>
            {tiers.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No wholesale volume discount slabs configured. Retail and wholesale base rates will apply across all order sizes."
              >
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={handleAddTier}
                  disabled={unitRulesIncomplete || !canWrite || submitting}
                  aria-label="Add first volume slab button"
                >
                  Add Volume Slab
                </Button>
              </Empty>
            ) : (
              <>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={tiers}
                  columns={[
                    {
                      title: 'Slab',
                      key: 'index',
                      width: 70,
                      render: (_, __, idx) => (
                        <Tag color="blue" aria-label={`Slab ${idx + 1} badge`}>
                          #{idx + 1}
                        </Tag>
                      ),
                    },
                    {
                      title: `Min Order Quantity (${unitCode || 'Units'})`,
                      dataIndex: 'minQuantity',
                      key: 'minQuantity',
                      render: (_, row) => (
                        <Input
                          placeholder={`> ${minOrderQuantity || 'MOQ'}`}
                          value={row.minQuantity}
                          onChange={(e) => handleTierQuantityChange(row.key, e.target.value)}
                          aria-label={`Tier ${row.key} min quantity input`}
                        />
                      ),
                    },
                    {
                      title: 'Discounted Unit Rate (₹ Net)',
                      dataIndex: 'priceRupees',
                      key: 'priceRupees',
                      render: (_, row) => (
                        <Input
                          prefix="₹"
                          placeholder="Rate per unit"
                          value={row.priceRupees}
                          onChange={(e) => handleTierPriceChange(row.key, e.target.value)}
                          aria-label={`Tier ${row.key} price input`}
                        />
                      ),
                    },
                    {
                      title: 'Action',
                      key: 'action',
                      width: 70,
                      render: (_, row) => (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleRemoveTier(row.key)}
                          aria-label={`Delete tier ${row.key} button`}
                        />
                      ),
                    },
                  ]}
                />
                <div style={{ marginTop: 12 }}>
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={handleAddTier}
                    disabled={
                      tiers.length >= MAX_B2B_VOLUME_TIERS ||
                      unitRulesIncomplete ||
                      !canWrite ||
                      submitting
                    }
                    aria-label="Add volume tier button"
                  >
                    Add Next Volume Slab ({tiers.length}/{MAX_B2B_VOLUME_TIERS})
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* SECTION E: Mandatory Audit Reason */}
          <Divider orientation="left">Commercial Change Justification (Required)</Divider>

          <Form.Item
            name="changeReason"
            label="Reason for Price Configuration or Revision"
            tooltip="Mandatory business explanation recorded immutably in the pricing audit trail per Business Decision #33."
            rules={[
              { required: true, message: 'A change justification reason is mandatory' },
              {
                validator: (_, val) => {
                  if (!val || val.trim().length === 0) {
                    return Promise.reject(
                      new Error('Change reason cannot be empty or whitespace only'),
                    );
                  }
                  if (val.trim().length > 500) {
                    return Promise.reject(new Error('Change reason cannot exceed 500 characters'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra={
              <div style={{ textAlign: 'right' }}>
                <Typography.Text type={watchedChangeReason.length > 500 ? 'danger' : 'secondary'}>
                  {watchedChangeReason.length}/500 characters
                </Typography.Text>
              </div>
            }
          >
            <Input.TextArea
              rows={3}
              placeholder="e.g. Revised wholesale slabs based on revised vendor supplier contract"
              maxLength={500}
              aria-label="Price change reason textarea"
            />
          </Form.Item>
        </Form>
      </Space>
    </Drawer>
  );
}
