import { Tag } from 'antd';

export function CategoryStatus({ isActive }: { isActive: boolean }) {
  return <Tag color={isActive ? 'green' : 'default'}>{isActive ? 'Active' : 'Inactive'}</Tag>;
}
