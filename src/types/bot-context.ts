import type { Context } from "grammy";
import type winston from "winston";

export type BotContext = Context & {
  logger: winston.Logger;
  isPrivateChat: boolean;
};
