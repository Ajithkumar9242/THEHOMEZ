export interface IFileSignatureValidationResult {
  valid: boolean;
  mimeType?: string;
  extension?: string;
  error?: string;
}

/**
 * Validates the binary header magic bytes of uploaded partner documents.
 * Strictly permits:
 * - PDF (%PDF)
 * - JPEG (0xFF 0xD8 0xFF)
 * - PNG (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
 * - WebP (RIFF .... WEBP)
 *
 * Explicitly rejects SVGs, HTML, executables, scripts, and spoofed extensions.
 */
export function validateDocumentSignature(buffer: Buffer): IFileSignatureValidationResult {
  if (!buffer || buffer.length < 12) {
    return {
      valid: false,
      error: 'File buffer is too small to verify binary signature',
    };
  }

  // 1. PDF: %PDF (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return {
      valid: true,
      mimeType: 'application/pdf',
      extension: 'pdf',
    };
  }

  // 2. JPEG: 0xFF 0xD8 0xFF
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      valid: true,
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }

  // 3. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      valid: true,
      mimeType: 'image/png',
      extension: 'png',
    };
  }

  // 4. WebP: 'RIFF' at 0..3 and 'WEBP' at 8..11
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return {
      valid: true,
      mimeType: 'image/webp',
      extension: 'webp',
    };
  }

  return {
    valid: false,
    error: 'Unsupported file signature. Only PDF, JPEG, PNG, and WebP files are permitted',
  };
}
