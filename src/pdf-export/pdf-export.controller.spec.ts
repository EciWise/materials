jest.mock('../config', () => ({
  envs: {
    blobStorageConnectionString: 'test-connection-string',
    blobStorageAccountName: 'test-account',
  },
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}), { virtual: true });

jest.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: jest.fn().mockReturnValue({
      getContainerClient: jest.fn().mockReturnValue({
        createIfNotExists: jest.fn().mockResolvedValue({}),
        getBlockBlobClient: jest.fn().mockReturnValue({
          uploadData: jest.fn(),
          url: 'https://fake.blob/file.pdf',
        }),
      }),
    }),
  },
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

import { PdfExportController } from './pdf-export.controller';
import { PdfExportService } from './pdf-export.service';
import { MaterialService } from '../material/material.service';
import { Readable, PassThrough } from 'stream';

describe('PdfExportController', () => {
  let controller: PdfExportController;
  let pdfExportServiceMock: { generateMaterialStatsPDF: jest.Mock };
  let materialServiceMock: { getMaterialStats: jest.Mock };

  beforeEach(() => {
    pdfExportServiceMock = {
      generateMaterialStatsPDF: jest.fn(),
    };

    materialServiceMock = {
      getMaterialStats: jest.fn(),
    };

    controller = new PdfExportController(
      pdfExportServiceMock as any,
      materialServiceMock as any,
    );
  });

  describe('exportMaterialStatsToPDF', () => {
    it('debería exportar un material a PDF y pipearlo al response', async () => {
      const fakeStream = new Readable({
        read() {
          this.push('fake-pdf-data');
          this.push(null);
        },
      });
      fakeStream.on = jest.fn().mockReturnValue(fakeStream);

      materialServiceMock.getMaterialStats.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Test Material',
      });

      pdfExportServiceMock.generateMaterialStatsPDF.mockResolvedValue({
        stream: fakeStream,
        filename: 'material-stats-mat-1.pdf',
        contentType: 'application/pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();

      await controller.exportMaterialStatsToPDF('mat-1', mockRes as any);

      expect(materialServiceMock.getMaterialStats).toHaveBeenCalledWith('mat-1');
      expect(pdfExportServiceMock.generateMaterialStatsPDF).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="material-stats-mat-1.pdf"',
      );
    });

    it('debería manejar errores del stream', async () => {
      const fakeStream = new Readable({
        read() {
          this.push(null);
        },
      });

      let errorHandler: (err: Error) => void;
      fakeStream.on = jest.fn().mockImplementation((event: string, cb: any) => {
        if (event === 'error') {
          errorHandler = cb;
        }
        return fakeStream;
      });

      materialServiceMock.getMaterialStats.mockResolvedValue({ id: 'mat-1' });
      pdfExportServiceMock.generateMaterialStatsPDF.mockResolvedValue({
        stream: fakeStream,
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();
      mockRes.status = jest.fn().mockReturnThis();
      mockRes.send = jest.fn();
      (mockRes as any).headersSent = false;

      await controller.exportMaterialStatsToPDF('mat-1', mockRes as any);

      if (errorHandler!) {
        errorHandler(new Error('PDF generation failed'));
      }

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.send).toHaveBeenCalledWith('Error generando el PDF');
    });

    it('debería llamar res.end si headers ya fueron enviados', async () => {
      const fakeStream = new Readable({
        read() {
          this.push(null);
        },
      });

      let errorHandler: (err: Error) => void;
      fakeStream.on = jest.fn().mockImplementation((event: string, cb: any) => {
        if (event === 'error') {
          errorHandler = cb;
        }
        return fakeStream;
      });

      materialServiceMock.getMaterialStats.mockResolvedValue({ id: 'mat-1' });
      pdfExportServiceMock.generateMaterialStatsPDF.mockResolvedValue({
        stream: fakeStream,
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();
      mockRes.end = jest.fn();
      (mockRes as any).headersSent = true;

      await controller.exportMaterialStatsToPDF('mat-1', mockRes as any);

      if (errorHandler!) {
        errorHandler(new Error('Stream error'));
      }

      expect(mockRes.end).toHaveBeenCalled();
    });

    it('debería limpiar comillas del filename', async () => {
      const fakeStream = new Readable({
        read() {
          this.push(null);
        },
      });
      fakeStream.on = jest.fn().mockReturnValue(fakeStream);

      materialServiceMock.getMaterialStats.mockResolvedValue({ id: 'mat-1' });
      pdfExportServiceMock.generateMaterialStatsPDF.mockResolvedValue({
        stream: fakeStream,
        filename: 'file"name.pdf',
        contentType: 'application/pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();

      await controller.exportMaterialStatsToPDF('mat-1', mockRes as any);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="filename.pdf"',
      );
    });
  });
});
