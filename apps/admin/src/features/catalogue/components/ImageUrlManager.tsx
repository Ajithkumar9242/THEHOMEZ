import { useState } from 'react';
import { Alert, Button, Card, Image, Input, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { MAX_PRODUCT_IMAGES } from '@thehomez/shared-types';

export interface ImageUrlManagerProps {
  value?: string[];
  onChange?: (urls: string[]) => void;
  disabled?: boolean;
}

const HTTP_URL_REGEX = /^https?:\/\/[^\s$.?#].[^\s]*$/i;

export function ImageUrlManager({ value = [], onChange, disabled = false }: ImageUrlManagerProps) {
  const [newUrl, setNewUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) {
      setUrlError('Please enter an image URL');
      return;
    }
    if (!HTTP_URL_REGEX.test(trimmed)) {
      setUrlError('URL must begin with http:// or https:// and be a valid URL');
      return;
    }
    if (value.includes(trimmed)) {
      setUrlError('This image URL is already in the list');
      return;
    }
    if (value.length >= MAX_PRODUCT_IMAGES) {
      setUrlError(`Cannot exceed ${MAX_PRODUCT_IMAGES} images`);
      return;
    }

    setUrlError(null);
    setNewUrl('');
    onChange?.([...value, trimmed]);
  };

  const handleRemove = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    onChange?.(updated);
  };

  const atLimit = value.length >= MAX_PRODUCT_IMAGES;

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary">
          {value.length} / {MAX_PRODUCT_IMAGES} images
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Pre-hosted HTTP/HTTPS URLs only
        </Typography.Text>
      </div>

      {!disabled && !atLimit && (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="https://example.com/images/product.jpg"
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
            onPressEnter={(e) => {
              e.preventDefault();
              handleAdd();
            }}
            disabled={disabled}
            status={urlError ? 'error' : undefined}
            aria-label="Image URL input"
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            disabled={disabled || !newUrl.trim()}
          >
            Add Image
          </Button>
        </Space.Compact>
      )}

      {urlError && <Typography.Text type="danger">{urlError}</Typography.Text>}

      {atLimit && (
        <Alert
          type="info"
          showIcon
          message={`Maximum limit of ${MAX_PRODUCT_IMAGES} images reached.`}
        />
      )}

      {value.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="No images configured"
          description="At least one image URL is required to publish this product. Drafts may be saved without images."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
            marginTop: 8,
          }}
        >
          {value.map((url, idx) => (
            <Card
              key={url}
              size="small"
              variant="outlined"
              cover={
                <div
                  style={{
                    height: 120,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f5f5f5',
                    overflow: 'hidden',
                  }}
                >
                  <Image
                    src={url}
                    alt={`Product image ${idx + 1}`}
                    height={120}
                    style={{ objectFit: 'cover' }}
                    fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23999'>Preview</text></svg>"
                  />
                </div>
              }
              actions={
                !disabled
                  ? [
                      <Button
                        key="delete"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleRemove(idx)}
                        aria-label={`Remove image ${idx + 1}`}
                      >
                        Remove
                      </Button>,
                    ]
                  : undefined
              }
            >
              <Typography.Paragraph
                ellipsis={{ rows: 1, tooltip: url }}
                type="secondary"
                style={{ marginBottom: 0, fontSize: 12 }}
              >
                {url}
              </Typography.Paragraph>
            </Card>
          ))}
        </div>
      )}
    </Space>
  );
}
