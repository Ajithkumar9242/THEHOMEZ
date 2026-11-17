import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons';
import {
  PermissionCode,
  type IServiceArea,
  type IServiceAreaPartnerItem,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from '../api/service-area-client.js';

export interface ServiceAreaLifecycleModalProps {
  open: boolean;
  mode: 'activate' | 'deactivate';
  serviceArea: IServiceArea | null;
  onClose: () => void;
  onSuccess: (updatedArea: IServiceArea) => void;
}

export function ServiceAreaLifecycleModal({
  open,
  mode,
  serviceArea,
  onClose,
  onSuccess,
}: ServiceAreaLifecycleModalProps) {
  const { user } = useAuth();
  const hasPartnerRead = user?.permissions.includes(PermissionCode.PARTNER_READ) ?? false;

  const [confirmCode, setConfirmCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [partners, setPartners] = useState<IServiceAreaPartnerItem[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [partnerFetchError, setPartnerFetchError] = useState<string | null>(null);

  // Reset modal state when opened/closed
  useEffect(() => {
    if (!open || !serviceArea) {
      setConfirmCode('');
      setSubmitting(false);
      setSubmitError(null);
      setPartners([]);
      setLoadingPartners(false);
      setPartnerFetchError(null);
      return;
    }

    setConfirmCode('');
    setSubmitting(false);
    setSubmitError(null);
    setPartnerFetchError(null);

    // If deactivating and user has PARTNER_READ, fetch active assigned partners
    if (mode === 'deactivate') {
      if (hasPartnerRead) {
        setLoadingPartners(true);
        serviceAreaClient
          .getPartners(serviceArea.id)
          .then((res) => {
            setPartners(res);
          })
          .catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 403) {
              setPartnerFetchError(
                'Permission to inspect partner assignments was denied by the backend (403 Forbidden).',
              );
            } else if (err instanceof Error) {
              setPartnerFetchError(`Failed to load assigned partners: ${err.message}`);
            } else {
              setPartnerFetchError('Failed to load assigned partners.');
            }
          })
          .finally(() => {
            setLoadingPartners(false);
          });
      } else {
        setPartners([]);
        setLoadingPartners(false);
      }
    }
  }, [open, mode, serviceArea, hasPartnerRead]);

  if (!serviceArea) return null;

  const isDeactivate = mode === 'deactivate';
  const isCodeMatched = confirmCode.trim() === serviceArea.code;

  const handleSubmit = async () => {
    if (isDeactivate && !isCodeMatched) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const targetActive = !isDeactivate;
      const updated = await serviceAreaClient.update(serviceArea.id, { isActive: targetActive });

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to update service area lifecycle state.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={submitting ? undefined : onClose}
      closable={!submitting}
      maskClosable={!submitting}
      width={640}
      title={
        <Space>
          {isDeactivate ? (
            <WarningOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <ExclamationCircleOutlined style={{ color: '#1890ff' }} />
          )}
          <span>
            {isDeactivate
              ? `Deactivate Service Area: ${serviceArea.name}`
              : `Activate Service Area: ${serviceArea.name}`}
          </span>
        </Space>
      }
      footer={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {isDeactivate ? (
            <Button
              danger
              type="primary"
              disabled={!isCodeMatched || submitting}
              loading={submitting}
              onClick={handleSubmit}
              aria-label="Confirm deactivation button"
            >
              Deactivate Service Area
            </Button>
          ) : (
            <Button
              type="primary"
              disabled={submitting}
              loading={submitting}
              onClick={handleSubmit}
              aria-label="Confirm activation button"
            >
              Activate Service Area
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {submitError && (
          <Alert
            type="error"
            showIcon
            message={isDeactivate ? 'Deactivation failed' : 'Activation failed'}
            description={submitError}
          />
        )}

        <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
          <Descriptions.Item label="Service Area Code">
            <strong>{serviceArea.code}</strong>
          </Descriptions.Item>
          <Descriptions.Item label="Current Status">
            <Tag color={serviceArea.isActive ? 'green' : 'default'}>
              {serviceArea.isActive ? 'Active' : 'Inactive'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="City & State">
            {serviceArea.city}, {serviceArea.state} ({serviceArea.countryCode || 'IN'})
          </Descriptions.Item>
          <Descriptions.Item label="Configured PINs">
            {serviceArea.pincodes.length} PIN code{serviceArea.pincodes.length === 1 ? '' : 's'}
          </Descriptions.Item>
        </Descriptions>

        {isDeactivate ? (
          <>
            <Alert
              type="error"
              showIcon
              message="Immediate Downstream Operational Impact"
              description={
                <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                  <li>
                    The {serviceArea.pincodes.length} configured PIN codes will immediately become{' '}
                    <strong>unserviceable</strong> to customers.
                  </li>
                  <li>
                    Customer storefront discovery will immediately cease returning partner product
                    offers for these PIN codes.
                  </li>
                  <li>
                    Existing customer carts localized to these PINs will become unserviceable and{' '}
                    <strong>blocked from checkout</strong>.
                  </li>
                  <li>Regional pricing resolution for deliveries in these PIN codes will fail.</li>
                  <li>
                    Existing partner assignments and PartnerProduct availability records will remain
                    stored, but partners cannot modify availability while the area is inactive.
                  </li>
                  <li>
                    Existing prepared checkout sessions retain their 15-minute validity window
                    before expiring naturally.
                  </li>
                </ul>
              }
            />

            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                * Note: Partner inspection identifies active merchants configured to service this
                hub; it does not track live, in-flight deliveries.
              </Typography.Text>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                Assigned Partners Inspection
              </Typography.Title>
              {loadingPartners ? (
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <Spin tip="Checking assigned partners..." />
                </div>
              ) : !hasPartnerRead ? (
                <Alert
                  type="info"
                  showIcon
                  message="Partner preview restricted"
                  description="Your account lacks PARTNER_READ permission. Assigned merchant details cannot be previewed, but you may proceed with deactivation if authorised with SERVICE_AREA_WRITE."
                />
              ) : partnerFetchError ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Partner inspection unavailable"
                  description={partnerFetchError}
                />
              ) : partners.length === 0 ? (
                <Typography.Text type="secondary">
                  No active partners are currently assigned to this service area.
                </Typography.Text>
              ) : (
                <>
                  <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
                    <strong>{partners.length}</strong> active partner
                    {partners.length === 1 ? ' is' : 's are'} currently assigned to this hub:
                  </Typography.Paragraph>
                  <Table<IServiceAreaPartnerItem>
                    size="small"
                    rowKey="partnerId"
                    dataSource={partners}
                    pagination={{ pageSize: 5, showSizeChanger: false }}
                    columns={[
                      {
                        title: 'Business Name',
                        dataIndex: 'businessName',
                        key: 'businessName',
                      },
                      {
                        title: 'Contact Phone',
                        dataIndex: 'phone',
                        key: 'phone',
                      },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        key: 'status',
                        render: (status: string) => <Tag color="blue">{status}</Tag>,
                      },
                    ]}
                  />
                </>
              )}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div
              style={{
                background: '#fff2f0',
                padding: 16,
                borderRadius: 6,
                border: '1px solid #ffccc7',
              }}
            >
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                To confirm deactivation, please type the exact service area code{' '}
                <Typography.Text code strong>
                  {serviceArea.code}
                </Typography.Text>{' '}
                below:
              </Typography.Paragraph>
              <Input
                placeholder={serviceArea.code}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                disabled={submitting}
                aria-label="Confirm service area code input"
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message="PIN Coverage Verification"
              description="Activating this service area will validate all configured PIN codes against currently active hubs. Activation succeeds only if there are zero active PIN coverage conflicts."
            />
            <Typography.Paragraph>
              Once activated, this hub will immediately become operational: customer storefront
              discovery will localize to these PINs, regional pricing will resolve, and assigned
              merchants can configure product availability.
            </Typography.Paragraph>
          </>
        )}
      </Space>
    </Modal>
  );
}
