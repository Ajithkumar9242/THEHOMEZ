import { Alert, Button, Result, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';

export function UnitError({ error, retry }: { error: unknown; retry: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const missing = apiError?.status === 404;
  const invalid = apiError?.status === 400 || apiError?.status === 422;
  const unauthorized = apiError?.status === 401;
  const message = missing
    ? 'No unit exists with this code.'
    : invalid
      ? apiError?.message || 'The unit code is invalid.'
      : unauthorized
        ? 'Your Admin session may have expired. Sign in again to continue.'
        : apiError?.status === 0
          ? 'Unable to reach the API. Check that the backend is running.'
          : apiError?.status && apiError.status >= 500
            ? 'The service is temporarily unavailable. Try again.'
            : error instanceof Error
              ? error.message
              : 'Could not load unit information.';

  if (missing)
    return (
      <Result
        status="404"
        title="Unit not found"
        subTitle={message}
        extra={
          <Button onClick={retry} icon={<ReloadOutlined />}>
            Retry
          </Button>
        }
      />
    );

  return (
    <Alert
      type={unauthorized ? 'error' : 'warning'}
      showIcon
      role="alert"
      message={
        invalid ? 'Invalid unit code' : unauthorized ? 'Session expired' : 'Could not load units'
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
