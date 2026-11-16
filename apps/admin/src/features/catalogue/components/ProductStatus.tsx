import { Tag } from 'antd';
import type { ProductStatus as Status } from '@thehomez/shared-types';

const colors: Record<Status, string> = {
  DRAFT: 'default',
  ACTIVE: 'green',
  INACTIVE: 'orange',
  ARCHIVED: 'red',
};
export function ProductStatus({ status }: { status: Status }) {
  return <Tag color={colors[status]}>{status}</Tag>;
}
