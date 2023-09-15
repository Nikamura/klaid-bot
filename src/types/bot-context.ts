import { Context } from "grammy";
import winston from "winston";

export type BotContext = Context & {
  logger: winston.Logger;
  isPrivateChat: boolean;
};
