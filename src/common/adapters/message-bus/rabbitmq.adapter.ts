import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { BaseBusService } from '../../base-bus.service';
import {
  ErrorHandler,
  MessageHandler,
  SendOptions,
} from '../../ports/message-bus.port';

@Injectable()
export class RabbitMQAdapter
  extends BaseBusService
  implements OnModuleInit, OnModuleDestroy
{
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;

  constructor(private readonly url: string) {
    super(RabbitMQAdapter.name);
  }

  async onModuleInit(): Promise<void> {
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createChannel();
    this.logger.log('RabbitMQ connection established');
  }

  async send(
    queue: string,
    body: unknown,
    options?: SendOptions,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');
    this.logSend(queue, options?.correlationId);
    await this.channel.assertQueue(queue, { durable: true });
    const content = Buffer.from(JSON.stringify(body));
    this.channel.sendToQueue(queue, content, {
      persistent: true,
      correlationId: options?.correlationId,
      contentType: options?.contentType ?? 'application/json',
      headers: { subject: options?.subject },
    });
  }

  subscribe<T = unknown>(
    queue: string,
    onMessage: MessageHandler<T>,
    onError: ErrorHandler,
  ): void {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');
    this.logSubscribe(queue);
    void this.channel.assertQueue(queue, { durable: true }).then(() => {
      void this.channel!.consume(queue, (msg) => {
        if (!msg) return;
        try {
          const body = JSON.parse(msg.content.toString()) as T;
          const correlationId = msg.properties.correlationId as
            | string
            | undefined;
          void onMessage(body, correlationId)
            .then(() => {
              this.channel!.ack(msg);
            })
            .catch(async (err: Error) => {
              this.channel!.nack(msg, false, false);
              await onError(err);
            });
        } catch (err) {
          this.channel!.nack(msg, false, false);
          void onError(err as Error);
        }
      });
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
