import { useEffect, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined, DollarOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PermissionCode,
  type IProduct,
  type IProductPricing,
  type IProductVariant,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { PricingInspection } from '../components/PricingInspection.js';
import { PricingFormDrawer } from '../components/PricingFormDrawer.js';
import { RegionalPricingFormDrawer } from '../components/RegionalPricingFormDrawer.js';

export function ProductPricingDetailPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWritePricing = user?.permissions.includes(PermissionCode.PRICING_WRITE) ?? false;

  const [product, setProduct] = useState<IProduct | null>(null);
  const [globalPricing, setGlobalPricing] = useState<IProductPricing | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [refreshKey, setRefreshKey] = useState(0);

  const [regionalRecords, setRegionalRecords] = useState<IProductPricing[]>([]);
  const [selectedRegionalPricing, setSelectedRegionalPricing] = useState<IProductPricing | null>(
    null,
  );
  const [regionalDrawerOpen, setRegionalDrawerOpen] = useState(false);
  const [regionalDrawerMode, setRegionalDrawerMode] = useState<'create' | 'edit'>('create');

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    void productClient
      .get(productId, { signal: controller.signal })
      .then((p) => {
        if (!controller.signal.aborted) setProduct(p);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [productId]);

  const handleOpenCreate = () => {
    setDrawerMode('create');
    setDrawerOpen(true);
  };

  const handleOpenEdit = (record?: IProductPricing) => {
    if (record) setGlobalPricing(record);
    setDrawerMode('edit');
    setDrawerOpen(true);
  };

  const handleOpenCreateRegional = () => {
    setSelectedRegionalPricing(null);
    setRegionalDrawerMode('create');
    setRegionalDrawerOpen(true);
  };

  const handleOpenEditRegional = (record: IProductPricing) => {
    setSelectedRegionalPricing(record);
    setRegionalDrawerMode('edit');
    setRegionalDrawerOpen(true);
  };

  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(`/catalogue/products/${encodeURIComponent(productId)}`)}
      >
        Back to product
      </Button>
      <div
        className="catalogue-heading"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <Typography.Text className="eyebrow">PRODUCT · PRICING MANAGEMENT</Typography.Text>
          <Typography.Title level={1}>Pricing configuration</Typography.Title>
          <Typography.Text type="secondary">
            {product?.title ? `${product.title} (${productId})` : `Product reference: ${productId}`}
          </Typography.Text>
        </div>
        {canWritePricing && !product?.hasVariants && (
          <Space>
            {globalPricing ? (
              <Button
                icon={<EditOutlined />}
                onClick={() => handleOpenEdit(globalPricing)}
                aria-label="Edit product pricing header button"
              >
                Edit Pricing
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={handleOpenCreate}
                aria-label="Set product pricing header button"
              >
                Set Pricing
              </Button>
            )}
          </Space>
        )}
      </div>

      <PricingInspection
        productId={productId}
        productHasVariants={product?.hasVariants}
        onSetPricing={handleOpenCreate}
        onEditPricing={handleOpenEdit}
        onAddRegionalOverride={handleOpenCreateRegional}
        onEditRegionalOverride={handleOpenEditRegional}
        onGlobalRecordLoaded={setGlobalPricing}
        onRegionalRecordsLoaded={setRegionalRecords}
        refreshKey={refreshKey}
      />

      <PricingFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        productId={productId}
        productTitle={product?.title}
        productSku={product?.sku}
        unitCode={product?.unitCode}
        quantityPrecision={product?.quantityPrecision}
        minOrderQuantity={product?.minOrderQuantity}
        maxOrderQuantity={product?.maxOrderQuantity}
        stepIncrement={product?.stepIncrement}
        existingPricing={globalPricing}
        onClose={() => setDrawerOpen(false)}
        onSuccess={(updated) => {
          setGlobalPricing(updated);
          setRefreshKey((n) => n + 1);
        }}
        onReloadLatest={() => {
          setRefreshKey((n) => n + 1);
        }}
      />

      <RegionalPricingFormDrawer
        open={regionalDrawerOpen}
        mode={regionalDrawerMode}
        productId={productId}
        productTitle={product?.title}
        productSku={product?.sku}
        unitCode={product?.unitCode}
        quantityPrecision={product?.quantityPrecision}
        minOrderQuantity={product?.minOrderQuantity}
        maxOrderQuantity={product?.maxOrderQuantity}
        stepIncrement={product?.stepIncrement}
        existingPricing={selectedRegionalPricing}
        existingRegionalRecords={regionalRecords}
        onClose={() => setRegionalDrawerOpen(false)}
        onSuccess={() => {
          setRefreshKey((n) => n + 1);
        }}
        onReloadLatest={() => {
          setRefreshKey((n) => n + 1);
        }}
      />
    </div>
  );
}

export function VariantPricingDetailPage() {
  const { productId = '', variantId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWritePricing = user?.permissions.includes(PermissionCode.PRICING_WRITE) ?? false;

  const [product, setProduct] = useState<IProduct | null>(null);
  const [variant, setVariant] = useState<IProductVariant | null>(null);
  const [globalPricing, setGlobalPricing] = useState<IProductPricing | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [refreshKey, setRefreshKey] = useState(0);

  const [regionalRecords, setRegionalRecords] = useState<IProductPricing[]>([]);
  const [selectedRegionalPricing, setSelectedRegionalPricing] = useState<IProductPricing | null>(
    null,
  );
  const [regionalDrawerOpen, setRegionalDrawerOpen] = useState(false);
  const [regionalDrawerMode, setRegionalDrawerMode] = useState<'create' | 'edit'>('create');

  useEffect(() => {
    if (!productId || !variantId) return;
    const controller = new AbortController();
    void productClient
      .get(productId, { signal: controller.signal })
      .then((p) => {
        if (!controller.signal.aborted) setProduct(p);
      })
      .catch(() => undefined);

    void variantClient
      .get(productId, variantId, { signal: controller.signal })
      .then((v) => {
        if (!controller.signal.aborted) setVariant(v);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [productId, variantId]);

  const handleOpenCreate = () => {
    setDrawerMode('create');
    setDrawerOpen(true);
  };

  const handleOpenEdit = (record?: IProductPricing) => {
    if (record) setGlobalPricing(record);
    setDrawerMode('edit');
    setDrawerOpen(true);
  };

  const handleOpenCreateRegional = () => {
    setSelectedRegionalPricing(null);
    setRegionalDrawerMode('create');
    setRegionalDrawerOpen(true);
  };

  const handleOpenEditRegional = (record: IProductPricing) => {
    setSelectedRegionalPricing(record);
    setRegionalDrawerMode('edit');
    setRegionalDrawerOpen(true);
  };

  return (
    <div className="catalogue-detail-page">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() =>
          navigate(
            `/catalogue/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
          )
        }
      >
        Back to variant
      </Button>
      <div
        className="catalogue-heading"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <Typography.Text className="eyebrow">VARIANT · PRICING MANAGEMENT</Typography.Text>
          <Typography.Title level={1}>Pricing configuration</Typography.Title>
          <Typography.Text type="secondary">
            {product?.title ? `${product.title} · ` : ''}
            {variant?.title ? `${variant.title} (${variantId})` : `Variant ${variantId}`}
          </Typography.Text>
        </div>
        {canWritePricing && (
          <Space>
            {globalPricing ? (
              <Button
                icon={<EditOutlined />}
                onClick={() => handleOpenEdit(globalPricing)}
                aria-label="Edit variant pricing header button"
              >
                Edit Pricing
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={handleOpenCreate}
                aria-label="Set variant pricing header button"
              >
                Set Pricing
              </Button>
            )}
          </Space>
        )}
      </div>

      <PricingInspection
        productId={productId}
        variantId={variantId}
        onSetPricing={handleOpenCreate}
        onEditPricing={handleOpenEdit}
        onAddRegionalOverride={handleOpenCreateRegional}
        onEditRegionalOverride={handleOpenEditRegional}
        onGlobalRecordLoaded={setGlobalPricing}
        onRegionalRecordsLoaded={setRegionalRecords}
        refreshKey={refreshKey}
      />

      <PricingFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        productId={productId}
        productTitle={product?.title}
        productSku={product?.sku}
        variantId={variantId}
        variantTitle={variant?.title}
        variantSku={variant?.sku}
        unitCode={variant?.unitCode || product?.unitCode}
        quantityPrecision={variant?.quantityPrecision ?? product?.quantityPrecision}
        minOrderQuantity={variant?.minOrderQuantity || product?.minOrderQuantity}
        maxOrderQuantity={variant?.maxOrderQuantity || product?.maxOrderQuantity}
        stepIncrement={variant?.stepIncrement || product?.stepIncrement}
        existingPricing={globalPricing}
        onClose={() => setDrawerOpen(false)}
        onSuccess={(updated) => {
          setGlobalPricing(updated);
          setRefreshKey((n) => n + 1);
        }}
        onReloadLatest={() => {
          setRefreshKey((n) => n + 1);
        }}
      />

      <RegionalPricingFormDrawer
        open={regionalDrawerOpen}
        mode={regionalDrawerMode}
        productId={productId}
        productTitle={product?.title}
        productSku={product?.sku}
        variantId={variantId}
        variantTitle={variant?.title}
        variantSku={variant?.sku}
        unitCode={variant?.unitCode || product?.unitCode}
        quantityPrecision={variant?.quantityPrecision ?? product?.quantityPrecision}
        minOrderQuantity={variant?.minOrderQuantity || product?.minOrderQuantity}
        maxOrderQuantity={variant?.maxOrderQuantity || product?.maxOrderQuantity}
        stepIncrement={variant?.stepIncrement || product?.stepIncrement}
        existingPricing={selectedRegionalPricing}
        existingRegionalRecords={regionalRecords}
        onClose={() => setRegionalDrawerOpen(false)}
        onSuccess={() => {
          setRefreshKey((n) => n + 1);
        }}
        onReloadLatest={() => {
          setRefreshKey((n) => n + 1);
        }}
      />
    </div>
  );
}
