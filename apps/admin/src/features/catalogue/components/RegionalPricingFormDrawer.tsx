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
  Select,
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
  EnvironmentOutlined,
} from '@ant-design/icons';
import {
  MAX_B2B_VOLUME_TIERS,
  PermissionCode,
  type IB2BVolumeTier,
  type IProductPricing,
  type IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { pricingClient, type SetRegionalPricingPayload } from '../api/pricing-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import {
  paiseToRupeeString,
  parseRupeesToPaise,
  RUPEE_STRING_REGEX,
} from '../utils/money-utils.js';
import { validateVolumeTiers, type UnitRules } from '../utils/quantity-utils.js';

export interface RegionalPricingFormDrawerProps {
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
  existingRegionalRecords?: IProductPricing[];
  onClose: () => void;
  onSuccess: (pricing: IProductPricing) => void;
  onReloadLatest?: () => void;
}

interface RegionalFormValues {
  serviceAreaId: string;
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

export function RegionalPricingFormDrawer({
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
  existingRegionalRecords = [],
  onClose,
  onSuccess,
  onReloadLatest,
}: RegionalPricingFormDrawerProps) {
  const { user } = useAuth();
  const canWrite = user?.permissions.includes(PermissionCode.PRICING_WRITE) ?? false;
  const canReadAreas = user?.permissions.includes(PermissionCode.SERVICE_AREA_READ) ?? false;

  const [form] = Form.useForm<RegionalFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);

  // Service Areas State
  const [serviceAreas, setServiceAreas] = useState<IServiceArea[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [selectedAreaDetails, setSelectedAreaDetails] = useState<IServiceArea | null>(null);

  // Volume Tiers Builder State
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [tierError, setTierError] = useState<string | null>(null);

  // Watch Form Values for Live Cross-Field Validation & Warnings
  const watchedServiceAreaId = Form.useWatch('serviceAreaId', form);
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

  // Set of serviceAreaIds that already have an override for this product/variant
  const existingOverrideAreaIds = useMemo(() => {
    return new Set(
      existingRegionalRecords.map((r) => r.serviceAreaId).filter((id): id is string => Boolean(id)),
    );
  }, [existingRegionalRecords]);

  // Load Active Service Areas when Drawer Opens
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setTiers([]);
      setTierError(null);
      setSubmitError(null);
      setConcurrencyConflict(false);
      setSelectedAreaDetails(null);
      return;
    }

    setSubmitError(null);
    setTierError(null);
    setConcurrencyConflict(false);

    // Fetch active service areas if user has SERVICE_AREA_READ
    if (canReadAreas && typeof serviceAreaClient.list === 'function') {
      const controller = new AbortController();
      setLoadingAreas(true);
      void serviceAreaClient
        .list({ isActive: true, limit: 100, signal: controller.signal })
        .then((res) => {
          if (!controller.signal.aborted && res?.items) {
            setServiceAreas(res.items);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setLoadingAreas(false);
        });

      return () => controller.abort();
    }
    return undefined;
  }, [open, canReadAreas, form]);

  // Pre-populate Form in Edit Mode or Reset in Create Mode
  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && existingPricing) {
      form.setFieldsValue({
        serviceAreaId: existingPricing.serviceAreaId || '',
        b2cPriceRupees: paiseToRupeeString(existingPricing.b2cPricePaise),
        b2cMrpRupees: paiseToRupeeString(existingPricing.b2cMrpPaise),
        b2bPriceRupees: paiseToRupeeString(existingPricing.b2bPricePaise),
        allowB2bExceedsB2c: false,
        changeReason: '',
      });

      // Populate volume tiers strictly from regional record (Zero-Inheritance)
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

  // Update selected area details when serviceAreaId changes
  useEffect(() => {
    if (!watchedServiceAreaId) {
      setSelectedAreaDetails(null);
      return undefined;
    }
    const found = serviceAreas.find((a) => a.id === watchedServiceAreaId);
    if (found) {
      setSelectedAreaDetails(found);
      return undefined;
    } else if (canReadAreas && typeof serviceAreaClient.get === 'function') {
      const controller = new AbortController();
      void serviceAreaClient
        .get(watchedServiceAreaId, { signal: controller.signal })
        .then((area) => {
          if (!controller.signal.aborted) setSelectedAreaDetails(area);
        })
        .catch(() => undefined);
      return () => controller.abort();
    }
    return undefined;
  }, [watchedServiceAreaId, serviceAreas, canReadAreas]);

  // Clearance warning detection: B2B > B2C
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

  // Tier Management Actions
  const handleAddTier = () => {
    if (tiers.length >= MAX_B2B_VOLUME_TIERS) return;
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

    let values: RegionalFormValues;
    try {
      values = await form.validateFields();
    } catch {
      const fieldErrors = form.getFieldsError();
      const firstError = fieldErrors.find((f) => f.errors.length > 0)?.errors[0];
      setSubmitError(firstError || 'Please correct the validation errors in the form.');
      return;
    }

    const serviceAreaId = (values.serviceAreaId || '').trim();
    if (!serviceAreaId) {
      const msg = 'Service area selection is required for regional pricing';
      form.setFields([{ name: 'serviceAreaId', errors: [msg] }]);
      setSubmitError(msg);
      return;
    }

    // Prevent duplicate service area in create mode
    if (mode === 'create' && existingOverrideAreaIds.has(serviceAreaId)) {
      const msg =
        'A regional pricing override already exists for this service area. Edit the existing record instead of creating a duplicate.';
      form.setFields([{ name: 'serviceAreaId', errors: [msg] }]);
      setSubmitError(msg);
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
          setSubmitError(
            'Wholesale base price exceeds B2C selling price. Check clearance override to confirm this rate.',
          );
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

    // 4. Validate B2B Volume Tiers (Zero-Inheritance: only explicit regional tiers submitted)
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

    // 6. Assemble Regional Payload (Zero-Inheritance: b2bTiers submitted strictly as parsed)
    const parsedTiers: IB2BVolumeTier[] = tiers.map((t) => ({
      minQuantity: t.minQuantity.trim(),
      pricePaise: parseRupeesToPaise(t.priceRupees),
    }));

    const payload: SetRegionalPricingPayload = {
      serviceAreaId,
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

    // 7. Dispatch to Regional API
    setSubmitting(true);
    try {
      const result = variantId
        ? await pricingClient.setVariantRegionalPricing(productId, variantId, payload)
        : await pricingClient.setProductRegionalPricing(productId, payload);

      message.success(
        mode === 'create'
          ? 'Regional price override created successfully.'
          : 'Regional price override updated successfully.',
      );
      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConcurrencyConflict(true);
          setSubmitError(
            'This regional pricing record was modified concurrently by another administrator. Your changes have not been saved.',
          );
        } else if (err.status === 403) {
          setSubmitError('Permission denied: Your staff account lacks PRICING_WRITE permission.');
        } else if (err.status === 400 && err.code === 'SERVICE_AREA_INACTIVE') {
          setSubmitError(
            'The selected service area is inactive and cannot accept regional pricing.',
          );
        } else if (err.status === 404 && err.code === 'SERVICE_AREA_NOT_FOUND') {
          setSubmitError('The selected service area was not found in the catalogue database.');
        } else {
          setSubmitError(err.message || 'Failed to save regional pricing override.');
        }
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('An unexpected network error occurred while communicating with the server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isVariant = Boolean(variantId);
  const targetLabel = isVariant ? 'Variant Regional Override' : 'Product Regional Override';
  const drawerTitle = mode === 'create' ? `Add ${targetLabel}` : `Edit ${targetLabel}`;

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
            {mode === 'create' ? 'Save Regional Override' : 'Update Regional Override'}
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
            description="Your staff account lacks PRICING_WRITE capability. Creating and updating regional pricing overrides is prohibited."
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
                  This regional pricing record was modified by another administrator while you were
                  editing. Your changes have not been saved to prevent overwriting newer data.
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

        {/* Complete Replacement Disclosure */}
        <Alert
          type="info"
          showIcon
          message="Complete Replacement Schedule (Zero-Inheritance)"
          description="Regional pricing completely overrides the global baseline for customer delivery addresses in the target service area. Global MRP, wholesale rates, and volume discount slabs are NOT inherited."
        />

        {/* SECTION A: Target Catalogue Context */}
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
                <Tag>New Override (v1)</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Pricing Scope">
              <Tag color="purple">{isVariant ? 'VARIANT_REGIONAL' : 'STANDALONE_REGIONAL'}</Tag>
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
          {/* SECTION B: Service Area Selection */}
          <Divider orientation="left">Target Service Area</Divider>

          {mode === 'edit' ? (
            <Form.Item
              name="serviceAreaId"
              label="Service Area Reference"
              tooltip="Service area assignment is immutable for existing regional records to preserve database unique index integrity."
            >
              <Input
                disabled
                prefix={<EnvironmentOutlined />}
                aria-label="Regional service area selector"
              />
            </Form.Item>
          ) : canReadAreas ? (
            <Form.Item
              name="serviceAreaId"
              label="Select Active Service Area"
              tooltip="Choose an active geographic service area. Areas with an existing override for this item are disabled to prevent duplicate collisions."
              rules={[{ required: true, message: 'Please select a target service area' }]}
            >
              <Select
                showSearch
                virtual={false}
                placeholder="Search active service areas by name, code or city"
                loading={loadingAreas}
                optionFilterProp="label"
                aria-label="Regional service area selector"
                options={serviceAreas.map((area) => {
                  const alreadyExists = existingOverrideAreaIds.has(area.id);
                  return {
                    value: area.id,
                    disabled: alreadyExists || !area.isActive,
                    label: `${area.name} (${area.code}) · ${area.city}, ${area.state}${alreadyExists ? ' [Override already exists]' : ''}${!area.isActive ? ' [Inactive]' : ''}`,
                  };
                })}
              />
            </Form.Item>
          ) : (
            <Form.Item
              name="serviceAreaId"
              label="Service Area ID (24-char ObjectId)"
              tooltip="Friendly service area names are unavailable (SERVICE_AREA_READ permission missing). Enter the 24-character hexadecimal ObjectId directly."
              rules={[
                { required: true, message: 'Service area ObjectId is required' },
                {
                  pattern: /^[0-9a-fA-F]{24}$/,
                  message: 'Must be a valid 24-character hexadecimal ObjectId',
                },
              ]}
            >
              <Input
                placeholder="e.g. 65b9d3e8f1c2a4b6d7e8f901"
                prefix={<EnvironmentOutlined />}
                aria-label="Regional service area selector"
              />
            </Form.Item>
          )}

          {selectedAreaDetails && (
            <Card
              size="small"
              style={{ background: '#fcf6ff', borderColor: '#d3adf7', marginBottom: 16 }}
            >
              <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Area Name">
                  <strong>{selectedAreaDetails.name}</strong> ({selectedAreaDetails.code})
                </Descriptions.Item>
                <Descriptions.Item label="Location">
                  {selectedAreaDetails.city}, {selectedAreaDetails.state}
                </Descriptions.Item>
                <Descriptions.Item label="Active Status">
                  <Tag color={selectedAreaDetails.isActive ? 'green' : 'default'}>
                    {selectedAreaDetails.isActive ? 'Active' : 'Inactive'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Serviceable PINs">
                  {selectedAreaDetails.pincodes?.length || 0} delivery pincodes
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* SECTION C: B2C Retail Pricing */}
          <Divider orientation="left">Regional B2C Retail Pricing (Consumer)</Divider>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="b2cPriceRupees"
                label="Regional B2C Selling Price (₹ Net)"
                tooltip="The regional retail selling price per unit charged to customers in this service area."
                rules={[
                  { required: true, message: 'Regional B2C selling price is required' },
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 395 or 395.50)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 395.00"
                  size="large"
                  aria-label="Regional B2C selling price input"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="b2cMrpRupees"
                label="Regional B2C MRP (₹ Net)"
                tooltip="Optional printed maximum retail price for this region. If provided, must be >= B2C selling price."
                rules={[
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 450 or 450.00)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 450.00 (Optional)"
                  size="large"
                  aria-label="Regional B2C MRP input"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* SECTION D: B2B Wholesale Pricing */}
          <Divider orientation="left">
            Regional B2B Wholesale Baseline Pricing (Contractors)
          </Divider>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="b2bPriceRupees"
                label="Regional B2B Baseline Rate (₹ Net)"
                tooltip="Baseline net rate per unit for verified trade contractors in this service area. Required if regional volume tiers are added."
                rules={[
                  {
                    pattern: RUPEE_STRING_REGEX,
                    message: 'Enter a valid non-negative rupee amount (e.g. 370 or 370.00)',
                  },
                ]}
              >
                <Input
                  prefix="₹"
                  placeholder="e.g. 370.00 (Optional)"
                  size="large"
                  aria-label="Regional B2B base rate input"
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              {b2bExceedsB2c && (
                <div style={{ marginTop: 28 }}>
                  <Form.Item name="allowB2bExceedsB2c" valuePropName="checked">
                    <Checkbox aria-label="Regional clearance override confirmation checkbox">
                      <Typography.Text type="danger">
                        <WarningOutlined /> Confirm regional wholesale rate exceeds retail rate
                        (Clearance Override)
                      </Typography.Text>
                    </Checkbox>
                  </Form.Item>
                </div>
              )}
            </Col>
          </Row>

          {/* SECTION E: Wholesale Volume Tiers (Zero-Inheritance) */}
          <Divider orientation="left">
            Regional B2B Volume Discount Slabs (Up to {MAX_B2B_VOLUME_TIERS} Slabs)
          </Divider>

          <Alert
            type="info"
            showIcon
            message="Zero-Inheritance Volume Tier Rule"
            description="Global volume tiers are NOT inherited. If you save this regional schedule without volume tiers, contractors in this region will receive no volume discounts."
            style={{ marginBottom: 16 }}
          />

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
                description="No regional volume discount slabs configured. Contractors in this service area will pay the base B2B price for all order quantities."
              >
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={handleAddTier}
                  disabled={unitRulesIncomplete || !canWrite || submitting}
                  aria-label="Add first regional volume slab button"
                >
                  Add Regional Volume Slab
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
                        <Tag color="purple" aria-label={`Slab ${idx + 1} badge`}>
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
                    Add Next Regional Volume Slab ({tiers.length}/{MAX_B2B_VOLUME_TIERS})
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* SECTION F: Mandatory Audit Reason */}
          <Divider orientation="left">Commercial Change Justification (Required)</Divider>

          <Form.Item
            name="changeReason"
            label="Reason for Regional Price Configuration or Revision"
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
              placeholder="e.g. Higher transport surcharge and local freight logistics for coastal delivery region"
              maxLength={500}
              aria-label="Regional price change reason textarea"
            />
          </Form.Item>
        </Form>
      </Space>
    </Drawer>
  );
}
