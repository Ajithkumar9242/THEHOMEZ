import { Button, Input, Select, Space } from 'antd';
import { ClearOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { IAdminPartnerQueryDto, IServiceArea, PartnerStatus } from '@thehomez/shared-types';

interface PartnerDirectoryFiltersProps {
  searchInput: string;
  onSearchInputChange: (val: string) => void;
  onSearchSubmit: () => void;
  status: PartnerStatus | undefined;
  onStatusChange: (status: PartnerStatus | undefined) => void;
  serviceAreaId: string | undefined;
  onServiceAreaChange: (saId: string | undefined) => void;
  sortBy: IAdminPartnerQueryDto['sortBy'];
  sortOrder: IAdminPartnerQueryDto['sortOrder'];
  onSortChange: (
    sortBy: IAdminPartnerQueryDto['sortBy'],
    sortOrder: IAdminPartnerQueryDto['sortOrder'],
  ) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  hasActiveFilters: boolean;
  serviceAreas: IServiceArea[];
  loading?: boolean;
}

const STATUS_OPTIONS: { label: string; value: PartnerStatus }[] = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'INACTIVE' },
  { label: 'Pending Verification', value: 'PENDING_VERIFICATION' },
  { label: 'Suspended', value: 'SUSPENDED' },
];

export function PartnerDirectoryFilters({
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  status,
  onStatusChange,
  serviceAreaId,
  onServiceAreaChange,
  sortBy,
  sortOrder,
  onSortChange,
  onClearFilters,
  onRefresh,
  hasActiveFilters,
  serviceAreas,
  loading = false,
}: PartnerDirectoryFiltersProps) {
  return (
    <div className="partner-directory-filters" style={{ marginBottom: 16 }}>
      <Space
        wrap
        size="middle"
        align="center"
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        <Space wrap size="middle">
          <Input.Search
            placeholder="Search business, legal name, phone..."
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            onSearch={onSearchSubmit}
            allowClear
            style={{ width: 280 }}
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
            aria-label="Search partners"
            disabled={loading}
          />

          <Select
            placeholder="Filter by Status"
            value={status}
            onChange={onStatusChange}
            allowClear
            style={{ width: 180 }}
            options={STATUS_OPTIONS}
            aria-label="Filter by partner status"
            disabled={loading}
          />

          <Select
            placeholder="Filter by Service Area"
            value={serviceAreaId}
            onChange={onServiceAreaChange}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            options={serviceAreas.map((sa) => ({
              label: `${sa.name} (${sa.city})`,
              value: sa.id,
            }))}
            aria-label="Filter by service area"
            disabled={loading}
          />

          <Select
            value={`${sortBy}-${sortOrder}`}
            onChange={(val) => {
              const [field, order] = val.split('-') as [
                IAdminPartnerQueryDto['sortBy'],
                IAdminPartnerQueryDto['sortOrder'],
              ];
              onSortChange(field, order);
            }}
            style={{ width: 190 }}
            options={[
              { label: 'Created (Newest First)', value: 'createdAt-desc' },
              { label: 'Created (Oldest First)', value: 'createdAt-asc' },
              { label: 'Business Name (A-Z)', value: 'businessName-asc' },
              { label: 'Business Name (Z-A)', value: 'businessName-desc' },
              { label: 'Status (A-Z)', value: 'status-asc' },
              { label: 'Recently Updated', value: 'updatedAt-desc' },
            ]}
            aria-label="Sort partner directory"
            disabled={loading}
          />

          {hasActiveFilters && (
            <Button
              icon={<ClearOutlined />}
              onClick={onClearFilters}
              disabled={loading}
              aria-label="Clear active filters"
            >
              Reset Filters
            </Button>
          )}
        </Space>

        <Button
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          loading={loading}
          aria-label="Refresh partner directory"
        >
          Refresh
        </Button>
      </Space>
    </div>
  );
}
