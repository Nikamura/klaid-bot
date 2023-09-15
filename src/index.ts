import { bot } from "./bot";
import { logger } from "./utils/logger";

await bot.start({
  onStart: (botInfo) => {
    logger.info(`Bot @${botInfo.username} started!`);
  },
});
