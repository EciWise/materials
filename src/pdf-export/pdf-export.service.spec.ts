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

import { PdfExportService } from './pdf-export.service';
import { MaterialDto } from '../material/dto/material.dto';

describe('PdfExportService', () => {
  let service: PdfExportService;

  beforeEach(() => {
    service = new PdfExportService();
  });

  describe('generateMaterialStatsPDF', () => {
    it('debería generar un PDF con los datos del material', async () => {
      const stats: MaterialDto = {
        id: 'mat-1',
        nombre: 'Calculo Diferencial',
        userId: 'user-1',
        userName: 'Test User',
        extension: 'pdf',
        url: 'https://blob/test.pdf',
        descripcion: 'Material de cálculo',
        vistos: 100,
        descargas: 50,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-06-20'),
        tags: ['calculo', 'mate'],
        calificacionPromedio: 4.5,
        totalComentarios: 10,
      };

      const result = await service.generateMaterialStatsPDF(stats);

      expect(result.filename).toBe('material-stats-mat-1.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.stream).toBeDefined();
    });

    it('debería manejar material sin tags', async () => {
      const stats: MaterialDto = {
        id: 'mat-2',
        nombre: 'Sin Tags',
        userId: 'user-1',
        url: 'https://blob/test.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        calificacionPromedio: undefined,
        totalComentarios: 0,
      };

      const result = await service.generateMaterialStatsPDF(stats);

      expect(result.filename).toBe('material-stats-mat-2.pdf');
      expect(result.contentType).toBe('application/pdf');
    });

    it('debería manejar material con campos undefined', async () => {
      const stats: MaterialDto = {
        id: 'mat-3',
        nombre: 'Material Mínimo',
        userId: 'user-1',
        url: 'https://blob/test.pdf',
        descripcion: undefined,
        vistos: undefined as any,
        descargas: undefined as any,
        createdAt: undefined,
        updatedAt: undefined,
        tags: undefined as any,
        calificacionPromedio: undefined,
        totalComentarios: undefined as any,
      };

      const result = await service.generateMaterialStatsPDF(stats);

      expect(result.filename).toBe('material-stats-mat-3.pdf');
      expect(result.contentType).toBe('application/pdf');
    });
  });
});
