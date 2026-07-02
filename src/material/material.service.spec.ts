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

import { MaterialService } from './material.service';
import { StoragePort } from '../common/ports/storage.port';
import {
  MessageBusPort,
  MessageHandler,
  ErrorHandler,
} from '../common/ports/message-bus.port';
import { RespuestaIADto } from './dto/respuestIA.dto';

describe('MaterialService', () => {
  let service: MaterialService;
  let prismaMock: any;
  let storageMock: jest.Mocked<StoragePort>;
  let messageBusMock: jest.Mocked<MessageBusPort>;
  let subscribeHandler: MessageHandler<RespuestaIADto>;
  let subscribeErrorHandler: ErrorHandler;

  beforeEach(() => {
    prismaMock = {
      materiales: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tags: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      materialTags: {
        create: jest.fn(),
      },
      calificaciones: {
        findMany: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      usuarios: {
        findUnique: jest.fn(),
      },
    };

    storageMock = {
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    };

    messageBusMock = {
      send: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation((_queue, onMessage, onError) => {
        subscribeHandler = onMessage;
        subscribeErrorHandler = onError;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    service = new MaterialService(storageMock, messageBusMock, prismaMock);
  });

  // ────────────────────────────
  // getMaterialsByUserWithStats
  // ────────────────────────────

  describe('getMaterialsByUserWithStats', () => {
    it('debería devolver los materiales del usuario con estadísticas correctas', async () => {
      const now = new Date();
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Guía de cálculo',
          userId: 'user-123',
          url: 'https://blob/guia.pdf',
          descripcion: 'Guía para parcial',
          vistos: 10,
          descargas: 3,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [
            { Tags: { tag: 'cálculo' } },
            { Tags: { tag: 'parcial' } },
          ],
          Calificaciones: [
            { calificacion: 4, comentario: 'bueno' },
            { calificacion: 5, comentario: '' },
          ],
          usuarios: { nombre: 'User 123' },
        },
        {
          id: 'mat-2',
          nombre: 'Taller de álgebra',
          userId: 'user-123',
          url: 'https://blob/taller.pdf',
          descripcion: null,
          vistos: 5,
          descargas: 2,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [{ calificacion: 3, comentario: null }],
          usuarios: { nombre: 'User 123' },
        },
      ]);

      const result = await service.getMaterialsByUserWithStats('user-123');

      expect(result.materials).toHaveLength(2);
      expect(result.materials[0].id).toBe('mat-1');
      expect(result.materials[0].tags).toEqual(['cálculo', 'parcial']);
      expect(result.materials[0].calificacionPromedio).toBe(4.5);
      expect(result.totalVistas).toBe(15);
      expect(result.totalDescargas).toBe(5);
      expect(result.calificacionPromedio).toBeCloseTo(4);
    });

    it('debería manejar el caso sin calificaciones', async () => {
      const now = new Date();
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Guía sin calificaciones',
          userId: 'user-123',
          url: 'https://blob/guia.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 123' },
        },
      ]);

      const result = await service.getMaterialsByUserWithStats('user-123');
      expect(result.materials).toHaveLength(1);
      expect(result.calificacionPromedio).toBeNull();
    });

    it('debería devolver arrays vacíos si el usuario no tiene materiales', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getMaterialsByUserWithStats('user-empty');
      expect(result.materials).toHaveLength(0);
      expect(result.calificacionPromedio).toBeNull();
    });
  });

  // ────────────────────────────
  // getPopularMaterials
  // ────────────────────────────

  describe('getPopularMaterials', () => {
    it('debería devolver los materiales ordenados por descargas y vistas', async () => {
      const now = new Date();
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Más descargado',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 50,
          descargas: 20,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 1' },
        },
        {
          id: 'mat-2',
          nombre: 'Segundo lugar',
          userId: 'u2',
          url: 'https://blob/m2.pdf',
          descripcion: null,
          vistos: 40,
          descargas: 10,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 2' },
        },
      ]);

      const result = await service.getPopularMaterials(10);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mat-1');
    });

    it('debería devolver array vacío si no hay materiales', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getPopularMaterials(10);
      expect(result).toHaveLength(0);
    });
  });

  // ────────────────────────────
  // guardarMaterial y guardarTags
  // ────────────────────────────

  describe('guardarMaterial y guardarTags', () => {
    it('debería guardar el material y crear/relacionar las tags', async () => {
      const now = new Date();
      const material = {
        id: 'mat-1',
        nombre: 'Material prueba',
        userId: 'user-1',
        url: 'https://blob/m1.pdf',
        descripcion: 'desc',
        vistos: 0,
        descargas: 0,
        createdAt: now,
        updatedAt: now,
      };

      prismaMock.tags.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tag-2', tag: 'algebra' });
      prismaMock.tags.create.mockResolvedValue({ id: 'tag-1', tag: 'calculo' });
      prismaMock.materialTags.create.mockResolvedValue({});

      await service.guardarMaterial(material as any, ['calculo', 'algebra']);

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({
        data: material,
      });
      expect(prismaMock.tags.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.tags.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.materialTags.create).toHaveBeenCalledTimes(2);
    });

    it('no debería fallar si no se pasan tags', async () => {
      const material = {
        id: 'mat-2',
        nombre: 'Sin tags',
        userId: 'user-1',
        url: 'https://blob/m2.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.guardarMaterial(material as any, []);

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({
        data: material,
      });
      expect(prismaMock.tags.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.materialTags.create).not.toHaveBeenCalled();
    });

    it('debería agregar el subject como tag adicional cuando se proporciona', async () => {
      const material = {
        id: 'mat-3',
        nombre: 'Con subject',
        userId: 'user-1',
        url: 'https://blob/m3.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.tags.findFirst.mockResolvedValue({
        id: 'tag-subj',
        tag: 'mate',
      });
      prismaMock.materialTags.create.mockResolvedValue({});

      await service.guardarMaterial(material as any, ['calculo'], 'mate');

      expect(prismaMock.tags.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.materialTags.create).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────
  // enviarNotificacion
  // ────────────────────────────

  describe('enviarNotificacion', () => {
    it('debería enviar un mensaje a la cola de notificaciones con el cuerpo correcto', async () => {
      const response = {
        tema: 'Cálculo diferencial',
        materia: 'Cálculo I',
        valid: true,
        tags: ['cálculo'],
      } as any;
      prismaMock.usuarios.findUnique.mockResolvedValue({
        email: 'test@test.com',
        nombre: 'Test User',
      });

      await service.enviarNotificacion(
        response,
        'user-1',
        'archivo.pdf',
        'nuevoMaterialSubido',
      );

      expect(messageBusMock.send).toHaveBeenCalledWith(
        'mail.envio.individual',
        expect.objectContaining({
          email: 'test@test.com',
          name: 'Test User',
          template: 'nuevoMaterialSubido',
        }),
      );
    });

    it('debería manejar usuario no encontrado con valores por defecto', async () => {
      const response = {
        tema: 'Álgebra',
        materia: 'Álgebra I',
        valid: true,
        tags: [],
      } as any;
      prismaMock.usuarios.findUnique.mockResolvedValue(null);

      await service.enviarNotificacion(
        response,
        'user-missing',
        'file.pdf',
        'template',
      );

      expect(messageBusMock.send).toHaveBeenCalledWith(
        'mail.envio.individual',
        expect.objectContaining({ email: 'estudiante', name: 'Estudiante' }),
      );
    });
  });

  // ────────────────────────────
  // listenForResponses
  // ────────────────────────────

  describe('listenForResponses', () => {
    it('debería resolver la promesa pendiente cuando llega un mensaje con correlationId conocido', async () => {
      const body = { valid: true } as any;
      const promise = (service as any).waitForResponse(
        'corr-1',
      ) as Promise<RespuestaIADto>;

      await subscribeHandler(body, 'corr-1');

      await expect(promise).resolves.toBe(body);
    });

    it('debería ignorar mensajes sin correlationId', async () => {
      await expect(
        subscribeHandler({ valid: true } as any, undefined),
      ).resolves.toBeUndefined();
    });

    it('debería registrar warning si no hay solicitud pendiente', async () => {
      await expect(
        subscribeHandler({ valid: true } as any, 'no-existe'),
      ).resolves.toBeUndefined();
    });

    it('debería manejar errores en processError', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      await expect(
        subscribeErrorHandler(new Error('boom')),
      ).resolves.toBeUndefined();
      consoleErrorSpy.mockRestore();
    });
  });

  // ────────────────────────────
  // helpers de storage y cola
  // ────────────────────────────

  describe('helpers de storage y cola', () => {
    it('uploadAndAnalyze debería subir el blob, enviar mensaje y esperar respuesta', async () => {
      const buffer = Buffer.from('fake pdf');
      storageMock.upload.mockResolvedValue('https://blob/file.pdf');
      const waitForResponseSpy = jest.fn().mockResolvedValue({ valid: true });
      (service as any).waitForResponse = waitForResponseSpy;

      const result = await (service as any).uploadAndAnalyze(
        buffer,
        'corr-1',
        'file.pdf',
      );

      expect(storageMock.upload).toHaveBeenCalledWith(
        buffer,
        'file.pdf',
        'application/pdf',
      );
      expect(messageBusMock.send).toHaveBeenCalledWith(
        'material.process',
        { fileUrl: 'https://blob/file.pdf', filename: 'file.pdf' },
        expect.objectContaining({
          correlationId: 'corr-1',
          subject: 'analysis',
        }),
      );
      expect(waitForResponseSpy).toHaveBeenCalledWith('corr-1');
      expect(result).toEqual({
        blobName: 'file.pdf',
        fileUrl: 'https://blob/file.pdf',
        response: { valid: true },
      });
    });

    it('uploadAndAnalyze debería lanzar BadRequestException si falla la subida', async () => {
      storageMock.upload.mockRejectedValue(new Error('Upload failed'));
      await expect(
        (service as any).uploadAndAnalyze(
          Buffer.from(''),
          'corr-1',
          'file.pdf',
        ),
      ).rejects.toThrow('Error almacenando PDF');
    });

    it('uploadAndAnalyze debería lanzar BadRequestException si falla el envío del mensaje a IA', async () => {
      storageMock.upload.mockResolvedValue('https://blob/file.pdf');
      storageMock.delete.mockResolvedValue(true);
      messageBusMock.send.mockRejectedValue(new Error('Queue error'));

      await expect(
        (service as any).uploadAndAnalyze(
          Buffer.from(''),
          'corr-1',
          'file.pdf',
        ),
      ).rejects.toThrow('Error enviando a IA');
      expect(storageMock.delete).toHaveBeenCalledWith('https://blob/file.pdf');
    });

    it('sendAnalysisMessage debería construir el mensaje y enviarlo al bus', async () => {
      await (service as any).sendAnalysisMessage(
        'https://blob/file.pdf',
        'file.pdf',
        'corr-1',
        'analysis',
      );

      expect(messageBusMock.send).toHaveBeenCalledWith(
        'material.process',
        { fileUrl: 'https://blob/file.pdf', filename: 'file.pdf' },
        {
          correlationId: 'corr-1',
          subject: 'analysis',
          contentType: 'application/json',
        },
      );
    });

    it('waitForResponse debería registrar la promesa en pendingRequests', async () => {
      const promise = (service as any).waitForResponse(
        'corr-X',
      ) as Promise<RespuestaIADto>;
      const pending = (service as any).pendingRequests as Map<
        string,
        (msg: RespuestaIADto) => void
      >;

      expect(pending.has('corr-X')).toBe(true);

      const fakeResponse = { valid: true } as any;
      const resolver = pending.get('corr-X')!;
      resolver(fakeResponse);

      await expect(promise).resolves.toBe(fakeResponse);
    });

    it('deleteBlobSafe debería loggear cuando se elimina el blob', async () => {
      storageMock.delete.mockResolvedValue(true);
      await (service as any).deleteBlobSafe('https://blob/test.pdf', 'corr-1');
      expect(storageMock.delete).toHaveBeenCalledWith('https://blob/test.pdf');
    });

    it('deleteBlobSafe debería manejar el caso en que no se pueda eliminar', async () => {
      storageMock.delete.mockResolvedValue(false);
      await (service as any).deleteBlobSafe('https://blob/test.pdf', 'corr-2');
      expect(storageMock.delete).toHaveBeenCalled();
    });

    it('deleteBlobSafe debería atrapar errores del cliente', async () => {
      storageMock.delete.mockRejectedValue(new Error('storage error'));
      await (service as any).deleteBlobSafe('https://blob/test.pdf', 'corr-3');
      expect(storageMock.delete).toHaveBeenCalled();
    });
  });

  // ────────────────────────────
  // validateMaterial
  // ────────────────────────────

  describe('validateMaterial', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake');

    it('debería orquestar subida, envío a IA y manejo de respuesta (caso feliz)', async () => {
      (service as any).checkDuplicateHash = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).uploadAndAnalyze = jest.fn().mockResolvedValue({
        blobName: 'test-uuid-archivo.pdf',
        fileUrl: 'https://blob/fake.pdf',
        response: { valid: true, tags: [], tema: 'T', materia: 'M' } as any,
      });
      (service as any).handleResponse = jest
        .fn()
        .mockResolvedValue({ id: 'test-uuid', title: 'archivo.pdf' });

      const result = await service.validateMaterial(
        pdfBuffer,
        { title: 'archivo.pdf', userId: 'user-1', description: 'desc' } as any,
        'archivo.pdf',
      );

      expect((service as any).checkDuplicateHash).toHaveBeenCalled();
      expect((service as any).uploadAndAnalyze).toHaveBeenCalledWith(
        pdfBuffer,
        'test-uuid',
        'archivo.pdf',
      );
      expect((service as any).handleResponse).toHaveBeenCalled();
      expect(result).toEqual({ id: 'test-uuid', title: 'archivo.pdf' });
    });

    it('debería lanzar error si hay hash duplicado', async () => {
      (service as any).checkDuplicateHash = jest
        .fn()
        .mockRejectedValue(
          new Error('Material already exists with same content'),
        );
      await expect(
        service.validateMaterial(
          pdfBuffer,
          { title: 'archivo.pdf', userId: 'user-1' } as any,
          'archivo.pdf',
        ),
      ).rejects.toThrow('Material already exists with same content');
    });

    it('debería lanzar error si falla uploadAndAnalyze', async () => {
      (service as any).checkDuplicateHash = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).uploadAndAnalyze = jest
        .fn()
        .mockRejectedValue(new Error('Error almacenando PDF'));
      await expect(
        service.validateMaterial(
          pdfBuffer,
          { title: 'archivo.pdf', userId: 'user-1' } as any,
          'archivo.pdf',
        ),
      ).rejects.toThrow('Error almacenando PDF');
    });
  });

  // ────────────────────────────
  // handleResponse
  // ────────────────────────────

  describe('handleResponse', () => {
    const baseCtx = {
      correlationId: 'corr-1',
      filename: 'archivo.pdf',
      blobName: 'corr-1-archivo.pdf',
      materialData: { userId: 'user-1', description: 'desc' } as any,
      fileUrl: 'https://blob/archivo.pdf',
      hash: 'abc123',
      extension: 'pdf',
    };

    it('debería guardar material y enviar notificación cuando la respuesta es válida', async () => {
      const response = {
        valid: true,
        tags: ['tag1', 'tag2'],
        tema: 'Tema X',
        materia: 'Materia Y',
      } as any;
      (service as any).guardarMaterial = jest.fn().mockResolvedValue(undefined);
      (service as any).sendAnalysisMessage = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).enviarNotificacion = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).deleteBlobSafe = jest.fn();

      await (service as any).handleResponse(response, undefined, baseCtx);

      expect((service as any).guardarMaterial).toHaveBeenCalled();
      expect((service as any).enviarNotificacion).toHaveBeenCalledWith(
        response,
        baseCtx.materialData.userId,
        baseCtx.filename,
        'nuevoMaterialSubido',
      );
    });

    it('debería eliminar el blob cuando la respuesta es NO válida', async () => {
      const response = { valid: false, detalles: 'Invalid PDF' } as any;
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        (service as any).handleResponse(response, undefined, baseCtx),
      ).rejects.toThrow('PDF falló la validación automatizada: Invalid PDF');
      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith(
        baseCtx.fileUrl,
        baseCtx.correlationId,
      );
    });

    it('debería lanzar error genérico si la respuesta no válida no tiene detalles', async () => {
      const response = { valid: false } as any;
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        (service as any).handleResponse(response, undefined, baseCtx),
      ).rejects.toThrow('PDF falló la validación automatizada');
    });

    it('debería lanzar error y limpiar blob si falla guardarMaterial', async () => {
      const response = {
        valid: true,
        tags: [],
        tema: 'Tema',
        materia: 'Materia',
      } as any;
      (service as any).guardarMaterial = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        (service as any).handleResponse(response, undefined, baseCtx),
      ).rejects.toThrow('Error guardando material válido');
      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith(
        baseCtx.fileUrl,
        baseCtx.correlationId,
      );
    });
  });

  // ────────────────────────────
  // checkDuplicateHash
  // ────────────────────────────

  describe('checkDuplicateHash', () => {
    it('debería pasar si no existe material con el mismo hash', async () => {
      prismaMock.materiales.findFirst.mockResolvedValue(null);
      await expect(
        (service as any).checkDuplicateHash('hash123'),
      ).resolves.toBeUndefined();
    });

    it('debería lanzar ConflictException si existe material con el mismo hash', async () => {
      prismaMock.materiales.findFirst.mockResolvedValue({
        id: 'existing-mat',
        hash: 'hash123',
      });
      await expect(
        (service as any).checkDuplicateHash('hash123'),
      ).rejects.toThrow('Material already exists with same content');
    });

    it('debería excluir el material actual cuando se proporciona excludeMaterialId', async () => {
      prismaMock.materiales.findFirst.mockResolvedValue(null);
      await expect(
        (service as any).checkDuplicateHash('hash123', 'current-mat'),
      ).resolves.toBeUndefined();
      expect(prismaMock.materiales.findFirst).toHaveBeenCalledWith({
        where: { hash: 'hash123', NOT: { id: 'current-mat' } },
      });
    });
  });

  // ────────────────────────────
  // validateUserExists
  // ────────────────────────────

  describe('validateUserExists', () => {
    it('debería pasar si el usuario existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({
        id: 'user-1',
        nombre: 'Test',
      });
      await expect(
        (service as any).validateUserExists('user-1'),
      ).resolves.toBeUndefined();
    });

    it('debería lanzar BadRequestException si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        (service as any).validateUserExists('user-missing'),
      ).rejects.toThrow('El userId user-missing no existe en la base de datos');
    });
  });

  // ────────────────────────────
  // getUserAverageRating
  // ────────────────────────────

  describe('getUserAverageRating', () => {
    it('debería devolver la calificación promedio del usuario', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          Calificaciones: [{ calificacion: 4 }, { calificacion: 5 }],
        },
        { id: 'mat-2', Calificaciones: [{ calificacion: 3 }] },
      ]);

      const result = await service.getUserAverageRating('user-1');
      expect(result.calificacionPromedio).toBe(4);
      expect(result.totalCalificaciones).toBe(3);
    });

    it('debería devolver null calificacionPromedio si no hay calificaciones', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        { id: 'mat-1', Calificaciones: [] },
      ]);
      const result = await service.getUserAverageRating('user-1');
      expect(result.calificacionPromedio).toBeNull();
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getUserAverageRating('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getUserMaterialsStats
  // ────────────────────────────

  describe('getUserMaterialsStats', () => {
    it('debería devolver estadísticas completas del usuario', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          vistos: 10,
          descargas: 5,
          Calificaciones: [{ calificacion: 4 }, { calificacion: 5 }],
        },
        {
          id: 'mat-2',
          vistos: 20,
          descargas: 8,
          Calificaciones: [{ calificacion: 3 }],
        },
      ]);

      const result = await service.getUserMaterialsStats('user-1');
      expect(result.totalMateriales).toBe(2);
      expect(result.totalDescargas).toBe(13);
      expect(result.totalVistas).toBe(30);
      expect(result.calificacionPromedio).toBe(4);
    });

    it('debería devolver 0 para calificacionPromedio si no hay calificaciones', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        { id: 'mat-1', vistos: 0, descargas: 0, Calificaciones: [] },
      ]);
      const result = await service.getUserMaterialsStats('user-1');
      expect(result.calificacionPromedio).toBe(0);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getUserMaterialsStats('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getTopDownloadedMaterials
  // ────────────────────────────

  describe('getTopDownloadedMaterials', () => {
    it('debería devolver el top 3 de materiales más descargados', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Top 1',
          descargas: 100,
          vistos: 50,
          Calificaciones: [{ calificacion: 5 }],
        },
        {
          id: 'mat-2',
          nombre: 'Top 2',
          descargas: 50,
          vistos: 30,
          Calificaciones: [],
        },
      ]);

      const result = await service.getTopDownloadedMaterials('user-1');
      expect(result.topDownloaded).toHaveLength(2);
      expect(result.topDownloaded[0].descargas).toBe(100);
      expect(result.topDownloaded[0].calificacionPromedio).toBe(5);
      expect(result.topDownloaded[1].calificacionPromedio).toBe(0);
    });

    it('debería devolver array vacío si no tiene materiales', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getTopDownloadedMaterials('user-1');
      expect(result.topDownloaded).toHaveLength(0);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getTopDownloadedMaterials('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getTopViewedMaterials
  // ────────────────────────────

  describe('getTopViewedMaterials', () => {
    it('debería devolver el top 3 de materiales más vistos', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Más visto',
          descargas: 10,
          vistos: 200,
          Calificaciones: [{ calificacion: 4 }, { calificacion: 4 }],
        },
      ]);

      const result = await service.getTopViewedMaterials('user-1');
      expect(result.topViewed[0].vistos).toBe(200);
      expect(result.topViewed[0].calificacionPromedio).toBe(4);
    });

    it('debería devolver array vacío si no tiene materiales', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getTopViewedMaterials('user-1');
      expect(result.topViewed).toHaveLength(0);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getTopViewedMaterials('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getUserTopMaterials
  // ────────────────────────────

  describe('getUserTopMaterials', () => {
    it('debería devolver todos los materiales ordenados por popularidad con tags', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Popular',
          descargas: 50,
          vistos: 100,
          Calificaciones: [{ calificacion: 5 }],
          MaterialTags: [
            { Tags: { tag: 'calculo' } },
            { Tags: { tag: 'algebra' } },
          ],
        },
      ]);

      const result = await service.getUserTopMaterials('user-1');
      expect(result[0].tags).toEqual(['calculo', 'algebra']);
      expect(result[0].calificacionPromedio).toBe(5);
    });

    it('debería manejar materiales sin calificaciones ni tags', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Vacío',
          descargas: 0,
          vistos: 0,
          Calificaciones: [],
          MaterialTags: [],
        },
      ]);

      const result = await service.getUserTopMaterials('user-1');
      expect(result[0].calificacionPromedio).toBe(0);
      expect(result[0].tags).toEqual([]);
    });

    it('debería manejar MaterialTags undefined', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Sin tags',
          descargas: 0,
          vistos: 0,
          Calificaciones: undefined,
          MaterialTags: undefined,
        },
      ]);

      const result = await service.getUserTopMaterials('user-1');
      expect(result[0].calificacionPromedio).toBe(0);
      expect(result[0].tags).toEqual([]);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getUserTopMaterials('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getUserTagsPercentage
  // ────────────────────────────

  describe('getUserTagsPercentage', () => {
    it('debería devolver porcentajes de tags correctos', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          MaterialTags: [
            { Tags: { tag: 'calculo' } },
            { Tags: { tag: 'algebra' } },
          ],
        },
        { MaterialTags: [{ Tags: { tag: 'calculo' } }] },
      ]);

      const result = await service.getUserTagsPercentage('user-1');
      expect(result.tags[0].tag).toBe('calculo');
      expect(result.tags[0].porcentaje).toBeCloseTo(66.67, 1);
      expect(result.tags[1].tag).toBe('algebra');
    });

    it('debería devolver array vacío si no hay tags', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.materiales.findMany.mockResolvedValue([{ MaterialTags: [] }]);
      const result = await service.getUserTagsPercentage('user-1');
      expect(result.tags).toHaveLength(0);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.getUserTagsPercentage('user-missing'),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getGlobalTagsPercentage
  // ────────────────────────────

  describe('getGlobalTagsPercentage', () => {
    it('debería devolver porcentajes globales de tags', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          MaterialTags: [
            { Tags: { tag: 'calculo' } },
            { Tags: { tag: 'algebra' } },
          ],
        },
        { MaterialTags: [{ Tags: { tag: 'calculo' } }] },
      ]);

      const result = await service.getGlobalTagsPercentage();
      expect(result.totalTags).toBe(2);
      expect(result.totalAsociaciones).toBe(3);
      expect(result.tags[0].tag).toBe('calculo');
    });

    it('debería manejar el caso sin materiales', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getGlobalTagsPercentage();
      expect(result.totalTags).toBe(0);
    });
  });

  // ────────────────────────────
  // getAllMaterials
  // ────────────────────────────

  describe('getAllMaterials', () => {
    it('debería devolver todos los materiales con paginación', async () => {
      const now = new Date();
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Material 1',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 10,
          descargas: 5,
          createdAt: now,
          updatedAt: now,
          extension: 'pdf',
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 1' },
        },
      ]);

      const result = await service.getAllMaterials(0, 10);
      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
      expect(result).toHaveLength(1);
    });

    it('debería manejar sin parámetros de paginación', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      const result = await service.getAllMaterials();
      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: undefined, take: undefined }),
      );
      expect(result).toHaveLength(0);
    });
  });

  // ────────────────────────────
  // searchMaterialsByName
  // ────────────────────────────

  describe('searchMaterialsByName', () => {
    it('debería buscar materiales por nombre', async () => {
      const now = new Date();
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Calculo',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: now,
          updatedAt: now,
          extension: 'pdf',
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 1' },
        },
      ]);

      const result = await service.searchMaterialsByName('Calculo');
      expect(result).toHaveLength(1);
    });

    it('debería lanzar BadRequestException con término vacío', async () => {
      await expect(service.searchMaterialsByName('')).rejects.toThrow(
        'El término de búsqueda debe tener al menos 1 carácter',
      );
    });

    it('debería lanzar BadRequestException con término solo espacios', async () => {
      await expect(service.searchMaterialsByName('   ')).rejects.toThrow(
        'El término de búsqueda debe tener al menos 1 carácter',
      );
    });

    it('debería lanzar BadRequestException con null', async () => {
      await expect(
        service.searchMaterialsByName(null as any),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────
  // getMaterialsByDate
  // ────────────────────────────

  describe('getMaterialsByDate', () => {
    it('debería devolver materiales ordenados por fecha descendente', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      await service.getMaterialsByDate('desc', 0, 5);
      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 5 }),
      );
    });

    it('debería funcionar sin parámetros de paginación', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([]);
      await service.getMaterialsByDate();
      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: undefined, take: undefined }),
      );
    });
  });

  // ────────────────────────────
  // toMaterialDto
  // ────────────────────────────

  describe('toMaterialDto', () => {
    it('debería mapear correctamente un material con todos los campos', () => {
      const now = new Date();
      const material = {
        id: 'mat-1',
        nombre: 'Test Material',
        userId: 'user-1',
        url: 'https://blob/test.pdf',
        extension: 'pdf',
        descripcion: 'Descripción',
        vistos: 100,
        descargas: 50,
        createdAt: now,
        updatedAt: now,
        MaterialTags: [
          { Tags: { tag: 'calculo' } },
          { Tags: { tag: 'algebra' } },
        ],
        Calificaciones: [
          { calificacion: 4, comentario: 'bueno' },
          { calificacion: 5, comentario: '' },
        ],
        usuarios: { nombre: 'Test User' },
      };

      const result = (service as any).toMaterialDto(material);
      expect(result.tags).toEqual(['calculo', 'algebra']);
      expect(result.calificacionPromedio).toBe(4.5);
      expect(result.totalComentarios).toBe(1);
    });

    it('debería manejar campos opcionales nulos o undefined', () => {
      const material = {
        id: 'mat-2',
        nombre: 'Test',
        userId: 'user-1',
        url: 'https://blob/test.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        MaterialTags: [],
        Calificaciones: [],
        usuarios: undefined,
      };

      const result = (service as any).toMaterialDto(material);
      expect(result.userName).toBeUndefined();
      expect(result.calificacionPromedio).toBeUndefined();
      expect(result.totalComentarios).toBe(0);
    });

    it('debería manejar Calificaciones undefined', () => {
      const material = {
        id: 'mat-3',
        nombre: 'Test',
        userId: 'user-1',
        url: 'https://blob/test.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        MaterialTags: undefined,
        Calificaciones: undefined,
        usuarios: null,
      };

      const result = (service as any).toMaterialDto(material);
      expect(result.tags).toEqual([]);
      expect(result.calificacionPromedio).toBeUndefined();
    });
  });

  // ────────────────────────────
  // rateMaterial
  // ────────────────────────────

  describe('rateMaterial', () => {
    it('debería registrar una calificación y devolver el promedio', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.calificaciones.create.mockResolvedValue({});
      prismaMock.calificaciones.aggregate.mockResolvedValue({
        _avg: { calificacion: 4.5 },
        _count: { _all: 3 },
      });

      const result = await service.rateMaterial(
        'mat-1',
        'user-1',
        5,
        'Excelente',
      );
      expect(result.calificacionPromedio).toBe(4.5);
      expect(result.totalCalificaciones).toBe(3);
    });

    it('debería lanzar BadRequestException si rating < 1', async () => {
      await expect(service.rateMaterial('mat-1', 'user-1', 0)).rejects.toThrow(
        'La calificación debe estar entre 1 y 5',
      );
    });

    it('debería lanzar BadRequestException si rating > 5', async () => {
      await expect(service.rateMaterial('mat-1', 'user-1', 6)).rejects.toThrow(
        'La calificación debe estar entre 1 y 5',
      );
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(
        service.rateMaterial('mat-missing', 'user-1', 4),
      ).rejects.toThrow('Material no encontrado');
    });

    it('debería lanzar NotFoundException si el usuario no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(
        service.rateMaterial('mat-1', 'user-missing', 4),
      ).rejects.toThrow('Usuario no encontrado');
    });

    it('debería manejar comentario null', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.calificaciones.create.mockResolvedValue({});
      prismaMock.calificaciones.aggregate.mockResolvedValue({
        _avg: { calificacion: 3 },
        _count: { _all: 1 },
      });

      const result = await service.rateMaterial('mat-1', 'user-1', 3, null);
      expect(result.comentario).toBeNull();
    });

    it('debería manejar promedio nulo del aggregate', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.calificaciones.create.mockResolvedValue({});
      prismaMock.calificaciones.aggregate.mockResolvedValue({
        _avg: { calificacion: null },
        _count: { _all: 0 },
      });

      const result = await service.rateMaterial('mat-1', 'user-1', 4);
      expect(result.calificacionPromedio).toBe(0);
    });
  });

  // ────────────────────────────
  // getMaterialRatings
  // ────────────────────────────

  describe('getMaterialRatings', () => {
    it('debería devolver las calificaciones y el promedio', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        descargas: 10,
        vistos: 20,
      });
      prismaMock.calificaciones.findMany.mockResolvedValue([
        { calificacion: 4 },
        { calificacion: 5 },
      ]);

      const result = await service.getMaterialRatings('mat-1');
      expect(result.calificacionPromedio).toBe(4.5);
      expect(result.totalCalificaciones).toBe(2);
    });

    it('debería devolver 0 para promedio si no hay calificaciones', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        descargas: 0,
        vistos: 0,
      });
      prismaMock.calificaciones.findMany.mockResolvedValue([]);
      const result = await service.getMaterialRatings('mat-1');
      expect(result.calificacionPromedio).toBe(0);
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.getMaterialRatings('mat-missing')).rejects.toThrow(
        'Material no encontrado',
      );
    });
  });

  // ────────────────────────────
  // getMaterialRatingsList
  // ────────────────────────────

  describe('getMaterialRatingsList', () => {
    it('debería devolver la lista de calificaciones con nombre de usuario', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.calificaciones.findMany.mockResolvedValue([
        {
          id: 'cal-1',
          calificacion: 5,
          comentario: 'Excelente',
          createdAt: new Date(),
          usuarios: { nombre: 'User 1' },
        },
        {
          id: 'cal-2',
          calificacion: 3,
          comentario: null,
          createdAt: new Date(),
          usuarios: null,
        },
      ]);

      const result = await service.getMaterialRatingsList('mat-1');
      expect(result[0].usuarioNombre).toBe('User 1');
      expect(result[1].usuarioNombre).toBe('Usuario Anónimo');
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(
        service.getMaterialRatingsList('mat-missing'),
      ).rejects.toThrow('Material no encontrado');
    });

    it('debería devolver array vacío si no hay calificaciones', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.calificaciones.findMany.mockResolvedValue([]);
      const result = await service.getMaterialRatingsList('mat-1');
      expect(result).toHaveLength(0);
    });
  });

  // ────────────────────────────
  // incrementViews
  // ────────────────────────────

  describe('incrementViews', () => {
    it('debería incrementar el contador de vistas', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.materiales.update.mockResolvedValue({});
      await service.incrementViews('mat-1');
      expect(prismaMock.materiales.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { vistos: { increment: 1 } },
      });
    });

    it('debería lanzar BadRequestException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.incrementViews('mat-missing')).rejects.toThrow(
        'Material con ID mat-missing no encontrado',
      );
    });
  });

  // ────────────────────────────
  // incrementDownloads
  // ────────────────────────────

  describe('incrementDownloads', () => {
    it('debería incrementar el contador de descargas', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.materiales.update.mockResolvedValue({});
      await (service as any).incrementDownloads('mat-1');
      expect(prismaMock.materiales.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { descargas: { increment: 1 } },
      });
    });

    it('debería lanzar BadRequestException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(
        (service as any).incrementDownloads('mat-missing'),
      ).rejects.toThrow('Material con ID mat-missing no encontrado');
    });
  });

  // ────────────────────────────
  // searchMaterials
  // ────────────────────────────

  describe('searchMaterials', () => {
    it('debería buscar materiales sin filtros', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Material 1',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          extension: 'pdf',
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'User 1' },
        },
      ]);
      prismaMock.materiales.count.mockResolvedValue(1);
      const result = await service.searchMaterials(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        10,
      );
      expect(result.materials).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('debería filtrar por materia (tags) post-fetch', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'M1',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          extension: 'pdf',
          MaterialTags: [{ Tags: { tag: 'calculo' } }],
          Calificaciones: [],
          usuarios: { nombre: 'U1' },
        },
        {
          id: 'mat-2',
          nombre: 'M2',
          userId: 'u2',
          url: 'https://blob/m2.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          extension: 'pdf',
          MaterialTags: [{ Tags: { tag: 'algebra' } }],
          Calificaciones: [],
          usuarios: { nombre: 'U2' },
        },
      ]);
      prismaMock.materiales.count.mockResolvedValue(2);
      const result = await service.searchMaterials(
        undefined,
        'calculo',
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        10,
      );
      expect(result.materials).toHaveLength(1);
      expect(result.materials[0].id).toBe('mat-1');
    });

    it('debería filtrar por calificación mínima post-fetch', async () => {
      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'M1',
          userId: 'u1',
          url: 'h',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          extension: 'pdf',
          MaterialTags: [],
          Calificaciones: [{ calificacion: 5 }, { calificacion: 4 }],
          usuarios: { nombre: 'U1' },
        },
        {
          id: 'mat-2',
          nombre: 'M2',
          userId: 'u2',
          url: 'h',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          extension: 'pdf',
          MaterialTags: [],
          Calificaciones: [{ calificacion: 2 }],
          usuarios: { nombre: 'U2' },
        },
      ]);
      prismaMock.materiales.count.mockResolvedValue(2);
      const result = await service.searchMaterials(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        4,
        1,
        10,
      );
      expect(result.materials).toHaveLength(1);
      expect(result.materials[0].id).toBe('mat-1');
    });
  });

  // ────────────────────────────
  // getMaterialStats
  // ────────────────────────────

  describe('getMaterialStats', () => {
    it('debería devolver las estadísticas de un material', async () => {
      const now = new Date();
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Material Stats',
        userId: 'u1',
        url: 'https://blob/stats.pdf',
        descripcion: 'Desc',
        vistos: 100,
        descargas: 50,
        createdAt: now,
        updatedAt: now,
        extension: 'pdf',
        MaterialTags: [{ Tags: { tag: 'calculo' } }],
        Calificaciones: [{ calificacion: 5, comentario: 'bueno' }],
        usuarios: { nombre: 'User 1' },
      });

      const result = await service.getMaterialStats('mat-1');
      expect(result.vistos).toBe(100);
    });
  });

  // ────────────────────────────
  // getMaterialDetail
  // ────────────────────────────

  describe('getMaterialDetail', () => {
    it('debería devolver el detalle completo del material', async () => {
      const now = new Date();
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Material Detail',
        userId: 'u1',
        url: 'https://blob/detail.pdf',
        descripcion: 'Detalle completo',
        vistos: 50,
        descargas: 25,
        createdAt: now,
        updatedAt: now,
        MaterialTags: [{ Tags: { tag: 'calculo' } }],
        Calificaciones: [{ calificacion: 4, comentario: 'bueno' }],
        usuarios: { nombre: 'User 1' },
      });
      prismaMock.materiales.update.mockResolvedValue({});

      const result = await service.getMaterialDetail('mat-1');
      expect(result.metadata.id).toBe('mat-1');
      expect(result.metadata.tags).toEqual(['calculo']);
      expect(result['calificación']).toBe(4);
    });

    it('debería devolver calificación null si no hay calificaciones', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Material',
        userId: 'u1',
        url: 'https://blob/m.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        MaterialTags: [],
        Calificaciones: [],
        usuarios: null,
      });
      prismaMock.materiales.update.mockResolvedValue({});

      const result = await service.getMaterialDetail('mat-1');
      expect(result['calificación']).toBeNull();
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.getMaterialDetail('mat-missing')).rejects.toThrow(
        'Material con id mat-missing no encontrado',
      );
    });
  });

  // ────────────────────────────
  // updateMaterialVersion
  // ────────────────────────────

  describe('updateMaterialVersion', () => {
    it('debería actualizar solo metadata sin archivo', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Old Title',
        url: 'https://blob/old.pdf',
        hash: 'old-hash',
        extension: 'pdf',
        descripcion: 'Old desc',
        createdAt: new Date(),
      });
      prismaMock.materiales.update.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/old.pdf',
        descripcion: 'New desc',
      });

      const result = await service.updateMaterialVersion(
        'mat-1',
        undefined,
        'New Title',
        'New desc',
      );
      expect(result.id).toBe('mat-1');
      expect(result.title).toBe('New Title');
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(
        service.updateMaterialVersion('mat-missing', undefined, 'Title'),
      ).rejects.toThrow('Material no encontrado');
    });

    it('debería actualizar con nuevo archivo válido', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Old',
        url: 'https://blob/old.pdf',
        hash: 'old-hash',
        extension: 'pdf',
        descripcion: 'Old desc',
        createdAt: new Date(),
      });
      (service as any).checkDuplicateHash = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).uploadAndAnalyze = jest.fn().mockResolvedValue({
        blobName: 'new-file.pdf',
        fileUrl: 'https://blob/new.pdf',
        response: { valid: true },
      });
      (service as any).sendAnalysisMessage = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).deleteOldBlob = jest.fn().mockResolvedValue(undefined);
      prismaMock.materiales.update.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/new.pdf',
        descripcion: 'Updated',
      });

      const result = await service.updateMaterialVersion(
        'mat-1',
        Buffer.from('%PDF-1.4'),
        'New Title',
        'Updated',
        'new-file.pdf',
      );
      expect(result.id).toBe('mat-1');
      expect((service as any).checkDuplicateHash).toHaveBeenCalled();
    });

    it('debería lanzar UnprocessableEntityException si IA rechaza el archivo', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'Old',
        url: 'https://blob/old.pdf',
        hash: 'old-hash',
        extension: 'pdf',
        descripcion: 'Old desc',
        createdAt: new Date(),
      });
      (service as any).checkDuplicateHash = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).uploadAndAnalyze = jest.fn().mockResolvedValue({
        blobName: 'bad.pdf',
        fileUrl: 'https://blob/bad.pdf',
        response: { valid: false, detalles: 'Invalid content' },
      });
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.updateMaterialVersion(
          'mat-1',
          Buffer.from('%PDF'),
          'Title',
          'desc',
          'bad.pdf',
        ),
      ).rejects.toThrow(
        'PDF falló la validación automatizada: Invalid content',
      );
    });
  });

  // ────────────────────────────
  // deleteOldBlob
  // ────────────────────────────

  describe('deleteOldBlob', () => {
    it('debería eliminar el blob anterior si la URL existe', async () => {
      storageMock.delete.mockResolvedValue(true);
      await (service as any).deleteOldBlob(
        'https://blob/old-file.pdf',
        'mat-1',
      );
      expect(storageMock.delete).toHaveBeenCalledWith(
        'https://blob/old-file.pdf',
      );
    });

    it('no debería hacer nada si la URL es null', async () => {
      await (service as any).deleteOldBlob(null, 'mat-1');
      expect(storageMock.delete).not.toHaveBeenCalled();
    });

    it('debería manejar errores silenciosamente', async () => {
      storageMock.delete.mockRejectedValue(new Error('storage error'));
      await expect(
        (service as any).deleteOldBlob('https://blob/file.pdf', 'mat-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────
  // getMaterialsCount
  // ────────────────────────────

  describe('getMaterialsCount', () => {
    it('debería devolver la cantidad total de materiales', async () => {
      prismaMock.materiales.count.mockResolvedValue(42);
      const result = await service.getMaterialsCount();
      expect(result.Count).toBe(42);
    });

    it('debería devolver 0 si no hay materiales', async () => {
      prismaMock.materiales.count.mockResolvedValue(0);
      const result = await service.getMaterialsCount();
      expect(result.Count).toBe(0);
    });
  });

  // ────────────────────────────
  // deleteMaterial
  // ────────────────────────────

  describe('deleteMaterial', () => {
    it('debería eliminar un material y su blob', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/file.pdf',
      });
      prismaMock.materiales.delete.mockResolvedValue({});
      const deleteOldBlobSpy = jest.fn().mockResolvedValue(undefined);
      (service as any).deleteOldBlob = deleteOldBlobSpy;

      const result = await service.deleteMaterial('mat-1');
      expect(result.message).toBe('Material mat-1 eliminado correctamente');
      expect(deleteOldBlobSpy).toHaveBeenCalledWith(
        'https://blob/file.pdf',
        'mat-1',
      );
    });

    it('debería lanzar NotFoundException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.deleteMaterial('mat-missing')).rejects.toThrow(
        'El material con ID mat-missing no existe',
      );
    });

    it('debería eliminar material sin URL de blob', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        url: null,
      });
      prismaMock.materiales.delete.mockResolvedValue({});
      const deleteOldBlobSpy = jest.fn();
      (service as any).deleteOldBlob = deleteOldBlobSpy;

      const result = await service.deleteMaterial('mat-1');
      expect(result.message).toBe('Material mat-1 eliminado correctamente');
      expect(deleteOldBlobSpy).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────
  // downloadMaterial
  // ────────────────────────────

  describe('downloadMaterial', () => {
    it('debería devolver stream, contentType y filename para un material válido', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/test-file.pdf',
      });
      storageMock.exists.mockResolvedValue(true);
      storageMock.download.mockResolvedValue({
        stream: 'fake-stream' as any,
        contentType: 'application/pdf',
        filename: 'test-file.pdf',
      });
      prismaMock.materiales.findUnique
        .mockResolvedValueOnce({
          id: 'mat-1',
          url: 'https://blob/test-file.pdf',
        })
        .mockResolvedValueOnce({ id: 'mat-1' });
      prismaMock.materiales.update.mockResolvedValue({});

      const result = await service.downloadMaterial('mat-1');
      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toBe('test-file.pdf');
    });

    it('debería lanzar BadRequestException si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.downloadMaterial('mat-missing')).rejects.toThrow(
        'Material con id mat-missing no existe',
      );
    });

    it('debería lanzar NotFoundException si el blob no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/missing.pdf',
      });
      storageMock.exists.mockResolvedValue(false);
      await expect(service.downloadMaterial('mat-1')).rejects.toThrow(
        'Archivo no encontrado en almacenamiento',
      );
    });

    it('debería manejar errores internos lanzando BadRequestException', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        url: 'https://blob/file.pdf',
      });
      storageMock.exists.mockRejectedValue(
        new Error('storage connection error'),
      );
      await expect(service.downloadMaterial('mat-1')).rejects.toThrow(
        'Error obteniendo archivo de almacenamiento',
      );
    });
  });
});
