import convict from "convict";

export const config = convict({
  NODE_ENV: {
    default: "development",
    doc: "The application environment.",
    env: "NODE_ENV",
    format: ["production", "development", "test"],
  },
  KLAID_TELEGRAM_BOT_TOKEN: {
    default: null,
    doc: "Telegram bot token.",
    env: "KLAID_TELEGRAM_BOT_TOKEN",
    format: String,
  },
  KLAID_LOG_LEVEL: {
    default: "info",
    doc: "The application log level.",
    env: "KLAID_LOG_LEVEL",
    format: String,
  },
  KLAID_DOWNLOAD_DIR: {
    default: "/tmp",
    doc: "The directory where the files will be downloaded to.",
    env: "KLAID_DOWNLOAD_DIR",
    format: String,
  },
  KLAID_AUTO_DL_URLS: {
    default: ["tiktok.com", "youtube.com/shorts/", "instagram.com/reel/"],
    doc: "The urls to download automatically.",
    env: "KLAID_AUTO_DL_URLS",
    format: Array,
  },
  KLAID_AUTO_DL_DELETE_MESSAGE: {
    default: true,
    doc: "Whether to delete the original message if it includes AUDO_DL video.",
    env: "KLAID_AUTO_DL_DELETE_MESSAGE",
    format: Boolean,
  },
  KLAID_TELEGRAM_API_ROOT: {
    default: "",
    env: "KLAID_TELEGRAM_API_ROOT",
    format: String,
  },
});

config.validate({ allowed: "strict" });
