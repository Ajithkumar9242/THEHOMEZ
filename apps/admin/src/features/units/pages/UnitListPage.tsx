import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Radio, Skeleton, Table, Tag, Typography } from 'antd';
import { ClearOutlined, FilterOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { IUnit, UnitClassification } from '@thehomez/shared-types';
import { unitClient } from '../api/unit-client.js';
import { UnitError } from '../components/UnitError.js';
import { UnitStatus } from '../components/UnitStatus.js';

const classifications: UnitClassification[] = ['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME'];

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function UnitListPage() {
  const [classificationDraft, setClassificationDraft] = useState<UnitClassification>();
  const [includeInactiveDraft, setIncludeInactiveDraft] = useState(false);
  const [classification, setClassification] = useState<UnitClassification>();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [units, setUnits] = useState<IUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void unitClient
      .list({ classification, activeOnly: !includeInactive, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setUnits(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [classification, includeInactive, attempt]);

  const applyFilters = () => {
    setClassification(classificationDraft);
    setIncludeInactive(includeInactiveDraft);
  };
  const clearFilters = () => {
    setClassificationDraft(undefined);
    setIncludeInactiveDraft(false);
    setClassification(undefined);
    setIncludeInactive(false);
  };

  return (
    <div className="unit-page">
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">CATALOGUE REFERENCE</Typography.Text>
          <Typography.Title level={1}>Units of Measurement</Typography.Title>
          <Typography.Paragraph type="secondary">
            Read-only reference for configured construction measurement units.
          </Typography.Paragraph>
        </div>
        {!loading && !error && <Tag>{units.length.toLocaleString()} units</Tag>}
      </div>
      <Card variant="borderless" className="catalogue-card">
        <div className="unit-filters">
          <div className="unit-classification-filter">
            <Typography.Text>Classification</Typography.Text>
            <Radio.Group
              aria-label="Filter by classification"
              optionType="button"
              buttonStyle="solid"
              value={classificationDraft || 'ALL'}
              onChange={(event) =>
                setClassificationDraft(
                  event.target.value === 'ALL' ? undefined : event.target.value,
                )
              }
              options={[
                { value: 'ALL', label: 'All' },
                ...classifications.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="unit-inactive-filter">
            <Typography.Text>Inactive records</Typography.Text>
            <Radio.Group
              aria-label="Inactive record inclusion"
              optionType="button"
              buttonStyle="solid"
              value={includeInactiveDraft ? 'include' : 'active'}
              onChange={(event) => setIncludeInactiveDraft(event.target.value === 'include')}
              options={[
                { value: 'active', label: 'Active only' },
                { value: 'include', label: 'Include inactive' },
              ]}
            />
          </div>
          <Button type="primary" icon={<FilterOutlined />} onClick={applyFilters}>
            Apply filters
          </Button>
          <Button icon={<ClearOutlined />} onClick={clearFilters}>
            Clear
          </Button>
        </div>
        {includeInactive && (
          <Alert
            className="unit-filter-note"
            type="info"
            showIcon
            message="Include inactive returns active and inactive units."
            description="The API has no inactive-only filter."
          />
        )}
        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : error ? (
            <UnitError error={error} retry={() => setAttempt((value) => value + 1)} />
          ) : units.length === 0 ? (
            <Empty description="No units match these filters" />
          ) : (
            <Table<IUnit>
              rowKey="code"
              dataSource={units}
              scroll={{ x: 1250 }}
              pagination={false}
              columns={[
                {
                  title: 'Code',
                  dataIndex: 'code',
                  key: 'code',
                  width: 120,
                  render: (code: string) => (
                    <Link to={`/catalogue/units/${encodeURIComponent(code)}`}>{code}</Link>
                  ),
                },
                { title: 'Name', dataIndex: 'name', key: 'name', width: 150 },
                { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', width: 90 },
                { title: 'Singular', dataIndex: 'singularLabel', key: 'singular', width: 140 },
                { title: 'Plural', dataIndex: 'pluralLabel', key: 'plural', width: 150 },
                {
                  title: 'Classification',
                  dataIndex: 'classification',
                  key: 'classification',
                  width: 130,
                },
                {
                  title: 'Quantity behavior',
                  dataIndex: 'isDiscrete',
                  key: 'discrete',
                  width: 155,
                  render: (isDiscrete: boolean) => (isDiscrete ? 'Discrete' : 'Continuous'),
                },
                {
                  title: 'Max precision',
                  dataIndex: 'allowedMaxPrecision',
                  key: 'precision',
                  width: 125,
                },
                {
                  title: 'Status',
                  dataIndex: 'isActive',
                  key: 'status',
                  width: 105,
                  render: (isActive: boolean) => <UnitStatus isActive={isActive} />,
                },
                {
                  title: 'Management',
                  dataIndex: 'isSystem',
                  key: 'system',
                  width: 140,
                  render: (isSystem: boolean) =>
                    isSystem ? <Tag color="blue">System managed</Tag> : <Tag>Custom</Tag>,
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  width: 260,
                  render: (description?: string) => description || '—',
                },
                {
                  title: 'Updated',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  width: 130,
                  render: formatDate,
                },
              ]}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
