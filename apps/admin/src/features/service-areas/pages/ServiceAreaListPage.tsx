import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Radio,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ClearOutlined, FilterOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PermissionCode, type IServiceArea } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { serviceAreaClient } from '../api/service-area-client.js';
import type { ServiceAreaListQuery } from '../api/service-area-client.js';
import { ServiceAreaError } from '../components/ServiceAreaError.js';
import { ServiceAreaStatus } from '../components/ServiceAreaStatus.js';
import { ServiceAreaFormDrawer } from '../components/ServiceAreaFormDrawer.js';

interface AreaFilters {
  city?: string;
  state?: string;
  isActive?: boolean;
}

const REGEX_OPERATOR = /[\\^$.*+?()[\]{}|]/;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function ServiceAreaListPage() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.SERVICE_AREA_READ) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.SERVICE_AREA_WRITE) ?? false;
  const navigate = useNavigate();
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>();
  const [filters, setFilters] = useState<AreaFilters>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [items, setItems] = useState<IServiceArea[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  useEffect(() => {
    if (!canRead) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query: ServiceAreaListQuery = { ...filters, page, limit, signal: controller.signal };
    void serviceAreaClient
      .list(query)
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.items);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, filters, page, limit, attempt]);

  const applyFilters = () => {
    const normalizedCity = city.trim();
    const normalizedState = state.trim();
    if (REGEX_OPERATOR.test(normalizedCity) || REGEX_OPERATOR.test(normalizedState)) {
      setFilterError('Enter ordinary city and state text without regular-expression symbols.');
      return;
    }
    setFilterError(null);
    const isActive =
      activeFilter === 'active' ? true : activeFilter === 'inactive' ? false : undefined;
    setFilters({
      city: normalizedCity || undefined,
      state: normalizedState || undefined,
      isActive,
    });
    setPage(1);
  };

  const clearFilters = () => {
    setCity('');
    setState('');
    setActiveFilter(undefined);
    setFilterError(null);
    setFilters({});
    setPage(1);
  };

  if (!canRead)
    return (
      <Alert
        type="error"
        showIcon
        message="SERVICE_AREA_READ permission required"
        description="Your account cannot inspect service areas. The service-area API was not requested."
      />
    );

  return (
    <div className="service-area-page">
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">GEOGRAPHY</Typography.Text>
          <Typography.Title level={1}>Service Areas</Typography.Title>
          <Typography.Paragraph type="secondary">
            Configured areas and their PIN-code coverage.
          </Typography.Paragraph>
        </div>
        <Space>
          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateDrawerOpen(true)}
              aria-label="Create service area button"
            >
              Create Service Area
            </Button>
          )}
          <Tag>{total.toLocaleString()} service areas</Tag>
        </Space>
      </div>
      <Card variant="borderless" className="catalogue-card">
        <div className="service-area-filters">
          <Input
            allowClear
            aria-label="Filter by city"
            placeholder="City"
            maxLength={100}
            value={city}
            onChange={(event) => setCity(event.target.value)}
            onPressEnter={applyFilters}
          />
          <Input
            allowClear
            aria-label="Filter by state"
            placeholder="State"
            maxLength={100}
            value={state}
            onChange={(event) => setState(event.target.value)}
            onPressEnter={applyFilters}
          />
          <Radio.Group
            aria-label="Filter by status"
            optionType="button"
            buttonStyle="solid"
            value={activeFilter || 'all'}
            onChange={(event) =>
              setActiveFilter(event.target.value === 'all' ? undefined : event.target.value)
            }
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <Button type="primary" icon={<FilterOutlined />} onClick={applyFilters}>
            Apply filters
          </Button>
          <Button icon={<ClearOutlined />} onClick={clearFilters}>
            Clear
          </Button>
        </div>
        {filterError && (
          <Alert
            className="service-area-state-note"
            type="warning"
            showIcon
            message={filterError}
          />
        )}
        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : error ? (
            <ServiceAreaError
              error={error}
              retry={() => setAttempt((current) => current + 1)}
              resource="service areas"
            />
          ) : items.length === 0 ? (
            <Empty description="No service areas match these filters" />
          ) : (
            <Table<IServiceArea>
              rowKey="id"
              dataSource={items}
              scroll={{ x: 980 }}
              pagination={{
                current: page,
                pageSize: limit,
                total,
                showSizeChanger: true,
                pageSizeOptions: PAGE_SIZE_OPTIONS.map(String),
                showTotal: (count) => `${count} service areas`,
                onChange: (nextPage, nextLimit) => {
                  setPage(nextPage);
                  if (nextLimit !== limit) setLimit(nextLimit);
                },
              }}
              columns={[
                { title: 'Code', dataIndex: 'code', key: 'code', width: 130 },
                { title: 'Name', dataIndex: 'name', key: 'name', width: 190 },
                { title: 'City', dataIndex: 'city', key: 'city', width: 150 },
                { title: 'State', dataIndex: 'state', key: 'state', width: 150 },
                { title: 'Country', dataIndex: 'countryCode', key: 'country', width: 100 },
                {
                  title: 'PINs',
                  dataIndex: 'pincodes',
                  key: 'pincodesCount',
                  width: 80,
                  render: (pins: string[]) => pins.length,
                },
                {
                  title: 'Status',
                  dataIndex: 'isActive',
                  key: 'status',
                  width: 110,
                  render: (isActive: boolean) => <ServiceAreaStatus isActive={isActive} />,
                },
                {
                  title: 'Radius',
                  dataIndex: 'deliveryRadiusKm',
                  key: 'radius',
                  width: 100,
                  render: (radius?: number) => (radius == null ? '—' : `${radius} km`),
                },
                {
                  title: 'Updated',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  width: 120,
                  render: formatDate,
                },
                {
                  title: '',
                  key: 'action',
                  fixed: 'right',
                  width: 130,
                  render: (_, area) => (
                    <Button
                      className="service-area-row-action"
                      type="link"
                      onClick={() => navigate(`/service-areas/${encodeURIComponent(area.id)}`)}
                    >
                      View details
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </div>
        {!loading && !error && items.length > 0 && (
          <Space>
            <Typography.Text type="secondary">
              Page {page} of {totalPages}
            </Typography.Text>
          </Space>
        )}
      </Card>

      <ServiceAreaFormDrawer
        open={createDrawerOpen}
        mode="create"
        onClose={() => setCreateDrawerOpen(false)}
        onSuccess={(created) => {
          message.success(`Service area "${created.name}" created successfully`);
          setAttempt((current) => current + 1);
        }}
      />
    </div>
  );
}
