import { Injectable } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';
import { BaseBusService } from '../../base-bus.service';
import {
  ErrorHandler,
  MessageHandler,
  SendOptions,
} from '../../ports/message-bus.port';

@Injectable()
export class AzureServiceBusAdapter extends BaseBusService {
  private readonly client: ServiceBusClient;

  constructor(connectionString: string) {
    super(AzureServiceBusAdapter.name);
    this.client = new ServiceBusClient(connectionString);
  }

  async send(
    queue: string,
    body: unknown,
    options?: SendOptions,
  ): Promise<void> {
    this.logSend(queue, options?.correlationId);
    const sender = this.client.createSender(queue);
    const message: ServiceBusMessage = {
      body,
      ...(options?.correlationId && { correlationId: options.correlationId }),
      ...(options?.subject && { subject: options.subject }),
      ...(options?.contentType && { contentType: options.contentType }),
    };
    await sender.sendMessages(message);
    await sender.close();
  }

  subscribe<T = unknown>(
    queue: string,
    onMessage: MessageHandler<T>,
    onError: ErrorHandler,
  ): void {
    this.logSubscribe(queue);
    const receiver = this.client.createReceiver(queue);
    receiver.subscribe({
      processMessage: async (message) => {
        await onMessage(message.body as T, message.correlationId);
      },
      processError: async (args) => {
        await onError(args.error);
      },
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
