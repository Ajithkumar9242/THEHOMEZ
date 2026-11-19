import { Empty, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowRightOutlined } from '@ant-design/icons';
import type { IPartnerAuditLogDto, PartnerStatus } from '@thehomez/shared-types';
import { PartnerStatusBadge } from './PartnerStatusBadge.js';

interface PartnerAuditHistoryTableProps {
  items: IPartnerAuditLogDto[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPaginationChange: (page: number, pageSize?: number) => void;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function PartnerAuditHistoryTable({
  items,
  loading,
  page,
  limit,
  total,
  onPaginationChange,
}: PartnerAuditHistoryTableProps) {
  const columns: ColumnsType<IPartnerAuditLogDto> = [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (val: string) => (
        <Typography.Text style={{ fontSize: 13 }}>{formatDate(val)}</Typography.Text>
      ),
    },
    {
      title: 'Status Transition',
      key: 'transition',
      width: 260,
      render: (_, record) => {
        const prevStatus = record.previousState?.status as PartnerStatus | undefined;
        const nextStatus = record.newState?.status as PartnerStatus | undefined;

        return (
          <Space align="center" size="small">
            {prevStatus ? (
              <PartnerStatusBadge status={prevStatus} />
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
            <ArrowRightOutlined style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }} />
            {nextStatus ? (
              <PartnerStatusBadge status={nextStatus} />
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Audit Reason',
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: string) => (
        <Typography.Paragraph
          ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
          style={{ margin: 0, fontSize: 13 }}
        >
          {reason}
        </Typography.Paragraph>
      ),
    },
    {
      title: 'Authorized Staff Actor',
      dataIndex: 'performedBy',
      key: 'performedBy',
      width: 220,
      render: (performedBy: IPartnerAuditLogDto['performedBy']) => {
        if (!performedBy) return <Typography.Text type="secondary">—</Typography.Text>;
        const identity = performedBy.email || performedBy.phone || performedBy.id;
        return (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {identity}
            </Typography.Text>
            {performedBy.email && performedBy.phone && (
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{performedBy.phone}</div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Table<IPartnerAuditLogDto>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      scroll={{ x: 750 }}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50'],
        showTotal: (totalCount, range) => `${range[0]}–${range[1]} of ${totalCount} events`,
        onChange: onPaginationChange,
      }}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No lifecycle status change events recorded for this partner organization"
          />
        ),
      }}
    />
  );
}
