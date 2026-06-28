export const MESSAGE_BUS_PORT = 'MESSAGE_BUS_PORT';

export interface SendOptions {
  correlationId?: string;
  subject?: string;
  contentType?: string;
}

export type MessageHandler<T = unknown> = (
  body: T,
  correlationId?: string,
) => Promise<void>;

export type ErrorHandler = (error: Error) => Promise<void>;

export interface MessageBusPort {
  send(queue: string, body: unknown, options?: SendOptions): Promise<void>;
  subscribe<T = unknown>(
    queue: string,
    onMessage: MessageHandler<T>,
    onError: ErrorHandler,
  ): void;
  close(): Promise<void>;
}
