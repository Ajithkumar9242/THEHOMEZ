import { Alert, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';

interface CustomerErrorProps {
  error: unknown;
  retry: () => void;
}

export function CustomerError({ error, retry }: CustomerErrorProps) {
  const apiError = error instanceof ApiError ? error : null;
  const unauthorized = apiError?.status === 401;
  const forbidden = apiError?.status === 403;
  const invalidRequest = apiError?.status === 400 || apiError?.status === 422;
  const isNetworkError =
    apiError?.status === 0 ||
    (error instanceof Error && error.message.toLowerCase().includes('network'));
  const isServerError = apiError?.status !== undefined && apiError.status >= 500;

  const title = unauthorized
    ? 'Session Expired'
    : forbidden
      ? 'Permission Denied'
      : invalidRequest
        ? 'Invalid Query Parameters'
        : isNetworkError
          ? 'Network Connection Failure'
          : isServerError
            ? 'Service Unavailable'
            : 'Error Loading Customers';

  const description = unauthorized
    ? 'Your session has expired. Please sign in again to access the customer directory.'
    : forbidden
      ? 'Your staff account does not have the required CUSTOMER_READ permission.'
      : invalidRequest
        ? apiError?.message || 'The customer directory query parameters are invalid.'
        : isNetworkError
          ? 'Unable to communicate with the server. Please check your network connection or ensure the backend service is running.'
          : isServerError
            ? 'The server encountered an error processing your request. Please try again later.'
            : error instanceof Error
              ? error.message
              : 'An unexpected error occurred while loading the customer directory.';

  return (
    <Alert
      role="alert"
      type={unauthorized || forbidden ? 'error' : 'warning'}
      showIcon
      message={title}
      description={description}
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
