import { Alert, Button, Result, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';

export function ServiceAreaError({
  error,
  retry,
  resource = 'service areas',
}: {
  error: unknown;
  retry: () => void;
  resource?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const unauthorized = apiError?.status === 401;
  const forbidden = apiError?.status === 403;
  const missing = apiError?.status === 404;
  const invalidRequest = apiError?.status === 400 || apiError?.status === 422;
  const message = unauthorized
    ? 'Your session has expired. Sign in again to continue.'
    : forbidden
      ? 'Your staff account does not have SERVICE_AREA_READ access.'
      : missing
        ? 'This service area could not be found.'
        : invalidRequest
          ? apiError?.message || 'The service area request is invalid.'
          : apiError?.status === 0
            ? 'Unable to reach the API. Check that the backend is running.'
            : apiError?.status && apiError.status >= 500
              ? 'The service is temporarily unavailable. Try again.'
              : error instanceof Error
                ? error.message
                : `Could not load ${resource}.`;

  if (missing) return <Result status="404" title="Service area not found" subTitle={message} />;

  return (
    <Alert
      type={unauthorized || forbidden ? 'error' : 'warning'}
      showIcon
      role="alert"
      message={
        unauthorized
          ? 'Session expired'
          : forbidden
            ? 'Permission denied'
            : invalidRequest
              ? 'Invalid request'
              : `Could not load ${resource}`
      }
      description={message}
      action={
        <Space>
          {unauthorized && (
            <Button type="link" href="/sign-in">
              Sign in
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={retry}>
            Retry
          </Button>
        </Space>
      }
    />
  );
}
