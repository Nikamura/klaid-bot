import { bot } from "./bot.js";
import { logger } from "./utils/logger.js";

await bot.start({
  onStart: (botInfo) => {
    logger.info(`Bot @${botInfo.username} started!`);
  },
});
