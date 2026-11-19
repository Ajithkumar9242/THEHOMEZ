import { Button, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { IPartnerApplicationSummaryDto } from '@thehomez/shared-types';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationDirectoryTableProps {
  items: IPartnerApplicationSummaryDto[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number, pageSize: number) => void;
}

export function PartnerApplicationDirectoryTable({
  items,
  loading,
  page,
  limit,
  total,
  onPageChange,
}: PartnerApplicationDirectoryTableProps) {
  const navigate = useNavigate();

  const columns: ColumnsType<IPartnerApplicationSummaryDto> = [
    {
      title: 'Business Name',
      dataIndex: 'businessName',
      key: 'businessName',
      render: (text: string, record) => (
        <Typography.Link
          onClick={() => navigate(`/partner-applications/${record.id}`)}
          style={{ fontWeight: 500 }}
        >
          {text}
        </Typography.Link>
      ),
    },
    {
      title: 'Contact Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string) => <Typography.Text copyable>{phone}</Typography.Text>,
    },
    {
      title: 'Contact Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string | null) => email || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status) => <PartnerApplicationStatusBadge status={status} />,
    },
    {
      title: 'Delivery Mode',
      dataIndex: 'deliveryMode',
      key: 'deliveryMode',
      render: (mode: string) => (
        <Tag color={mode === 'PARTNER_MANAGED' ? 'blue' : 'purple'}>
          {mode === 'PARTNER_MANAGED' ? 'Partner Managed' : 'Platform Managed'}
        </Tag>
      ),
    },
    {
      title: 'Service Areas',
      dataIndex: 'serviceAreaCount',
      key: 'serviceAreaCount',
      align: 'center',
      render: (count: number) => <Tag color="cyan">{count} {count === 1 ? 'Area' : 'Areas'}</Tag>,
    },
    {
      title: 'Submitted On',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => {
        try {
          return new Date(val).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return val;
        }
      },
    },
    {
      title: 'Action',
      key: 'action',
      align: 'center',
      render: (_, record) => (
        <Button
          type="text"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/partner-applications/${record.id}`)}
          aria-label={`View details for ${record.businessName}`}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <Table<IPartnerApplicationSummaryDto>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50'],
        showTotal: (tot, range) => `${range[0]}-${range[1]} of ${tot} applications`,
        onChange: onPageChange,
      }}
      locale={{
        emptyText: 'No partner applications found matching the selected criteria.',
      }}
      scroll={{ x: 900 }}
    />
  );
}
