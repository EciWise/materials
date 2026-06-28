import { Logger } from '@nestjs/common';
import {
  ErrorHandler,
  MessageBusPort,
  MessageHandler,
  SendOptions,
} from './ports/message-bus.port';

export abstract class BaseBusService implements MessageBusPort {
  protected readonly logger: Logger;

  constructor(name: string) {
    this.logger = new Logger(name);
  }

  abstract send(
    queue: string,
    body: unknown,
    options?: SendOptions,
  ): Promise<void>;

  abstract subscribe<T = unknown>(
    queue: string,
    onMessage: MessageHandler<T>,
    onError: ErrorHandler,
  ): void;

  abstract close(): Promise<void>;

  protected logSend(queue: string, correlationId?: string): void {
    this.logger.log(
      `Sending message to '${queue}'${correlationId ? ` [correlationId=${correlationId}]` : ''}`,
    );
  }

  protected logSubscribe(queue: string): void {
    this.logger.log(`Subscribed to queue '${queue}'`);
  }
}
