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
import {
  CheckCircleOutlined,
  DollarOutlined,
  EditOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { PermissionCode, type IProductPricing, type IServiceArea } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { pricingClient } from '../api/pricing-client.js';
import {
  comparePricePaise,
  compareVolumeTiers,
  formatPaiseExact,
  type PriceComparison,
  type TierComparisonRow,
} from '../utils/pricing-comparison.js';

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

function PriceComparisonTag({
  comparison,
  baseLabel = 'global',
}: {
  comparison: PriceComparison;
  baseLabel?: string;
}) {
  if (!comparison.hasComparison) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        ({comparison.label})
      </Typography.Text>
    );
  }

  if (comparison.direction === 'HIGHER') {
    return (
      <Tag color="volcano" style={{ fontWeight: 500 }}>
        +{formatPaiseExact(comparison.absDiffPaise)} higher than {baseLabel}
      </Tag>
    );
  }

  if (comparison.direction === 'LOWER') {
    return (
      <Tag color="green" style={{ fontWeight: 500 }}>
        -{formatPaiseExact(comparison.absDiffPaise)} lower than {baseLabel}
      </Tag>
    );
  }

  return (
    <Tag color="default" style={{ fontWeight: 500 }}>
      Equal to {baseLabel}
    </Tag>
  );
}

function GlobalPricingCard({
  record,
  canWrite = false,
  onEdit,
}: {
  record: IProductPricing;
  canWrite?: boolean;
  onEdit?: (record: IProductPricing) => void;
}) {
  return (
    <Card
      className="catalogue-card pricing-record-card global-pricing-card"
      variant="borderless"
      title={
        <Space wrap>
          <GlobalOutlined style={{ color: '#1677ff' }} />
          <span>{record.pricingScope.replaceAll('_', ' ')}</span>
          <Tag color="blue">GLOBAL BASELINE</Tag>
          <Tag color="cyan">Fallback Schedule</Tag>
        </Space>
      }
      extra={
        <Space>
          <Tag color={record.isActive ? 'green' : 'default'}>
            {record.isActive ? 'Active' : 'Inactive'}
          </Tag>
          <Tag>Version {record.version}</Tag>
          {canWrite && onEdit && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
              aria-label="Edit global pricing button"
            >
              Edit Pricing
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="Platform Default Baseline Schedule"
        description="This schedule serves as the commercial default across all active service areas. Any serviceable delivery pincode without a dedicated regional override automatically falls back to these rates."
        style={{ marginBottom: 16 }}
      />
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
        <Descriptions.Item label="Configuration">Global Baseline</Descriptions.Item>
        <Descriptions.Item label="Currency">{record.currency}</Descriptions.Item>
        <Descriptions.Item label="B2C price">
          <Typography.Text strong style={{ fontSize: 16 }}>
            {formatPricePaise(record.b2cPricePaise)}
          </Typography.Text>
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

      <div style={{ marginTop: 16 }}>
        <Typography.Title level={5}>B2B volume tiers</Typography.Title>
        {record.b2bTiers.length > 0 ? (
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
                render: (value: number) => (
                  <Typography.Text strong>{formatPricePaise(value)}</Typography.Text>
                ),
              },
            ]}
          />
        ) : (
          <Typography.Text type="secondary">
            No B2B volume discount slabs configured on the global baseline.
          </Typography.Text>
        )}
      </div>
    </Card>
  );
}

function RegionalPricingCard({
  record,
  globalRecord,
  areaName,
  canWrite = false,
  onEdit,
}: {
  record: IProductPricing;
  globalRecord: IProductPricing | null;
  areaName?: string;
  canWrite?: boolean;
  onEdit?: (record: IProductPricing) => void;
}) {
  const b2cComparison = useMemo(
    () => comparePricePaise(record.b2cPricePaise, globalRecord?.b2cPricePaise),
    [record.b2cPricePaise, globalRecord?.b2cPricePaise],
  );

  const mrpComparison = useMemo(
    () => comparePricePaise(record.b2cMrpPaise, globalRecord?.b2cMrpPaise),
    [record.b2cMrpPaise, globalRecord?.b2cMrpPaise],
  );

  const b2bComparison = useMemo(
    () => comparePricePaise(record.b2bPricePaise, globalRecord?.b2bPricePaise),
    [record.b2bPricePaise, globalRecord?.b2bPricePaise],
  );

  const tiersComparison = useMemo(
    () => compareVolumeTiers(record.b2bTiers, globalRecord?.b2bTiers),
    [record.b2bTiers, globalRecord?.b2bTiers],
  );

  const displayName = areaName ? `${areaName} · ${record.serviceAreaId}` : record.serviceAreaId;

  return (
    <Card
      className="catalogue-card pricing-record-card regional-pricing-card"
      variant="borderless"
      style={{ borderLeft: '4px solid #722ed1' }}
      title={
        <Space wrap>
          <span style={{ fontWeight: 600 }}>{areaName || 'Regional Override'}</span>
          <Tag color="purple">REGIONAL OVERRIDE</Tag>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            {record.pricingScope.replaceAll('_', ' ')}
          </span>
        </Space>
      }
      extra={
        <Space>
          <Tag color={record.isActive ? 'green' : 'default'}>
            {record.isActive ? 'Active' : 'Inactive'}
          </Tag>
          <Tag>Version {record.version}</Tag>
          {canWrite && onEdit && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
              aria-label={`Edit regional override for ${areaName || record.serviceAreaId} button`}
            >
              Edit Override
            </Button>
          )}
        </Space>
      }
    >
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
        <Descriptions.Item label="Configuration">Regional</Descriptions.Item>
        <Descriptions.Item label="Service area reference">
          <span>{displayName}</span>
        </Descriptions.Item>
        <Descriptions.Item label="Currency">{record.currency}</Descriptions.Item>

        <Descriptions.Item label="B2C price">
          <Space direction="vertical" size={2}>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {formatPricePaise(record.b2cPricePaise)}
            </Typography.Text>
            <PriceComparisonTag comparison={b2cComparison} baseLabel="global" />
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label="MRP">
          <Space direction="vertical" size={2}>
            <span>{formatPricePaise(record.b2cMrpPaise)}</span>
            {record.b2cMrpPaise != null && globalRecord?.b2cMrpPaise != null && (
              <PriceComparisonTag comparison={mrpComparison} baseLabel="global MRP" />
            )}
            {record.b2cMrpPaise == null && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                (Not set on regional)
              </Typography.Text>
            )}
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label="B2B base price">
          <Space direction="vertical" size={2}>
            <span>{formatPricePaise(record.b2bPricePaise)}</span>
            {record.b2bPricePaise != null && globalRecord?.b2bPricePaise != null && (
              <PriceComparisonTag comparison={b2bComparison} baseLabel="global B2B" />
            )}
            {record.b2bPricePaise == null && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                (Not configured on regional)
              </Typography.Text>
            )}
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label="Version">{record.version}</Descriptions.Item>
        <Descriptions.Item label="Created">{formatTimestamp(record.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Last updated">
          {formatTimestamp(record.updatedAt)}
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 16 }}>
        <Typography.Title level={5}>B2B volume tiers</Typography.Title>
        {tiersComparison.hasRegionalTiers ? (
          <>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {tiersComparison.summaryMessage}
            </Typography.Paragraph>
            <Table<TierComparisonRow>
              size="small"
              rowKey={(tier) => `${record.id}-tier-${tier.minQuantity}`}
              pagination={false}
              dataSource={tiersComparison.rows.filter(
                (r) => r.status === 'MATCHED' || r.status === 'REGIONAL_ONLY',
              )}
              columns={[
                {
                  title: 'Minimum qualifying quantity',
                  dataIndex: 'minQuantity',
                  key: 'minQuantity',
                  render: (value: string) => <Typography.Text>{value}</Typography.Text>,
                },
                {
                  title: 'Regional price per unit',
                  dataIndex: 'regionalPricePaise',
                  key: 'regionalPricePaise',
                  render: (value: number | null) => (
                    <Typography.Text strong>{formatPricePaise(value)}</Typography.Text>
                  ),
                },
                {
                  title: 'Global baseline rate',
                  dataIndex: 'globalPricePaise',
                  key: 'globalPricePaise',
                  render: (value: number | null) => formatPricePaise(value),
                },
                {
                  title: 'Comparison vs Global',
                  key: 'comparison',
                  render: (_, row) => {
                    if (row.status === 'MATCHED' && row.comparison) {
                      return (
                        <PriceComparisonTag comparison={row.comparison} baseLabel="global tier" />
                      );
                    }
                    if (row.status === 'REGIONAL_ONLY') {
                      return <Tag color="purple">Custom regional slab</Tag>;
                    }
                    return null;
                  },
                },
              ]}
            />
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message="No Regional Volume Tiers Configured"
            description="Contractors in this service area do not receive bulk volume discounts. In accordance with zero-inheritance rules, global baseline volume tiers are NOT inherited by regional overrides."
          />
        )}
      </div>
    </Card>
  );
}

export function PricingInspection({
  productId,
  variantId,
  productHasVariants = false,
  onSetPricing,
  onEditPricing,
  onAddRegionalOverride,
  onEditRegionalOverride,
  onGlobalRecordLoaded,
  onRegionalRecordsLoaded,
  refreshKey = 0,
}: {
  productId: string;
  variantId?: string;
  productHasVariants?: boolean;
  onSetPricing?: () => void;
  onEditPricing?: (record: IProductPricing) => void;
  onAddRegionalOverride?: () => void;
  onEditRegionalOverride?: (record: IProductPricing) => void;
  onGlobalRecordLoaded?: (record: IProductPricing | null) => void;
  onRegionalRecordsLoaded?: (records: IProductPricing[]) => void;
  refreshKey?: number;
}) {
  const { user } = useAuth();
  const canReadPricing = user?.permissions.includes(PermissionCode.PRICING_READ) ?? false;
  const canWritePricing = user?.permissions.includes(PermissionCode.PRICING_WRITE) ?? false;
  const canReadAreas = user?.permissions.includes(PermissionCode.SERVICE_AREA_READ) ?? false;

  const [records, setRecords] = useState<IProductPricing[] | null>(null);
  const [recordsContext, setRecordsContext] = useState<string | null>(null);
  const [areaNames, setAreaNames] = useState<Map<string, string>>(new Map());
  const [activeServiceAreas, setActiveServiceAreas] = useState<IServiceArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const contextKey = `${productId}:${variantId || 'standalone'}`;
  const currentRecords = recordsContext === contextKey ? records : null;

  useEffect(() => {
    if (!canReadPricing || !productId || (variantId !== undefined && !variantId)) {
      setRecords(null);
      setLoading(false);
      onGlobalRecordLoaded?.(null);
      onRegionalRecordsLoaded?.([]);
      return;
    }
    const controller = new AbortController();
    setRecords(null);
    setRecordsContext(null);
    setAreaNames(new Map());
    setActiveServiceAreas([]);
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

        const globalRecord = scoped.find((r) => r.serviceAreaId === null) || null;
        onGlobalRecordLoaded?.(globalRecord);

        const regionalList = scoped.filter((r) => r.serviceAreaId !== null);
        onRegionalRecordsLoaded?.(regionalList);

        if (!canReadAreas) return;

        let listedAreas: IServiceArea[] = [];
        if (typeof serviceAreaClient.list === 'function') {
          try {
            const listRes = await serviceAreaClient.list({
              isActive: true,
              limit: 100,
              signal: controller.signal,
            });
            if (!controller.signal.aborted && listRes?.items) {
              listedAreas = listRes.items;
              setActiveServiceAreas(listedAreas);
            }
          } catch {
            // graceful degradation if listing fails
          }
        }

        const areaIds = [
          ...new Set(
            scoped.flatMap((record) => (record.serviceAreaId ? [record.serviceAreaId] : [])),
          ),
        ];

        const resolved = await Promise.all(
          areaIds.map(async (id) => {
            const known = listedAreas.find((a) => a.id === id);
            if (known) return [id, known.name] as const;
            try {
              const area = await serviceAreaClient.get(id, { signal: controller.signal });
              return [id, area.name] as const;
            } catch {
              return null;
            }
          }),
        );

        if (!controller.signal.aborted) {
          const mapEntries = [
            ...listedAreas.map((a) => [a.id, a.name] as const),
            ...resolved.filter((item): item is readonly [string, string] => item !== null),
          ];
          setAreaNames(new Map(mapEntries));
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRecords(null);
          setRecordsContext(contextKey);
          setError(reason);
          onGlobalRecordLoaded?.(null);
          onRegionalRecordsLoaded?.([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    canReadPricing,
    canReadAreas,
    productId,
    variantId,
    productHasVariants,
    attempt,
    contextKey,
    refreshKey,
    onGlobalRecordLoaded,
    onRegionalRecordsLoaded,
  ]);

  const globalRecord = useMemo(
    () => currentRecords?.find((r) => r.serviceAreaId === null) || null,
    [currentRecords],
  );

  const regionalRecords = useMemo(
    () => currentRecords?.filter((r) => r.serviceAreaId !== null) || [],
    [currentRecords],
  );

  const overrideAreaIds = useMemo(
    () => new Set(regionalRecords.map((r) => r.serviceAreaId).filter(Boolean)),
    [regionalRecords],
  );

  const areasUsingGlobal = useMemo(
    () => activeServiceAreas.filter((area) => !overrideAreaIds.has(area.id)),
    [activeServiceAreas, overrideAreaIds],
  );

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

          {/* Section 1: Global Baseline */}
          {globalRecord ? (
            <GlobalPricingCard
              record={globalRecord}
              canWrite={canWritePricing}
              onEdit={onEditPricing}
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              message="No Global Baseline Pricing Configured"
              description="A global baseline price is recommended as the fallback for all service areas without a dedicated regional override."
            />
          )}

          {/* Section 2: Regional Overrides */}
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 12,
              }}
            >
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  Regional Service-Area Overrides ({regionalRecords.length})
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Regional price schedules completely replace the global baseline for that area.
                </Typography.Text>
              </div>
              {canWritePricing && onAddRegionalOverride && (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={onAddRegionalOverride}
                  aria-label="Add regional override button"
                >
                  Add Regional Override
                </Button>
              )}
            </div>

            {regionalRecords.length > 0 ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {regionalRecords.map((record) => (
                  <RegionalPricingCard
                    key={record.id}
                    record={record}
                    globalRecord={globalRecord}
                    areaName={
                      record.serviceAreaId ? areaNames.get(record.serviceAreaId) : undefined
                    }
                    canWrite={canWritePricing}
                    onEdit={onEditRegionalOverride}
                  />
                ))}
              </Space>
            ) : (
              <Card variant="borderless" style={{ background: '#fafafa', textAlign: 'center' }}>
                <Space direction="vertical" size="small">
                  <Typography.Text strong>No Regional Overrides Configured</Typography.Text>
                  <Typography.Text type="secondary">
                    All serviceable areas currently use the global baseline schedule.
                  </Typography.Text>
                </Space>
              </Card>
            )}
          </div>

          {/* Section 3: Service Areas Coverage Summary (when SERVICE_AREA_READ available) */}
          {canReadAreas && activeServiceAreas.length > 0 && (
            <Card
              size="small"
              variant="borderless"
              style={{ background: '#f5f5f5', marginTop: 8 }}
              title={
                <Space>
                  <InfoCircleOutlined style={{ color: '#1890ff' }} />
                  <span>Service Area Coverage Summary</span>
                </Space>
              }
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Typography.Text>
                  <strong>Total active service areas:</strong> {activeServiceAreas.length} ·{' '}
                  <strong>With regional override:</strong> {regionalRecords.length} ·{' '}
                  <strong>Using global baseline fallback:</strong> {areasUsingGlobal.length}
                </Typography.Text>

                {areasUsingGlobal.length > 0 ? (
                  <div>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                    >
                      Active service areas using global baseline pricing (no override configured):
                    </Typography.Text>
                    <Space wrap size={[4, 8]}>
                      {areasUsingGlobal.map((area) => (
                        <Tag key={area.id} icon={<CheckCircleOutlined />}>
                          {area.name} ({area.code})
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : (
                  <Typography.Text type="secondary">
                    All {activeServiceAreas.length} active service areas have dedicated regional
                    overrides configured.
                  </Typography.Text>
                )}
              </Space>
            </Card>
          )}
        </>
      ) : (
        <Empty
          description={
            productHasVariants && !variantId
              ? 'This product is a variant container. Inspect pricing on an individual variant.'
              : 'No pricing configuration was returned for this catalogue item'
          }
        >
          {canWritePricing && !(productHasVariants && !variantId) && onSetPricing && (
            <Button
              type="primary"
              icon={<DollarOutlined />}
              onClick={onSetPricing}
              aria-label="Set pricing button"
            >
              Set Pricing
            </Button>
          )}
        </Empty>
      )}
    </Space>
  );
}
