import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  DocumentReviewStatus,
  DocumentScanStatus,
  PartnerDocumentType,
  PermissionCode,
  type IPartnerDocumentDto,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { DocumentReviewModal } from './DocumentReviewModal.js';
import { ManualSecurityOverrideModal } from './ManualSecurityOverrideModal.js';
import { ApiError } from '../../../services/api-client.js';

interface PartnerDocumentManagerProps {
  partnerId: string;
  onDocumentChange?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function PartnerDocumentManager({
  partnerId,
  onDocumentChange,
}: PartnerDocumentManagerProps) {
  const { user } = useAuth();
  const canVerify = user?.permissions.includes(PermissionCode.PARTNER_VERIFY) ?? false;
  const canWrite = user?.permissions.includes(PermissionCode.PARTNER_WRITE) ?? false;
  const canManageRbac = user?.permissions.includes(PermissionCode.RBAC_MANAGE) ?? false;

  const [documents, setDocuments] = useState<IPartnerDocumentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewDoc, setReviewDoc] = useState<IPartnerDocumentDto | null>(null);

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideDoc, setOverrideDoc] = useState<IPartnerDocumentDto | null>(null);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!partnerId) return;
    setLoading(true);
    setErrorAlert(null);
    try {
      const res = await partnerClient.getPartnerDocuments(partnerId);
      setDocuments(res.items);
    } catch (err) {
      setErrorAlert(
        err instanceof Error ? err.message : 'Failed to retrieve partner documents.',
      );
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleDownload = async (doc: IPartnerDocumentDto) => {
    setDownloadingId(doc.id);
    setErrorAlert(null);
    try {
      const res = await partnerClient.getPartnerDocumentSignedUrl(partnerId, doc.id);
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErrorAlert(
        err instanceof Error ? err.message : 'Failed to generate download URL.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (doc: IPartnerDocumentDto) => {
    setErrorAlert(null);
    try {
      await partnerClient.deletePartnerDocument(partnerId, doc.id);
      setFeedback(`Document "${doc.originalFilename}" has been successfully removed.`);
      void loadDocuments();
      onDocumentChange?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorAlert(err.message);
      } else if (err instanceof Error) {
        setErrorAlert(err.message);
      } else {
        setErrorAlert('Failed to delete document.');
      }
    }
  };

  const handleReviewSuccess = (_updated: IPartnerDocumentDto) => {
    setFeedback('Document review status updated successfully.');
    void loadDocuments();
    onDocumentChange?.();
  };

  const handleOverrideSuccess = (_updated: IPartnerDocumentDto) => {
    setFeedback('Document security override applied successfully.');
    void loadDocuments();
    onDocumentChange?.();
  };

  // Eligibility evaluation (KYC proof baseline: GST and PAN verified)
  const hasVerifiedGst = documents.some(
    (d) =>
      (d.documentType === PartnerDocumentType.GST_CERTIFICATE ||
        String(d.documentType) === 'GSTIN_CERTIFICATE') &&
      d.status === DocumentReviewStatus.VERIFIED &&
      !d.isDeleted,
  );
  const hasVerifiedPan = documents.some(
    (d) =>
      d.documentType === PartnerDocumentType.PAN_CARD &&
      d.status === DocumentReviewStatus.VERIFIED &&
      !d.isDeleted,
  );
  const isEligibleForActivation = hasVerifiedGst && hasVerifiedPan;

  const missingProofs: string[] = [];
  if (!hasVerifiedGst) missingProofs.push('GSTIN Certificate');
  if (!hasVerifiedPan) missingProofs.push('Permanent Account Number (PAN) Card');

  const columns: ColumnsType<IPartnerDocumentDto> = [
    {
      title: 'Document Type',
      dataIndex: 'documentType',
      key: 'documentType',
      render: (type: string) => (
        <Space>
          <FileProtectOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>{type.replace(/_/g, ' ')}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'File Details',
      key: 'fileDetails',
      render: (_, doc) => (
        <div>
          <Typography.Text>{doc.originalFilename}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(doc.fileSizeBytes)} • {doc.mimeType}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Antivirus Scan',
      dataIndex: 'scanStatus',
      key: 'scanStatus',
      render: (status: DocumentScanStatus) => {
        switch (status) {
          case DocumentScanStatus.CLEAN:
            return <Tag color="green" icon={<CheckCircleOutlined />}>CLEAN</Tag>;
          case DocumentScanStatus.INFECTED:
            return <Tag color="red" icon={<CloseCircleOutlined />}>INFECTED</Tag>;
          case DocumentScanStatus.PENDING_SCAN:
            return <Tag color="blue" icon={<SyncOutlined spin />}>SCANNING</Tag>;
          case DocumentScanStatus.SCAN_FAILED:
            return <Tag color="orange" icon={<ExclamationCircleOutlined />}>SCAN FAILED</Tag>;
          default:
            return <Tag>{status}</Tag>;
        }
      },
    },
    {
      title: 'Verification Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: DocumentReviewStatus, doc) => {
        if (status === DocumentReviewStatus.VERIFIED) {
          return <Tag color="green" icon={<CheckCircleOutlined />}>VERIFIED</Tag>;
        }
        if (status === DocumentReviewStatus.REJECTED) {
          return (
            <Tooltip title={doc.rejectionReason || 'No reason provided'}>
              <Tag color="red" icon={<CloseCircleOutlined />}>REJECTED</Tag>
            </Tooltip>
          );
        }
        return <Tag color="gold" icon={<SyncOutlined />}>PENDING REVIEW</Tag>;
      },
    },
    {
      title: 'Uploaded At',
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      render: (date: string) => (date ? new Date(date).toLocaleDateString() : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, doc) => (
        <Space size="small">
          {/* Download */}
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingId === doc.id}
            disabled={doc.scanStatus === DocumentScanStatus.INFECTED}
            onClick={() => void handleDownload(doc)}
          >
            Download
          </Button>

          {/* Review (Verify / Reject) */}
          {canVerify && (
            <Button
              size="small"
              onClick={() => {
                setReviewDoc(doc);
                setReviewModalOpen(true);
              }}
            >
              Review
            </Button>
          )}

          {/* Antivirus Security Override */}
          {canVerify &&
            canManageRbac &&
            (doc.scanStatus === DocumentScanStatus.INFECTED ||
              doc.scanStatus === DocumentScanStatus.SCAN_FAILED) && (
              <Button
                size="small"
                danger
                onClick={() => {
                  setOverrideDoc(doc);
                  setOverrideModalOpen(true);
                }}
              >
                Override
              </Button>
            )}

          {/* Soft Delete */}
          {canWrite && (
            <Popconfirm
              title="Delete Document"
              description={`Are you sure you want to remove "${doc.originalFilename}"? This will move the document to soft-deleted storage.`}
              onConfirm={() => void handleDelete(doc)}
              okText="Delete"
              cancelText="Cancel"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger>
                Delete
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <span>KYC Compliance Documents</span>
          <Tag color={isEligibleForActivation ? 'green' : 'orange'}>
            {isEligibleForActivation
              ? 'Activation Proofs Satisfied'
              : 'Proofs Incomplete'}
          </Tag>
        </Space>
      }
      extra={
        <Button
          icon={<ReloadOutlined />}
          size="small"
          onClick={() => void loadDocuments()}
          loading={loading}
        >
          Refresh
        </Button>
      }
      variant="borderless"
      className="catalogue-card"
    >
      {feedback && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setFeedback(null)}
          message={feedback}
          style={{ marginBottom: 16 }}
        />
      )}

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

      {!isEligibleForActivation && missingProofs.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Missing Mandatory Verification Documents"
          description={`Partner is missing verified records for: ${missingProofs.join(', ')}. Standard activation requires verified GST and PAN proofs or a supervisory waiver.`}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<IPartnerDocumentDto>
        rowKey="id"
        columns={columns}
        dataSource={documents}
        loading={loading}
        pagination={false}
        size="small"
        locale={{
          emptyText: 'No KYC documents uploaded for this partner organization',
        }}
      />

      <DocumentReviewModal
        open={reviewModalOpen}
        partnerId={partnerId}
        document={reviewDoc}
        onClose={() => {
          setReviewModalOpen(false);
          setReviewDoc(null);
        }}
        onSuccess={handleReviewSuccess}
      />

      <ManualSecurityOverrideModal
        open={overrideModalOpen}
        partnerId={partnerId}
        document={overrideDoc}
        onClose={() => {
          setOverrideModalOpen(false);
          setOverrideDoc(null);
        }}
        onSuccess={handleOverrideSuccess}
      />
    </Card>
  );
}
