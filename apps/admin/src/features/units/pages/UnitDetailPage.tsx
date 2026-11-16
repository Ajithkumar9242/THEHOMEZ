import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Skeleton, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { UNIT_CODE_REGEX, type IUnit } from '@thehomez/shared-types';
import { unitClient } from '../api/unit-client.js';
import { UnitError } from '../components/UnitError.js';
import { UnitStatus } from '../components/UnitStatus.js';

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
  const [unit, setUnit] = useState<IUnit | null>(null);
  const [loading, setLoading] = useState(validCode);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validCode) {
      setLoading(false);
      setUnit(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void unitClient
      .getByCode(normalizedCode, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setUnit(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [validCode, normalizedCode, attempt]);

  return (
    <div className="unit-detail-page">
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/catalogue/units')}>
        Back to units
      </Button>
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">UNIT DETAILS</Typography.Text>
          <Typography.Title level={1}>{unit?.name || 'Unit'}</Typography.Title>
        </div>
        {unit && <UnitStatus isActive={unit.isActive} />}
      </div>
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
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : error ? (
        <UnitError error={error} retry={() => setAttempt((value) => value + 1)} />
      ) : unit ? (
        <Card variant="borderless" title="Measurement unit">
          {unit.description && (
            <Alert className="unit-description" type="info" showIcon message={unit.description} />
          )}
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
            <Descriptions.Item label="ID">{unit.id}</Descriptions.Item>
            <Descriptions.Item label="Code">{unit.code}</Descriptions.Item>
            <Descriptions.Item label="Name">{unit.name}</Descriptions.Item>
            <Descriptions.Item label="Symbol">{unit.symbol}</Descriptions.Item>
            <Descriptions.Item label="Singular label">{unit.singularLabel}</Descriptions.Item>
            <Descriptions.Item label="Plural label">{unit.pluralLabel}</Descriptions.Item>
            <Descriptions.Item label="Classification">{unit.classification}</Descriptions.Item>
            <Descriptions.Item label="Quantity behavior">
              {unit.isDiscrete
                ? 'Discrete — fractional quantities are not allowed.'
                : 'Continuous — decimal quantities may be used within the precision ceiling.'}
            </Descriptions.Item>
            <Descriptions.Item label="Maximum allowed precision">
              {unit.allowedMaxPrecision} decimal places
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <UnitStatus isActive={unit.isActive} />
            </Descriptions.Item>
            <Descriptions.Item label="Management">
              {unit.isSystem ? <Tag color="blue">System managed</Tag> : <Tag>Custom</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Created">{formatDate(unit.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="Updated">{formatDate(unit.updatedAt)}</Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}
    </div>
  );
}
