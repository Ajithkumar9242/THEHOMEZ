import { useEffect, useState } from 'react';
import { Button, Card, Empty, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined, DollarOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PermissionCode, type IProduct, type IProductVariant } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnitLabels } from '../api/catalogue-lookups.js';
import { CatalogueError } from '../components/CatalogueStates.js';
import { VariantDetails } from '../components/VariantDetails.js';

export function VariantDetailPage() {
  const { productId = '', variantId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const [parent, setParent] = useState<IProduct | null>(null);
  const [variant, setVariant] = useState<IProductVariant | null>(null);
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
  }, [productId, variantId, attempt]);
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
      </div>
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
    </div>
  );
}
