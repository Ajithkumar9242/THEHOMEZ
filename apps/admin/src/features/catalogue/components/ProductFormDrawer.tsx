import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ReloadOutlined,
  BarcodeOutlined,
  CheckOutlined,
  ColumnWidthOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  CANONICAL_SKU_REGEX,
  DECIMAL_STRING_REGEX,
  MAX_ALLOWED_QUANTITY_PRECISION,
  PRODUCT_SLUG_REGEX,
  type ICategoryTreeItem,
  type ICreateProductDto,
  type IProduct,
  type IUnit,
  type IUpdateProductDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { productClient } from '../api/product-client.js';
import { getCategories, getUnits } from '../api/catalogue-lookups.js';
import { ProductImageUploader } from './ProductImageUploader.js';
import { SpecificationEditor } from './SpecificationEditor.js';

export interface ProductFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  product?: IProduct | null;
  onClose: () => void;
  onSuccess: (product: IProduct) => void;
}

interface FormValues {
  title: string;
  brand: string;
  slug?: string;
  description?: string;
  categoryId: string;
  subcategoryId: string;
  hasVariants?: boolean;
  sku?: string;
  unitCode?: string;
  quantityPrecision?: number;
  minOrderQuantity?: string;
  maxOrderQuantity?: string;
  stepIncrement?: string;
}

export function ProductFormDrawer({
  open,
  mode,
  product,
  onClose,
  onSuccess,
}: ProductFormDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ICategoryTreeItem[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [units, setUnits] = useState<IUnit[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [specifications, setSpecifications] = useState<Record<string, string>>({});

  const watchedCategoryId = Form.useWatch('categoryId', form);
  const watchedHasVariants = Form.useWatch('hasVariants', form);
  const watchedUnitCode = Form.useWatch('unitCode', form);

  // Load categories with retry and error reporting
  const loadCategories = useCallback((signal?: AbortSignal) => {
    setLoadingCategories(true);
    setCategoryError(null);

    return getCategories(signal)
      .then((res) => {
        if (!signal?.aborted) {
          setCategories(res.tree);
          setCategoryError(null);
        }
      })
      .catch((err: unknown) => {
        if (signal?.aborted) return;
        if (err instanceof ApiError) {
          setCategoryError(`${err.message} (${err.code})`);
        } else if (err instanceof Error) {
          setCategoryError(err.message);
        } else {
          setCategoryError('Failed to load categories. Please check connection and try again.');
        }
      })
      .finally(() => {
        if (!signal?.aborted) setLoadingCategories(false);
      });
  }, []);

  // Load categories and units on open
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    void loadCategories(controller.signal);

    void getUnits(controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setUnits(res);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [open, loadCategories]);

  // Populate or reset form values
  useEffect(() => {
    if (!open) {
      form.resetFields();
      setImages([]);
      setSpecifications({});
      setSubmitError(null);
      return;
    }

    setSubmitError(null);

    if (mode === 'edit' && product) {
      form.setFieldsValue({
        title: product.title,
        brand: product.brand,
        slug: product.slug,
        description: product.description || '',
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
        hasVariants: product.hasVariants,
        sku: product.sku || '',
        unitCode: product.unitCode || undefined,
        quantityPrecision:
          product.quantityPrecision !== null && product.quantityPrecision !== undefined
            ? product.quantityPrecision
            : undefined,
        minOrderQuantity: product.minOrderQuantity || '',
        maxOrderQuantity: product.maxOrderQuantity || '',
        stepIncrement: product.stepIncrement || '',
      });
      setImages(product.images || []);
      setSpecifications(product.specifications || {});
    } else {
      form.setFieldsValue({
        title: '',
        brand: '',
        slug: '',
        description: '',
        categoryId: '',
        subcategoryId: '',
        hasVariants: false,
        sku: '',
        unitCode: undefined,
        quantityPrecision: 0,
        minOrderQuantity: '1',
        maxOrderQuantity: '',
        stepIncrement: '1',
      });
      setImages([]);
      setSpecifications({});
    }
  }, [open, mode, product, form]);

  // Selected root category object
  const selectedRootCategory = useMemo(() => {
    if (!watchedCategoryId) return null;
    return categories.find((c) => c.id === watchedCategoryId) || null;
  }, [categories, watchedCategoryId]);

  // Calculate available subcategories strictly from selected root
  const subcategories = useMemo(() => {
    return selectedRootCategory?.subcategories || [];
  }, [selectedRootCategory]);

  // Synchronize and auto-clear subcategory if root changes or selected sub does not belong to root
  useEffect(() => {
    if (!watchedCategoryId) {
      if (form.getFieldValue('subcategoryId')) {
        form.setFieldValue('subcategoryId', '');
      }
      return;
    }
    const currentSub = form.getFieldValue('subcategoryId');
    if (currentSub && !subcategories.some((s) => s.id === currentSub)) {
      form.setFieldValue('subcategoryId', '');
    }
  }, [watchedCategoryId, subcategories, form]);

  // Selected unit details
  const selectedUnit = useMemo(() => {
    if (!watchedUnitCode) return null;
    return units.find((u) => u.code === watchedUnitCode) || null;
  }, [units, watchedUnitCode]);

  // Handle unit selection change to adjust default precision
  const handleUnitChange = (code: string) => {
    const unit = units.find((u) => u.code === code);
    if (unit?.isDiscrete) {
      form.setFieldValue('quantityPrecision', 0);
    }
  };

  const isPublished = mode === 'edit' && product?.publishedAt !== null;

  const handleSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const cleanSlug = values.slug?.trim() ? values.slug.trim().toLowerCase() : undefined;
      const cleanDesc = values.description?.trim() ? values.description.trim() : undefined;
      const cleanSku = values.sku?.trim() ? values.sku.trim().toUpperCase() : undefined;

      const hasVariants =
        mode === 'edit' ? Boolean(product?.hasVariants) : Boolean(values.hasVariants);

      if (mode === 'create') {
        const createDto: ICreateProductDto = {
          title: values.title.trim(),
          brand: values.brand.trim(),
          categoryId: values.categoryId,
          subcategoryId: values.subcategoryId,
          hasVariants,
          ...(cleanSlug ? { slug: cleanSlug } : {}),
          ...(cleanDesc ? { description: cleanDesc } : {}),
          ...(cleanSku ? { sku: cleanSku } : {}),
          images,
          specifications,
        };

        if (!hasVariants && values.unitCode) {
          createDto.unitCode = values.unitCode.trim().toUpperCase();
          if (values.quantityPrecision !== undefined) {
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
        }

        const created = await productClient.create(createDto);
        onSuccess(created);
        onClose();
      } else if (mode === 'edit' && product) {
        const updateDto: IUpdateProductDto = {
          title: values.title.trim(),
          brand: values.brand.trim(),
          categoryId: values.categoryId,
          subcategoryId: values.subcategoryId,
          description: cleanDesc || '',
          images,
          specifications,
        };

        if (cleanSlug && cleanSlug !== product.slug) {
          updateDto.slug = cleanSlug;
        }

        // Only send SKU if it's draft and changed or cleared
        if (!isPublished) {
          updateDto.sku = cleanSku;
        }

        // Unit updates (for standalone products)
        if (!product.hasVariants) {
          if (!isPublished) {
            if (values.unitCode) {
              updateDto.unitCode = values.unitCode.trim().toUpperCase();
            }
            if (values.quantityPrecision !== undefined) {
              updateDto.quantityPrecision = values.quantityPrecision;
            }
          }
          if (values.minOrderQuantity !== undefined) {
            updateDto.minOrderQuantity = values.minOrderQuantity.trim() || undefined;
          }
          if (values.maxOrderQuantity !== undefined) {
            updateDto.maxOrderQuantity = values.maxOrderQuantity?.trim() || null;
          }
          if (values.stepIncrement !== undefined) {
            updateDto.stepIncrement = values.stepIncrement.trim() || undefined;
          }
        }

        const updated = await productClient.update(product.id, updateDto);
        onSuccess(updated);
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to save product. Please verify fields and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={mode === 'create' ? 'Create Product Draft' : `Edit Product: ${product?.title}`}
      open={open}
      onClose={onClose}
      width={740}
      destroyOnClose
      maskClosable={!submitting}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '4px 0' }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={submitting || isUploadingImages}
            onClick={() => form.submit()}
            icon={<CheckOutlined />}
            title={isUploadingImages ? 'Please wait for image uploads to complete' : undefined}
          >
            {isUploadingImages
              ? 'Uploading Images...'
              : mode === 'create'
                ? 'Create Draft'
                : 'Save Changes'}
          </Button>
        </div>
      }
      extra={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={submitting || isUploadingImages}
            onClick={() => form.submit()}
            aria-label="Save product button"
            title={isUploadingImages ? 'Please wait for image uploads to complete' : undefined}
          >
            {isUploadingImages
              ? 'Uploading Images...'
              : mode === 'create'
                ? 'Create Draft'
                : 'Save Changes'}
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

        <Card
          title={
            <Space size={8}>
              <InfoCircleOutlined style={{ color: '#8b2626' }} />
              <span>1. Basic Information</span>
            </Space>
          }
          variant="borderless"
          style={{ marginBottom: 16 }}
        >
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="title"
                label="Product Title"
                rules={[
                  { required: true, message: 'Product title is required' },
                  { max: 200, message: 'Title cannot exceed 200 characters' },
                ]}
              >
                <Input placeholder="e.g. UltraTech Super Cement 50kg" maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="brand"
                label="Brand"
                rules={[
                  { required: true, message: 'Brand is required' },
                  { max: 100, message: 'Brand cannot exceed 100 characters' },
                ]}
              >
                <Input placeholder="e.g. UltraTech, Tata Steel" maxLength={100} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="slug"
                label="Custom Slug"
                extra="Leave empty for backend automatic slug generation from title."
                rules={[
                  {
                    pattern: PRODUCT_SLUG_REGEX,
                    message:
                      'Slug must be lowercase alphanumeric words separated by single hyphens',
                  },
                  { max: 100, message: 'Slug cannot exceed 100 characters' },
                ]}
              >
                <Input placeholder="e.g. ultratech-super-cement-50kg" maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="hasVariants"
                label="Product Structure"
                extra={
                  mode === 'edit'
                    ? 'Product structure cannot be changed after creation.'
                    : 'Choose whether this product has variants or is a standalone item.'
                }
              >
                {mode === 'edit' ? (
                  <Tag
                    color={product?.hasVariants ? 'blue' : 'default'}
                    style={{ fontSize: 13, padding: '4px 8px' }}
                  >
                    {product?.hasVariants ? 'Multi-Variant Container' : 'Standalone Single Product'}
                  </Tag>
                ) : (
                  <Radio.Group>
                    <Radio value={false}>Standalone Product</Radio>
                    <Radio value={true}>Multi-Variant Container</Radio>
                  </Radio.Group>
                )}
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="Description"
            rules={[{ max: 2000, message: 'Description cannot exceed 2000 characters' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="Detailed description of the product and its construction use cases..."
              maxLength={2000}
              showCount
            />
          </Form.Item>
        </Card>

        {/* Taxonomy & Categorization Section */}
        <Card
          title={
            <Space size={8}>
              <FolderOutlined style={{ color: '#8b2626' }} />
              <span>2. Taxonomy & Categorization</span>
            </Space>
          }
          variant="borderless"
          style={{ marginBottom: 16 }}
          extra={
            categoryError ? (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void loadCategories()}
                loading={loadingCategories}
              >
                Retry Loading
              </Button>
            ) : null
          }
        >
          {categoryError && (
            <Alert
              type="error"
              showIcon
              closable
              message="Category Synchronization Failed"
              description={
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <Typography.Text type="secondary">{categoryError}</Typography.Text>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ReloadOutlined />}
                    onClick={() => void loadCategories()}
                    loading={loadingCategories}
                  >
                    Retry Categories
                  </Button>
                </Space>
              }
              style={{ marginBottom: 16 }}
              onClose={() => setCategoryError(null)}
            />
          )}

          {!loadingCategories && !categoryError && categories.length === 0 && (
            <Alert
              type="warning"
              showIcon
              message="No Categories Configured"
              description="Category setup is a prerequisite before creating products. Please define Root Categories and Subcategories in Category Management before creating product catalogue entries."
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="categoryId"
                label="Root Category"
                rules={[
                  { required: true, message: 'Root category is required' },
                  {
                    validator: async (_, value) => {
                      if (!value) return Promise.resolve();
                      const exists = categories.some((c) => c.id === value);
                      if (!exists && categories.length > 0) {
                        return Promise.reject(
                          new Error('Selected root category does not exist in the taxonomy'),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Select
                  placeholder={loadingCategories ? 'Loading categories...' : 'Select root category'}
                  loading={loadingCategories}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  notFoundContent={
                    loadingCategories
                      ? 'Loading categories...'
                      : categories.length === 0
                        ? 'No root categories found. Category setup required.'
                        : 'No matching categories'
                  }
                  onChange={() => {
                    form.setFieldValue('subcategoryId', '');
                  }}
                  options={categories.map((c) => ({
                    value: c.id,
                    label: c.isActive ? c.name : `${c.name} (Draft only - Inactive)`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="subcategoryId"
                label="Subcategory"
                extra={
                  watchedCategoryId && selectedRootCategory && subcategories.length === 0
                    ? 'Selected root has no subcategories. Subcategories are required.'
                    : undefined
                }
                rules={[
                  { required: true, message: 'Subcategory is required' },
                  {
                    validator: async (_, value) => {
                      if (!value) return Promise.resolve();
                      if (!watchedCategoryId) {
                        return Promise.reject(new Error('Select a root category first'));
                      }
                      const valid = subcategories.some((s) => s.id === value);
                      if (!valid) {
                        return Promise.reject(
                          new Error(
                            'Selected subcategory does not belong to the selected root category',
                          ),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Select
                  placeholder={
                    !watchedCategoryId
                      ? 'Select root category first'
                      : subcategories.length === 0
                        ? 'No subcategories in this category'
                        : 'Select subcategory'
                  }
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  disabled={!watchedCategoryId || subcategories.length === 0}
                  notFoundContent={
                    !watchedCategoryId
                      ? 'Select a root category first'
                      : subcategories.length === 0
                        ? 'No subcategories available in selected category'
                        : 'No matching subcategories'
                  }
                  options={subcategories.map((s) => ({
                    value: s.id,
                    label: s.isActive ? s.name : `${s.name} (Draft only - Inactive)`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* SKU Governance */}
        <Card
          title={
            <Space size={8}>
              <BarcodeOutlined style={{ color: '#8b2626' }} />
              <span>3. SKU Governance</span>
            </Space>
          }
          variant="borderless"
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="sku"
            label="Canonical SKU"
            extra={
              isPublished
                ? 'SKU is permanently immutable once published.'
                : 'Leave blank to use backend auto-generation (THZ-P-...). Must be 4–64 characters alphanumeric.'
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
              placeholder="e.g. THZ-P-CEMENT-50KG (optional)"
              disabled={isPublished || (mode === 'edit' && Boolean(product?.hasVariants))}
              maxLength={64}
              onChange={(e) => form.setFieldValue('sku', e.target.value.toUpperCase())}
            />
          </Form.Item>
        </Card>

        {/* Unit Configuration (Standalone products only) */}
        {watchedHasVariants ? (
          <Card
            title={
              <Space size={8}>
                <ColumnWidthOutlined style={{ color: '#8b2626' }} />
                <span>4. Unit & Quantity Configuration</span>
              </Space>
            }
            variant="borderless"
            style={{ marginBottom: 16 }}
          >
            <Alert
              type="info"
              showIcon
              message="Variant-Level Configuration"
              description="Multi-variant parent products do not hold standalone unit configurations. Each child variant manages its own unit of measurement, precision, and order quantity limits."
            />
          </Card>
        ) : (
          <Card
            title={
              <Space size={8}>
                <ColumnWidthOutlined style={{ color: '#8b2626' }} />
                <span>4. Unit & Quantity Configuration</span>
              </Space>
            }
            variant="borderless"
            style={{ marginBottom: 16 }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="unitCode"
                  label="Unit of Measurement"
                  extra={
                    isPublished
                      ? 'Unit code is immutable after initial publication.'
                      : 'Required to publish product.'
                  }
                >
                  <Select
                    placeholder="Select construction unit"
                    showSearch
                    optionFilterProp="label"
                    disabled={isPublished}
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
                    isPublished
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
                    disabled={isPublished || selectedUnit?.isDiscrete}
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
                      pattern: DECIMAL_STRING_REGEX,
                      message: 'Must be a valid decimal string without exponents',
                    },
                  ]}
                >
                  <Input placeholder="1" maxLength={15} />
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
                        if (!DECIMAL_STRING_REGEX.test(val.trim())) {
                          return Promise.reject(new Error('Must be a valid decimal string'));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input placeholder="e.g. 500 (optional)" maxLength={15} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="stepIncrement"
                  label="Step Increment"
                  extra="Quantity increment step"
                  rules={[
                    {
                      pattern: DECIMAL_STRING_REGEX,
                      message: 'Must be a valid decimal string without exponents',
                    },
                  ]}
                >
                  <Input placeholder="1" maxLength={15} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        )}

        {/* Product Media & Gallery */}
        <Card
          title={
            <Space size={8}>
              <PictureOutlined style={{ color: '#8b2626' }} />
              <span>5. Product Media & Gallery</span>
            </Space>
          }
          variant="borderless"
          style={{ marginBottom: 16 }}
        >
          <ProductImageUploader
            value={images}
            onChange={setImages}
            onUploadingChange={setIsUploadingImages}
          />
        </Card>

        {/* Specifications */}
        <Card
          title={
            <Space size={8}>
              <UnorderedListOutlined style={{ color: '#8b2626' }} />
              <span>6. Product Specifications</span>
            </Space>
          }
          variant="borderless"
          style={{ marginBottom: 16 }}
        >
          <SpecificationEditor value={specifications} onChange={setSpecifications} />
        </Card>
      </Form>
    </Drawer>
  );
}
