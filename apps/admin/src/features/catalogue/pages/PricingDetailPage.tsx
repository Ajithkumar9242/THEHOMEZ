import { Button, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PricingInspection } from '../components/PricingInspection.js';

export function ProductPricingDetailPage() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
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
          <Typography.Text className="eyebrow">PRODUCT · PRICING INSPECTION</Typography.Text>
          <Typography.Title level={1}>Pricing configuration</Typography.Title>
          <Typography.Text type="secondary">Product reference: {productId}</Typography.Text>
        </div>
      </div>
      <PricingInspection productId={productId} />
    </div>
  );
}

export function VariantPricingDetailPage() {
  const { productId = '', variantId = '' } = useParams();
  const navigate = useNavigate();
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
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">VARIANT · PRICING INSPECTION</Typography.Text>
          <Typography.Title level={1}>Pricing configuration</Typography.Title>
          <Typography.Text type="secondary">
            Product {productId} · Variant {variantId}
          </Typography.Text>
        </div>
      </div>
      <PricingInspection productId={productId} variantId={variantId} />
    </div>
  );
}
