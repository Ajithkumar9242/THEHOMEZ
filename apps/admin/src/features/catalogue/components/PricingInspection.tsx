import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Result,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PermissionCode, type IProductPricing } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { pricingClient } from '../api/pricing-client.js';

const integerRupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Formats an exact integer-paise amount without converting paise through floating point. */
export function formatPricePaise(value: number | null | undefined): string {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return '—';
  const paise = BigInt(value);
  const rupees = paise / 100n;
  const fraction = String(paise % 100n).padStart(2, '0');
  return `₹${integerRupees.format(Number(rupees))}.${fraction}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function PricingError({ error, retry }: { error: unknown; retry: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const isMissing = apiError?.status === 404;
  const title =
    apiError?.status === 401
      ? 'Session expired'
      : apiError?.status === 403
        ? 'Permission denied'
        : 'Could not load pricing';
  const message =
    apiError?.status === 401
      ? 'Your session has expired. Sign in again to continue.'
      : apiError?.status === 403
        ? 'Your staff account does not have PRICING_READ access.'
        : isMissing
          ? 'The selected product or variant pricing context could not be found.'
          : apiError?.status === 0
            ? 'Unable to reach the API. Check that the backend is running.'
            : apiError?.status && apiError.status >= 500
              ? 'The pricing service is temporarily unavailable. Try again.'
              : error instanceof Error
                ? error.message
                : 'Could not load pricing configuration.';
  if (isMissing)
    return <Result status="404" title="Pricing context not found" subTitle={message} />;
  return (
    <Alert
      type={apiError?.status === 401 || apiError?.status === 403 ? 'error' : 'warning'}
      showIcon
      role="alert"
      message={title}
      description={message}
      action={
        apiError?.status === 401 ? (
          <Button type="link" href="/sign-in">
            Sign in
          </Button>
        ) : (
          <Button icon={<ReloadOutlined />} onClick={retry}>
            Retry
          </Button>
        )
      }
    />
  );
}

function PricingRecordCard({ record, areaName }: { record: IProductPricing; areaName?: string }) {
  const regional = record.serviceAreaId !== null;
  return (
    <Card
      className="catalogue-card pricing-record-card"
      variant="borderless"
      title={record.pricingScope.replaceAll('_', ' ')}
      extra={
        <Tag color={record.isActive ? 'green' : 'default'}>
          {record.isActive ? 'Active' : 'Inactive'}
        </Tag>
      }
    >
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="Configuration">
          {regional ? 'Regional' : 'Global'}
        </Descriptions.Item>
        {regional && (
          <Descriptions.Item label="Service area reference">
            <span>
              {areaName ? `${areaName} · ` : ''}
              {record.serviceAreaId}
            </span>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Currency">{record.currency}</Descriptions.Item>
        <Descriptions.Item label="B2C price">
          {formatPricePaise(record.b2cPricePaise)}
        </Descriptions.Item>
        <Descriptions.Item label="MRP">{formatPricePaise(record.b2cMrpPaise)}</Descriptions.Item>
        <Descriptions.Item label="B2B base price">
          {formatPricePaise(record.b2bPricePaise)}
        </Descriptions.Item>
        <Descriptions.Item label="Version">{record.version}</Descriptions.Item>
        <Descriptions.Item label="Created">{formatTimestamp(record.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Last updated">
          {formatTimestamp(record.updatedAt)}
        </Descriptions.Item>
      </Descriptions>
      {record.b2bTiers.length > 0 && (
        <>
          <Typography.Title level={5}>B2B volume tiers</Typography.Title>
          <Table
            size="small"
            rowKey={(tier) => `${record.id}-tier-${tier.minQuantity}`}
            pagination={false}
            dataSource={record.b2bTiers}
            columns={[
              {
                title: 'Minimum qualifying quantity',
                dataIndex: 'minQuantity',
                key: 'minQuantity',
                render: (value: string) => <Typography.Text>{value}</Typography.Text>,
              },
              {
                title: 'Price per applicable unit',
                dataIndex: 'pricePaise',
                key: 'pricePaise',
                render: (value: number) => formatPricePaise(value),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

export function PricingInspection({
  productId,
  variantId,
  productHasVariants = false,
}: {
  productId: string;
  variantId?: string;
  productHasVariants?: boolean;
}) {
  const { user } = useAuth();
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const canReadAreas = user?.permissions.includes(PermissionCode.SERVICE_AREA_READ) ?? false;
  const [records, setRecords] = useState<IProductPricing[] | null>(null);
  const [recordsContext, setRecordsContext] = useState<string | null>(null);
  const [areaNames, setAreaNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const contextKey = `${productId}:${variantId || 'standalone'}`;
  const currentRecords = recordsContext === contextKey ? records : null;

  useEffect(() => {
    if (!canReadPricing || !productId || (variantId !== undefined && !variantId)) {
      setRecords(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setRecords(null);
    setRecordsContext(null);
    setAreaNames(new Map());
    setLoading(true);
    setError(null);
    const request = variantId
      ? pricingClient.getVariantPricing(productId, variantId, { signal: controller.signal })
      : productHasVariants
        ? Promise.resolve([])
        : pricingClient.getProductPricing(productId, { signal: controller.signal });
    void request
      .then(async (result) => {
        if (controller.signal.aborted) return;
        const scoped = result.filter((record) =>
          variantId
            ? record.productId === productId && record.variantId === variantId
            : record.productId === productId && record.variantId === null,
        );
        setRecords(scoped);
        setRecordsContext(contextKey);
        if (!canReadAreas) return;
        const areaIds = [
          ...new Set(
            scoped.flatMap((record) => (record.serviceAreaId ? [record.serviceAreaId] : [])),
          ),
        ];
        const resolved = await Promise.all(
          areaIds.map(async (id) => {
            try {
              const area = await serviceAreaClient.get(id, { signal: controller.signal });
              return [id, area.name] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!controller.signal.aborted) {
          setAreaNames(
            new Map(resolved.filter((item): item is readonly [string, string] => item !== null)),
          );
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRecords(null);
          setRecordsContext(contextKey);
          setError(reason);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canReadPricing, canReadAreas, productId, variantId, productHasVariants, attempt, contextKey]);

  const title = variantId ? 'Variant pricing configuration' : 'Product pricing configuration';
  const areaPermissionNotice = useMemo(() => canReadAreas, [canReadAreas]);
  if (!canReadPricing) {
    return (
      <Alert
        type="error"
        showIcon
        message="PRICING_READ permission required"
        description="Your account cannot inspect stored pricing. No pricing API request was made."
      />
    );
  }

  return (
    <Space direction="vertical" size="middle" className="catalogue-sections pricing-inspection">
      <Alert
        type="info"
        showIcon
        message="Configured prices are GST-exclusive. These are stored pricing configurations, not final delivered customer totals."
        description="Regional schedules replace the global schedule when the pricing engine resolves an active regional match; they are not added together. Stored records are not a statement of the currently effective customer price."
      />
      {!areaPermissionNotice && currentRecords?.some((record) => record.serviceAreaId) && (
        <Alert
          type="warning"
          showIcon
          message="Service-area names are unavailable"
          description="SERVICE_AREA_READ is not present. Regional records remain visible by their stored service-area ID; no service-area lookup was requested."
        />
      )}
      {loading || (canReadPricing && !error && recordsContext !== contextKey) ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : error ? (
        <PricingError error={error} retry={() => setAttempt((current) => current + 1)} />
      ) : currentRecords?.length ? (
        <>
          <Typography.Title level={4}>{title}</Typography.Title>
          {currentRecords.map((record) => (
            <PricingRecordCard
              key={record.id}
              record={record}
              areaName={record.serviceAreaId ? areaNames.get(record.serviceAreaId) : undefined}
            />
          ))}
        </>
      ) : (
        <Empty
          description={
            productHasVariants && !variantId
              ? 'This product is a variant container. Inspect pricing on an individual variant.'
              : 'No pricing configuration was returned for this catalogue item'
          }
        />
      )}
    </Space>
  );
}
