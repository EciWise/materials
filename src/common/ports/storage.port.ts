export const STORAGE_PORT = 'STORAGE_PORT';

export interface DownloadResult {
  stream: NodeJS.ReadableStream;
  contentType: string;
  filename: string;
}

export interface StoragePort {
  upload(buffer: Buffer, name: string, contentType: string): Promise<string>;
  download(fileUrl: string): Promise<DownloadResult>;
  delete(fileUrl: string): Promise<boolean>;
  exists(fileUrl: string): Promise<boolean>;
}
