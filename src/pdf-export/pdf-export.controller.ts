import { Controller, Logger, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PdfExportService } from './pdf-export.service';
import { MaterialService } from '../material/material.service';

@ApiBearerAuth('access-token')
@ApiTags('PDF Export')
@Controller('pdf-export')
export class PdfExportController {
  private readonly logger = new Logger(PdfExportController.name);

  constructor(
    private readonly pdfExportService: PdfExportService,
    private readonly materialService: MaterialService,
  ) {}

  @Get(':id/stats/export')
  @ApiOperation({
    summary: 'Exportar estadísticas de un material a PDF',
    description:
      'Genera un reporte PDF con las estadísticas del material (vistas, descargas, calificaciones, tags) y lo devuelve como descarga.',
  })
  @ApiParam({ name: 'id', description: 'ID del material' })
  @ApiResponse({
    status: 200,
    description: 'PDF generado y enviado como stream.',
  })
  @ApiResponse({ status: 404, description: 'Material no encontrado.' })
  async exportMaterialStatsToPDF(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Exportando PDF industrial para material ${id}`);

    const stats = await this.materialService.getMaterialStats(id);

    const { stream, filename, contentType } =
      await this.pdfExportService.generateMaterialStatsPDF(stats);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );

    stream.on('error', (err) => {
      this.logger.error(
        `Error generando PDF para ${id}: ${err?.message ?? err}`,
      );
      if (!res.headersSent) {
        res.status(500).send('Error generando el PDF');
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  }
}
