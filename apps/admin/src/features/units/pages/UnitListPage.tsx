import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Radio,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ClearOutlined,
  EditOutlined,
  EyeOutlined,
  FilterOutlined,
  PlusOutlined,
  PoweroffOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import {
  PermissionCode,
  type IUnit,
  type UnitClassification,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { unitClient } from '../api/unit-client.js';
import { UnitError } from '../components/UnitError.js';
import { UnitStatus } from '../components/UnitStatus.js';
import { UnitFormDrawer } from '../components/UnitFormDrawer.js';
import { UnitStatusModal } from '../components/UnitStatusModal.js';

const classifications: UnitClassification[] = ['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME'];

type StatusFilterOption = 'active' | 'all' | 'inactive';

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
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function UnitListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN');
  const hasWritePermission = Boolean(
    isSuperAdmin || user?.permissions.includes(PermissionCode.CATALOG_WRITE),
  );

  // Filter drafts (UI inputs)
  const [searchDraft, setSearchDraft] = useState('');
  const [classificationDraft, setClassificationDraft] = useState<UnitClassification>();
  const [statusFilterDraft, setStatusFilterDraft] = useState<StatusFilterOption>('active');

  // Applied filters
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState<UnitClassification>();
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('active');

  // Data & loading states
  const [units, setUnits] = useState<IUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Modal / Drawer states
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<IUnit | null>(null);

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [targetActiveStatus, setTargetActiveStatus] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // activeOnly is true if statusFilter is 'active', false if 'all' or 'inactive'
    const activeOnly = statusFilter === 'active';

    void unitClient
      .list({
        classification,
        activeOnly,
        search: search.trim() || undefined,
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          // If statusFilter is 'inactive', filter client-side for inactive units
          if (statusFilter === 'inactive') {
            setUnits(result.filter((u) => !u.isActive));
          } else {
            setUnits(result);
          }
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [classification, statusFilter, search, attempt]);

  const applyFilters = () => {
    setSearch(searchDraft);
    setClassification(classificationDraft);
    setStatusFilter(statusFilterDraft);
  };

  const clearFilters = () => {
    setSearchDraft('');
    setClassificationDraft(undefined);
    setStatusFilterDraft('active');
    setSearch('');
    setClassification(undefined);
    setStatusFilter('active');
  };

  // Metrics from current dataset
  const metrics = useMemo(() => {
    const total = units.length;
    const active = units.filter((u) => u.isActive).length;
    const inactive = units.filter((u) => !u.isActive).length;
    const discrete = units.filter((u) => u.isDiscrete).length;
    const continuous = total - discrete;
    return { total, active, inactive, discrete, continuous };
  }, [units]);

  const handleUnitSaved = (savedUnit: IUnit) => {
    message.success(`Measurement unit ${savedUnit.code} saved successfully`);
    setAttempt((v) => v + 1);
  };

  const handleStatusUpdated = (updatedUnit: IUnit) => {
    message.success(
      `Unit ${updatedUnit.code} is now ${updatedUnit.isActive ? 'Active' : 'Inactive'}`,
    );
    setAttempt((v) => v + 1);
  };

  const openEditDrawer = (unit: IUnit) => {
    setSelectedUnit(unit);
    setEditDrawerOpen(true);
  };

  const openStatusConfirmation = (unit: IUnit, targetActive: boolean) => {
    setSelectedUnit(unit);
    setTargetActiveStatus(targetActive);
    setStatusModalOpen(true);
  };

  return (
    <div className="unit-page">
      <div className="catalogue-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <Typography.Text className="eyebrow">CATALOGUE REFERENCE</Typography.Text>
          <Typography.Title level={1} style={{ margin: '4px 0 8px' }}>
            Units of Measurement
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Manage construction measurement units, dimensional classifications, and quantity precision rules.
          </Typography.Paragraph>
        </div>
        {hasWritePermission && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateDrawerOpen(true)}
            size="large"
          >
            Create Unit
          </Button>
        )}
      </div>

      {/* Statistics Overview */}
      {!loading && !error && (
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={12} sm={6}>
            <Card variant="borderless">
              <Statistic title="Total Displayed" value={metrics.total} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless">
              <Statistic
                title="Active Units"
                value={metrics.active}
                valueStyle={{ color: '#10b981' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless">
              <Statistic
                title="Inactive Units"
                value={metrics.inactive}
                valueStyle={{ color: metrics.inactive > 0 ? '#ef4444' : '#64748b' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card variant="borderless">
              <Statistic
                title="Discrete / Continuous"
                value={`${metrics.discrete} / ${metrics.continuous}`}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Filter and Search Card */}
      <Card variant="borderless" className="catalogue-card" style={{ marginBottom: 20 }}>
        <div className="unit-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: '1 1 200px', minWidth: 200 }}>
            <Typography.Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
              Search Code or Name
            </Typography.Text>
            <Input
              prefix={<SearchOutlined />}
              placeholder="e.g. SQ_FT, Tonne"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onPressEnter={applyFilters}
              allowClear
            />
          </div>

          <div className="unit-classification-filter">
            <Typography.Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
              Classification
            </Typography.Text>
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
            <Typography.Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
              Status
            </Typography.Text>
            <Radio.Group
              aria-label="Filter by status"
              optionType="button"
              buttonStyle="solid"
              value={statusFilterDraft}
              onChange={(event) => setStatusFilterDraft(event.target.value)}
              options={[
                { value: 'active', label: 'Active only' },
                { value: 'all', label: 'All units' },
                { value: 'inactive', label: 'Inactive only' },
              ]}
            />
          </div>

          <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
            <Button type="primary" icon={<FilterOutlined />} onClick={applyFilters}>
              Apply filters
            </Button>
            <Button icon={<ClearOutlined />} onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </div>

        {statusFilter === 'all' && (
          <Alert
            className="unit-filter-note"
            type="info"
            showIcon
            message="Displaying both active and inactive units."
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* Directory Table */}
      <Card variant="borderless" className="catalogue-card">
        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : error ? (
            <UnitError error={error} retry={() => setAttempt((value) => value + 1)} />
          ) : units.length === 0 ? (
            <Empty description="No units match these filters" />
          ) : (
            <Table<IUnit>
              rowKey="code"
              dataSource={units}
              scroll={{ x: 1300 }}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} units`,
              }}
              columns={[
                {
                  title: 'Code',
                  dataIndex: 'code',
                  key: 'code',
                  width: 130,
                  render: (code: string) => (
                    <Link
                      to={`/catalogue/units/${encodeURIComponent(code)}`}
                      style={{ fontWeight: 600 }}
                    >
                      {code}
                    </Link>
                  ),
                },
                {
                  title: 'Name',
                  dataIndex: 'name',
                  key: 'name',
                  width: 160,
                },
                {
                  title: 'Symbol',
                  dataIndex: 'symbol',
                  key: 'symbol',
                  width: 90,
                  render: (symbol: string) => <Tag>{symbol}</Tag>,
                },
                {
                  title: 'Singular / Plural',
                  key: 'labels',
                  width: 170,
                  render: (_: unknown, record: IUnit) => (
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      {record.singularLabel} / {record.pluralLabel}
                    </Typography.Text>
                  ),
                },
                {
                  title: 'Classification',
                  dataIndex: 'classification',
                  key: 'classification',
                  width: 130,
                  render: (classification: UnitClassification) => (
                    <Tag color={classificationColorMap[classification] || 'default'}>
                      {classification}
                    </Tag>
                  ),
                },
                {
                  title: 'Quantity Behavior',
                  dataIndex: 'isDiscrete',
                  key: 'discrete',
                  width: 160,
                  render: (isDiscrete: boolean) =>
                    isDiscrete ? (
                      <Tag color="geekblue">Discrete (Whole)</Tag>
                    ) : (
                      <Tag color="cyan">Continuous (Decimal)</Tag>
                    ),
                },
                {
                  title: 'Max Precision',
                  dataIndex: 'allowedMaxPrecision',
                  key: 'precision',
                  width: 120,
                  render: (precision: number) => (
                    <span>
                      {precision} {precision === 1 ? 'decimal' : 'decimals'}
                    </span>
                  ),
                },
                {
                  title: 'Conversions',
                  key: 'conversions',
                  width: 130,
                  render: (_: unknown, record: IUnit) => {
                    if (record.code === 'TONNE' || record.code === 'KG') {
                      return <Tag color="gold">TONNE ↔ KG</Tag>;
                    }
                    return <Typography.Text type="secondary">—</Typography.Text>;
                  },
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
                  width: 130,
                  render: (isSystem: boolean) =>
                    isSystem ? <Tag color="blue">System</Tag> : <Tag>Custom</Tag>,
                },
                {
                  title: 'Updated',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  width: 120,
                  render: formatDate,
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  fixed: 'right',
                  width: 160,
                  render: (_: unknown, record: IUnit) => (
                    <Space size="small">
                      <Tooltip title="View details">
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() =>
                            navigate(`/catalogue/units/${encodeURIComponent(record.code)}`)
                          }
                        />
                      </Tooltip>

                      {hasWritePermission && (
                        <Tooltip title="Edit unit properties">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditDrawer(record)}
                          />
                        </Tooltip>
                      )}

                      {hasWritePermission && (
                        <Tooltip
                          title={
                            record.isActive
                              ? 'Deactivate measurement unit'
                              : 'Activate measurement unit'
                          }
                        >
                          <Button
                            type="text"
                            size="small"
                            danger={record.isActive}
                            icon={<PoweroffOutlined />}
                            onClick={() =>
                              openStatusConfirmation(record, !record.isActive)
                            }
                          />
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {/* Create Unit Drawer */}
      <UnitFormDrawer
        open={createDrawerOpen}
        mode="create"
        onClose={() => setCreateDrawerOpen(false)}
        onSuccess={handleUnitSaved}
      />

      {/* Edit Unit Drawer */}
      <UnitFormDrawer
        open={editDrawerOpen}
        mode="edit"
        unit={selectedUnit}
        onClose={() => {
          setEditDrawerOpen(false);
          setSelectedUnit(null);
        }}
        onSuccess={handleUnitSaved}
      />

      {/* Activation / Deactivation Confirmation Modal */}
      <UnitStatusModal
        open={statusModalOpen}
        unit={selectedUnit}
        targetActive={targetActiveStatus}
        onClose={() => {
          setStatusModalOpen(false);
          setSelectedUnit(null);
        }}
        onSuccess={handleStatusUpdated}
      />
    </div>
  );
}
