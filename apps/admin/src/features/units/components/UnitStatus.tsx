import { Tag } from 'antd';

export function UnitStatus({ isActive }: { isActive: boolean }) {
  return <Tag color={isActive ? 'green' : 'default'}>{isActive ? 'Active' : 'Inactive'}</Tag>;
}
