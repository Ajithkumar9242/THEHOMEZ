import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { IProduct } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { productClient } from '../api/product-client.js';

export type ProductLifecycleAction = 'publish' | 'deactivate' | 'archive' | 'delete';

export interface ProductLifecycleModalProps {
  open: boolean;
  action: ProductLifecycleAction | null;
  product: IProduct | null;
  onClose: () => void;
  onSuccess: (product?: IProduct) => void;
}

export function ProductLifecycleModal({
  open,
  action,
  product,
  onClose,
  onSuccess,
}: ProductLifecycleModalProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setArchiveConfirmed(false);
      setSubmitting(false);
    }
  }, [open]);

  if (!product || !action) return null;

  const handleExecute = async () => {
    try {
      setSubmitting(true);
      setError(null);

      if (action === 'publish') {
        const updated = await productClient.publish(product.id);
        onSuccess(updated);
        onClose();
      } else if (action === 'deactivate') {
        const updated = await productClient.deactivate(product.id);
        onSuccess(updated);
        onClose();
      } else if (action === 'archive') {
        const updated = await productClient.archive(product.id);
        onSuccess(updated);
        onClose();
      } else if (action === 'delete') {
        await productClient.deleteDraft(product.id);
        onSuccess();
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError({ message: err.message, code: err.code });
      } else if (err instanceof Error) {
        setError({ message: err.message });
      } else {
        setError({ message: 'Lifecycle operation failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isPricingError =
    error?.code === 'CANNOT_PUBLISH_UNPRICED_PRODUCT' ||
    error?.code === 'CANNOT_PUBLISH_PRODUCT_WITH_UNPRICED_VARIANTS' ||
    error?.message?.toLowerCase().includes('pricing');

  const titles: Record<ProductLifecycleAction, string> = {
    publish: `Publish Product: ${product.title}`,
    deactivate: `Deactivate Product: ${product.title}`,
    archive: `Archive Product: ${product.title}`,
    delete: `Delete Draft Product: ${product.title}`,
  };

  return (
    <Modal
      title={
        <Space>
          {action === 'publish' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
          {action === 'deactivate' && <WarningOutlined style={{ color: '#faad14' }} />}
          {action === 'archive' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          {action === 'delete' && <DeleteOutlined style={{ color: '#ff4d4f' }} />}
          <span>{titles[action]}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      transitionName=""
      maskTransitionName=""
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            danger={action === 'archive' || action === 'delete'}
            loading={submitting}
            disabled={action === 'archive' && !archiveConfirmed}
            onClick={handleExecute}
            aria-label={`Confirm ${action} button`}
          >
            {action === 'publish' && 'Confirm Publication'}
            {action === 'deactivate' && 'Confirm Deactivation'}
            {action === 'archive' && 'Permanently Archive'}
            {action === 'delete' && 'Delete Draft Permanently'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 8 }}>
        {action === 'publish' && (
          <>
            <Typography.Paragraph>
              Publishing will transition this product to <strong>ACTIVE</strong> and make it visible
              on the public storefront.
            </Typography.Paragraph>
            <Alert
              type="info"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message="Publication Prerequisites"
              description={
                <ul style={{ paddingLeft: 18, marginBottom: 0, marginTop: 4 }}>
                  <li>Both root category and subcategory must be active.</li>
                  <li>At least one image URL must be provided.</li>
                  {product.hasVariants ? (
                    <>
                      <li>Multi-variant container must have at least one active variant.</li>
                      <li>All active variants must have complete unit configurations.</li>
                      <li>
                        All active variants must have active global B2C pricing configured (&gt; 0).
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        Complete unit configuration (unit code, precision, MOQ, step increment) is
                        required.
                      </li>
                      <li>
                        An active global B2C pricing record (&gt; 0) must be configured in the
                        Pricing Browser.
                      </li>
                    </>
                  )}
                </ul>
              }
            />
          </>
        )}

        {action === 'deactivate' && (
          <>
            <Typography.Paragraph>
              Deactivating this product will transition it to <strong>INACTIVE</strong>.
            </Typography.Paragraph>
            <Alert
              type="warning"
              showIcon
              message="Storefront Visibility"
              description="The product will immediately disappear from public storefront search and discovery. All variants, pricing configurations, and historical audit stamps remain preserved."
            />
          </>
        )}

        {action === 'archive' && (
          <>
            <Alert
              type="error"
              showIcon
              message="Irreversible Permanent Action"
              description="Archiving a product is terminal and irreversible. Once archived, the product cannot be re-activated, edited, or published again."
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              In accordance with data governance rules, this operation will atomically:
            </Typography.Paragraph>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: '#595959' }}>
              <li>Permanently archive all child variants.</li>
              <li>Mark all associated SKU registry entries as ARCHIVED.</li>
              <li>Deactivate all associated pricing records with PriceHistory audit trails.</li>
              <li>Cascade partner availability records to unavailable.</li>
            </ul>
            <div style={{ marginTop: 12 }}>
              <Checkbox
                checked={archiveConfirmed}
                onChange={(e) => setArchiveConfirmed(e.target.checked)}
                aria-label="Confirm permanent archival checkbox"
              >
                <Typography.Text strong>
                  I understand that archiving this product is permanent and cannot be undone.
                </Typography.Text>
              </Checkbox>
            </div>
          </>
        )}

        {action === 'delete' && (
          <>
            <Alert
              type="error"
              showIcon
              message="Permanent Draft Deletion"
              description="This will permanently delete this unpublished draft product from the database. Any reserved SKUs will be released back to the pool."
            />
            <Typography.Paragraph type="secondary">
              Eligible only because this product has status <strong>DRAFT</strong> and has never
              been published.
            </Typography.Paragraph>
          </>
        )}

        {error && (
          <Alert
            type="error"
            showIcon
            message={error.code ? `Operation Failed: ${error.code}` : 'Operation Failed'}
            description={
              <div>
                <Typography.Paragraph style={{ marginBottom: isPricingError ? 8 : 0 }}>
                  {error.message}
                </Typography.Paragraph>
                {isPricingError && !product.hasVariants && (
                  <Button
                    type="primary"
                    icon={<DollarOutlined />}
                    onClick={() => {
                      onClose();
                      navigate(`/catalogue/products/${encodeURIComponent(product.id)}/pricing`);
                    }}
                  >
                    Open Pricing Browser to Configure Pricing
                  </Button>
                )}
              </div>
            }
          />
        )}
      </Space>
    </Modal>
  );
}
