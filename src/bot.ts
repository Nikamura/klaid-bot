import { Bot } from "grammy";
import { downloadMediaFromMessage } from "./download-video.js";
import { handleChosenInlineResult, handleInlineQuery } from "./handle-inline-query.js";
import type { BotContext } from "./types/bot-context.js";
import { config } from "./utils/config.js";
import { logger as globalLogger } from "./utils/logger.js";

const apiRoot = config.KLAID_TELEGRAM_API_ROOT;

export const bot = new Bot<BotContext>(
  config.KLAID_TELEGRAM_BOT_TOKEN,
  apiRoot
    ? {
        client: {
          apiRoot,
        },
      }
    : {},
);

bot.use(async (ctx, next) => {
  const updateId = ctx.message?.message_id ?? ctx.inlineQuery?.id ?? ctx.chosenInlineResult?.result_id ?? "unknown";
  ctx.logger = globalLogger.child({ updateId });
  ctx.isPrivateChat = ctx.message?.chat.type === "private";
  await next();
});

bot.catch((err) => {
  err.ctx.logger.error(err);
});

bot.on("inline_query", handleInlineQuery);
bot.on("chosen_inline_result", handleChosenInlineResult);
bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

bot.command(["dl", "download"], async (ctx) => {
  const { logger, message, match: text, isPrivateChat } = ctx;
  if (!message) {
    logger.warn("No message found");
    return;
  }

  await downloadMediaFromMessage(message, text, logger, ctx, undefined, isPrivateChat ? false : true);
});

bot.on("message", async (ctx) => {
  const { message, logger, isPrivateChat } = ctx;
  const text = message?.text;
  if (!text) return;

  // Skip messages sent via this bot (e.g. inline query results)
  if (message.via_bot?.id === ctx.me.id) return;

  await downloadMediaFromMessage(
    message,
    text,
    logger,
    ctx,
    isPrivateChat ? undefined : config.KLAID_AUTO_DL_URLS,
    isPrivateChat ? false : config.KLAID_AUTO_DL_DELETE_MESSAGE,
  );
});
