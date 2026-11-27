import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EnvironmentOutlined } from '@ant-design/icons';
import {
  MAX_SERVICE_AREAS_PER_PARTNER,
  type IPartnerAdminDetailDto,
  type IServiceArea,
} from '@thehomez/shared-types';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { partnerClient } from '../api/partner-client.js';
import { ApiError } from '../../../services/api-client.js';

interface ManagePartnerServiceAreasModalProps {
  open: boolean;
  partner: IPartnerAdminDetailDto | null;
  onClose: () => void;
  onSuccess: (updatedServiceAreaIds: string[]) => void;
}

export function ManagePartnerServiceAreasModal({
  open,
  partner,
  onClose,
  onSuccess,
}: ManagePartnerServiceAreasModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serviceAreas, setServiceAreas] = useState<IServiceArea[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);

  useEffect(() => {
    if (open && partner) {
      setErrorAlert(null);
      // Pre-select current partner's service area IDs
      setSelectedRowKeys(partner.serviceAreas?.map((sa) => sa.id) || []);

      // Fetch all active service areas
      setLoading(true);
      serviceAreaClient
        .list({ isActive: true, limit: 100 })
        .then((res) => {
          setServiceAreas(res.items);
        })
        .catch((err) => {
          setErrorAlert(
            err instanceof Error
              ? err.message
              : 'Failed to load service areas directory.',
          );
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, partner]);

  const handleSubmit = async () => {
    if (!partner) return;

    const selectedIds = selectedRowKeys.map(String);

    if (selectedIds.length > MAX_SERVICE_AREAS_PER_PARTNER) {
      setErrorAlert(
        `Cannot assign more than ${MAX_SERVICE_AREAS_PER_PARTNER} service areas to a single partner. Selected: ${selectedIds.length}.`,
      );
      return;
    }

    if (partner.status === 'ACTIVE' && selectedIds.length === 0) {
      setErrorAlert(
        'Active partners must remain assigned to at least one active fulfillment hub.',
      );
      return;
    }

    setSubmitting(true);
    setErrorAlert(null);

    try {
      const result = await partnerClient.assignServiceAreas(partner.id, selectedIds);
      onSuccess(result.serviceAreaIds);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('An unexpected error occurred while assigning service areas.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<IServiceArea> = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      render: (code: string) => (
        <Typography.Text strong style={{ fontFamily: 'monospace' }}>
          {code}
        </Typography.Text>
      ),
    },
    {
      title: 'Hub Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'City / State',
      key: 'location',
      render: (_, record) => `${record.city}, ${record.state}`,
    },
    {
      title: 'PIN Codes',
      key: 'pincodes',
      width: 100,
      align: 'right',
      render: (_, record) => (
        <Tag>{record.pincodes?.length ?? 0} PINs</Tag>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <EnvironmentOutlined style={{ color: '#1677ff' }} />
          <span>Manage Service Area Hubs</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={handleSubmit}
          loading={submitting}
        >
          Save Service Hubs ({selectedRowKeys.length})
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Select the operational fulfillment hubs serviced by <strong>{partner?.businessName}</strong>.
        Maximum {MAX_SERVICE_AREAS_PER_PARTNER} hubs per partner.
      </Typography.Paragraph>

      {errorAlert && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setErrorAlert(null)}
          message={errorAlert}
          style={{ marginBottom: 16 }}
        />
      )}

      {selectedRowKeys.length > MAX_SERVICE_AREAS_PER_PARTNER && (
        <Alert
          type="warning"
          showIcon
          message={`Exceeded maximum allowed limit of ${MAX_SERVICE_AREAS_PER_PARTNER} hubs. Please deselect some hubs before saving.`}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<IServiceArea>
        rowKey="id"
        columns={columns}
        dataSource={serviceAreas}
        loading={loading}
        size="small"
        pagination={{ pageSize: 8, showSizeChanger: false }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => {
            setSelectedRowKeys(keys);
            setErrorAlert(null);
          },
        }}
        locale={{
          emptyText: 'No operational service areas available',
        }}
      />
    </Modal>
  );
}
