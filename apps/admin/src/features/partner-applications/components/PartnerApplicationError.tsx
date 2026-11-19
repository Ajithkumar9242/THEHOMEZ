import { Alert, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';

interface PartnerApplicationErrorProps {
  error: Error | ApiError | null;
  retry?: () => void;
  title?: string;
  style?: React.CSSProperties;
}

export function PartnerApplicationError({
  error,
  retry,
  title,
  style,
}: PartnerApplicationErrorProps) {
  if (!error) return null;

  let message = title || 'Unable to complete request';
  let description = error.message;

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'FORBIDDEN':
      case 'STAFF_ACCESS_REQUIRED':
        message = 'Access Denied';
        description = 'Your account does not possess the required permission for this operation.';
        break;
      case 'APPLICATION_NOT_FOUND':
        message = 'Application Not Found';
        description = 'The requested partner application could not be located in the database.';
        break;
      case 'CONCURRENT_MODIFICATION':
        message = 'Concurrent Modification Detected';
        description =
          'Another administrator has modified this application state. Please reload to review the latest state.';
        break;
      case 'INVALID_STATE_TRANSITION':
        message = 'Invalid Status Transition';
        description =
          error.message || 'The requested state transition is not allowed by application lifecycle rules.';
        break;
      case 'NO_ACTIVE_SERVICE_AREA':
        message = 'Service Area Inactive or Missing';
        description =
          error.message ||
          'Partner application must have at least one active assigned service area for approval.';
        break;
      case 'ATTESTATIONS_INCOMPLETE':
        message = 'Attestations Incomplete';
        description =
          'All three administrative verification attestations must be affirmatively confirmed.';
        break;
      case 'PARTNER_PHONE_EXISTS':
        message = 'Partner Phone Collision';
        description =
          'An operational partner organization with this business phone number already exists.';
        break;
      case 'PHONE_ALREADY_REGISTERED':
        message = 'Operator Phone Collision';
        description =
          'A partner user account with this primary contact phone number is already registered.';
        break;
      case 'EMAIL_ALREADY_REGISTERED':
        message = 'User Email Collision';
        description =
          'A user account with this email address is already registered on the platform.';
        break;
      case 'VALIDATION_ERROR':
        message = 'Validation Error';
        description = error.message || 'Please verify that all fields meet system constraints.';
        break;
      case 'NETWORK_ERROR':
        message = 'Network Error';
        description = 'Unable to reach the backend server. Please verify your connection.';
        break;
      default:
        break;
    }
  }

  return (
    <Alert
      type="error"
      showIcon
      role="alert"
      message={message}
      description={
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div>{description}</div>
          {retry && (
            <div>
              <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
                Try again
              </Button>
            </div>
          )}
        </Space>
      }
      style={style}
    />
  );
}
