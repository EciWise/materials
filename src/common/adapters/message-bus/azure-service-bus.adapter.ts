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

  async publish(
    exchange: string,
    routingKey: string,
    body: unknown,
    options?: SendOptions,
  ): Promise<void> {
    // En Azure Service Bus el "exchange topic" se modela como un Topic y la
    // routing key viaja como `subject` para que las suscripciones filtren.
    this.logSend(`${exchange}/${routingKey}`, options?.correlationId);
    const sender = this.client.createSender(exchange);
    const message: ServiceBusMessage = {
      body,
      subject: routingKey,
      ...(options?.correlationId && { correlationId: options.correlationId }),
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
        await onMessage(
          message.body as T,
          message.correlationId as string | undefined,
        );
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
