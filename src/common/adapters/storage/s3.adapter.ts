import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { DownloadResult, StoragePort } from '../../ports/storage.port';

@Injectable()
export class S3Adapter implements StoragePort {
  private readonly logger = new Logger(S3Adapter.name);
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async upload(
    buffer: Buffer,
    name: string,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: name,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${name}`;
  }

  async download(fileUrl: string): Promise<DownloadResult> {
    const key = this.extractKey(fileUrl);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) throw new Error(`S3 object body is empty: ${key}`);

    const stream = body as unknown as Readable;
    const contentType = response.ContentType ?? 'application/octet-stream';
    const filename = key.split('/').pop() ?? 'file';
    return { stream, contentType, filename };
  }

  async delete(fileUrl: string): Promise<boolean> {
    const key = this.extractKey(fileUrl);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return true;
  }

  async exists(fileUrl: string): Promise<boolean> {
    const key = this.extractKey(fileUrl);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404)
        return false;
      throw err;
    }
  }

  private extractKey(fileUrl: string): string {
    const url = new URL(fileUrl);
    return url.pathname.replace(/^\//, '');
  }
}
