import {
  Injectable,
  BadRequestException,
  Logger,
  ConflictException,
  UnprocessableEntityException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../common/ports/storage.port';
import {
  MESSAGE_BUS_PORT,
  MessageBusPort,
  SendOptions,
} from '../common/ports/message-bus.port';
import { RespuestaIADto } from './dto/respuestIA.dto';
import { NotificationDto } from 'src/material/dto/notificacion.dto';
import { Material } from './entities/material.entity';
import { MaterialDto } from './dto/material.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { CreateMaterialDto } from './dto/createMaterial.dto';
import { CreateMaterialResponseDto } from './dto/create-material-response.dto';
import { RateMaterialResponseDto } from './dto/rate-material-response.dto';
import {
  GetMaterialRatingsResponseDto,
  MaterialRatingDto,
} from './dto/get-material-ratings.dto';
import { UserMaterialsStatsDto } from './dto/user-materials-stats.dto';
import {
  TopDownloadedMaterialsDto,
  TopViewedMaterialsDto,
} from './dto/top-materials.dto';
import { UserTagsPercentageDto } from './dto/user-tags-percentage.dto';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  private readonly pendingRequests: Map<string, (msg: RespuestaIADto) => void> =
    new Map();

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(MESSAGE_BUS_PORT) private readonly messageBus: MessageBusPort,
    private readonly prisma: PrismaService,
  ) {
    this.listenForResponses();
  }

  private listenForResponses(): void {
    this.messageBus.subscribe<RespuestaIADto>(
      'material.responses',
      async (body, correlationId) => {
        if (!correlationId) {
          this.logger.warn('Mensaje recibido SIN correlationId, se ignora');
          return;
        }
        if (this.pendingRequests.has(correlationId)) {
          const resolver = this.pendingRequests.get(correlationId);
          resolver?.(body);
          this.pendingRequests.delete(correlationId);
        } else {
          this.logger.warn(
            `No hay solicitud pendiente para correlationId: ${correlationId}`,
          );
        }
      },
      async (err) => {
        console.error('Error receiving response:', err);
      },
    );
  }

  async validateMaterial(
    pdfBuffer: Buffer,
    materialData: CreateMaterialDto,
    originalName?: string,
  ): Promise<CreateMaterialResponseDto> {
    const correlationId = uuid();
    const filename = materialData.title;
    const { hash, extension } = this.calculateHashAndExtension(
      pdfBuffer,
      originalName,
    );

    await this.checkDuplicateHash(hash);

    const { blobName, fileUrl, response } = await this.uploadAndAnalyze(
      pdfBuffer,
      correlationId,
      filename,
    );

    const materialResponse = await this.handleResponse(
      response,
      materialData.subject,
      {
        correlationId,
        filename,
        blobName,
        materialData,
        fileUrl,
        hash,
        extension,
      },
    );

    return materialResponse;
  }

  private calculateHashAndExtension(
    pdfBuffer: Buffer,
    originalName?: string,
  ): { hash: string; extension: string } {
    const hash = createHash('sha256').update(pdfBuffer).digest('hex');
    const extension = originalName
      ? path.extname(originalName).replace(/^\./, '').toLowerCase()
      : 'pdf';
    this.logger.log(`Hash calculado: ${hash}`);
    return { hash, extension };
  }

  private async checkDuplicateHash(
    hash: string,
    excludeMaterialId?: string,
  ): Promise<void> {
    const where = excludeMaterialId
      ? { hash, NOT: { id: excludeMaterialId } }
      : { hash };
    const existingMaterial = await this.prisma.materiales.findFirst({ where });
    if (existingMaterial) {
      this.logger.warn('Material duplicado detectado');
      throw new ConflictException('Material already exists with same content');
    }
  }

  private async uploadAndAnalyze(
    pdfBuffer: Buffer,
    correlationId: string,
    filename: string,
  ): Promise<{ blobName: string; fileUrl: string; response: RespuestaIADto }> {
    const blobName = filename;

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(
        pdfBuffer,
        blobName,
        'application/pdf',
      );
    } catch (err) {
      this.logger.error('Error subiendo PDF a Blob:', err as Error);
      throw new BadRequestException('Error almacenando PDF');
    }

    try {
      await this.sendAnalysisMessage(
        fileUrl,
        blobName,
        correlationId,
        'analysis',
      );
    } catch (err) {
      this.logger.error('Error enviando mensaje a IA:', err as Error);
      await this.deleteBlobSafe(fileUrl, correlationId);
      throw new BadRequestException('Error enviando a IA');
    }

    const response = await this.waitForResponse(correlationId);
    return { blobName, fileUrl, response };
  }

  private async sendAnalysisMessage(
    fileUrl: string,
    blobName: string,
    correlationId: string,
    eventType: string,
  ): Promise<void> {
    this.logger.log(
      `enviando mensaje a IA...${eventType}, correlationId = ${correlationId}`,
    );
    const options: SendOptions = {
      correlationId,
      subject: eventType,
      contentType: 'application/json',
    };
    await this.messageBus.send(
      'material.process',
      { fileUrl, filename: blobName },
      options,
    );
  }

  private waitForResponse(correlationId: string): Promise<RespuestaIADto> {
    return new Promise<RespuestaIADto>((resolve) => {
      this.pendingRequests.set(correlationId, (response: RespuestaIADto) => {
        resolve(response);
      });
    });
  }

  private async handleResponse(
    response: RespuestaIADto,
    subject: string | undefined,
    ctx: {
      correlationId: string;
      filename: string;
      blobName: string;
      materialData: CreateMaterialDto;
      fileUrl: string;
      hash: string;
      extension: string;
    },
  ): Promise<CreateMaterialResponseDto> {
    const { correlationId, filename, blobName, materialData, fileUrl, hash } =
      ctx;
    if (response.valid) {
      this.logger.log(
        `Material validado como VÁLIDO por IA (correlationId=${correlationId})`,
      );
      try {
        await this.guardarMaterial(
          {
            id: correlationId,
            nombre: filename,
            userId: materialData.userId,
            url: fileUrl,
            extension: ctx.extension,
            descripcion: materialData.description,
            vistos: 0,
            descargas: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            hash,
          },
          response.tags,
          subject,
        );
        await this.sendAnalysisMessage('', blobName, correlationId, 'save');
        await this.enviarNotificacion(
          response,
          materialData.userId,
          filename,
          'nuevoMaterialSubido',
        );
        return {
          id: correlationId,
          title: materialData.title,
          description: materialData.description,
          subject: materialData.subject,
          filename,
          fileUrl,
          createdAt: new Date(),
        };
      } catch (err) {
        this.logger.error('Error guardando material válido:', err as Error);
        await this.deleteBlobSafe(fileUrl, correlationId);
        throw new BadRequestException('Error guardando material válido');
      }
    } else {
      const reason = response.detalles;
      this.logger.log(
        `Material validado como NO VÁLIDO por IA (correlationId=${correlationId})${reason ? ` - motivo: ${reason}` : ''}`,
      );
      await this.deleteBlobSafe(fileUrl, correlationId);
      const message = reason
        ? `PDF falló la validación automatizada: ${reason}`
        : 'PDF falló la validación automatizada';
      throw new UnprocessableEntityException(message);
    }
  }

  private async deleteBlobSafe(
    fileUrl: string,
    correlationId: string,
  ): Promise<void> {
    try {
      const deleted = await this.storage.delete(fileUrl);
      if (deleted) {
        this.logger.log(
          `Blob eliminado: ${fileUrl} (correlationId=${correlationId})`,
        );
      } else {
        this.logger.warn(
          `No se pudo eliminar el blob (no existe o ya eliminado): ${fileUrl} (correlationId=${correlationId})`,
        );
      }
    } catch (err) {
      this.logger.error(`Error eliminando blob ${fileUrl}:`, err as Error);
    }
  }

  async guardarMaterial(
    material: Material,
    tags: string[],
    subject?: string,
  ): Promise<void> {
    await this.prisma.materiales.create({ data: material });
    this.logger.log(
      `Material guardado/actualizado en base de datos con id=${material.id}`,
    );
    await this.guardarTags(tags, material.id, subject);
  }

  async guardarTags(
    tags: string[],
    materialId: string,
    subject?: string,
  ): Promise<void> {
    const allTags = subject ? tags.concat([subject]) : tags;
    if (allTags && allTags.length > 0) {
      for (const tag of allTags) {
        const tagNormalizado = tag.toLowerCase().trim();
        const etiquetaExistente = await this.prisma.tags.findFirst({
          where: { tag: { equals: tagNormalizado, mode: 'insensitive' } },
        });
        let etiqueta = etiquetaExistente;
        if (!etiqueta) {
          etiqueta = await this.prisma.tags.create({
            data: { tag: tagNormalizado },
          });
          this.logger.log(`Etiqueta creada: ${tagNormalizado}`);
        } else {
          this.logger.log(`Etiqueta existente encontrada: ${etiqueta.tag}`);
        }
        await this.prisma.materialTags.create({
          data: { idMaterial: materialId, idTag: etiqueta.id },
        });
        this.logger.log(
          `Relación creada entre material ${materialId} y etiqueta ${etiqueta.id}`,
        );
      }
    }
  }

  async enviarNotificacion(
    response: RespuestaIADto,
    userId: string,
    filename: string,
    template: string,
  ): Promise<void> {
    const user = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    const cuerpo: NotificationDto = {
      email: user?.email || 'estudiante',
      name: user?.nombre || 'Estudiante',
      template,
      resumen: `Se ha subido un nuevo materia de ${response.tema}`,
      fileName: filename,
      tema: response.tema,
      materia: response.materia,
      guardar: true,
      mandarCorreo: true,
    };
    await this.messageBus.send('mail.envio.individual', cuerpo);
  }

  async getMaterialsByUserWithStats(
    userId: string,
  ): Promise<UserMaterialsResponseDto> {
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    const materialsDto = materiales.map((m: any) => this.toMaterialDto(m));
    const totalVistas = materiales.reduce(
      (acc: number, m: any) => acc + (m.vistos ?? 0),
      0,
    );
    const totalDescargas = materiales.reduce(
      (acc: number, m: any) => acc + (m.descargas ?? 0),
      0,
    );
    const todasLasCalificaciones = materiales.flatMap(
      (m: any) => m.Calificaciones ?? [],
    );
    const calificacionPromedio =
      todasLasCalificaciones.length > 0
        ? Math.round(
            (todasLasCalificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              todasLasCalificaciones.length) *
              10,
          ) / 10
        : null;

    return {
      materials: materialsDto,
      totalVistas,
      totalDescargas,
      calificacionPromedio,
    };
  }

  async getUserAverageRating(userId: string): Promise<any> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      include: { Calificaciones: true },
    });
    const todasLasCalificaciones = materiales.flatMap(
      (m: any) => m.Calificaciones ?? [],
    );
    const calificacionPromedio =
      todasLasCalificaciones.length > 0
        ? Math.round(
            (todasLasCalificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              todasLasCalificaciones.length) *
              10,
          ) / 10
        : null;
    return {
      userId,
      calificacionPromedio,
      totalCalificaciones: todasLasCalificaciones.length,
      totalMateriales: materiales.length,
    };
  }

  async getPopularMaterials(limit: number): Promise<MaterialDto[]> {
    const materiales = await this.prisma.materiales.findMany({
      orderBy: [
        { descargas: 'desc' },
        { vistos: 'desc' },
        { createdAt: 'desc' },
      ],
      take: Number(limit),
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  async getUserMaterialsStats(userId: string): Promise<UserMaterialsStatsDto> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      include: { Calificaciones: true },
    });
    const totalMateriales = materiales.length;
    const totalDescargas = materiales.reduce(
      (acc: number, m: any) => acc + (m.descargas ?? 0),
      0,
    );
    const totalVistas = materiales.reduce(
      (acc: number, m: any) => acc + (m.vistos ?? 0),
      0,
    );
    const todasLasCalificaciones = materiales.flatMap(
      (m: any) => m.Calificaciones ?? [],
    );
    const calificacionPromedio =
      todasLasCalificaciones.length > 0
        ? Math.round(
            (todasLasCalificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              todasLasCalificaciones.length) *
              10,
          ) / 10
        : 0;
    return {
      userId,
      calificacionPromedio,
      totalMateriales,
      totalDescargas,
      totalVistas,
    };
  }

  async getTopDownloadedMaterials(
    userId: string,
  ): Promise<TopDownloadedMaterialsDto> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      select: {
        id: true,
        nombre: true,
        descargas: true,
        vistos: true,
        Calificaciones: true,
      },
      orderBy: { descargas: 'desc' },
      take: 3,
    });
    return {
      userId,
      topDownloaded: materiales.map((m: any) => {
        const calificacionPromedio =
          m.Calificaciones && m.Calificaciones.length > 0
            ? Math.round(
                (m.Calificaciones.reduce(
                  (acc: number, c: any) => acc + c.calificacion,
                  0,
                ) /
                  m.Calificaciones.length) *
                  10,
              ) / 10
            : 0;
        return {
          id: m.id,
          nombre: m.nombre,
          descargas: m.descargas ?? 0,
          vistos: m.vistos ?? 0,
          calificacionPromedio,
        };
      }),
    };
  }

  async getTopViewedMaterials(userId: string): Promise<TopViewedMaterialsDto> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      select: {
        id: true,
        nombre: true,
        descargas: true,
        vistos: true,
        Calificaciones: true,
      },
      orderBy: { vistos: 'desc' },
      take: 3,
    });
    return {
      userId,
      topViewed: materiales.map((m: any) => {
        const calificacionPromedio =
          m.Calificaciones && m.Calificaciones.length > 0
            ? Math.round(
                (m.Calificaciones.reduce(
                  (acc: number, c: any) => acc + c.calificacion,
                  0,
                ) /
                  m.Calificaciones.length) *
                  10,
              ) / 10
            : 0;
        return {
          id: m.id,
          nombre: m.nombre,
          descargas: m.descargas ?? 0,
          vistos: m.vistos ?? 0,
          calificacionPromedio,
        };
      }),
    };
  }

  async getUserTopMaterials(userId: string): Promise<any[]> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      select: {
        id: true,
        nombre: true,
        descargas: true,
        vistos: true,
        Calificaciones: true,
        MaterialTags: { include: { Tags: true } },
      },
      orderBy: [{ descargas: 'desc' }, { vistos: 'desc' }],
    });
    return materiales.map((m: any) => {
      const calificacionPromedio =
        m.Calificaciones && m.Calificaciones.length > 0
          ? Math.round(
              (m.Calificaciones.reduce(
                (acc: number, c: any) => acc + c.calificacion,
                0,
              ) /
                m.Calificaciones.length) *
                10,
            ) / 10
          : 0;
      return {
        id: m.id,
        nombre: m.nombre,
        descargas: m.descargas ?? 0,
        vistos: m.vistos ?? 0,
        calificacionPromedio,
        tags: m.MaterialTags?.map((mt: any) => mt.Tags?.tag) ?? [],
      };
    });
  }

  async getUserTagsPercentage(userId: string): Promise<UserTagsPercentageDto> {
    await this.validateUserExists(userId);
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      include: { MaterialTags: { include: { Tags: true } } },
    });
    const tagCount: { [key: string]: number } = {};
    let totalTags = 0;
    materiales.forEach((material: any) => {
      material.MaterialTags.forEach((materialTag: any) => {
        const tagName = materialTag.Tags.tag;
        tagCount[tagName] = (tagCount[tagName] || 0) + 1;
        totalTags++;
      });
    });
    const tagsWithPercentage = Object.entries(tagCount)
      .map(([tag, count]) => ({
        tag,
        porcentaje: totalTags > 0 ? (count / totalTags) * 100 : 0,
      }))
      .sort((a, b) => b.porcentaje - a.porcentaje);
    return { userId, tags: tagsWithPercentage };
  }

  async getGlobalTagsPercentage(): Promise<any> {
    const materiales = await this.prisma.materiales.findMany({
      include: { MaterialTags: { include: { Tags: true } } },
    });
    const tagCount: { [key: string]: number } = {};
    let totalAsociaciones = 0;
    materiales.forEach((material: any) => {
      material.MaterialTags.forEach((materialTag: any) => {
        const tagName = materialTag.Tags.tag;
        tagCount[tagName] = (tagCount[tagName] || 0) + 1;
        totalAsociaciones++;
      });
    });
    const tagsWithPercentage = Object.entries(tagCount)
      .map(([tag, count]) => ({
        tag,
        cantidad: count,
        porcentaje:
          totalAsociaciones > 0 ? (count / totalAsociaciones) * 100 : 0,
      }))
      .sort((a, b) => b.porcentaje - a.porcentaje);
    return {
      totalTags: Object.keys(tagCount).length,
      totalAsociaciones,
      tags: tagsWithPercentage,
    };
  }

  async getAllMaterials(skip?: number, take?: number): Promise<MaterialDto[]> {
    const materiales = await this.prisma.materiales.findMany({
      orderBy: { createdAt: 'desc' },
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  async searchMaterialsByName(
    nombre: string,
    skip?: number,
    take?: number,
  ): Promise<MaterialDto[]> {
    const term = nombre?.trim();
    if (!term || term.length < 1) {
      throw new BadRequestException(
        'El término de búsqueda debe tener al menos 1 carácter',
      );
    }
    const materiales = await this.prisma.materiales.findMany({
      where: { nombre: { contains: term, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  async getMaterialsByDate(
    order: 'asc' | 'desc' = 'desc',
    skip?: number,
    take?: number,
  ): Promise<MaterialDto[]> {
    const materiales = await this.prisma.materiales.findMany({
      orderBy: { createdAt: order },
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  private toMaterialDto(material: any): MaterialDto {
    const promedio =
      material.Calificaciones && material.Calificaciones.length > 0
        ? Math.round(
            (material.Calificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              material.Calificaciones.length) *
              10,
          ) / 10
        : undefined;
    const totalComentarios = material.Calificaciones
      ? material.Calificaciones.filter(
          (c: any) => c.comentario && c.comentario.trim().length > 0,
        ).length
      : 0;
    return {
      id: material.id,
      nombre: material.nombre,
      userId: material.userId,
      userName: material.usuarios?.nombre ?? undefined,
      extension: material.extension,
      url: material.url,
      descripcion: material.descripcion,
      vistos: material.vistos,
      descargas: material.descargas,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      tags: material.MaterialTags?.map((mt: any) => mt.Tags?.tag) ?? [],
      calificacionPromedio: promedio,
      totalComentarios,
    };
  }

  async rateMaterial(
    materialId: string,
    userId: string,
    rating: number,
    comentario?: string | null,
  ): Promise<RateMaterialResponseDto> {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('La calificación debe estar entre 1 y 5');
    }
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(
        `Intento de calificar material inexistente: ${materialId} (userId=${userId})`,
      );
      throw new NotFoundException('Material no encontrado');
    }
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!usuario) {
      this.logger.warn(
        `Intento de calificar por usuario inexistente: ${userId} (materialId=${materialId})`,
      );
      throw new NotFoundException('Usuario no encontrado');
    }
    await this.prisma.calificaciones.create({
      data: {
        idMaterial: materialId,
        userId,
        calificacion: rating,
        comentario: comentario ?? undefined,
      },
    });
    const aggregate = await this.prisma.calificaciones.aggregate({
      where: { idMaterial: materialId },
      _avg: { calificacion: true },
      _count: { _all: true },
    });
    const promedio = aggregate._avg.calificacion
      ? Math.round(aggregate._avg.calificacion * 10) / 10
      : 0;
    const totalCalificaciones = aggregate._count._all;
    return {
      materialId,
      rating,
      comentario: comentario ?? null,
      calificacionPromedio: promedio,
      totalCalificaciones,
    };
  }

  async getMaterialRatings(
    materialId: string,
  ): Promise<GetMaterialRatingsResponseDto> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(
        `Intento de obtener calificaciones de material inexistente: ${materialId}`,
      );
      throw new NotFoundException('Material no encontrado');
    }
    const calificaciones = await this.prisma.calificaciones.findMany({
      where: { idMaterial: materialId },
    });
    const totalCalificaciones = calificaciones.length;
    const calificacionPromedio =
      totalCalificaciones > 0
        ? Math.round(
            (calificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              totalCalificaciones) *
              10,
          ) / 10
        : 0;
    return {
      materialId,
      calificacionPromedio,
      totalCalificaciones,
      totalDescargas: material.descargas,
      totalVistas: material.vistos,
    };
  }

  async getMaterialRatingsList(
    materialId: string,
  ): Promise<MaterialRatingDto[]> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(
        `Intento de obtener calificaciones de material inexistente: ${materialId}`,
      );
      throw new NotFoundException('Material no encontrado');
    }
    const calificaciones = await this.prisma.calificaciones.findMany({
      where: { idMaterial: materialId },
      orderBy: { createdAt: 'desc' },
      include: { usuarios: { select: { nombre: true } } },
    });
    return calificaciones.map((c: any) => ({
      id: c.id,
      calificacion: c.calificacion,
      comentario: c.comentario ?? null,
      usuarioNombre: c.usuarios?.nombre ?? 'Usuario Anónimo',
      createdAt: c.createdAt,
    }));
  }

  async downloadMaterial(materialId: string) {
    this.logger.log(`Preparando stream para material ${materialId}`);
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(`Material no encontrado: ${materialId}`);
      throw new BadRequestException(`Material con id ${materialId} no existe`);
    }
    try {
      const fileExists = await this.storage.exists(material.url);
      if (!fileExists) {
        this.logger.warn(
          `Archivo no existe en storage para material ${materialId}: ${material.url}`,
        );
        throw new NotFoundException('Archivo no encontrado en almacenamiento');
      }
      const { stream, contentType, filename } = await this.storage.download(
        material.url,
      );
      await this.incrementDownloads(materialId);
      this.logger.log(
        `Contador de descargas incrementado para material ${materialId}`,
      );
      return { stream, contentType, filename };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        `Error obteniendo blob para material ${materialId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Error obteniendo archivo de almacenamiento',
      );
    }
  }

  async incrementViews(materialId: string): Promise<void> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      throw new BadRequestException(
        `Material con ID ${materialId} no encontrado`,
      );
    }
    await this.prisma.materiales.update({
      where: { id: materialId },
      data: { vistos: { increment: 1 } },
    });
  }

  async searchMaterials(
    palabraClave?: string,
    materia?: string,
    autor?: string,
    tipoMaterial?: string,
    semestre?: number,
    calificacionMin?: number,
    page: number = 1,
    size: number = 10,
  ): Promise<{ materials: MaterialDto[]; total: number }> {
    const whereConditions: any = {};
    const skip = (page - 1) * size;
    if (palabraClave) {
      whereConditions.OR = [
        { nombre: { contains: palabraClave, mode: 'insensitive' } },
        { descripcion: { contains: palabraClave, mode: 'insensitive' } },
      ];
    }
    if (autor) whereConditions.userId = autor;
    if (tipoMaterial)
      whereConditions.extension = {
        contains: tipoMaterial,
        mode: 'insensitive',
      };
    if (semestre)
      whereConditions.descripcion = {
        contains: semestre.toString(),
        mode: 'insensitive',
      };
    const [materiales, _total] = await Promise.all([
      this.prisma.materiales.findMany({
        where: whereConditions,
        include: {
          MaterialTags: { include: { Tags: true } },
          Calificaciones: true,
          usuarios: { select: { nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
      }),
      this.prisma.materiales.count({ where: whereConditions }),
    ]);
    let materialesFiltrados = materiales;
    if (materia) {
      materialesFiltrados = materialesFiltrados.filter((m: any) =>
        m.MaterialTags?.some((mt: any) =>
          mt.Tags?.tag.toLowerCase().includes(materia.toLowerCase()),
        ),
      );
    }
    if (calificacionMin) {
      materialesFiltrados = materialesFiltrados.filter((m: any) => {
        if (!m.Calificaciones || m.Calificaciones.length === 0) return false;
        const promedio =
          m.Calificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / m.Calificaciones.length;
        return promedio >= calificacionMin;
      });
    }
    return {
      materials: materialesFiltrados.map((m: any) => this.toMaterialDto(m)),
      total: materialesFiltrados.length,
    };
  }

  async getMaterialStats(materialId: string): Promise<MaterialDto> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    return this.toMaterialDto(material);
  }

  async getMaterialDetail(materialId: string): Promise<any> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });
    if (!material) {
      throw new NotFoundException(
        `Material con id ${materialId} no encontrado`,
      );
    }
    const calificacionPromedio =
      material.Calificaciones && material.Calificaciones.length > 0
        ? Math.round(
            (material.Calificaciones.reduce(
              (acc: number, c: any) => acc + c.calificacion,
              0,
            ) /
              material.Calificaciones.length) *
              10,
          ) / 10
        : null;
    await this.incrementViews(materialId);
    return {
      metadata: {
        id: material.id,
        nombre: material.nombre,
        descripcion: material.descripcion,
        userId: material.userId,
        userName: material.usuarios?.nombre,
        vistos: material.vistos,
        descargas: material.descargas,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
        tags: material.MaterialTags?.map((mt: any) => mt.Tags?.tag) ?? [],
      },
      calificación: calificacionPromedio,
      previewURL: material.url,
    };
  }

  private async incrementDownloads(materialId: string): Promise<void> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      throw new BadRequestException(
        `Material con ID ${materialId} no encontrado`,
      );
    }
    await this.prisma.materiales.update({
      where: { id: materialId },
      data: { descargas: { increment: 1 } },
    });
  }

  async updateMaterialVersion(
    materialId: string,
    pdfBuffer: Buffer | undefined,
    title: string,
    description?: string,
    originalName?: string,
  ): Promise<any> {
    const existing = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!existing) {
      this.logger.warn(
        `Intento de actualizar material inexistente: ${materialId}`,
      );
      throw new NotFoundException('Material no encontrado');
    }
    let hash = existing.hash;
    let extension = existing.extension;
    let newFileUrl = existing.url;
    let blobName: string | null = null;
    let correlationId: string | null = null;

    if (pdfBuffer) {
      correlationId = uuid();
      const filename = title;
      const hashResult = this.calculateHashAndExtension(
        pdfBuffer,
        originalName,
      );
      hash = hashResult.hash;
      extension = hashResult.extension;
      await this.checkDuplicateHash(hash, materialId);
      const uploadResult = await this.uploadAndAnalyze(
        pdfBuffer,
        correlationId,
        filename,
      );
      blobName = uploadResult.blobName;
      const response = uploadResult.response;
      if (!response.valid) {
        const reason = response.detalles;
        this.logger.log(
          `Material actualizado marcado como NO VÁLIDO por IA (correlationId=${correlationId})${reason ? ` - motivo: ${reason}` : ''}`,
        );
        await this.deleteBlobSafe(uploadResult.fileUrl, correlationId);
        const message = reason
          ? `PDF falló la validación automatizada: ${reason}`
          : 'PDF falló la validación automatizada';
        throw new UnprocessableEntityException(message);
      }
      this.logger.log(
        `Material validado como VÁLIDO por IA en actualización (correlationId=${correlationId})`,
      );
      newFileUrl = uploadResult.fileUrl;
    }

    const updated = await this.prisma.materiales.update({
      where: { id: materialId },
      data: {
        nombre: title,
        descripcion: description || existing.descripcion,
        ...(newFileUrl && newFileUrl !== existing.url && { url: newFileUrl }),
        extension,
        hash,
        updatedAt: new Date(),
      },
    });

    if (blobName && correlationId) {
      await this.sendAnalysisMessage('', blobName, correlationId, 'save');
      await this.deleteOldBlob(existing.url, materialId);
    }

    return {
      id: updated.id,
      title,
      description: description || existing.descripcion,
      filename: title,
      fileUrl: updated.url,
      createdAt: existing.createdAt,
      message: 'Material actualizado correctamente',
    };
  }

  private async validateUserExists(userId: string): Promise<void> {
    const userExists = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      throw new BadRequestException(
        `El userId ${userId} no existe en la base de datos`,
      );
    }
  }

  private async deleteOldBlob(
    oldUrl: string | null,
    materialId: string,
  ): Promise<void> {
    try {
      if (oldUrl) {
        await this.deleteBlobSafe(oldUrl, materialId);
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo eliminar el blob anterior para material ${materialId}: ${(err as Error).message}`,
      );
    }
  }

  async getMaterialsCount(): Promise<{ Count: number }> {
    const count = await this.prisma.materiales.count();
    return { Count: count };
  }

  async deleteMaterial(materialId: string): Promise<{ message: string }> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      throw new NotFoundException(`El material con ID ${materialId} no existe`);
    }
    if (material.url) {
      await this.deleteOldBlob(material.url, materialId);
    }
    await this.prisma.materiales.delete({ where: { id: materialId } });
    this.logger.log(`Material ${materialId} eliminado correctamente`);
    return { message: `Material ${materialId} eliminado correctamente` };
  }
}
