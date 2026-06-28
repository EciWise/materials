import 'dotenv/config';
import * as joi from 'joi';

type StorageProvider = 'azure' | 's3';
type MessageBusProvider = 'azure' | 'rabbitmq';

interface EnvVars {
  PORT: number;
  STORAGE_PROVIDER: StorageProvider;
  MESSAGE_BUS_PROVIDER: MessageBusProvider;
  SERVICE_BUS_CONNECTION_STRING: string;
  BLOB_STORAGE_CONNECTION_STRING: string;
  BLOB_STORAGE_ACCOUNT_NAME: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  S3_BUCKET_NAME: string;
  RABBITMQ_URL: string;
  SWAGGER_ENABLED: boolean;
}

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    STORAGE_PROVIDER: joi.string().valid('azure', 's3').default('azure'),
    MESSAGE_BUS_PROVIDER: joi
      .string()
      .valid('azure', 'rabbitmq')
      .default('azure'),
    SERVICE_BUS_CONNECTION_STRING: joi.when('MESSAGE_BUS_PROVIDER', {
      is: 'azure',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    BLOB_STORAGE_CONNECTION_STRING: joi.when('STORAGE_PROVIDER', {
      is: 'azure',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    BLOB_STORAGE_ACCOUNT_NAME: joi.when('STORAGE_PROVIDER', {
      is: 'azure',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    AWS_ACCESS_KEY_ID: joi.when('STORAGE_PROVIDER', {
      is: 's3',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    AWS_SECRET_ACCESS_KEY: joi.when('STORAGE_PROVIDER', {
      is: 's3',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    AWS_REGION: joi.when('STORAGE_PROVIDER', {
      is: 's3',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    S3_BUCKET_NAME: joi.when('STORAGE_PROVIDER', {
      is: 's3',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    RABBITMQ_URL: joi.when('MESSAGE_BUS_PROVIDER', {
      is: 'rabbitmq',
      then: joi.string().required(),
      otherwise: joi.string().optional().allow(''),
    }),
    SWAGGER_ENABLED: joi.boolean().default(true),
  })
  .unknown(true);

const result = envsSchema.validate(process.env);
if (result.error) {
  throw new Error(`Config validation error: ${result.error.message}`);
}
const envVars = result.value as EnvVars;

export const envs = {
  port: envVars.PORT,
  storageProvider: envVars.STORAGE_PROVIDER,
  messageBusProvider: envVars.MESSAGE_BUS_PROVIDER,
  serviceBusConnectionString: envVars.SERVICE_BUS_CONNECTION_STRING,
  blobStorageConnectionString: envVars.BLOB_STORAGE_CONNECTION_STRING,
  blobStorageAccountName: envVars.BLOB_STORAGE_ACCOUNT_NAME,
  awsAccessKeyId: envVars.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
  awsRegion: envVars.AWS_REGION,
  s3BucketName: envVars.S3_BUCKET_NAME,
  rabbitmqUrl: envVars.RABBITMQ_URL,
  swaggerEnabled: envVars.SWAGGER_ENABLED,
};
