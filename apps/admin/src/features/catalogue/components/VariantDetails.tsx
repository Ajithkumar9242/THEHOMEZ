import { Card, Descriptions, Image, Space, Typography } from 'antd';
import type { IProductVariant } from '@thehomez/shared-types';
import { ProductStatus } from './ProductStatus.js';

const display = (v?: string | number | null) =>
  v === null || v === undefined || v === '' ? '—' : String(v);
export function VariantDetails({
  variant,
  unitLabel,
}: {
  variant: IProductVariant;
  unitLabel?: string;
}) {
  return (
    <Space direction="vertical" size="middle" className="catalogue-sections">
      <Card
        variant="borderless"
        title={
          <Space wrap>
            <Typography.Title level={4} className="card-title">
              {variant.title}
            </Typography.Title>
            <ProductStatus status={variant.status} />
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="SKU">{display(variant.sku)}</Descriptions.Item>
          <Descriptions.Item label="Variant ID">{variant.id}</Descriptions.Item>
          <Descriptions.Item label="Parent product ID">{variant.productId}</Descriptions.Item>
          <Descriptions.Item label="Unit">
            {variant.unitCode ? `${unitLabel || 'Unavailable'} · ${variant.unitCode}` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Quantity precision">
            {display(variant.quantityPrecision)}
          </Descriptions.Item>
          <Descriptions.Item label="Minimum order quantity">
            {display(variant.minOrderQuantity)}
          </Descriptions.Item>
          <Descriptions.Item label="Maximum order quantity">
            {display(variant.maxOrderQuantity)}
          </Descriptions.Item>
          <Descriptions.Item label="Step increment">
            {display(variant.stepIncrement)}
          </Descriptions.Item>
          <Descriptions.Item label="Published">
            {display(variant.publishedAt ? new Date(variant.publishedAt).toLocaleString() : null)}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {display(variant.createdAt ? new Date(variant.createdAt).toLocaleString() : null)}
          </Descriptions.Item>
          <Descriptions.Item label="Last updated">
            {display(variant.updatedAt ? new Date(variant.updatedAt).toLocaleString() : null)}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card
        variant="borderless"
        title={`Attributes (${Object.keys(variant.attributes || {}).length})`}
      >
        {Object.keys(variant.attributes || {}).length ? (
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            {Object.entries(variant.attributes).map(([key, val]) => (
              <Descriptions.Item key={key} label={key}>
                {val}
              </Descriptions.Item>
            ))}
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">No attributes provided.</Typography.Text>
        )}
      </Card>
      <Card variant="borderless" title={`Images (${variant.images?.length || 0})`}>
        {variant.images?.length ? (
          <Image.PreviewGroup>
            {variant.images.map((src) => (
              <Image
                key={src}
                src={src}
                alt={variant.title}
                width={112}
                height={88}
                style={{ objectFit: 'cover', margin: 6, borderRadius: 6 }}
              />
            ))}
          </Image.PreviewGroup>
        ) : (
          <Typography.Text type="secondary">No images available.</Typography.Text>
        )}
      </Card>
    </Space>
  );
}
