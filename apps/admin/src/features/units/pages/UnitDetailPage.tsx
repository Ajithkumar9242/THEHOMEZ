import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  PoweroffOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PermissionCode,
  UNIT_CODE_REGEX,
  type IUnit,
  type IUnitConversionRate,
  type UnitClassification,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { unitClient } from '../api/unit-client.js';
import { UnitError } from '../components/UnitError.js';
import { UnitStatus } from '../components/UnitStatus.js';
import { UnitFormDrawer } from '../components/UnitFormDrawer.js';
import { UnitStatusModal } from '../components/UnitStatusModal.js';

const classificationColorMap: Record<UnitClassification, string> = {
  COUNT: 'purple',
  MASS: 'blue',
  LENGTH: 'green',
  AREA: 'orange',
  VOLUME: 'cyan',
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function UnitDetailPage() {
  const { code = '' } = useParams();
  const normalizedCode = code.trim().toUpperCase();
  const validCode = UNIT_CODE_REGEX.test(normalizedCode);
  const navigate = useNavigate();

  const { user } = useAuth();
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN');
  const hasWritePermission = Boolean(
    isSuperAdmin || user?.permissions.includes(PermissionCode.CATALOG_WRITE),
  );

  const [unit, setUnit] = useState<IUnit | null>(null);
  const [conversions, setConversions] = useState<IUnitConversionRate[]>([]);
  const [loading, setLoading] = useState(validCode);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Edit Drawer & Status Modal
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  useEffect(() => {
    if (!validCode) {
      setLoading(false);
      setUnit(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      unitClient.getByCode(normalizedCode, { signal: controller.signal }),
      unitClient.listConversions({ signal: controller.signal }).catch(() => []),
    ])
      .then(([unitResult, conversionsResult]) => {
        if (!controller.signal.aborted) {
          setUnit(unitResult);
          setConversions(conversionsResult);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [validCode, normalizedCode, attempt]);

  const handleUnitSaved = (savedUnit: IUnit) => {
    message.success(`Unit ${savedUnit.code} updated successfully`);
    setUnit(savedUnit);
    setAttempt((v) => v + 1);
  };

  const handleStatusUpdated = (updatedUnit: IUnit) => {
    message.success(
      `Unit ${updatedUnit.code} status changed to ${updatedUnit.isActive ? 'Active' : 'Inactive'}`,
    );
    setUnit(updatedUnit);
    setAttempt((v) => v + 1);
  };

  // Find conversions relevant to this unit
  const relevantConversions = conversions.filter(
    (c) => c.fromUnit === normalizedCode || c.toUnit === normalizedCode,
  );

  return (
    <div className="unit-detail-page">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/catalogue/units')}
        style={{ marginBottom: 16 }}
      >
        Back to units
      </Button>

      {!validCode ? (
        <Result
          status="error"
          title="Invalid unit code"
          subTitle="Unit codes must contain 2–20 uppercase letters, digits, or underscores."
          extra={
            <Button type="primary" onClick={() => navigate('/catalogue/units')}>
              Back to units
            </Button>
          }
        />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : error ? (
        <UnitError error={error} retry={() => setAttempt((value) => value + 1)} />
      ) : unit ? (
        <>
          <div
            className="catalogue-heading"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 20,
            }}
          >
            <div>
              <Typography.Text className="eyebrow">UNIT DETAILS</Typography.Text>
              <Typography.Title level={1} style={{ margin: '4px 0 8px' }}>
                {unit.name} <Tag style={{ fontSize: 16, verticalAlign: 'middle' }}>{unit.code}</Tag>
              </Typography.Title>
            </div>
            <Space>
              <UnitStatus isActive={unit.isActive} />
              {hasWritePermission && (
                <>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => setEditDrawerOpen(true)}
                  >
                    Edit Unit
                  </Button>
                  <Button
                    danger={unit.isActive}
                    icon={<PoweroffOutlined />}
                    onClick={() => setStatusModalOpen(true)}
                  >
                    {unit.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </>
              )}
            </Space>
          </div>

          <Card variant="borderless" title="Measurement Specifications" style={{ marginBottom: 20 }}>
            {unit.description && (
              <Alert
                className="unit-description"
                type="info"
                showIcon
                message={unit.description}
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="middle" bordered>
              <Descriptions.Item label="ID">{unit.id}</Descriptions.Item>
              <Descriptions.Item label="Canonical Code">
                <strong>{unit.code}</strong>
              </Descriptions.Item>
              <Descriptions.Item label="Name">{unit.name}</Descriptions.Item>
              <Descriptions.Item label="Symbol / Abbr.">
                <Tag>{unit.symbol}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Singular label">{unit.singularLabel}</Descriptions.Item>
              <Descriptions.Item label="Plural label">{unit.pluralLabel}</Descriptions.Item>
              <Descriptions.Item label="Physical Classification">
                <Tag color={classificationColorMap[unit.classification] || 'default'}>
                  {unit.classification}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Quantity behavior">
                {unit.isDiscrete
                  ? 'Discrete — whole integer quantities only (0 decimals).'
                  : 'Continuous — decimal quantities permitted within the precision ceiling.'}
              </Descriptions.Item>
              <Descriptions.Item label="Maximum allowed precision">
                {unit.allowedMaxPrecision} {unit.allowedMaxPrecision === 1 ? 'decimal place' : 'decimal places'}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <UnitStatus isActive={unit.isActive} />
              </Descriptions.Item>
              <Descriptions.Item label="Management Type">
                {unit.isSystem ? <Tag color="blue">System managed</Tag> : <Tag>Custom</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Created At">{formatDate(unit.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Updated At">{formatDate(unit.updatedAt)}</Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Universal Conversion Details */}
          {relevantConversions.length > 0 && (
            <Card
              variant="borderless"
              title={
                <Space>
                  <SwapOutlined />
                  <span>Configured Universal Conversions</span>
                </Space>
              }
              style={{ marginBottom: 20 }}
            >
              <Typography.Paragraph type="secondary">
                Universal conversions allow exact scaled conversions between compatible physical units without material density factors.
              </Typography.Paragraph>
              <Space direction="vertical" style={{ width: '100%' }}>
                {relevantConversions.map((conv, idx) => (
                  <Alert
                    key={idx}
                    type="success"
                    showIcon
                    message={conv.formula}
                    description={`Factor: ${conv.factor} | Max Precision: ${conv.precision} decimal places`}
                  />
                ))}
              </Space>
            </Card>
          )}

          {/* Edit Drawer */}
          <UnitFormDrawer
            open={editDrawerOpen}
            mode="edit"
            unit={unit}
            onClose={() => setEditDrawerOpen(false)}
            onSuccess={handleUnitSaved}
          />

          {/* Status Modal */}
          <UnitStatusModal
            open={statusModalOpen}
            unit={unit}
            targetActive={!unit.isActive}
            onClose={() => setStatusModalOpen(false)}
            onSuccess={handleStatusUpdated}
          />
        </>
      ) : null}
    </div>
  );
}
