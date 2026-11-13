import { Navigate, Route, Routes } from 'react-router-dom';
import { Alert, Card, Space, Tag, Typography } from 'antd';
import { AdminLayout } from '../layouts/AdminLayout.js';
import { AuthProvider, SignInPage, useAuth } from '../providers/AuthProvider.js';
import { ProtectedRoute } from '../routes/ProtectedRoute.js';
import { PermissionCode } from '@thehomez/shared-types';
import { Outlet } from 'react-router-dom';
import { CategoryBrowserPage } from '../features/categories/pages/CategoryBrowserPage.js';
import { CategoryDetailPage } from '../features/categories/pages/CategoryDetailPage.js';

function CategoryLayout() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}

function StatusPage() {
  const { user } = useAuth();
  return (
    <Space direction="vertical" size="large" className="status-page">
      <div>
        <Typography.Text className="eyebrow">ADMIN WORKSPACE</Typography.Text>
        <Typography.Title level={1}>Administration foundation</Typography.Title>
        <Typography.Paragraph className="intro-copy">
          TheHomez Admin is being prepared for operational workflows. This workspace currently
          provides a staff-only shell; no operational modules or metrics are active.
        </Typography.Paragraph>
      </div>
      <Alert
        type="info"
        showIcon
        message="No operational data is displayed"
        description="Dashboard figures and module workflows will appear only after their APIs and requirements are implemented and verified."
      />
      <Card title="Current access" variant="borderless">
        <Space direction="vertical" size="small">
          <Typography.Text>Authenticated identity is confirmed by the backend.</Typography.Text>
          <Typography.Text type="secondary">{user?.email || user?.phone}</Typography.Text>
          <Tag color="blue">
            {user?.userType} · {user?.status}
          </Tag>
        </Space>
      </Card>
      <Card title="Modules" variant="borderless">
        <Typography.Paragraph type="secondary">
          Navigation is visible for planning, while unfinished areas remain unavailable. The
          read-only Category Browser is planned for the next implementation phase.
        </Typography.Paragraph>
      </Card>
      <Alert
        type="warning"
        showIcon
        message="Temporary development authentication only"
        description="Email/password sign-in is scoped to the isolated development verification database. MFA is not implemented, and production Admin authentication is not approved."
      />
    </Space>
  );
}

function ShellRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<ProtectedRoute />}>
        <Route
          path="/"
          element={
            <AdminLayout>
              <StatusPage />
            </AdminLayout>
          }
        />
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/catalogue/categories" element={<CategoryBrowserPage />} />
          <Route path="/catalogue/categories/:slug" element={<CategoryDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ShellRoutes />
    </AuthProvider>
  );
}
