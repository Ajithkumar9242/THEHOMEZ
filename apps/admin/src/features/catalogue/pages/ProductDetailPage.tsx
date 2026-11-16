import { useEffect, useState } from 'react';
import { Button, Card, Empty, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined, AppstoreOutlined, DollarOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IProduct } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { getCategories, getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { ProductDetails } from '../components/ProductDetails.js';

export function ProductDetailPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const [product, setProduct] = useState<IProduct | null>(null);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [units, setUnits] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void productClient
      .get(productId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProduct(result);
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
                  View variants
                </Button>
              }
            >
              <Typography.Text type="secondary">
                Inspect the variants attached to this product.
              </Typography.Text>
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
        </>
      ) : (
        <Empty description="No product details returned" />
      )}
    </div>
  );
}
