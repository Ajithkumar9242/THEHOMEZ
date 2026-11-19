import { Tag } from 'antd';
import type { PartnerStatus } from '@thehomez/shared-types';

interface PartnerStatusBadgeProps {
  status: PartnerStatus;
  style?: React.CSSProperties;
}

const STATUS_CONFIG: Record<
  PartnerStatus,
  { label: string; color: 'success' | 'warning' | 'error' | 'default' }
> = {
  ACTIVE: {
    label: 'Active',
    color: 'success',
  },
  INACTIVE: {
    label: 'Inactive',
    color: 'default',
  },
  PENDING_VERIFICATION: {
    label: 'Pending Verification',
    color: 'warning',
  },
  SUSPENDED: {
    label: 'Suspended',
    color: 'error',
  },
};

export function PartnerStatusBadge({ status, style }: PartnerStatusBadgeProps) {
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
