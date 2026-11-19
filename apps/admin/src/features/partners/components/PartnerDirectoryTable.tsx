import { Button, Empty, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type {
  IAdminPartnerQueryDto,
  IPartnerAdminSummaryDto,
  PartnerStatus,
} from '@thehomez/shared-types';
import { PartnerStatusBadge } from './PartnerStatusBadge.js';
import { PartnerDeliveryModeBadge } from './PartnerDeliveryModeBadge.js';

interface PartnerDirectoryTableProps {
  items: IPartnerAdminSummaryDto[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  sortBy: IAdminPartnerQueryDto['sortBy'];
  sortOrder: IAdminPartnerQueryDto['sortOrder'];
  onPaginationChange: (page: number, pageSize?: number) => void;
  onSortChange: (
    sortBy: IAdminPartnerQueryDto['sortBy'],
    sortOrder: IAdminPartnerQueryDto['sortOrder'],
  ) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function PartnerDirectoryTable({
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
}: PartnerDirectoryTableProps) {
  const navigate = useNavigate();

  const columns: ColumnsType<IPartnerAdminSummaryDto> = [
    {
      title: 'Business Name',
      dataIndex: 'businessName',
      key: 'businessName',
      sorter: true,
      sortOrder: sortBy === 'businessName' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (name: string, record) => (
        <div>
          <Typography.Link
            strong
            onClick={() => navigate(`/partners/${record.id}`)}
            aria-label={`View details for ${name}`}
          >
            {name}
          </Typography.Link>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontFamily: 'monospace' }}>
            ID: {record.id}
          </div>
        </div>
      ),
    },
    {
      title: 'Legal Name',
      dataIndex: 'legalName',
      key: 'legalName',
      render: (legal: string | null) =>
        legal || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string) => (
        <Typography.Text copyable={{ text: phone }}>{phone}</Typography.Text>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string | null) =>
        email ? (
          <Typography.Text copyable={{ text: email }}>{email}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      sorter: true,
      sortOrder: sortBy === 'status' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (status: PartnerStatus) => <PartnerStatusBadge status={status} />,
    },
    {
      title: 'Delivery Mode',
      dataIndex: 'deliveryMode',
      key: 'deliveryMode',
      render: (mode: 'PARTNER_MANAGED' | 'PLATFORM_MANAGED') => (
        <PartnerDeliveryModeBadge deliveryMode={mode} />
      ),
    },
    {
      title: 'Service Areas',
      dataIndex: 'serviceAreaCount',
      key: 'serviceAreaCount',
      align: 'right',
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: true,
      sortOrder: sortBy === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (val: string) => formatDate(val),
    },
    {
      title: 'Updated At',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      sorter: true,
      sortOrder: sortBy === 'updatedAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (val: string) => formatDate(val),
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/partners/${record.id}`)}
          aria-label={`Inspect ${record.businessName}`}
        >
          Inspect
        </Button>
      ),
    },
  ];

  return (
    <Table<IPartnerAdminSummaryDto>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      scroll={{ x: 1100 }}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50', '100'],
        showTotal: (totalCount, range) => `${range[0]}–${range[1]} of ${totalCount} partners`,
        onChange: onPaginationChange,
      }}
      onChange={(_pagination, _filters, sorter) => {
        if (!Array.isArray(sorter) && sorter.columnKey) {
          const field = sorter.columnKey as IAdminPartnerQueryDto['sortBy'];
          const order = sorter.order === 'ascend' ? 'asc' : 'desc';
          onSortChange(field, order);
        }
      }}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              hasActiveFilters
                ? 'No partners match the specified filters'
                : 'No partner organizations registered yet'
            }
          >
            {hasActiveFilters && (
              <Button type="primary" onClick={onClearFilters}>
                Clear Active Filters
              </Button>
            )}
          </Empty>
        ),
      }}
    />
  );
}
