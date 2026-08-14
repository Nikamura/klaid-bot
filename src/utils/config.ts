type ConfigFormat = "production" | "development" | "test";

interface ConfigSchema {
  NODE_ENV: ConfigFormat;
  KLAID_TELEGRAM_BOT_TOKEN: string;
  KLAID_LOG_LEVEL: string;
  KLAID_DOWNLOAD_DIR: string;
  KLAID_AUTO_DL_URLS: string[];
  KLAID_AUTO_DL_DELETE_MESSAGE: boolean;
  KLAID_TELEGRAM_API_ROOT: string;
}

class Config {
  private config: ConfigSchema;

  constructor() {
    this.config = {
      NODE_ENV: this.validateEnumValue((process.env.NODE_ENV as ConfigFormat) || "development", [
        "production",
        "development",
        "test",
      ]),
      KLAID_TELEGRAM_BOT_TOKEN:
        process.env.KLAID_TELEGRAM_BOT_TOKEN ||
        (() => {
          throw new Error("KLAID_TELEGRAM_BOT_TOKEN is required");
        })(),
      KLAID_LOG_LEVEL: process.env.KLAID_LOG_LEVEL || "info",
      KLAID_DOWNLOAD_DIR: process.env.KLAID_DOWNLOAD_DIR || "/tmp",
      KLAID_AUTO_DL_URLS: this.parseArrayValue(process.env.KLAID_AUTO_DL_URLS, [
        "tiktok.com",
        "youtube.com/shorts/",
        "instagram.com/reel/",
      ]),
      KLAID_AUTO_DL_DELETE_MESSAGE: this.parseBooleanValue(process.env.KLAID_AUTO_DL_DELETE_MESSAGE, true),
      KLAID_TELEGRAM_API_ROOT: process.env.KLAID_TELEGRAM_API_ROOT || "",
    };
  }

  private validateEnumValue<T extends string>(value: T, allowedValues: T[]): T {
    if (!value || !allowedValues.includes(value)) {
      throw new Error(`Invalid value: ${value}. Allowed values: ${allowedValues.join(", ")}`);
    }
    return value;
  }

  private parseArrayValue(value: string | undefined, defaultValue: string[]): string[] {
    if (!value) return defaultValue;
    try {
      return JSON.parse(value);
    } catch {
      return defaultValue;
    }
  }

  private parseBooleanValue(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true";
  }

  public get(): ConfigSchema {
    return this.config;
  }
}

export const config = new Config().get();
