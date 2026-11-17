import { Alert, Card, Skeleton, Space, Tag, Typography } from 'antd';
import { PermissionCode } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { useCustomerDirectory } from '../hooks/useCustomerDirectory.js';
import { CustomerDirectoryFilters } from '../components/CustomerDirectoryFilters.js';
import { CustomerDirectoryTable } from '../components/CustomerDirectoryTable.js';
import { CustomerError } from '../components/CustomerError.js';

export function CustomerDirectoryPage() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes(PermissionCode.CUSTOMER_READ) ?? false;

  const {
    searchInput,
    setSearchInput,
    applySearchImmediately,
    status,
    setStatus,
    segment,
    setSegment,
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
  } = useCustomerDirectory({ enabled: canRead });

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="CUSTOMER_READ permission required"
        description="Your account does not have permission to view customer accounts. The customer API was not requested."
      />
    );
  }

  return (
    <div className="customer-page">
      <div className="catalogue-heading">
        <div>
          <Typography.Text className="eyebrow">CUSTOMER MANAGEMENT</Typography.Text>
          <Typography.Title level={1} style={{ margin: '4px 0' }}>
            Customers
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Manage and inspect customer accounts registered on TheHomez platform.
          </Typography.Paragraph>
        </div>
        <Space>
          <Tag>{total.toLocaleString()} customers</Tag>
        </Space>
      </div>

      <Card variant="borderless" className="catalogue-card">
        <CustomerDirectoryFilters
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onSearchSubmit={applySearchImmediately}
          status={status}
          onStatusChange={setStatus}
          segment={segment}
          onSegmentChange={setSegment}
          onClearFilters={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
          loading={loading && items.length === 0}
        />

        <div aria-live="polite" aria-busy={loading} style={{ marginTop: 16 }}>
          {error ? (
            <CustomerError error={error} retry={retry} />
          ) : loading && items.length === 0 ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : (
            <CustomerDirectoryTable
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
