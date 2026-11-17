import { Button, Empty, Table, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { useNavigate } from 'react-router-dom';
import type { IAdminCustomerListItemDto } from '@thehomez/shared-types';
import { CustomerStatusBadge } from './CustomerStatusBadge.js';
import { CustomerSegmentBadge } from './CustomerSegmentBadge.js';
import type { SortDirection, SortField } from '../hooks/useCustomerDirectory.js';

interface CustomerDirectoryTableProps {
  items: IAdminCustomerListItemDto[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  sortBy: SortField;
  sortOrder: SortDirection;
  onPaginationChange: (page: number, limit: number) => void;
  onSortChange: (field: SortField, direction: SortDirection) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatLocation(city: string | null, pincode: string | null): string {
  if (city && pincode) return `${city} - ${pincode}`;
  if (city) return city;
  if (pincode) return pincode;
  return '—';
}

export function CustomerDirectoryTable({
  items,
  loading,
  page,
  limit,
  total,
  sortBy,
  sortOrder,
  onPaginationChange,
  onSortChange,
  onClearFilters,
  hasActiveFilters,
}: CustomerDirectoryTableProps) {
  const navigate = useNavigate();

  const handleTableChange = (
    _pagination: TablePaginationConfig,
    _filters: Record<string, unknown>,
    sorter: SorterResult<IAdminCustomerListItemDto> | SorterResult<IAdminCustomerListItemDto>[],
  ) => {
    const singleSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (singleSorter && singleSorter.order) {
      const field = (singleSorter.columnKey || singleSorter.field) as SortField;
      const direction: SortDirection = singleSorter.order === 'ascend' ? 'asc' : 'desc';
      onSortChange(field, direction);
    } else {
      // Default reset
      onSortChange('createdAt', 'desc');
    }
  };

  const columns: ColumnsType<IAdminCustomerListItemDto> = [
    {
      title: 'Customer',
      key: 'phone',
      width: 220,
      sorter: true,
      sortOrder: sortBy === 'phone' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, record) => (
        <div>
          <Typography.Link
            href={`/customers/${encodeURIComponent(record.id)}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/customers/${encodeURIComponent(record.id)}`);
            }}
            style={{ display: 'block', fontSize: 13, fontWeight: 600 }}
            aria-label={`Inspect customer ${record.phone}`}
          >
            {record.phone}
          </Typography.Link>
          <Typography.Text
            type="secondary"
            copyable={{ text: record.id }}
            style={{ fontSize: 11, fontFamily: 'monospace' }}
          >
            {record.id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      render: (email: string | null) =>
        email ? (
          <Typography.Text copyable={{ text: email }}>{email}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Segment',
      dataIndex: 'customerSegment',
      key: 'segment',
      width: 140,
      render: (segment: 'B2B' | 'B2C') => <CustomerSegmentBadge segment={segment} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 160,
      render: (status) => <CustomerStatusBadge status={status} />,
    },
    {
      title: 'Addresses',
      dataIndex: 'addressCount',
      key: 'addressCount',
      width: 100,
      align: 'center',
      render: (count: number) => count ?? 0,
    },
    {
      title: 'Default Location',
      key: 'defaultLocation',
      width: 180,
      render: (_, record) => formatLocation(record.defaultCity, record.defaultPincode),
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 150,
      sorter: true,
      sortOrder: sortBy === 'lastLoginAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (lastLoginAt: string | null) => (lastLoginAt ? formatDate(lastLoginAt) : 'Never'),
    },
    {
      title: 'Registered',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      sorter: true,
      sortOrder: sortBy === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (createdAt: string) => formatDate(createdAt),
    },
    {
      title: 'Action',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/customers/${encodeURIComponent(record.id)}`)}
          aria-label={`View details for customer ${record.phone}`}
        >
          View Details
        </Button>
      ),
    },
  ];

  const emptyDescription = hasActiveFilters
    ? 'No customers match the current search or filter criteria'
    : 'No customer accounts registered';

  return (
    <Table<IAdminCustomerListItemDto>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      scroll={{ x: 1200 }}
      onChange={handleTableChange}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        showSizeChanger: true,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        showTotal: (count) => `${count.toLocaleString()} customers`,
        onChange: (newPage, newLimit) => onPaginationChange(newPage, newLimit),
      }}
      locale={{
        emptyText: (
          <Empty description={emptyDescription}>
            {hasActiveFilters && (
              <Button type="primary" onClick={onClearFilters}>
                Clear filters
              </Button>
            )}
          </Empty>
        ),
      }}
    />
  );
}
