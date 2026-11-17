import { Button, Input, Select, Space } from 'antd';
import { ClearOutlined, SearchOutlined } from '@ant-design/icons';
import { UserStatus } from '@thehomez/shared-types';

interface CustomerDirectoryFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  status?: UserStatus;
  onStatusChange: (status?: UserStatus) => void;
  segment?: 'B2B' | 'B2C';
  onSegmentChange: (segment?: 'B2B' | 'B2C') => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  loading?: boolean;
}

const statusOptions = [
  { value: 'ALL', label: 'All Statuses' },
  { value: UserStatus.ACTIVE, label: 'Active' },
  { value: UserStatus.SUSPENDED, label: 'Suspended' },
  { value: UserStatus.PENDING_VERIFICATION, label: 'Pending Verification' },
];

const segmentOptions = [
  { value: 'ALL', label: 'All Segments' },
  { value: 'B2B', label: 'B2B Wholesale' },
  { value: 'B2C', label: 'B2C Retail' },
];

export function CustomerDirectoryFilters({
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  status,
  onStatusChange,
  segment,
  onSegmentChange,
  onClearFilters,
  hasActiveFilters,
  loading = false,
}: CustomerDirectoryFiltersProps) {
  return (
    <div className="customer-filters" role="search" aria-label="Customer search and filters">
      <Space wrap size="middle" style={{ width: '100%' }}>
        <Input
          className="customer-search-input"
          placeholder="Search by phone, email, or customer ID..."
          prefix={<SearchOutlined />}
          allowClear
          maxLength={100}
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          onPressEnter={() => onSearchSubmit(searchInput)}
          disabled={loading}
          aria-label="Search customers"
          style={{ width: 320 }}
        />

        <Select
          className="customer-status-filter"
          data-testid="customer-status-filter"
          value={status || 'ALL'}
          onChange={(val) => onStatusChange(val === 'ALL' ? undefined : (val as UserStatus))}
          options={statusOptions}
          disabled={loading}
          aria-label="Filter by account status"
          style={{ width: 180 }}
        />

        <Select
          className="customer-segment-filter"
          data-testid="customer-segment-filter"
          value={segment || 'ALL'}
          onChange={(val) => onSegmentChange(val === 'ALL' ? undefined : (val as 'B2B' | 'B2C'))}
          options={segmentOptions}
          disabled={loading}
          aria-label="Filter by customer segment"
          style={{ width: 160 }}
        />

        <Button
          icon={<ClearOutlined />}
          onClick={onClearFilters}
          disabled={!hasActiveFilters || loading}
          aria-label="Clear all filters"
        >
          Clear Filters
        </Button>
      </Space>
    </div>
  );
}
