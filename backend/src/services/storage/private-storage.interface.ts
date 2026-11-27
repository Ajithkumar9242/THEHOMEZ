export interface IStorageObjectMeta {
  key: string;
  sizeBytes: number;
  lastModified: Date;
  tags?: Record<string, string>;
}

export interface IPrivateDocumentStorageAdapter {
  uploadPrivateDocument(
    fileBuffer: Buffer,
    options: {
      partnerId: string;
      documentType: string;
      originalFilename: string;
      mimeType: string;
      sha256Hash: string;
      tags?: Record<string, string>;
    },
  ): Promise<{
    storageKey: string;
    bytes: number;
    mimeType: string;
  }>;

  generateExpiringSignedUrl(
    storageKey: string,
    ttlSeconds: number,
  ): Promise<{
    downloadUrl: string;
    expiresAt: Date;
  }>;

  deletePrivateDocument(storageKey: string): Promise<boolean>;

  listStorageObjects(prefix: string): Promise<IStorageObjectMeta[]>;

  updateObjectTags(storageKey: string, tags: Record<string, string>): Promise<boolean>;
}
