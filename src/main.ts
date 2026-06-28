import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';
import { envs } from './config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  if (envs.swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Wise Banco Material API')
      .setDescription(
        `## Microservicio de banco de materiales académicos

Permite a los usuarios subir, buscar, calificar y descargar materiales PDF.
Cada archivo pasa por validación automática de IA antes de ser almacenado.

### Arquitectura
El servicio implementa **Ports & Adapters** (hexagonal): el dominio nunca depende
de SDKs concretos. El proveedor de almacenamiento y el bus de mensajes se
seleccionan mediante variables de entorno sin recompilar.

| Variable | Opciones |
|---|---|
| \`STORAGE_PROVIDER\` | \`azure\` (Blob Storage) · \`s3\` (AWS S3) |
| \`MESSAGE_BUS_PROVIDER\` | \`azure\` (Service Bus) · \`rabbitmq\` |

### Flujo principal (POST /material)
1. Valida PDF y calcula hash SHA-256 (detecta duplicados)
2. Sube a almacenamiento y envía mensaje a IA
3. Si IA aprueba → persiste en BD y envía email de confirmación
4. Si IA rechaza → elimina el blob y responde 422`,
      )
      .setVersion('1.0')
      .setContact('DOSW2025 / EciWise', '', '')
      .setLicense('Privado', '')
      .addServer(`http://localhost:${envs.port}`, 'Local')
      .addTag('Material', 'Gestión de materiales académicos PDF')
      .addTag('PDF Export', 'Exportación de estadísticas a PDF')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
      customSiteTitle: 'Wise Banco Material — API Docs',
    });
    logger.log('Swagger documentation enabled at /api');
  } else {
    logger.log('Swagger documentation disabled via SWAGGER_ENABLED=false');
  }

  const port = envs.port;
  await app.listen(port);
  logger.log(`Application is running on: ${port}`);
}
void bootstrap();
