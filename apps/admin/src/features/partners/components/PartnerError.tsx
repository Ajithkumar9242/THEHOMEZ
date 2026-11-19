import { Alert, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../../services/api-client.js';

interface PartnerErrorProps {
  error: Error | ApiError | null;
  retry?: () => void;
  title?: string;
  style?: React.CSSProperties;
}

export function PartnerError({ error, retry, title, style }: PartnerErrorProps) {
  if (!error) return null;

  let message = title || 'Unable to complete request';
  let description = error.message;

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'FORBIDDEN':
        message = 'Access Denied';
        description = 'Your account does not possess the required permission for this operation.';
        break;
      case 'PARTNER_NOT_FOUND':
        message = 'Partner Not Found';
        description = 'The requested partner organization could not be located in the database.';
        break;
      case 'CONCURRENT_MODIFICATION':
        message = 'Concurrent Modification Detected';
        description =
          'Another administrator has modified this partner status concurrently. Please reload to review current state.';
        break;
      case 'INVALID_STATE_TRANSITION':
        message = 'Invalid Status Transition';
        description =
          error.message || 'The requested state transition is not allowed by lifecycle rules.';
        break;
      case 'PARTNER_VERIFICATION_REQUIRED':
        message = 'Verification Workflow Required';
        description =
          'Transition to ACTIVE requires the dedicated Stage C-11 verification workflow. Direct administrative activation is prohibited.';
        break;
      case 'VALIDATION_ERROR':
        message = 'Validation Error';
        description = error.message || 'Please verify that all fields meet system constraints.';
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
            <Button
              size="small"
              type="primary"
              danger
              ghost
              icon={<ReloadOutlined />}
              onClick={retry}
            >
              Retry Operation
            </Button>
          )}
        </Space>
      }
      style={style}
    />
  );
}
