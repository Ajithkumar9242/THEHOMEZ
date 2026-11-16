import { useEffect, useState } from 'react';
import { Button, Card, Empty, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type { IProduct, IProductVariant } from '@thehomez/shared-types';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { ProductStatus } from '../components/ProductStatus.js';

export function VariantListPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<IProduct | null>(null);
  const [variants, setVariants] = useState<IProductVariant[]>([]);
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
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
  }, [productId, attempt]);
  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
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
      </div>
      <Card variant="borderless" className="catalogue-card" title={`Variants (${variants.length})`}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : error ? (
          <CatalogueError
            error={error}
            retry={() => setAttempt((n) => n + 1)}
            resource="product variants"
          />
        ) : variants.length === 0 ? (
          <Empty description="No variants found for this product" />
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
                    <Typography.Text type="secondary">{item.sku || 'No SKU'}</Typography.Text>
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
            ]}
          />
        )}
      </Card>
    </div>
  );
}
