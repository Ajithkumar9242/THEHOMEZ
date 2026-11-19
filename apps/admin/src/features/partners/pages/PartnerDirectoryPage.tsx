import { Alert, Card, Skeleton, Space, Tag, Typography } from 'antd';
import { PermissionCode } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { usePartnerDirectory } from '../hooks/usePartnerDirectory.js';
import { PartnerDirectoryFilters } from '../components/PartnerDirectoryFilters.js';
import { PartnerDirectoryTable } from '../components/PartnerDirectoryTable.js';
import { PartnerError } from '../components/PartnerError.js';

export function PartnerDirectoryPage() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.PARTNER_READ) ?? false;

  const {
    searchInput,
    setSearchInput,
    applySearchImmediately,
    status,
    setStatus,
    serviceAreaId,
    setServiceAreaId,
    sortBy,
    sortOrder,
    setSorting,
    page,
    limit,
    setPagination,
    clearAllFilters,
    hasActiveFilters,
    items,
    total,
    totalPages,
    loading,
    error,
    retry,
    refresh,
    serviceAreas,
    loadingServiceAreas,
  } = usePartnerDirectory({ enabled: canRead });

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="PARTNER_READ permission required"
        description="Your account does not possess the permission required to inspect partner organizations. The partner API was not requested."
      />
    );
  }

  return (
    <div className="partner-directory-page">
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">PARTNER MANAGEMENT</Typography.Text>
          <Typography.Title level={1} style={{ margin: '4px 0' }}>
            Partners
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Directory of verified material distributors, fabricators, and hub fulfillment partners.
          </Typography.Paragraph>
        </div>
        <Space>
          <Tag color="blue">{total.toLocaleString()} partners</Tag>
        </Space>
      </div>

      <Card variant="borderless" className="catalogue-card" style={{ marginTop: 16 }}>
        <PartnerDirectoryFilters
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onSearchSubmit={applySearchImmediately}
          status={status}
          onStatusChange={setStatus}
          serviceAreaId={serviceAreaId}
          onServiceAreaChange={setServiceAreaId}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={setSorting}
          onClearFilters={clearAllFilters}
          onRefresh={refresh}
          hasActiveFilters={hasActiveFilters}
          serviceAreas={serviceAreas}
          loading={loading || loadingServiceAreas}
        />

        <div aria-live="polite" aria-busy={loading} style={{ marginTop: 16 }}>
          {error ? (
            <PartnerError error={error} retry={retry} />
          ) : loading && items.length === 0 ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : (
            <PartnerDirectoryTable
              items={items}
              loading={loading}
              page={page}
              limit={limit}
              total={total}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onPaginationChange={setPagination}
              onSortChange={setSorting}
              onClearFilters={clearAllFilters}
              hasActiveFilters={hasActiveFilters}
            />
          )}
        </div>

        {!loading && !error && items.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Page {page} of {totalPages}
            </Typography.Text>
          </div>
        )}
      </Card>
    </div>
  );
}
