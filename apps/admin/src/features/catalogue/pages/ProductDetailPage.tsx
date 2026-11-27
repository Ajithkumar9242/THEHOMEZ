import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  AppstoreOutlined,
  DollarOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IProduct, type IProductVariant } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getCategories, getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { ProductDetails } from '../components/ProductDetails.js';
import { ProductFormDrawer } from '../components/ProductFormDrawer.js';
import {
  ProductLifecycleModal,
  type ProductLifecycleAction,
} from '../components/ProductLifecycleModal.js';

export function ProductDetailPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.CATALOG_WRITE) ?? false;
  const canPublish = user?.permissions.includes(PermissionCode.CATALOG_PUBLISH) ?? false;
  const [product, setProduct] = useState<IProduct | null>(null);
  const [variants, setVariants] = useState<IProductVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Management UI State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<ProductLifecycleAction | null>(null);
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void productClient
      .get(productId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setProduct(result);
          if (result.hasVariants) {
            setVariantsLoading(true);
            void variantClient
              .list(productId, { signal: controller.signal })
              .then((items) => {
                if (!controller.signal.aborted) setVariants(items);
              })
              .catch(() => undefined)
              .finally(() => {
                if (!controller.signal.aborted) setVariantsLoading(false);
              });
          }
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void getCategories(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCategories(result.labels);
      })
      .catch(() => undefined);
    void getUnitLabels(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setUnits(result);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [productId, attempt]);

  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
        className="thz-back-btn"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/catalogue/products')}
      >
        Back to products
      </Button>
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">PRODUCT DETAILS</Typography.Text>
          <Typography.Title level={1}>{product?.title || 'Product'}</Typography.Title>
        </div>
        {product && (canWrite || canPublish) && (
          <Space wrap>
            {canWrite && product.status !== 'ARCHIVED' && (
              <Button
                icon={<EditOutlined />}
                onClick={() => setDrawerOpen(true)}
                aria-label={`Edit ${product.title}`}
              >
                Edit Product
              </Button>
            )}
            {canPublish && product.status !== 'ACTIVE' && product.status !== 'ARCHIVED' && (
              <Button
                type="primary"
                onClick={() => {
                  setLifecycleAction('publish');
                  setLifecycleModalOpen(true);
                }}
                aria-label={`Publish ${product.title}`}
              >
                Publish Product
              </Button>
            )}
            {canWrite && product.status === 'ACTIVE' && (
              <Button
                onClick={() => {
                  setLifecycleAction('deactivate');
                  setLifecycleModalOpen(true);
                }}
                aria-label={`Deactivate ${product.title}`}
              >
                Deactivate Product
              </Button>
            )}
            {canWrite && product.status !== 'ARCHIVED' && (
              <Button
                danger
                onClick={() => {
                  setLifecycleAction('archive');
                  setLifecycleModalOpen(true);
                }}
                aria-label={`Archive ${product.title}`}
              >
                Archive Product
              </Button>
            )}
            {canWrite && product.status === 'DRAFT' && product.publishedAt === null && (
              <Button
                danger
                onClick={() => {
                  setLifecycleAction('delete');
                  setLifecycleModalOpen(true);
                }}
                aria-label={`Delete draft ${product.title}`}
              >
                Delete Draft
              </Button>
            )}
          </Space>
        )}
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : error ? (
        <CatalogueError error={error} retry={() => setAttempt((n) => n + 1)} resource="product" />
      ) : product ? (
        <>
          {product.hasVariants && (
            <Card
              variant="borderless"
              className="catalogue-card variant-callout"
              title="Product variants"
              extra={
                <Button
                  type="primary"
                  icon={<AppstoreOutlined />}
                  onClick={() =>
                    navigate(`/catalogue/products/${encodeURIComponent(product.id)}/variants`)
                  }
                >
                  Manage variants
                </Button>
              }
            >
              {variantsLoading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                  <Space wrap size="middle">
                    <Tag color="blue">Total: {variants.length}</Tag>
                    <Tag color="success">
                      Active: {variants.filter((v) => v.status === 'ACTIVE').length}
                    </Tag>
                    <Tag color="default">
                      Draft / Inactive: {variants.filter((v) => v.status !== 'ACTIVE').length}
                    </Tag>
                  </Space>
                  {variants.filter((v) => v.status === 'ACTIVE').length === 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message="No Active Variants"
                      description="At least one variant must be ACTIVE before this product can be published. Click 'Manage variants' to configure and activate variants."
                    />
                  )}
                  <Typography.Text type="secondary">
                    Inspect and manage the variants attached to this product.
                  </Typography.Text>
                </Space>
              )}
            </Card>
          )}
          {canReadPricing && !product.hasVariants && (
            <Card
              variant="borderless"
              className="catalogue-card variant-callout"
              title="Pricing configuration"
              extra={
                <Button
                  icon={<DollarOutlined />}
                  onClick={() =>
                    navigate(`/catalogue/products/${encodeURIComponent(product.id)}/pricing`)
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
          <ProductDetails product={product} categories={categories} units={units} />
          <ProductFormDrawer
            open={drawerOpen}
            mode="edit"
            product={product}
            onClose={() => setDrawerOpen(false)}
            onSuccess={() => {
              setAttempt((n) => n + 1);
            }}
          />
          <ProductLifecycleModal
            open={lifecycleModalOpen}
            action={lifecycleAction}
            product={product}
            onClose={() => setLifecycleModalOpen(false)}
            onSuccess={(updated) => {
              if (lifecycleAction === 'delete') {
                navigate('/catalogue/products');
              } else if (updated) {
                setProduct(updated);
              } else {
                setAttempt((n) => n + 1);
              }
            }}
          />
        </>
      ) : (
        <Empty description="No product details returned" />
      )}
    </div>
  );
}
