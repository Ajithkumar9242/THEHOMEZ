import { Button, Input, Select, Space } from 'antd';
import { ClearOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { IServiceArea, PartnerApplicationStatus } from '@thehomez/shared-types';
import { PARTNER_APPLICATION_STATUSES } from '@thehomez/shared-types';

interface PartnerApplicationDirectoryFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  status?: PartnerApplicationStatus;
  onStatusChange: (status?: PartnerApplicationStatus) => void;
  serviceAreaId?: string;
  onServiceAreaChange: (serviceAreaId?: string) => void;
  serviceAreas: IServiceArea[];
  loadingServiceAreas?: boolean;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  canCreateApplication?: boolean;
  onCreateClick?: () => void;
}

export function PartnerApplicationDirectoryFilters({
  searchInput,
  onSearchChange,
  onSearchSubmit,
  status,
  onStatusChange,
  serviceAreaId,
  onServiceAreaChange,
  serviceAreas,
  loadingServiceAreas,
  hasActiveFilters,
  onResetFilters,
  canCreateApplication,
  onCreateClick,
}: PartnerApplicationDirectoryFiltersProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
      }}
    >
      <Space wrap size="middle">
        <Input
          placeholder="Search by business name, phone, email..."
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          onPressEnter={onSearchSubmit}
          allowClear
          style={{ width: 280 }}
          aria-label="Search partner applications"
        />

        <Select<PartnerApplicationStatus | ''>
          placeholder="Filter by status"
          value={status || ''}
          onChange={(val) => onStatusChange(val === '' ? undefined : (val as PartnerApplicationStatus))}
          style={{ width: 170 }}
          aria-label="Filter by application status"
          options={[
            { label: 'All Statuses', value: '' },
            ...PARTNER_APPLICATION_STATUSES.map((st) => ({
              label: st.replace('_', ' '),
              value: st,
            })),
          ]}
        />

        <Select<string | ''>
          placeholder="Filter by service area"
          value={serviceAreaId || ''}
          onChange={(val) => onServiceAreaChange(val === '' ? undefined : val)}
          loading={loadingServiceAreas}
          style={{ width: 210 }}
          aria-label="Filter by service area"
          showSearch
          optionFilterProp="label"
          options={[
            { label: 'All Service Areas', value: '' },
            ...serviceAreas.map((sa) => ({
              label: `${sa.code} · ${sa.name}`,
              value: sa.id,
            })),
          ]}
        />

        {hasActiveFilters && (
          <Button icon={<ClearOutlined />} onClick={onResetFilters}>
            Clear Filters
          </Button>
        )}
      </Space>

      {canCreateApplication && onCreateClick && (
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateClick}>
          New Application
        </Button>
      )}
    </div>
  );
}
