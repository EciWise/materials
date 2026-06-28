import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt.guard';
import { MaterialModule } from './material/material.module';
import { PrismaModule } from './prisma/prisma.module';
import { PdfExportModule } from './pdf-export/pdf-export.module';

@Module({
  imports: [AuthModule, MaterialModule, PrismaModule, PdfExportModule],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
