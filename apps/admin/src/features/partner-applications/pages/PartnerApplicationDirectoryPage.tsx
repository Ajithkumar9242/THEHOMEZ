import { useState } from 'react';
import { Alert, Card, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PermissionCode } from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { usePartnerApplications } from '../hooks/usePartnerApplications.js';
import { PartnerApplicationDirectoryFilters } from '../components/PartnerApplicationDirectoryFilters.js';
import { PartnerApplicationDirectoryTable } from '../components/PartnerApplicationDirectoryTable.js';
import { CreatePartnerApplicationDrawer } from '../components/CreatePartnerApplicationDrawer.js';
import { PartnerApplicationError } from '../components/PartnerApplicationError.js';

export function PartnerApplicationDirectoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const canRead = user?.permissions.includes(PermissionCode.PARTNER_READ) ?? false;
  const canOnboard = user?.permissions.includes(PermissionCode.PARTNER_ONBOARD) ?? false;

  const {
    items,
    total,
    loading,
    error,
    searchInput,
    setSearchInput,
    applySearchImmediately,
    status,
    setStatus,
    serviceAreaId,
    setServiceAreaId,
    page,
    setPage,
    limit,
    setLimit,
    serviceAreas,
    loadingServiceAreas,
    hasActiveFilters,
    resetFilters,
    retry,
    refresh,
  } = usePartnerApplications({ enabled: canRead });

  if (!canRead) {
    return (
      <Alert
        type="error"
        showIcon
        role="alert"
        message="PARTNER_READ permission required"
        description="Your account does not possess the permission required to inspect partner applications. The partner application API was not requested."
      />
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 32 }}>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <Typography.Text type="secondary" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>
          PARTNER ONBOARDING
        </Typography.Text>
        <Typography.Title level={2} style={{ marginTop: 4, marginBottom: 4 }}>
          Partner Applications
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Manage candidate partner intake, track compliance review pipelines, and process transactional approval gates.
        </Typography.Paragraph>
      </div>

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <PartnerApplicationDirectoryFilters
            searchInput={searchInput}
            onSearchChange={setSearchInput}
            onSearchSubmit={applySearchImmediately}
            status={status}
            onStatusChange={setStatus}
            serviceAreaId={serviceAreaId}
            onServiceAreaChange={setServiceAreaId}
            serviceAreas={serviceAreas}
            loadingServiceAreas={loadingServiceAreas}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={resetFilters}
            canCreateApplication={canOnboard}
            onCreateClick={() => setCreateDrawerOpen(true)}
          />

          {error && <PartnerApplicationError error={error} retry={retry} />}

          <PartnerApplicationDirectoryTable
            items={items}
            loading={loading}
            page={page}
            limit={limit}
            total={total}
            onPageChange={(newPage, newLimit) => {
              setPage(newPage);
              setLimit(newLimit);
            }}
          />
        </Space>
      </Card>

      {/* Intake Drawer */}
      <CreatePartnerApplicationDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        serviceAreas={serviceAreas}
        onSuccess={(createdId) => {
          refresh();
          navigate(`/partner-applications/${createdId}`);
        }}
      />
    </div>
  );
}
