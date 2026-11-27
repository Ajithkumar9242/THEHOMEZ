import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
  PartnerDocumentType,
  type IPartnerDocumentDto,
} from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { DocumentReviewModal } from './DocumentReviewModal.js';

vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    reviewPartnerDocument: vi.fn(),
  },
}));

const mockDocument: IPartnerDocumentDto = {
  id: 'doc-123',
  documentType: PartnerDocumentType.GST_CERTIFICATE,
  originalFilename: 'gstin_certificate.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 204800,
  sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  uploadedBy: 'staff-1',
  status: DocumentReviewStatus.PENDING_REVIEW,
  scanStatus: DocumentScanStatus.CLEAN,
  scanGeneration: 1,
  manualSecurityReview: {
    status: ManualSecurityReviewStatus.NOT_REVIEWED,
  },
  isDeleted: false,
};

describe('DocumentReviewModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders review options and document details', () => {
    render(
      <DocumentReviewModal
        open={true}
        partnerId="partner-1"
        document={mockDocument}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/Review Partner KYC Document/i)).toBeInTheDocument();
    expect(screen.getByText(/gstin_certificate\.pdf/i)).toBeInTheDocument();
    expect(screen.getByText(/Verify Document/i)).toBeInTheDocument();
    expect(screen.getByText(/Reject Document/i)).toBeInTheDocument();
  });

  it('shows rejection reason field when Reject Document is selected', async () => {
    render(
      <DocumentReviewModal
        open={true}
        partnerId="partner-1"
        document={mockDocument}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const rejectRadio = screen.getByLabelText(/Reject Document/i);
    fireEvent.click(rejectRadio);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/GSTIN certificate is illegible/i),
      ).toBeInTheDocument();
    });
  });

  it('submits verification decision and invokes onSuccess', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    vi.mocked(partnerClient.reviewPartnerDocument).mockResolvedValue({
      document: {
        ...mockDocument,
        status: DocumentReviewStatus.VERIFIED,
      },
    });

    render(
      <DocumentReviewModal
        open={true}
        partnerId="partner-1"
        document={mockDocument}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Review/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(partnerClient.reviewPartnerDocument).toHaveBeenCalledWith(
        'partner-1',
        mockDocument.id,
        {
          status: DocumentReviewStatus.VERIFIED,
          rejectionReason: undefined,
        },
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
