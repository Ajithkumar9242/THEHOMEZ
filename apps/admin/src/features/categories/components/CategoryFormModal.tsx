import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  CATEGORY_SLUG_REGEX,
  MAX_CATEGORY_DESC_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_SLUG_LENGTH,
  type ICategory,
  type ICategorySubcategoryItem,
  type ICategoryTreeItem,
  type ICreateCategoryDto,
  type IUpdateCategoryDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { categoryClient, slugify } from '../api/category-client.js';

export interface CategoryFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  category?: ICategory | ICategoryTreeItem | ICategorySubcategoryItem | null;
  initialParentId?: string | null;
  rootCategories: Array<{ id: string; name: string }>;
  hasChildren?: boolean;
  onClose: () => void;
  onSuccess: (category: ICategory) => void;
}

interface FormValues {
  name: string;
  slug?: string;
  parentId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  description?: string;
}

export function CategoryFormModal({
  open,
  mode,
  category,
  initialParentId,
  rootCategories,
  hasChildren = false,
  onClose,
  onSuccess,
}: CategoryFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const selectedParentId = Form.useWatch('parentId', form);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setError(null);
      setSlugTouched(false);
      return;
    }

    setError(null);
    setSlugTouched(false);

    if (mode === 'edit' && category) {
      form.setFieldsValue({
        name: category.name,
        slug: category.slug,
        parentId: category.parentId || '',
        displayOrder: category.displayOrder ?? 0,
        isActive: category.isActive ?? true,
        description: category.description || '',
      });
    } else {
      form.setFieldsValue({
        name: '',
        slug: '',
        parentId: initialParentId || '',
        displayOrder: 0,
        isActive: true,
        description: '',
      });
    }
  }, [open, mode, category, initialParentId, form]);

  const handleSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      setError(null);

      const trimmedName = (values.name || '').trim();
      if (!trimmedName) {
        setError('Please enter category name');
        setSubmitting(false);
        return;
      }
      const resolvedSlug = (values.slug || '').trim().toLowerCase() || slugify(trimmedName);

      if (resolvedSlug.length < 2) {
        setError('Slug must be at least 2 characters');
        setSubmitting(false);
        return;
      }
      if (resolvedSlug.length > MAX_CATEGORY_SLUG_LENGTH) {
        setError(`Slug cannot exceed ${MAX_CATEGORY_SLUG_LENGTH} characters`);
        setSubmitting(false);
        return;
      }
      if (!CATEGORY_SLUG_REGEX.test(resolvedSlug)) {
        setError(
          'Slug must consist of lowercase alphanumeric words separated by single hyphens (e.g. "building-materials")',
        );
        setSubmitting(false);
        return;
      }

      const parentId = values.parentId && values.parentId.trim() ? values.parentId.trim() : null;

      if (mode === 'create') {
        const payload: ICreateCategoryDto = {
          name: trimmedName,
          slug: resolvedSlug,
          parentId,
          displayOrder: Number(values.displayOrder) || 0,
          isActive: values.isActive ?? true,
          description: values.description?.trim() || undefined,
        };

        const result = await categoryClient.create(payload);
        onSuccess(result.category);
        onClose();
      } else if (mode === 'edit' && category) {
        const payload: IUpdateCategoryDto = {
          name: trimmedName,
          slug: resolvedSlug !== category.slug ? resolvedSlug : undefined,
          parentId: parentId !== (category.parentId || null) ? parentId : undefined,
          displayOrder: Number(values.displayOrder) || 0,
          isActive: values.isActive ?? true,
          description:
            values.description !== undefined ? values.description.trim() || undefined : undefined,
        };

        const result = await categoryClient.update(category.id, payload);
        onSuccess(result.category);
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('A category with this URL slug already exists. Please choose a unique slug.');
        } else {
          setError(err.message || 'Operation failed. Please check form values.');
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not save category. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    mode === 'create'
      ? selectedParentId
        ? 'Add Subcategory'
        : 'Add Category'
      : `Edit "${category?.name || 'Category'}"`;

  return (
    <Modal
      open={open}
      title={title}
      onCancel={submitting ? undefined : onClose}
      footer={null}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      maskClosable={!submitting}
    >
      {error && (
        <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} />
      )}

      <div style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary" style={{ marginRight: 8 }}>
          Hierarchy Level:
        </Typography.Text>
        {selectedParentId ? (
          <Tag color="purple">Subcategory (Level 1)</Tag>
        ) : (
          <Tag color="blue">Root Category (Level 0)</Tag>
        )}
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        onFinishFailed={(errInfo) => {
          const firstErr = errInfo.errorFields[0]?.errors[0];
          if (firstErr) setError(firstErr);
        }}
        disabled={submitting}
        requiredMark="optional"
      >
        <Form.Item
          name="name"
          label="Category Name"
          rules={[
            { required: true, whitespace: true, message: 'Please enter category name' },
            {
              max: MAX_CATEGORY_NAME_LENGTH,
              message: `Name cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters`,
            },
          ]}
        >
          <Input
            placeholder="e.g. Building Materials"
            aria-label="Category name"
            onChange={(e) => {
              if (mode === 'create' && !slugTouched) {
                form.setFieldValue('slug', slugify(e.target.value));
              }
            }}
          />
        </Form.Item>

        <Form.Item
          name="slug"
          label="URL Slug"
          extra="Optional. Lowercase alphanumeric words separated by single hyphens. If omitted, generated automatically from name."
          rules={[
            {
              validator: async (_, value) => {
                if (!value) return;
                const trimmed = String(value).trim().toLowerCase();
                if (trimmed.length < 2) throw new Error('Slug must be at least 2 characters');
                if (trimmed.length > MAX_CATEGORY_SLUG_LENGTH) {
                  throw new Error(`Slug cannot exceed ${MAX_CATEGORY_SLUG_LENGTH} characters`);
                }
                if (!CATEGORY_SLUG_REGEX.test(trimmed)) {
                  throw new Error(
                    'Slug must consist of lowercase alphanumeric words separated by single hyphens',
                  );
                }
              },
            },
          ]}
        >
          <Input
            placeholder="e.g. building-materials"
            aria-label="Category slug"
            onChange={() => setSlugTouched(true)}
          />
        </Form.Item>

        <Form.Item
          name="parentId"
          label="Parent Category"
          extra={
            mode === 'edit' && hasChildren
              ? 'This root category has subcategories and cannot be converted into a subcategory.'
              : 'Select a root category to nest as a Subcategory (Level 1), or select None to create a Root Category (Level 0).'
          }
        >
          <Select
            allowClear
            aria-label="Parent category"
            placeholder="None (Root Category)"
            disabled={mode === 'edit' && hasChildren}
            options={[
              { value: '', label: 'None (Root Category)' },
              ...rootCategories
                .filter((r) => r.id !== category?.id)
                .map((r) => ({ value: r.id, label: `${r.name} (Root Category)` })),
            ]}
          />
        </Form.Item>

        <Form.Item
          name="displayOrder"
          label="Display Order"
          extra="Non-negative integer controlling relative sort order in listings."
          rules={[
            {
              type: 'number',
              min: 0,
              max: 100000,
              message: 'Display order must be between 0 and 100,000',
            },
          ]}
        >
          <InputNumber min={0} max={100000} style={{ width: '100%' }} aria-label="Display order" />
        </Form.Item>

        <Form.Item
          name="isActive"
          label="Active Status"
          valuePropName="checked"
          extra="Inactive categories are excluded from public storefront discovery."
        >
          <Switch
            checkedChildren="Active"
            unCheckedChildren="Inactive"
            aria-label="Active status"
          />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
          rules={[
            {
              max: MAX_CATEGORY_DESC_LENGTH,
              message: `Description cannot exceed ${MAX_CATEGORY_DESC_LENGTH} characters`,
            },
          ]}
        >
          <Input.TextArea
            rows={3}
            placeholder="Optional description of this category and its items"
            maxLength={MAX_CATEGORY_DESC_LENGTH}
            showCount
            aria-label="Category description"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {mode === 'create' ? 'Create category' : 'Save changes'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}
