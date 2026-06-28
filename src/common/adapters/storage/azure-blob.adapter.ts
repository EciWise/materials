import { Injectable, Logger } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import { DownloadResult, StoragePort } from '../../ports/storage.port';
import { Readable } from 'node:stream';

@Injectable()
export class AzureBlobAdapter implements StoragePort {
  private readonly logger = new Logger(AzureBlobAdapter.name);
  private readonly containerClient;
  private readonly accountName: string;
  private readonly containerName = 'materials';

  constructor(connectionString: string, accountName: string) {
    this.accountName = accountName;
    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = blobServiceClient.getContainerClient(
      this.containerName,
    );
    this.containerClient.createIfNotExists().catch((err: Error) => {
      this.logger.warn(
        `No se pudo crear/asegurar contenedor '${this.containerName}': ${err?.message}`,
      );
    });
  }

  async upload(
    buffer: Buffer,
    name: string,
    contentType: string,
  ): Promise<string> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(name);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return `https://${this.accountName}.blob.core.windows.net/${this.containerName}/${name}`;
  }

  async download(fileUrl: string): Promise<DownloadResult> {
    const blobName = this.extractBlobName(fileUrl);
    let blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    const exists = await blockBlobClient.exists();
    if (!exists) {
      const encoded = encodeURIComponent(blobName);
      const fallback = this.containerClient.getBlockBlobClient(encoded);
      const fallbackExists = await fallback.exists();
      if (!fallbackExists) {
        throw new Error(`Blob not found: ${blobName}`);
      }
      blockBlobClient = fallback;
    }

    const response = await blockBlobClient.download();
    const stream = response.readableStreamBody;
    const contentType = response.contentType ?? 'application/pdf';
    const filename = blobName.split('/').pop() ?? 'material.pdf';

    if (!stream) {
      const buffer = await blockBlobClient.downloadToBuffer();
      return {
        stream: Readable.from(buffer) as NodeJS.ReadableStream,
        contentType,
        filename,
      };
    }

    return { stream, contentType, filename };
  }

  async delete(fileUrl: string): Promise<boolean> {
    const blobName = this.extractBlobName(fileUrl);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const result = await blockBlobClient.deleteIfExists();
    return result.succeeded;
  }

  async exists(fileUrl: string): Promise<boolean> {
    const blobName = this.extractBlobName(fileUrl);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    return blockBlobClient.exists();
  }

  private extractBlobName(fileUrl: string): string {
    const url = new URL(fileUrl);
    const parts = url.pathname.split('/');
    return decodeURIComponent(parts.slice(2).join('/'));
  }
}
