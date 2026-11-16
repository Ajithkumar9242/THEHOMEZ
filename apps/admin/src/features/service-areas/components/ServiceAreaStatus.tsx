import { Tag } from 'antd';

export function ServiceAreaStatus({ isActive }: { isActive: boolean }) {
  return <Tag color={isActive ? 'green' : 'default'}>{isActive ? 'Active' : 'Inactive'}</Tag>;
}
