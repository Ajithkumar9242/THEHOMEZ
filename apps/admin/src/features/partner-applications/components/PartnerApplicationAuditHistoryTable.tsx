import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { IPartnerApplicationAuditEntry } from '@thehomez/shared-types';
import { PartnerApplicationStatusBadge } from './PartnerApplicationStatusBadge.js';

interface PartnerApplicationAuditHistoryTableProps {
  entries: IPartnerApplicationAuditEntry[];
  loading?: boolean;
}

export function PartnerApplicationAuditHistoryTable({
  entries,
  loading = false,
}: PartnerApplicationAuditHistoryTableProps) {
  const columns: ColumnsType<IPartnerApplicationAuditEntry> = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (val: string) => {
        try {
          return new Date(val).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
        } catch {
          return val;
        }
      },
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (action: string) => {
        let color = 'default';
        if (action.includes('APPROVED')) color = 'success';
        else if (action.includes('REJECTED')) color = 'error';
        else if (action.includes('UNDER_REVIEW')) color = 'warning';
        else if (action.includes('CREATED') || action.includes('SUBMITTED')) color = 'processing';
        return <Tag color={color}>{action}</Tag>;
      },
    },
    {
      title: 'Transition',
      key: 'transition',
      width: 220,
      render: (_, record) => {
        if (!record.previousStatus && !record.newStatus) return '—';
        return (
          <span>
            {record.previousStatus ? (
              <PartnerApplicationStatusBadge status={record.previousStatus} />
            ) : (
              <Tag>Init</Tag>
            )}
            {' → '}
            {record.newStatus && <PartnerApplicationStatusBadge status={record.newStatus} />}
          </span>
        );
      },
    },
    {
      title: 'Performed By',
      dataIndex: 'performedBy',
      key: 'performedBy',
      width: 160,
      render: (val: string) => (
        <Typography.Text copyable={{ text: val }} ellipsis style={{ maxWidth: 140 }}>
          {val ? `${val.substring(0, 8)}...` : 'System'}
        </Typography.Text>
      ),
    },
    {
      title: 'Reason / Refusal Details',
      key: 'details',
      render: (_, record) => {
        return (
          <div>
            {record.refusalReasonCode && (
              <div style={{ marginBottom: 4 }}>
                <Tag color="red">Code: {record.refusalReasonCode}</Tag>
              </div>
            )}
            {record.reason && (
              <Typography.Text type="secondary" style={{ fontStyle: 'italic' }}>
                &ldquo;{record.reason}&rdquo;
              </Typography.Text>
            )}
            {!record.refusalReasonCode && !record.reason && (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="Embedded Application Evaluation History"
        description="Records administrative review and state transition events occurring prior to operational partner creation. (Note: Embedded application history is distinct from the immutable operational partner governance ledger)."
        style={{ marginBottom: 16 }}
      />
      <Table<IPartnerApplicationAuditEntry>
        rowKey={(record) => `${record.timestamp}-${record.action}-${record.performedBy}`}
        columns={columns}
        dataSource={entries}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: 'No audit records recorded for this application.',
        }}
        scroll={{ x: 800 }}
      />
    </div>
  );
}
