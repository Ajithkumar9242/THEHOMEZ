import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Skeleton, Space, Typography } from 'antd';
import { ArrowLeftOutlined, DollarOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IProduct, type IProductVariant } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { VariantDetails } from '../components/VariantDetails.js';
import { VariantFormDrawer } from '../components/VariantFormDrawer.js';
import {
  VariantLifecycleModal,
  type VariantLifecycleAction,
} from '../components/VariantLifecycleModal.js';

export function VariantDetailPage() {
  const { productId = '', variantId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CATALOG_READ) ?? false;
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.CATALOG_WRITE) ?? false;
  const canPublish = user?.permissions.includes(PermissionCode.CATALOG_PUBLISH) ?? false;

  const [parent, setParent] = useState<IProduct | null>(null);
  const [variant, setVariant] = useState<IProductVariant | null>(null);
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Management UI State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<VariantLifecycleAction | null>(null);
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      productClient.get(productId, { signal: controller.signal }),
      variantClient.get(productId, variantId, { signal: controller.signal }),
    ])
      .then(([product, item]) => {
        if (controller.signal.aborted) return;
        if (item.productId !== product.id)
          throw new Error('Variant does not belong to the selected product.');
        setParent(product);
        setVariant(item);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void getUnitLabels(controller.signal)
      .then((map) => {
        if (!controller.signal.aborted) setUnits(map);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [productId, variantId, attempt, canRead]);

  if (!canRead) {
    return (
      <div className="catalogue-detail-page">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/catalogue/products/${encodeURIComponent(productId)}/variants`)}
        >
          Back to variants
        </Button>
        <div className="catalogue-heading">
          <div>
            <Typography.Text className="eyebrow">VARIANT DETAILS</Typography.Text>
            <Typography.Title level={1}>Variant details</Typography.Title>
          </div>
        </div>
        <Card variant="borderless" className="catalogue-card">
          <Typography.Paragraph type="secondary">
            CATALOG_READ permission required to view variant details.
          </Typography.Paragraph>
        </Card>
      </div>
    );
  }

  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(`/catalogue/products/${encodeURIComponent(productId)}/variants`)}
      >
        Back to variants
      </Button>
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">
            VARIANT DETAILS · {parent?.title || 'PRODUCT'}
          </Typography.Text>
          <Typography.Title level={1}>{variant?.title || 'Variant'}</Typography.Title>
        </div>
        {variant && parent && (canWrite || canPublish) && (
          <Space wrap>
            {canWrite && parent.status !== 'ARCHIVED' && variant.status !== 'ARCHIVED' && (
              <Button
                icon={<EditOutlined />}
                onClick={() => setDrawerOpen(true)}
                aria-label="Edit Variant"
              >
                Edit Variant
              </Button>
            )}
            {canWrite &&
              canPublish &&
              parent.status !== 'ARCHIVED' &&
              variant.status !== 'ACTIVE' &&
              variant.status !== 'ARCHIVED' && (
                <Button
                  type="primary"
                  onClick={() => {
                    setLifecycleAction('activate');
                    setLifecycleModalOpen(true);
                  }}
                  aria-label="Activate Variant"
                >
                  Activate Variant
                </Button>
              )}
            {canWrite && parent.status !== 'ARCHIVED' && variant.status === 'ACTIVE' && (
              <Button
                onClick={() => {
                  setLifecycleAction('deactivate');
                  setLifecycleModalOpen(true);
                }}
                aria-label="Deactivate Variant"
              >
                Deactivate Variant
              </Button>
            )}
            {canWrite && parent.status !== 'ARCHIVED' && variant.status !== 'ARCHIVED' && (
              <Button
                danger
                onClick={() => {
                  setLifecycleAction('archive');
                  setLifecycleModalOpen(true);
                }}
                aria-label="Archive Variant"
              >
                Archive Variant
              </Button>
            )}
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => setAttempt((n) => n + 1)}
              aria-label="Refresh variant details"
            >
              Refresh
            </Button>
          </Space>
        )}
      </div>

      {parent?.status === 'ARCHIVED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Parent Product Archived"
          description="The parent product is archived. Variant mutations and lifecycle actions are permanently disabled."
        />
      )}

      {variant?.status === 'ARCHIVED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Variant Archived"
          description="This variant is permanently archived. Modifications and lifecycle transitions are disabled."
        />
      )}

      {loading ? (
        <Skeleton active paragraph={{ rows: 7 }} />
      ) : error ? (
        <CatalogueError error={error} retry={() => setAttempt((n) => n + 1)} resource="variant" />
      ) : variant ? (
        <>
          {canReadPricing && (
            <Card
              variant="borderless"
              className="catalogue-card variant-callout"
              title="Pricing configuration"
              extra={
                <Button
                  icon={<DollarOutlined />}
                  onClick={() =>
                    navigate(
                      `/catalogue/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/pricing`,
                    )
                  }
                >
                  Inspect pricing
                </Button>
              }
            >
              <Typography.Text type="secondary">
                Read-only stored pricing details are available to staff with PRICING_READ.
              </Typography.Text>
            </Card>
          )}
          <VariantDetails
            variant={variant}
            unitLabel={variant.unitCode ? units.get(variant.unitCode) : undefined}
          />
        </>
      ) : (
        <Empty description="No variant details returned" />
      )}

      <VariantFormDrawer
        open={drawerOpen}
        mode="edit"
        parentProduct={parent}
        variant={variant}
        onClose={() => setDrawerOpen(false)}
        onSuccess={(updated) => {
          setVariant(updated);
          setDrawerOpen(false);
          setAttempt((n) => n + 1);
        }}
      />

      <VariantLifecycleModal
        open={lifecycleModalOpen}
        action={lifecycleAction}
        parentProduct={parent}
        variant={variant}
        onClose={() => setLifecycleModalOpen(false)}
        onSuccess={(updated) => {
          setVariant(updated);
          setLifecycleModalOpen(false);
          setAttempt((n) => n + 1);
        }}
      />
    </div>
  );
}
