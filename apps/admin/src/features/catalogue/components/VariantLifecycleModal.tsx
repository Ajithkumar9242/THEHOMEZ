import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PermissionCode, type IProduct, type IProductVariant } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { variantClient } from '../api/variant-client.js';

export type VariantLifecycleAction = 'activate' | 'deactivate' | 'archive';

export interface VariantLifecycleModalProps {
  open: boolean;
  action: VariantLifecycleAction | null;
  parentProduct: IProduct | null;
  variant: IProductVariant | null;
  onClose: () => void;
  onSuccess: (updatedVariant: IProductVariant) => void;
  userPermissions?: string[];
}

const getVariantStatusColor = (status?: string) => {
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

export function VariantLifecycleModal({
  open,
  action,
  parentProduct,
  variant,
  onClose,
  onSuccess,
  userPermissions: overridePermissions,
}: VariantLifecycleModalProps) {
  const navigate = useNavigate();
  const auth = useAuth();
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

  if (!variant || !parentProduct || !action) return null;

  const effectivePermissions: string[] = overridePermissions ?? auth.user?.permissions ?? [];

  // Permission validation
  const hasCatalogWrite = effectivePermissions.includes(PermissionCode.CATALOG_WRITE);
  const hasCatalogPublish = effectivePermissions.includes(PermissionCode.CATALOG_PUBLISH);

  let hasRequiredPermissions = true;
  let missingPermissionMessage = '';

  if (action === 'activate') {
    if (!hasCatalogWrite || !hasCatalogPublish) {
      hasRequiredPermissions = false;
      const missing: string[] = [];
      if (!hasCatalogWrite) missing.push(PermissionCode.CATALOG_WRITE);
      if (!hasCatalogPublish) missing.push(PermissionCode.CATALOG_PUBLISH);
      missingPermissionMessage = `Activating a variant requires ${missing.join(' and ')} permission.`;
    }
  } else if (action === 'deactivate') {
    if (!hasCatalogWrite) {
      hasRequiredPermissions = false;
      missingPermissionMessage = `Deactivating a variant requires ${PermissionCode.CATALOG_WRITE} permission.`;
    }
  } else if (action === 'archive') {
    if (!hasCatalogWrite) {
      hasRequiredPermissions = false;
      missingPermissionMessage = `Archiving a variant requires ${PermissionCode.CATALOG_WRITE} permission.`;
    }
  }

  // Lifecycle state guards
  const isParentArchived = parentProduct.status === 'ARCHIVED';
  const isVariantArchived = variant.status === 'ARCHIVED';
  const isAlreadyActive = action === 'activate' && variant.status === 'ACTIVE';
  const isAlreadyInactive = action === 'deactivate' && variant.status === 'INACTIVE';

  const isBlocked =
    !hasRequiredPermissions ||
    isParentArchived ||
    isVariantArchived ||
    isAlreadyActive ||
    isAlreadyInactive;

  const isConfirmDisabled = submitting || isBlocked || (action === 'archive' && !archiveConfirmed);

  const handleExecute = async () => {
    if (isBlocked || submitting) return;

    try {
      setSubmitting(true);
      setError(null);

      let updatedVariant: IProductVariant;

      if (action === 'activate') {
        updatedVariant = await variantClient.update(parentProduct.id, variant.id, {
          status: 'ACTIVE',
        });
      } else if (action === 'deactivate') {
        updatedVariant = await variantClient.deactivate(parentProduct.id, variant.id);
      } else if (action === 'archive') {
        updatedVariant = await variantClient.archive(parentProduct.id, variant.id);
      } else {
        return;
      }

      onSuccess(updatedVariant);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError({ message: err.message, code: err.code });
      } else if (err instanceof Error) {
        setError({ message: err.message });
      } else {
        setError({ message: 'Variant lifecycle operation failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isUnpricedError =
    error?.code === 'CANNOT_ACTIVATE_UNPRICED_VARIANT' ||
    error?.message?.toLowerCase().includes('pricing');

  const titles: Record<VariantLifecycleAction, string> = {
    activate: `Activate Variant: ${variant.title}`,
    deactivate: `Deactivate Variant: ${variant.title}`,
    archive: `Archive Variant: ${variant.title}`,
  };

  return (
    <Modal
      title={
        <Space>
          {action === 'activate' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
          {action === 'deactivate' && <WarningOutlined style={{ color: '#faad14' }} />}
          {action === 'archive' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          <span>{titles[action]}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      transitionName=""
      maskTransitionName=""
      destroyOnHidden
      maskClosable={!submitting}
      footer={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="primary"
            danger={action === 'archive'}
            loading={submitting}
            disabled={isConfirmDisabled}
            onClick={handleExecute}
            aria-label={`Confirm ${action} button`}
          >
            {action === 'activate' && 'Confirm Activation'}
            {action === 'deactivate' && 'Confirm Deactivation'}
            {action === 'archive' && 'Permanently Archive'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 8 }}>
        {/* Context Summary */}
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Parent Product">{parentProduct.title}</Descriptions.Item>
          <Descriptions.Item label="Variant Title">{variant.title}</Descriptions.Item>
          <Descriptions.Item label="Canonical SKU">{variant.sku || 'None'}</Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <Tag color={getVariantStatusColor(variant.status)}>{variant.status}</Tag>
          </Descriptions.Item>
        </Descriptions>

        {/* Blocking Safeguards */}
        {isParentArchived && (
          <Alert
            type="warning"
            showIcon
            message="Parent Product Archived"
            description="The parent product is archived. Lifecycle actions cannot be performed on variants belonging to an archived product."
          />
        )}

        {isVariantArchived && (
          <Alert
            type="warning"
            showIcon
            message="Variant Archived"
            description="This variant is archived. Archived variants are permanently immutable and cannot be activated, deactivated, or archived again."
          />
        )}

        {!hasRequiredPermissions && (
          <Alert
            type="warning"
            showIcon
            message="Insufficient Permissions"
            description={missingPermissionMessage}
          />
        )}

        {isAlreadyActive && (
          <Alert
            type="info"
            showIcon
            message="Variant Already Active"
            description="This variant is already in ACTIVE status. No activation transition is required."
          />
        )}

        {isAlreadyInactive && (
          <Alert
            type="info"
            showIcon
            message="Variant Already Inactive"
            description="This variant is already in INACTIVE status. No deactivation transition is required."
          />
        )}

        {/* Action Specific Guidance */}
        {!isBlocked && action === 'activate' && (
          <>
            <Typography.Paragraph>
              Activating this variant will transition it to <strong>ACTIVE</strong> and make it
              available for storefront search and purchase.
            </Typography.Paragraph>
            <Alert
              type="info"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message="Activation Prerequisites"
              description={
                <ul style={{ paddingLeft: 18, marginBottom: 0, marginTop: 4 }}>
                  <li>
                    A complete unit configuration (unitCode, quantityPrecision, minOrderQuantity,
                    stepIncrement) must be defined on the variant or snapshotted from the parent.
                  </li>
                  <li>
                    Quantity precision must be 0 for discrete units and within allowable maximums
                    for continuous units.
                  </li>
                  <li>
                    An active global B2C pricing record (<code>VARIANT_GLOBAL</code>) with price
                    &gt; 0 is mandatory before activation.
                  </li>
                </ul>
              }
            />
          </>
        )}

        {!isBlocked && action === 'deactivate' && (
          <>
            <Typography.Paragraph>
              Deactivating this variant will transition it to <strong>INACTIVE</strong>.
            </Typography.Paragraph>
            <Alert
              type="warning"
              showIcon
              message="Storefront Availability"
              description="The variant will immediately become unavailable for customer purchase on the storefront. Historical publication dates, audit records, and existing pricing configurations remain preserved."
            />
          </>
        )}

        {!isBlocked && action === 'archive' && (
          <>
            <Alert
              type="error"
              showIcon
              message="Irreversible Permanent Archival"
              description="Archiving a variant is permanent and terminal. Once archived, the variant cannot be re-activated, edited, or restored through the lifecycle API."
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              In accordance with marketplace catalogue invariants, this operation will atomically:
            </Typography.Paragraph>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: '#595959' }}>
              <li>Transition variant status permanently to ARCHIVED.</li>
              <li>Mark the variant's canonical SKU reservation in the registry as ARCHIVED.</li>
              <li>Deactivate all active regional and global pricing records for this variant.</li>
              <li>Deactivate all partner inventory availability mappings for this variant.</li>
            </ul>
            <div style={{ marginTop: 12 }}>
              <Checkbox
                checked={archiveConfirmed}
                onChange={(e) => setArchiveConfirmed(e.target.checked)}
                aria-label="Confirm permanent archival checkbox"
              >
                <Typography.Text strong>
                  I understand that archiving this variant is permanent and cannot be undone.
                </Typography.Text>
              </Checkbox>
            </div>
          </>
        )}

        {/* Backend Error State */}
        {error && (
          <Alert
            type="error"
            showIcon
            message={error.code ? `Operation Failed: ${error.code}` : 'Operation Failed'}
            description={
              <div>
                <Typography.Paragraph style={{ marginBottom: isUnpricedError ? 12 : 0 }}>
                  {error.message}
                </Typography.Paragraph>
                {isUnpricedError && (
                  <Button
                    type="primary"
                    icon={<DollarOutlined />}
                    onClick={() => {
                      onClose();
                      navigate(
                        `/catalogue/products/${encodeURIComponent(parentProduct.id)}/variants/${encodeURIComponent(variant.id)}/pricing`,
                      );
                    }}
                    aria-label="Configure variant pricing button"
                  >
                    Configure Variant Pricing
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
