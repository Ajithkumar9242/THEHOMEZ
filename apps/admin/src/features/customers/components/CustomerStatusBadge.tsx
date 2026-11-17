import { Tag } from 'antd';
import { UserStatus } from '@thehomez/shared-types';

interface CustomerStatusBadgeProps {
  status: UserStatus | string;
}

const statusConfig: Record<string, { color: string; label: string }> = {
  [UserStatus.ACTIVE]: { color: 'green', label: 'ACTIVE' },
  [UserStatus.SUSPENDED]: { color: 'red', label: 'SUSPENDED' },
  [UserStatus.PENDING_VERIFICATION]: { color: 'gold', label: 'PENDING VERIFICATION' },
};

export function CustomerStatusBadge({ status }: CustomerStatusBadgeProps) {
  const config = statusConfig[status] || { color: 'default', label: status || 'UNKNOWN' };
  return (
    <Tag color={config.color} aria-label={`Status: ${config.label}`}>
      {config.label}
    </Tag>
  );
}
