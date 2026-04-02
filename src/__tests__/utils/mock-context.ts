import type { Message } from "grammy/types";
import type { BotContext } from "../../types/bot-context.js";
import { createMockLogger } from "./mock-logger.js";

export interface MockContextOptions {
  chatType?: "private" | "group" | "supergroup" | "channel";
  messageText?: string;
  messageId?: number;
  chatId?: number;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  match?: string;
}

export interface MockContextResult {
  ctx: BotContext;
  mocks: {
    reply: ReturnType<typeof createMockFn>;
    replyWithMediaGroup: ReturnType<typeof createMockFn>;
    replyWithPhoto: ReturnType<typeof createMockFn>;
    deleteMessage: ReturnType<typeof createMockFn>;
  };
}

function createMockFn<T = unknown>(): { fn: (...args: unknown[]) => Promise<T>; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): Promise<T> => {
    calls.push(args);
    return Promise.resolve({} as T);
  };
  return { fn, calls };
}

export function createMockContext(options: MockContextOptions = {}): MockContextResult {
  const chatType = options.chatType ?? "group";
  const messageText = options.messageText ?? "test message";
  const messageId = options.messageId ?? 123;
  const chatId = options.chatId ?? 456;
  const userId = options.userId ?? 789;
  // Use hasOwn to check if username was explicitly set (including to undefined)
  const username = Object.hasOwn(options, "username") ? options.username : "testuser";
  const firstName = options.firstName ?? "Test";
  const lastName = options.lastName ?? "User";
  const match = options.match ?? "";

  const mockLogger = createMockLogger();
  const replyMock = createMockFn<Message>();
  const replyWithMediaGroupMock = createMockFn<Message[]>();
  const replyWithPhotoMock = createMockFn<Message>();
  const deleteMessageMock = createMockFn<boolean>();

  const message: Message = {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: chatId,
      type: chatType,
    },
    from: {
      id: userId,
      is_bot: false,
      first_name: firstName,
      last_name: lastName,
      username,
    },
    text: messageText,
  } as Message;

  const ctx = {
    message,
    match,
    logger: mockLogger,
    isPrivateChat: chatType === "private",
    reply: replyMock.fn,
    replyWithMediaGroup: replyWithMediaGroupMock.fn,
    replyWithPhoto: replyWithPhotoMock.fn,
    deleteMessage: deleteMessageMock.fn,
  } as unknown as BotContext;

  return {
    ctx,
    mocks: {
      reply: replyMock,
      replyWithMediaGroup: replyWithMediaGroupMock,
      replyWithPhoto: replyWithPhotoMock,
      deleteMessage: deleteMessageMock,
    },
  };
}
