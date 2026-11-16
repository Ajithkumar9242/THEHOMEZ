import { Card, Descriptions, Image, Space, Typography } from 'antd';
import type { IProduct } from '@thehomez/shared-types';
import { ProductStatus } from './ProductStatus.js';

const value = (item?: string | number | null) =>
  item === null || item === undefined || item === '' ? '—' : String(item);
export function ProductDetails({
  product,
  categories,
  units,
}: {
  product: IProduct;
  categories: Map<string, string>;
  units: Map<string, string>;
}) {
  const category = categories.get(product.categoryId) || 'Unavailable';
  const subcategory = categories.get(product.subcategoryId) || 'Unavailable';
  const unit = product.unitCode
    ? `${units.get(product.unitCode) || 'Unavailable'} · ${product.unitCode}`
    : '—';
  return (
    <Space direction="vertical" size="middle" className="catalogue-sections">
      <Card
        variant="borderless"
        title={
          <Space wrap>
            <Typography.Title level={4} className="card-title">
              {product.title}
            </Typography.Title>
            <ProductStatus status={product.status} />
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="Brand">{value(product.brand)}</Descriptions.Item>
          <Descriptions.Item label="SKU">{value(product.sku)}</Descriptions.Item>
          <Descriptions.Item label="Slug">{value(product.slug)}</Descriptions.Item>
          <Descriptions.Item label="Category">{category}</Descriptions.Item>
          <Descriptions.Item label="Subcategory">{subcategory}</Descriptions.Item>
          <Descriptions.Item label="Variants">
            {product.hasVariants ? 'Has variants' : 'Single product'}
          </Descriptions.Item>
          <Descriptions.Item label="Description" span={3}>
            {value(product.description)}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card variant="borderless" title="Unit and quantity configuration">
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="Unit">{unit}</Descriptions.Item>
          <Descriptions.Item label="Quantity precision">
            {value(product.quantityPrecision)}
          </Descriptions.Item>
          <Descriptions.Item label="Minimum order quantity">
            {value(product.minOrderQuantity)}
          </Descriptions.Item>
          <Descriptions.Item label="Maximum order quantity">
            {value(product.maxOrderQuantity)}
          </Descriptions.Item>
          <Descriptions.Item label="Step increment">
            {value(product.stepIncrement)}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card
        variant="borderless"
        title={`Specifications (${Object.keys(product.specifications || {}).length})`}
      >
        {Object.keys(product.specifications || {}).length ? (
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            {Object.entries(product.specifications).map(([key, val]) => (
              <Descriptions.Item key={key} label={key}>
                {val}
              </Descriptions.Item>
            ))}
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">No specifications provided.</Typography.Text>
        )}
      </Card>
      <Card variant="borderless" title={`Images (${product.images?.length || 0})`}>
        {product.images?.length ? (
          <Image.PreviewGroup>
            {product.images.map((src) => (
              <Image
                key={src}
                src={src}
                alt={product.title}
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
      <Card variant="borderless" title="Publication and record history">
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="Published">
            {value(product.publishedAt ? new Date(product.publishedAt).toLocaleString() : null)}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {value(product.createdAt ? new Date(product.createdAt).toLocaleString() : null)}
          </Descriptions.Item>
          <Descriptions.Item label="Last updated">
            {value(product.updatedAt ? new Date(product.updatedAt).toLocaleString() : null)}
          </Descriptions.Item>
          <Descriptions.Item label="Version">{value(product.version)}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}
