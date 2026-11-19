import { Tag } from 'antd';
import type { PartnerApplicationStatus } from '@thehomez/shared-types';

interface PartnerApplicationStatusBadgeProps {
  status: PartnerApplicationStatus;
  style?: React.CSSProperties;
}

const STATUS_CONFIG: Record<
  PartnerApplicationStatus,
  { label: string; color: 'success' | 'processing' | 'warning' | 'error' | 'default' }
> = {
  DRAFT: {
    label: 'Draft',
    color: 'default',
  },
  SUBMITTED: {
    label: 'Submitted',
    color: 'processing',
  },
  UNDER_REVIEW: {
    label: 'Under Review',
    color: 'warning',
  },
  APPROVED: {
    label: 'Approved',
    color: 'success',
  },
  REJECTED: {
    label: 'Rejected',
    color: 'error',
  },
  WITHDRAWN: {
    label: 'Withdrawn',
    color: 'default',
  },
};

export function PartnerApplicationStatusBadge({ status, style }: PartnerApplicationStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    color: 'default' as const,
  };

  return (
    <Tag color={config.color} style={style} role="status" aria-label={`Status: ${config.label}`}>
      {config.label}
    </Tag>
  );
}
