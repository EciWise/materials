import { Module } from '@nestjs/common';
import { AzureBlobAdapter } from './adapters/storage/azure-blob.adapter';
import { S3Adapter } from './adapters/storage/s3.adapter';
import { AzureServiceBusAdapter } from './adapters/message-bus/azure-service-bus.adapter';
import { RabbitMQAdapter } from './adapters/message-bus/rabbitmq.adapter';
import { STORAGE_PORT } from './ports/storage.port';
import { MESSAGE_BUS_PORT } from './ports/message-bus.port';

@Module({
  providers: [
    {
      provide: STORAGE_PORT,
      useFactory: () => {
        const provider = process.env.STORAGE_PROVIDER ?? 'azure';
        if (provider === 's3') {
          return new S3Adapter(
            process.env.S3_BUCKET_NAME!,
            process.env.AWS_REGION!,
            process.env.AWS_ACCESS_KEY_ID!,
            process.env.AWS_SECRET_ACCESS_KEY!,
          );
        }
        return new AzureBlobAdapter(
          process.env.BLOB_STORAGE_CONNECTION_STRING!,
          process.env.BLOB_STORAGE_ACCOUNT_NAME!,
        );
      },
    },
    {
      provide: MESSAGE_BUS_PORT,
      useFactory: () => {
        const provider = process.env.MESSAGE_BUS_PROVIDER ?? 'azure';
        if (provider === 'rabbitmq') {
          return new RabbitMQAdapter(process.env.RABBITMQ_URL!);
        }
        return new AzureServiceBusAdapter(
          process.env.SERVICE_BUS_CONNECTION_STRING!,
        );
      },
    },
  ],
  exports: [STORAGE_PORT, MESSAGE_BUS_PORT],
})
export class CommonModule {}
