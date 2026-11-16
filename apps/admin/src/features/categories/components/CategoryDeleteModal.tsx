import { useState } from 'react';
import { Alert, Button, Modal, Space, Typography } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';
import { categoryClient } from '../api/category-client.js';

export interface CategoryDeleteModalProps {
  open: boolean;
  category: { id: string; name: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function CategoryDeleteModal({
  open,
  category,
  onClose,
  onSuccess,
}: CategoryDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (isDeleting) return;
    setError(null);
    onClose();
  };

  const handleDelete = async () => {
    if (!category) return;
    try {
      setIsDeleting(true);
      setError(null);
      await categoryClient.delete(category.id);
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.code === 'CATEGORY_HAS_PRODUCTS') {
          setError(
            'Cannot delete category: products in the catalogue are currently referencing it. Please deactivate the category or reassign products first.',
          );
        } else if (err.status === 400 && err.code === 'CATEGORY_HAS_CHILDREN') {
          setError(
            'Cannot delete category: child subcategories exist under it. Please reassign or delete subcategories first.',
          );
        } else {
          setError(err.message || 'Deletion failed. The category could not be deleted.');
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not delete category. Try again.');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
          <span>Delete "{category?.name || 'Category'}"?</span>
        </Space>
      }
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={isDeleting}>
          Cancel
        </Button>,
        <Button key="delete" danger type="primary" loading={isDeleting} onClick={handleDelete}>
          Delete category
        </Button>,
      ]}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      maskClosable={!isDeleting}
    >
      {error && (
        <Alert
          type="error"
          showIcon
          role="alert"
          message="Deletion rejected"
          description={error}
          style={{ marginBottom: 16 }}
        />
      )}

      <Typography.Paragraph>
        Are you sure you want to permanently delete <strong>{category?.name}</strong>?
      </Typography.Paragraph>

      <Alert
        type="warning"
        showIcon
        message="This action is permanent and cannot be undone."
        description="If any active or draft products in the catalogue reference this category, the deletion will be rejected by the backend to preserve referential integrity."
      />
    </Modal>
  );
}
