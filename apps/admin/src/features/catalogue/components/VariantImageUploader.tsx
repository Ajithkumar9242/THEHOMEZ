import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Image,
  Input,
  Progress,
  Space,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { MAX_VARIANT_IMAGES } from '@thehomez/shared-types';
import { uploadClient } from '../api/upload-client.js';
import { ApiError } from '../../../services/api-client.js';

export interface VariantImageUploaderProps {
  value?: string[];
  onChange?: (urls: string[]) => void;
  onUploadingChange?: (isUploading: boolean) => void;
  disabled?: boolean;
}

const HTTP_URL_REGEX = /^https?:\/\/[^\s$.?#].[^\s]*$/i;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function VariantImageUploader({
  value = [],
  onChange,
  onUploadingChange,
  disabled = false,
}: VariantImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastFailedFile, setLastFailedFile] = useState<File | null>(null);

  // Manual URL state
  const [manualUrl, setManualUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const setUploadState = (isUploading: boolean) => {
    setUploading(isUploading);
    onUploadingChange?.(isUploading);
  };

  const executeUpload = (file: File) => {
    setUploadState(true);
    setUploadPercent(20);
    setUploadError(null);
    setLastFailedFile(null);

    const progressTimer = setInterval(() => {
      setUploadPercent((prev) => (prev < 85 ? prev + 15 : prev));
    }, 250);

    uploadClient
      .uploadProductImage(file)
      .then((res) => {
        clearInterval(progressTimer);
        setUploadPercent(100);
        setTimeout(() => {
          onChange?.([...value, res.url]);
          setUploadState(false);
          setUploadPercent(0);
          setLastFailedFile(null);
        }, 200);
      })
      .catch((err: unknown) => {
        clearInterval(progressTimer);
        setUploadState(false);
        setUploadPercent(0);
        setLastFailedFile(file);
        if (err instanceof ApiError) {
          setUploadError(`${err.message} (${err.code})`);
        } else if (err instanceof Error) {
          setUploadError(err.message);
        } else {
          setUploadError('Failed to upload image. Please check your connection and try again.');
        }
      });
  };

  const handleManualAdd = () => {
    const trimmed = manualUrl.trim();
    if (!trimmed) {
      setUrlError('Please enter an image URL');
      return;
    }
    if (!HTTP_URL_REGEX.test(trimmed)) {
      setUrlError('URL must begin with http:// or https:// and be a valid web address');
      return;
    }
    if (value.includes(trimmed)) {
      setUrlError('This image URL is already in the list');
      return;
    }
    if (value.length >= MAX_VARIANT_IMAGES) {
      setUrlError(`Cannot exceed ${MAX_VARIANT_IMAGES} images`);
      return;
    }

    setUrlError(null);
    setManualUrl('');
    onChange?.([...value, trimmed]);
  };

  const handleRemove = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    onChange?.(updated);
  };

  const handleMove = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= value.length) return;
    const updated = [...value];
    const item = updated.splice(fromIndex, 1)[0];
    if (item) {
      updated.splice(toIndex, 0, item);
      onChange?.(updated);
    }
  };

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    showUploadList: false,
    accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    disabled: disabled || uploading || value.length >= MAX_VARIANT_IMAGES,
    beforeUpload(file) {
      setUploadError(null);
      setLastFailedFile(null);

      // Validate count limit
      if (value.length >= MAX_VARIANT_IMAGES) {
        setUploadError(`Maximum limit of ${MAX_VARIANT_IMAGES} images reached.`);
        return Upload.LIST_IGNORE;
      }

      // Validate extension / MIME type
      const filename = file.name.toLowerCase();
      const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => filename.endsWith(ext));
      const hasValidMime = ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
      if (!hasValidExt && !hasValidMime) {
        setUploadError(
          `Unsupported file format for "${file.name}". Please upload a JPG, JPEG, PNG, or WebP image.`,
        );
        return Upload.LIST_IGNORE;
      }

      // Validate size limit (5MB)
      if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        setUploadError(
          `Image "${file.name}" is ${sizeMb} MB, which exceeds the maximum limit of 5 MB.`,
        );
        return Upload.LIST_IGNORE;
      }

      return true;
    },
    customRequest({ file, onSuccess, onError }) {
      const uploadFile = file as File;
      setUploadState(true);
      setUploadPercent(20);
      setUploadError(null);
      setLastFailedFile(null);

      const progressTimer = setInterval(() => {
        setUploadPercent((prev) => (prev < 85 ? prev + 15 : prev));
      }, 250);

      void uploadClient
        .uploadProductImage(uploadFile)
        .then((res) => {
          clearInterval(progressTimer);
          setUploadPercent(100);
          setTimeout(() => {
            onChange?.([...value, res.url]);
            setUploadState(false);
            setUploadPercent(0);
            setLastFailedFile(null);
            onSuccess?.(res);
          }, 200);
        })
        .catch((err: unknown) => {
          clearInterval(progressTimer);
          setUploadState(false);
          setUploadPercent(0);
          setLastFailedFile(uploadFile);
          if (err instanceof ApiError) {
            setUploadError(`${err.message} (${err.code})`);
          } else if (err instanceof Error) {
            setUploadError(err.message);
          } else {
            setUploadError('Failed to upload image. Please check your connection and try again.');
          }
          onError?.(err as Error);
        });
    },
  };

  const atLimit = value.length >= MAX_VARIANT_IMAGES;

  return (
    <div className="variant-image-uploader">
      {/* Header with counter */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Space size={8} align="center">
          <Typography.Text strong style={{ fontSize: 14 }}>
            Variant Images
          </Typography.Text>
          <Badge
            count={`${value.length} / ${MAX_VARIANT_IMAGES}`}
            style={{
              backgroundColor: atLimit ? '#f59e0b' : '#3b82f6',
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          JPG, PNG, WebP · Max 5MB per file
        </Typography.Text>
      </div>

      {/* Upload Error Banner with Retry */}
      {uploadError && (
        <Alert
          type="error"
          showIcon
          closable
          message="Upload Failed"
          description={
            <div>
              <Typography.Paragraph style={{ marginBottom: lastFailedFile ? 8 : 0 }}>
                {uploadError}
              </Typography.Paragraph>
              {lastFailedFile && (
                <Button
                  size="small"
                  type="primary"
                  danger
                  icon={<ReloadOutlined />}
                  onClick={() => executeUpload(lastFailedFile)}
                  disabled={uploading}
                >
                  Retry Upload
                </Button>
              )}
            </div>
          }
          onClose={() => {
            setUploadError(null);
            setLastFailedFile(null);
          }}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Upload Section (Cloudinary Dragger + Add by URL) */}
      {!disabled && !atLimit && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '16px',
            marginBottom: 16,
          }}
        >
          <Upload.Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon" style={{ marginBottom: 8 }}>
              <InboxOutlined style={{ color: '#8b2626', fontSize: 36 }} />
            </p>
            <p className="ant-upload-text" style={{ fontSize: 14, fontWeight: 500 }}>
              Click to browse or drag image to this area to upload
            </p>
            <p className="ant-upload-hint" style={{ fontSize: 12, color: '#64748b' }}>
              Supports JPG, PNG, and WebP. Automatically hosted and optimized by Cloudinary CDN.
            </p>
          </Upload.Dragger>
          {uploading && (
            <div style={{ marginTop: 12 }}>
              <Progress
                percent={uploadPercent}
                status="active"
                strokeColor="#8b2626"
                size="small"
              />
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', textAlign: 'center' }}
              >
                Uploading and processing variant image on Cloudinary CDN...
              </Typography.Text>
            </div>
          )}

          {/* Direct URL input fallback */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #cbd5e1' }}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginBottom: 6 }}
            >
              Or add image by URL:
            </Typography.Text>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="https://example.com/images/variant.jpg"
                  value={manualUrl}
                  onChange={(e) => {
                    setManualUrl(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    handleManualAdd();
                  }}
                  disabled={disabled || uploading}
                  status={urlError ? 'error' : undefined}
                  aria-label="Image URL input"
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleManualAdd}
                  disabled={disabled || uploading || !manualUrl.trim()}
                >
                  Add Image
                </Button>
              </Space.Compact>
              {urlError && <Typography.Text type="danger">{urlError}</Typography.Text>}
            </Space>
          </div>
        </div>
      )}

      {atLimit && (
        <Alert
          type="info"
          showIcon
          message={`Maximum limit of ${MAX_VARIANT_IMAGES} images reached.`}
          description="Remove existing images if you need to upload different variant views."
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Gallery Grid */}
      {value.length === 0 ? (
        <div
          style={{
            border: '1px dashed #cbd5e1',
            borderRadius: 8,
            padding: '24px 16px',
            textAlign: 'center',
            background: '#ffffff',
          }}
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            No variant images uploaded yet
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Variant images showcase specific size, diameter, color, or finish options for this SKU.
            Up to 10 images supported.
          </Typography.Text>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginTop: 8,
          }}
        >
          {value.map((url, idx) => (
            <Card
              key={`${url}-${idx}`}
              size="small"
              variant="outlined"
              style={{
                borderRadius: 8,
                overflow: 'hidden',
                borderColor: idx === 0 ? '#8b2626' : '#e2e8f0',
                boxShadow: idx === 0 ? '0 2px 8px -2px rgba(139, 38, 38, 0.18)' : undefined,
              }}
              cover={
                <div
                  style={{
                    position: 'relative',
                    height: 120,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f8fafc',
                    overflow: 'hidden',
                  }}
                >
                  <Image
                    src={url}
                    alt={`Variant view ${idx + 1}`}
                    height={120}
                    style={{ objectFit: 'contain' }}
                    fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8'>Preview</text></svg>"
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      background: idx === 0 ? '#8b2626' : 'rgba(15, 23, 42, 0.75)',
                      color: '#ffffff',
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {idx === 0 ? 'Primary' : `#${idx + 1}`}
                  </div>
                </div>
              }
              actions={
                !disabled
                  ? [
                      <Button
                        key="left"
                        type="text"
                        size="small"
                        icon={<ArrowLeftOutlined />}
                        disabled={idx === 0 || uploading}
                        onClick={() => handleMove(idx, idx - 1)}
                        aria-label={`Move image ${idx + 1} left`}
                        title="Move left (higher priority)"
                      />,
                      <Button
                        key="right"
                        type="text"
                        size="small"
                        icon={<ArrowRightOutlined />}
                        disabled={idx === value.length - 1 || uploading}
                        onClick={() => handleMove(idx, idx + 1)}
                        aria-label={`Move image ${idx + 1} right`}
                        title="Move right (lower priority)"
                      />,
                      <Button
                        key="delete"
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={uploading}
                        onClick={() => handleRemove(idx)}
                        aria-label={`Remove image ${idx + 1}`}
                        title="Remove image"
                      />,
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
    </div>
  );
}
