import { Bot } from "grammy";
import { downloadVideosFromMessage } from "./download-video.js";
import type { BotContext } from "./types/bot-context.js";
import { config } from "./utils/config.js";
import { logger as globalLogger } from "./utils/logger.js";

const apiRoot = config.get("KLAID_TELEGRAM_API_ROOT");

export const bot = new Bot<BotContext>(
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  config.get("KLAID_TELEGRAM_BOT_TOKEN")!,
  apiRoot
    ? {
        client: {
          apiRoot,
        },
      }
    : {},
);

bot.use(async (ctx, next) => {
  const logger = globalLogger.child({ messageId: ctx.message?.message_id });
  ctx.logger = logger;
  ctx.isPrivateChat = false && ctx.message?.chat.type === "private";
  await next();
});

bot.catch((err) => {
  err.ctx.logger.error(err);
});

bot.command(["dl", "download"], async (ctx) => {
  const { logger, message, match: text, isPrivateChat } = ctx;
  if (!message) {
    logger.warn("No message found");
    return;
  }

  await downloadVideosFromMessage(message, text, logger, ctx, undefined, isPrivateChat ? false : true);
});

bot.on("message", async (ctx) => {
  const { message, logger, isPrivateChat } = ctx;
  const text = message?.text;
  if (!text) return;

  await downloadVideosFromMessage(
    message,
    text,
    logger,
    ctx,
    isPrivateChat ? undefined : config.get("KLAID_AUTO_DL_URLS"),
    isPrivateChat ? false : config.get("KLAID_AUTO_DL_DELETE_MESSAGE"),
  );
});
