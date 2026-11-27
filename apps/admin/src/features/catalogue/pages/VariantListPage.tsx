import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IProduct, type IProductVariant } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { ProductStatus } from '../components/ProductStatus.js';
import { VariantFormDrawer } from '../components/VariantFormDrawer.js';
import {
  VariantLifecycleModal,
  type VariantLifecycleAction,
} from '../components/VariantLifecycleModal.js';
import { ProductLifecycleModal } from '../components/ProductLifecycleModal.js';

export function VariantListPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CATALOG_READ) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.CATALOG_WRITE) ?? false;
  const canPublish = user?.permissions.includes(PermissionCode.CATALOG_PUBLISH) ?? false;

  const [product, setProduct] = useState<IProduct | null>(null);
  const [variants, setVariants] = useState<IProductVariant[]>([]);
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Management UI State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [selectedVariant, setSelectedVariant] = useState<IProductVariant | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<VariantLifecycleAction | null>(null);
  const [lifecycleModalOpen, setLifecycleModalOpen] = useState(false);
  const [productLifecycleModalOpen, setProductLifecycleModalOpen] = useState(false);

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
      variantClient.list(productId, { signal: controller.signal }),
    ])
      .then(([parent, items]) => {
        if (!controller.signal.aborted) {
          setProduct(parent);
          setVariants(items.filter((item) => item.productId === parent.id));
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void getUnitLabels(controller.signal)
      .then((labels) => {
        if (!controller.signal.aborted) setUnits(labels);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [productId, attempt, canRead]);

  if (!canRead) {
    return (
      <div className="catalogue-detail-page">
        <Button
          type="text"
          className="thz-back-btn"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/catalogue/products/${encodeURIComponent(productId)}`)}
        >
          Back to product
        </Button>
        <div className="catalogue-heading">
          <div>
            <Typography.Text className="eyebrow">PRODUCT VARIANTS</Typography.Text>
            <Typography.Title level={1}>Product variants</Typography.Title>
          </div>
        </div>
        <Card variant="borderless" className="catalogue-card">
          <Typography.Paragraph type="secondary">
            CATALOG_READ permission required to browse product variants.
          </Typography.Paragraph>
        </Card>
      </div>
    );
  }

  const canCreateVariant =
    canWrite && product !== null && product.hasVariants && product.status !== 'ARCHIVED';
  const activeVariantCount = variants.filter((v) => v.status === 'ACTIVE').length;

  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
        className="thz-back-btn"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(`/catalogue/products/${encodeURIComponent(productId)}`)}
      >
        Back to product
      </Button>
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">PRODUCT VARIANTS</Typography.Text>
          <Typography.Title level={1}>{product?.title || 'Product variants'}</Typography.Title>
          <Typography.Paragraph type="secondary">
            Variants returned for this product only.
          </Typography.Paragraph>
        </div>
        {canCreateVariant && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setSelectedVariant(null);
              setDrawerMode('create');
              setDrawerOpen(true);
            }}
            aria-label="Create Variant"
          >
            Create Variant
          </Button>
        )}
      </div>

      {product && !product.hasVariants && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Single-Item Product"
          description="This product is configured as a single item and does not support creating variants."
        />
      )}

      {product?.status === 'ARCHIVED' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Parent Product Archived"
          description="The parent product is archived. Variant creation and lifecycle mutations are permanently disabled."
        />
      )}

      {product?.status === 'DRAFT' && activeVariantCount > 0 && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="Product Ready to Publish"
          description={
            <Space direction="vertical" size={8}>
              <span>
                This product has {activeVariantCount} active variant(s) and meets all variant
                criteria for publishing.
              </span>
              {canPublish && (
                <Button
                  type="primary"
                  size="small"
                  onClick={() => setProductLifecycleModalOpen(true)}
                  aria-label={`Publish ${product.title}`}
                >
                  Publish Product Now
                </Button>
              )}
            </Space>
          }
        />
      )}

      <Card
        variant="borderless"
        className="catalogue-card"
        title={`Variants (${variants.length})`}
        extra={
          !loading && !error ? (
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => setAttempt((n) => n + 1)}
              aria-label="Refresh variants"
            >
              Refresh
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : error ? (
          <CatalogueError
            error={error}
            retry={() => setAttempt((n) => n + 1)}
            resource="product variants"
          />
        ) : variants.length === 0 ? (
          <Empty description="No variants found for this product">
            {canCreateVariant && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setSelectedVariant(null);
                  setDrawerMode('create');
                  setDrawerOpen(true);
                }}
                style={{ marginTop: 8 }}
              >
                Create First Variant
              </Button>
            )}
          </Empty>
        ) : (
          <Table<IProductVariant>
            rowKey="id"
            dataSource={variants}
            scroll={{ x: 700 }}
            pagination={false}
            onRow={(record) => ({
              onClick: () =>
                navigate(
                  `/catalogue/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(record.id)}`,
                ),
              className: 'catalogue-row',
            })}
            columns={[
              {
                title: 'Variant',
                dataIndex: 'title',
                key: 'title',
                render: (title: string, item) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{title}</Typography.Text>
                    {item.sku ? (
                      <span className="sku-cell">{item.sku}</span>
                    ) : (
                      <Typography.Text type="secondary">No SKU</Typography.Text>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Attributes',
                dataIndex: 'attributes',
                key: 'attributes',
                render: (attrs: Record<string, string>) =>
                  Object.entries(attrs || {}).map(([key, value]) => (
                    <Tag key={key}>
                      {key}: {value}
                    </Tag>
                  )),
              },
              {
                title: 'Unit',
                dataIndex: 'unitCode',
                key: 'unit',
                render: (unit: string | null | undefined) =>
                  unit ? `${units.get(unit) || 'Unavailable'} · ${unit}` : '—',
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (status) => <ProductStatus status={status} />,
              },
              {
                title: 'Created',
                dataIndex: 'createdAt',
                key: 'created',
                render: (date?: string) => (date ? new Date(date).toLocaleDateString() : '—'),
              },
              ...(canWrite || canPublish
                ? [
                    {
                      title: 'Actions',
                      key: 'actions',
                      width: 240,
                      render: (_: unknown, record: IProductVariant) => (
                        <Space onClick={(e) => e.stopPropagation()} wrap size="small">
                          {canWrite &&
                            product?.status !== 'ARCHIVED' &&
                            record.status !== 'ARCHIVED' && (
                              <Button
                                size="small"
                                onClick={() => {
                                  setSelectedVariant(record);
                                  setDrawerMode('edit');
                                  setDrawerOpen(true);
                                }}
                                aria-label={`Edit ${record.title}`}
                              >
                                Edit
                              </Button>
                            )}
                          {canWrite &&
                            canPublish &&
                            product?.status !== 'ARCHIVED' &&
                            record.status !== 'ACTIVE' &&
                            record.status !== 'ARCHIVED' && (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  setSelectedVariant(record);
                                  setLifecycleAction('activate');
                                  setLifecycleModalOpen(true);
                                }}
                                aria-label={`Activate ${record.title}`}
                              >
                                Activate
                              </Button>
                            )}
                          {canWrite &&
                            product?.status !== 'ARCHIVED' &&
                            record.status === 'ACTIVE' && (
                              <Button
                                size="small"
                                onClick={() => {
                                  setSelectedVariant(record);
                                  setLifecycleAction('deactivate');
                                  setLifecycleModalOpen(true);
                                }}
                                aria-label={`Deactivate ${record.title}`}
                              >
                                Deactivate
                              </Button>
                            )}
                          {canWrite &&
                            product?.status !== 'ARCHIVED' &&
                            record.status !== 'ARCHIVED' && (
                              <Button
                                size="small"
                                danger
                                onClick={() => {
                                  setSelectedVariant(record);
                                  setLifecycleAction('archive');
                                  setLifecycleModalOpen(true);
                                }}
                                aria-label={`Archive ${record.title}`}
                              >
                                Archive
                              </Button>
                            )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>

      <VariantFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        parentProduct={product}
        variant={selectedVariant}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedVariant(null);
        }}
        onSuccess={() => {
          setDrawerOpen(false);
          setSelectedVariant(null);
          setAttempt((n) => n + 1);
        }}
      />

      <VariantLifecycleModal
        open={lifecycleModalOpen}
        action={lifecycleAction}
        parentProduct={product}
        variant={selectedVariant}
        onClose={() => {
          setLifecycleModalOpen(false);
          setSelectedVariant(null);
        }}
        onSuccess={() => {
          setLifecycleModalOpen(false);
          setSelectedVariant(null);
          setAttempt((n) => n + 1);
        }}
        onEditVariant={(v) => {
          setLifecycleModalOpen(false);
          setSelectedVariant(v);
          setDrawerMode('edit');
          setDrawerOpen(true);
        }}
      />

      <ProductLifecycleModal
        open={productLifecycleModalOpen}
        action="publish"
        product={product}
        onClose={() => setProductLifecycleModalOpen(false)}
        onSuccess={(updated) => {
          setProductLifecycleModalOpen(false);
          if (updated) setProduct(updated);
          setAttempt((n) => n + 1);
        }}
      />
    </div>
  );
}
