jest.mock('../config', () => ({
  envs: {
    storageProvider: 'azure',
    messageBusProvider: 'azure',
  },
}));

jest.mock(
  '../prisma/prisma.service',
  () => ({
    PrismaService: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { MaterialListItemDto } from './dto/material.dto';
import { Readable, PassThrough } from 'stream';

describe('MaterialController', () => {
  let controller: MaterialController;
  let serviceMock: Record<string, jest.Mock>;

  beforeEach(() => {
    serviceMock = {
      getMaterialsByUserWithStats: jest.fn(),
      getPopularMaterials: jest.fn(),
      validateMaterial: jest.fn(),
      updateMaterialVersion: jest.fn(),
      getUserMaterialsStats: jest.fn(),
      getTopDownloadedMaterials: jest.fn(),
      getTopViewedMaterials: jest.fn(),
      getUserTopMaterials: jest.fn(),
      getUserAverageRating: jest.fn(),
      getUserTagsPercentage: jest.fn(),
      getGlobalTagsPercentage: jest.fn(),
      getMaterialsCount: jest.fn(),
      searchMaterialsByName: jest.fn(),
      getMaterialsByDate: jest.fn(),
      getAllMaterials: jest.fn(),
      rateMaterial: jest.fn(),
      getMaterialRatings: jest.fn(),
      getMaterialRatingsList: jest.fn(),
      searchMaterials: jest.fn(),
      getMaterialDetail: jest.fn(),
      downloadMaterial: jest.fn(),
      deleteMaterial: jest.fn(),
      getMaterialStats: jest.fn(),
    };

    controller = new MaterialController(serviceMock as any, {} as any);
  });

  // ────────────────────────────
  // Existent tests (preserved)
  // ────────────────────────────

  describe('getMaterialsByUser', () => {
    it('debería delegar en el servicio', async () => {
      const mockResponse: UserMaterialsResponseDto = {
        materials: [],
        totalVistas: 0,
        totalDescargas: 0,
        calificacionPromedio: null,
      };

      serviceMock.getMaterialsByUserWithStats.mockResolvedValue(mockResponse);

      const result = await controller.getMaterialsByUser('user-123');

      expect(serviceMock.getMaterialsByUserWithStats).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toBe(mockResponse);
    });
  });

  describe('getPopularMaterials', () => {
    it('debería delegar en el servicio', async () => {
      const now = new Date();
      const mockMaterials: MaterialListItemDto[] = [
        {
          id: 'mat-1',
          nombre: 'Popular',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 10,
          descargas: 5,
          createdAt: now,
          updatedAt: now,
          tags: [],
          calificacionPromedio: 4,
        },
      ];

      serviceMock.getPopularMaterials.mockResolvedValue(mockMaterials);

      const result = await controller.getPopularMaterials(10);

      expect(serviceMock.getPopularMaterials).toHaveBeenCalledWith(10);
      expect(result).toBe(mockMaterials);
    });
  });

  describe('subirNuevoMaterial', () => {
    it('debería lanzar error si no se envía archivo', async () => {
      await expect(
        controller.subirNuevoMaterial(undefined as any, { userId: 'user-123' }),
      ).rejects.toThrow('Archivo PDF requerido en el campo "file"');
    });

    it('debería lanzar error si el archivo no es PDF', async () => {
      const fakeFile = {
        mimetype: 'image/png',
        originalname: 'imagen.png',
        size: 1234,
        buffer: Buffer.from('fake'),
      };

      await expect(
        controller.subirNuevoMaterial(fakeFile as any, { userId: 'user-123' }),
      ).rejects.toThrow('Solo se permiten archivos PDF');
    });

    it('debería llamar a validateMaterial y devolver su resultado', async () => {
      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'material.pdf',
        size: 2048,
        buffer: Buffer.from('%PDF-1.4 contenido'),
      };

      const body = {
        userId: 'user-123',
        descripcion: 'Apuntes de cálculo',
      };

      const mockResult = { id: 'mat-1', message: 'ok' };
      serviceMock.validateMaterial.mockResolvedValue(mockResult);

      const result = await controller.subirNuevoMaterial(fakeFile as any, body);

      expect(serviceMock.validateMaterial).toHaveBeenCalledWith(
        fakeFile.buffer,
        body,
        fakeFile.originalname,
      );
      expect(result).toBe(mockResult);
    });
  });

  describe('actualizarMaterialVersion', () => {
    it('debería lanzar error si el archivo no es PDF', async () => {
      const fakeFile = {
        mimetype: 'image/png',
        originalname: 'imagen.png',
        size: 1234,
        buffer: Buffer.from('fake'),
      };

      await expect(
        controller.actualizarMaterialVersion('mat-1', fakeFile as any, {
          title: 'T',
          userId: 'u1',
        }),
      ).rejects.toThrow('Solo se permiten archivos PDF');
    });

    it('debería delegar sin archivo', async () => {
      const body = {
        title: 'Nuevo título',
        description: 'Actualizado',
        userId: 'user-123',
      };
      const mockResult = { id: 'mat-1', title: body.title };
      serviceMock.updateMaterialVersion.mockResolvedValue(mockResult);

      const result = await controller.actualizarMaterialVersion(
        'mat-1',
        undefined as any,
        body,
      );

      expect(serviceMock.updateMaterialVersion).toHaveBeenCalledWith(
        'mat-1',
        undefined,
        body.title,
        body.description,
        undefined,
      );
      expect(result).toBe(mockResult);
    });

    it('debería delegar con archivo PDF', async () => {
      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'nuevo.pdf',
        size: 2048,
        buffer: Buffer.from('%PDF-1.4....'),
      };
      const body = {
        title: 'Nuevo título',
        description: 'Actualizado',
        userId: 'user-123',
      };
      const mockResult = { id: 'mat-1', title: body.title };
      serviceMock.updateMaterialVersion.mockResolvedValue(mockResult);

      const result = await controller.actualizarMaterialVersion(
        'mat-1',
        fakeFile as any,
        body,
      );

      expect(serviceMock.updateMaterialVersion).toHaveBeenCalledWith(
        'mat-1',
        fakeFile.buffer,
        body.title,
        body.description,
        fakeFile.originalname,
      );
      expect(result).toBe(mockResult);
    });
  });

  // ────────────────────────────
  // NEW TESTS: all uncovered endpoints
  // ────────────────────────────

  describe('getUserMaterialsStats', () => {
    it('debería delegar en el servicio', async () => {
      const mockStats = {
        userId: 'user-1',
        calificacionPromedio: 4.5,
        totalMateriales: 5,
        totalDescargas: 20,
        totalVistas: 100,
      };
      serviceMock.getUserMaterialsStats.mockResolvedValue(mockStats);

      const result = await controller.getUserMaterialsStats('user-1');

      expect(serviceMock.getUserMaterialsStats).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockStats);
    });
  });

  describe('getTopDownloadedMaterials', () => {
    it('debería delegar en el servicio', async () => {
      const mockTop = {
        userId: 'user-1',
        topDownloaded: [
          {
            id: 'm1',
            nombre: 'Top',
            descargas: 50,
            vistos: 10,
            calificacionPromedio: 4,
          },
        ],
      };
      serviceMock.getTopDownloadedMaterials.mockResolvedValue(mockTop);

      const result = await controller.getTopDownloadedMaterials('user-1');

      expect(serviceMock.getTopDownloadedMaterials).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result).toBe(mockTop);
    });
  });

  describe('getTopViewedMaterials', () => {
    it('debería delegar en el servicio', async () => {
      const mockTop = {
        userId: 'user-1',
        topViewed: [
          {
            id: 'm1',
            nombre: 'Top',
            descargas: 10,
            vistos: 50,
            calificacionPromedio: 5,
          },
        ],
      };
      serviceMock.getTopViewedMaterials.mockResolvedValue(mockTop);

      const result = await controller.getTopViewedMaterials('user-1');

      expect(serviceMock.getTopViewedMaterials).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockTop);
    });
  });

  describe('getUserTopMaterials', () => {
    it('debería delegar en el servicio', async () => {
      const mockMaterials = [
        {
          id: 'm1',
          nombre: 'Top',
          descargas: 50,
          vistos: 100,
          calificacionPromedio: 5,
          tags: ['calculo'],
        },
      ];
      serviceMock.getUserTopMaterials.mockResolvedValue(mockMaterials);

      const result = await controller.getUserTopMaterials('user-1');

      expect(serviceMock.getUserTopMaterials).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockMaterials);
    });
  });

  describe('getUserAverageRating', () => {
    it('debería delegar en el servicio', async () => {
      const mockRating = {
        userId: 'user-1',
        calificacionPromedio: 4.2,
        totalCalificaciones: 10,
        totalMateriales: 5,
      };
      serviceMock.getUserAverageRating.mockResolvedValue(mockRating);

      const result = await controller.getUserAverageRating('user-1');

      expect(serviceMock.getUserAverageRating).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockRating);
    });
  });

  describe('getUserTagsPercentage', () => {
    it('debería delegar en el servicio', async () => {
      const mockTags = {
        userId: 'user-1',
        tags: [
          { tag: 'calculo', porcentaje: 60 },
          { tag: 'algebra', porcentaje: 40 },
        ],
      };
      serviceMock.getUserTagsPercentage.mockResolvedValue(mockTags);

      const result = await controller.getUserTagsPercentage('user-1');

      expect(serviceMock.getUserTagsPercentage).toHaveBeenCalledWith('user-1');
      expect(result).toBe(mockTags);
    });
  });

  describe('getGlobalTagsPercentage', () => {
    it('debería delegar en el servicio', async () => {
      const mockGlobal = {
        totalTags: 2,
        totalAsociaciones: 10,
        tags: [{ tag: 'calculo', cantidad: 6, porcentaje: 60 }],
      };
      serviceMock.getGlobalTagsPercentage.mockResolvedValue(mockGlobal);

      const result = await controller.getGlobalTagsPercentage();

      expect(serviceMock.getGlobalTagsPercentage).toHaveBeenCalled();
      expect(result).toBe(mockGlobal);
    });
  });

  describe('getMaterialsCount', () => {
    it('debería delegar en el servicio', async () => {
      const mockCount = { Count: 42 };
      serviceMock.getMaterialsCount.mockResolvedValue(mockCount);

      const result = await controller.getMaterialsCount();

      expect(serviceMock.getMaterialsCount).toHaveBeenCalled();
      expect(result).toBe(mockCount);
    });
  });

  describe('searchMaterialsByName', () => {
    it('debería delegar en el servicio', async () => {
      const mockResults = [{ id: 'mat-1', nombre: 'Calculo' }];
      serviceMock.searchMaterialsByName.mockResolvedValue(mockResults);

      const result = await controller.searchMaterialsByName('calculo', 0, 10);

      expect(serviceMock.searchMaterialsByName).toHaveBeenCalledWith(
        'calculo',
        0,
        10,
      );
      expect(result).toBe(mockResults);
    });
  });

  describe('getMaterialsByDate', () => {
    it('debería delegar en el servicio', async () => {
      const mockResults = [{ id: 'mat-1', nombre: 'Material' }];
      serviceMock.getMaterialsByDate.mockResolvedValue(mockResults);

      const result = await controller.getMaterialsByDate('desc', 0, 10);

      expect(serviceMock.getMaterialsByDate).toHaveBeenCalledWith(
        'desc',
        0,
        10,
      );
      expect(result).toBe(mockResults);
    });
  });

  describe('getAllMaterials', () => {
    it('debería delegar en el servicio', async () => {
      const mockResults = [{ id: 'mat-1', nombre: 'Material' }];
      serviceMock.getAllMaterials.mockResolvedValue(mockResults);

      const result = await controller.getAllMaterials(0, 10);

      expect(serviceMock.getAllMaterials).toHaveBeenCalledWith(0, 10);
      expect(result).toBe(mockResults);
    });
  });

  describe('rateMaterial', () => {
    it('debería delegar en el servicio', async () => {
      const mockResponse = {
        materialId: 'mat-1',
        rating: 5,
        comentario: 'Excelente',
        calificacionPromedio: 4.5,
        totalCalificaciones: 10,
      };
      serviceMock.rateMaterial.mockResolvedValue(mockResponse);

      const result = await controller.rateMaterial('mat-1', {
        userId: 'user-1',
        rating: 5,
        comentario: 'Excelente',
      });

      expect(serviceMock.rateMaterial).toHaveBeenCalledWith(
        'mat-1',
        'user-1',
        5,
        'Excelente',
      );
      expect(result).toBe(mockResponse);
    });
  });

  describe('getMaterialRatings', () => {
    it('debería delegar en el servicio', async () => {
      const mockRatings = {
        materialId: 'mat-1',
        calificacionPromedio: 4,
        totalCalificaciones: 5,
        totalDescargas: 10,
        totalVistas: 20,
      };
      serviceMock.getMaterialRatings.mockResolvedValue(mockRatings);

      const result = await controller.getMaterialRatings('mat-1');

      expect(serviceMock.getMaterialRatings).toHaveBeenCalledWith('mat-1');
      expect(result).toBe(mockRatings);
    });
  });

  describe('getMaterialRatingsList', () => {
    it('debería delegar en el servicio', async () => {
      const mockList = [{ id: 'cal-1', calificacion: 5, comentario: 'Bueno' }];
      serviceMock.getMaterialRatingsList.mockResolvedValue(mockList);

      const result = await controller.getMaterialRatingsList('mat-1');

      expect(serviceMock.getMaterialRatingsList).toHaveBeenCalledWith('mat-1');
      expect(result).toBe(mockList);
    });
  });

  describe('searchMaterials', () => {
    it('debería delegar en el servicio con filtros', async () => {
      const mockResult = {
        materials: [{ id: 'mat-1' }],
        total: 1,
      };
      serviceMock.searchMaterials.mockResolvedValue(mockResult);

      const filters = {
        palabraClave: 'calculo',
        materia: 'mate',
        autor: 'user-1',
        tipoMaterial: 'pdf',
        semestre: 3,
        calificacionMin: 4,
        page: 1,
        size: 10,
      };

      const result = await controller.searchMaterials(filters as any);

      expect(serviceMock.searchMaterials).toHaveBeenCalledWith(
        'calculo',
        'mate',
        'user-1',
        'pdf',
        3,
        4,
        1,
        10,
      );
      expect(result).toEqual({
        materials: [{ id: 'mat-1' }],
        total: 1,
        page: 1,
        size: 10,
        totalPages: 1,
      });
    });

    it('debería usar valores por defecto para page y size', async () => {
      serviceMock.searchMaterials.mockResolvedValue({
        materials: [],
        total: 0,
      });

      const filters = {};
      const result = await controller.searchMaterials(filters as any);

      expect(serviceMock.searchMaterials).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        10,
      );
      expect(result.page).toBe(1);
      expect(result.size).toBe(10);
    });

    it('debería calcular totalPages correctamente', async () => {
      serviceMock.searchMaterials.mockResolvedValue({
        materials: [],
        total: 25,
      });

      const filters = { page: 1, size: 10 };
      const result = await controller.searchMaterials(filters as any);

      expect(result.totalPages).toBe(3); // ceil(25/10)
    });
  });

  describe('getMaterialDetail', () => {
    it('debería delegar en el servicio', async () => {
      const mockDetail = {
        metadata: { id: 'mat-1', nombre: 'Test' },
        calificación: 4.5,
        previewURL: 'https://blob/test.pdf',
      };
      serviceMock.getMaterialDetail.mockResolvedValue(mockDetail);

      const result = await controller.getMaterialDetail('mat-1');

      expect(serviceMock.getMaterialDetail).toHaveBeenCalledWith('mat-1');
      expect(result).toBe(mockDetail);
    });
  });

  describe('downloadMaterial', () => {
    it('debería delegar en el servicio y pipear el stream', async () => {
      const fakeStream = new Readable({
        read() {
          this.push('fake-data');
          this.push(null);
        },
      });

      serviceMock.downloadMaterial.mockResolvedValue({
        stream: fakeStream,
        contentType: 'application/pdf',
        filename: 'material.pdf',
      });

      // Use PassThrough as a mock writable that supports .on and .pipe
      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();
      mockRes.on = jest.fn().mockImplementation((event: string, cb: any) => {
        if (event === 'error') {
          // store for later
        }
        return mockRes;
      }) as any;

      const mockReq = {} as any;

      await controller.downloadMaterial('mat-1', mockRes as any, mockReq);

      expect(serviceMock.downloadMaterial).toHaveBeenCalledWith('mat-1');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="material.pdf"',
      );
    });

    it('debería manejar errores del stream', async () => {
      const fakeStream = new Readable({
        read() {
          this.push('fake-data');
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

      serviceMock.downloadMaterial.mockResolvedValue({
        stream: fakeStream,
        contentType: 'application/pdf',
        filename: 'test.pdf',
      });

      // Use a mock that supports both setHeader and the writable stream interface
      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();
      mockRes.status = jest.fn().mockReturnThis();
      mockRes.send = jest.fn();
      (mockRes as any).headersSent = false;

      const mockReq = {} as any;

      await controller.downloadMaterial('mat-1', mockRes as any, mockReq);

      // Simulate stream error
      if (errorHandler!) {
        errorHandler(new Error('Stream failed'));
      }

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.send).toHaveBeenCalledWith('Error descargando el archivo');
    });

    it('debería llamar res.end si headers ya fueron enviados y hay error en stream', async () => {
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

      serviceMock.downloadMaterial.mockResolvedValue({
        stream: fakeStream,
        contentType: 'application/pdf',
        filename: 'test.pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();
      mockRes.end = jest.fn();
      (mockRes as any).headersSent = true;

      await controller.downloadMaterial('mat-1', mockRes as any, {} as any);

      if (errorHandler!) {
        errorHandler(new Error('Stream failed'));
      }

      expect(mockRes.end).toHaveBeenCalled();
    });

    it('debería limpiar comillas del filename en Content-Disposition', async () => {
      const fakeStream = new Readable({
        read() {
          this.push(null);
        },
      });
      fakeStream.on = jest.fn().mockReturnValue(fakeStream);

      serviceMock.downloadMaterial.mockResolvedValue({
        stream: fakeStream,
        contentType: 'application/pdf',
        filename: 'file"name.pdf',
      });

      const mockRes = new PassThrough();
      mockRes.setHeader = jest.fn();

      await controller.downloadMaterial('mat-1', mockRes as any, {} as any);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="filename.pdf"',
      );
    });
  });

  describe('deleteMaterial', () => {
    it('debería delegar en el servicio', async () => {
      const mockResult = { message: 'Material mat-1 eliminado correctamente' };
      serviceMock.deleteMaterial.mockResolvedValue(mockResult);

      const result = await controller.deleteMaterial('mat-1');

      expect(serviceMock.deleteMaterial).toHaveBeenCalledWith('mat-1');
      expect(result).toBe(mockResult);
    });
  });
});
