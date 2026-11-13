import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { UserType, type PermissionCode } from '@thehomez/shared-types';
import { Alert, Result, Spin } from 'antd';
import { useAuth } from '../providers/AuthProvider.js';

export function ProtectedRoute({ permission }: { permission?: PermissionCode }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading')
    return (
      <div className="route-loading">
        <Spin size="large" />
      </div>
    );
  if (status !== 'signed-in' || !user)
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  if (user.userType !== UserType.STAFF) return <Navigate to="/sign-in" replace />;
  if (permission && !user.permissions.includes(permission)) {
    return (
      <Result
        status="403"
        title="Permission required"
        subTitle={
          <Alert
            type="error"
            message="The backend identity does not include the permission required for this page."
          />
        }
      />
    );
  }
  return <Outlet />;
}
