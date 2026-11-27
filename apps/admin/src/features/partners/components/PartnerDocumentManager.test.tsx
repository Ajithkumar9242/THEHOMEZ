import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
  PartnerDocumentType,
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerDocumentDto,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { PartnerDocumentManager } from './PartnerDocumentManager.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    getPartnerDocuments: vi.fn(),
    getPartnerDocumentSignedUrl: vi.fn(),
    deletePartnerDocument: vi.fn(),
    reviewPartnerDocument: vi.fn(),
    overrideDocumentScanStatus: vi.fn(),
  },
}));

function createStaff(permissions: PermissionCode[]): IAuthUser {
  return {
    id: 'staff-test-user',
    phone: '+919999999999',
    email: 'staff@thehomez.com',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['OPERATOR'],
    permissions,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const mockGstDoc: IPartnerDocumentDto = {
  id: 'doc-gst-1',
  documentType: PartnerDocumentType.GST_CERTIFICATE,
  originalFilename: 'gst_certificate.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1048576,
  sha256Hash: 'hash1',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  uploadedBy: 'staff-1',
  status: DocumentReviewStatus.VERIFIED,
  scanStatus: DocumentScanStatus.CLEAN,
  scanGeneration: 1,
  manualSecurityReview: {
    status: ManualSecurityReviewStatus.NOT_REVIEWED,
  },
  isDeleted: false,
};

const mockPanDoc: IPartnerDocumentDto = {
  id: 'doc-pan-1',
  documentType: PartnerDocumentType.PAN_CARD,
  originalFilename: 'pan_card.jpg',
  mimeType: 'image/jpeg',
  fileSizeBytes: 524288,
  sha256Hash: 'hash2',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  uploadedBy: 'staff-1',
  status: DocumentReviewStatus.VERIFIED,
  scanStatus: DocumentScanStatus.CLEAN,
  scanGeneration: 1,
  manualSecurityReview: {
    status: ManualSecurityReviewStatus.NOT_REVIEWED,
  },
  isDeleted: false,
};

describe('PartnerDocumentManager Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders KYC documents and indicates activation proofs satisfied', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.PARTNER_WRITE,
      ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(partnerClient.getPartnerDocuments).mockResolvedValue({
      partnerId: 'partner-123',
      items: [mockGstDoc, mockPanDoc],
      total: 2,
    });

    render(<PartnerDocumentManager partnerId="partner-123" />);

    await waitFor(() => {
      expect(screen.getByText('gst_certificate.pdf')).toBeInTheDocument();
      expect(screen.getByText('pan_card.jpg')).toBeInTheDocument();
      expect(screen.getByText('Activation Proofs Satisfied')).toBeInTheDocument();
    });
  });

  it('fetches signed URL and opens in browser on download click', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(partnerClient.getPartnerDocuments).mockResolvedValue({
      partnerId: 'partner-123',
      items: [mockGstDoc],
      total: 1,
    });

    vi.mocked(partnerClient.getPartnerDocumentSignedUrl).mockResolvedValue({
      downloadUrl: 'https://storage.thehomez.com/signed-document-url.pdf',
      expiresAt: '2026-01-01T01:00:00.000Z',
      ttlSeconds: 900,
    });

    render(<PartnerDocumentManager partnerId="partner-123" />);

    await waitFor(() => {
      expect(screen.getByText('gst_certificate.pdf')).toBeInTheDocument();
    });

    const downloadBtn = screen.getByRole('button', { name: /Download/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(partnerClient.getPartnerDocumentSignedUrl).toHaveBeenCalledWith(
        'partner-123',
        mockGstDoc.id,
      );
      expect(window.open).toHaveBeenCalledWith(
        'https://storage.thehomez.com/signed-document-url.pdf',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });
});
