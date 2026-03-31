import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("config", () => {
  const originalEnv = { ...process.env };
  let importCounter = 0;

  beforeEach(() => {
    // Reset environment to a clean state with required token
    process.env = { ...originalEnv };
    process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";
    importCounter++;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importConfig() {
    // Use query string to bust module cache for each test
    const module = await import(`../utils/config.js?t=${importCounter}`);
    return module.config;
  }

  describe("KLAID_TELEGRAM_BOT_TOKEN", () => {
    it("should throw error when KLAID_TELEGRAM_BOT_TOKEN is missing", async () => {
      process.env.KLAID_TELEGRAM_BOT_TOKEN = undefined;

      await assert.rejects(
        async () => {
          importCounter++;
          await import(`../utils/config.js?t=${importCounter}`);
        },
        { message: "KLAID_TELEGRAM_BOT_TOKEN is required" },
      );
    });

    it("should accept KLAID_TELEGRAM_BOT_TOKEN when provided", async () => {
      process.env.KLAID_TELEGRAM_BOT_TOKEN = "my-bot-token";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_TELEGRAM_BOT_TOKEN, "my-bot-token");
    });
  });

  describe("NODE_ENV validation", () => {
    it("should accept 'production' as NODE_ENV", async () => {
      process.env.NODE_ENV = "production";
      const config = await importConfig();
      assert.strictEqual(config.NODE_ENV, "production");
    });

    it("should accept 'development' as NODE_ENV", async () => {
      process.env.NODE_ENV = "development";
      const config = await importConfig();
      assert.strictEqual(config.NODE_ENV, "development");
    });

    it("should accept 'test' as NODE_ENV", async () => {
      process.env.NODE_ENV = "test";
      const config = await importConfig();
      assert.strictEqual(config.NODE_ENV, "test");
    });

    it("should default to 'development' when NODE_ENV is not set", async () => {
      process.env.NODE_ENV = undefined;
      const config = await importConfig();
      assert.strictEqual(config.NODE_ENV, "development");
    });

    it("should throw for invalid NODE_ENV value", async () => {
      process.env.NODE_ENV = "invalid";

      await assert.rejects(async () => {
        importCounter++;
        await import(`../utils/config.js?t=${importCounter}`);
      }, /Invalid value: invalid/);
    });
  });

  describe("KLAID_AUTO_DL_URLS parsing", () => {
    it("should parse valid JSON array", async () => {
      process.env.KLAID_AUTO_DL_URLS = '["custom.com", "other.com"]';
      const config = await importConfig();
      assert.deepStrictEqual(config.KLAID_AUTO_DL_URLS, ["custom.com", "other.com"]);
    });

    it("should use default when value is undefined", async () => {
      process.env.KLAID_AUTO_DL_URLS = undefined;
      const config = await importConfig();
      assert.deepStrictEqual(config.KLAID_AUTO_DL_URLS, ["tiktok.com", "youtube.com/shorts/", "instagram.com/reel/"]);
    });

    it("should use default when JSON is invalid", async () => {
      process.env.KLAID_AUTO_DL_URLS = "not-valid-json";
      const config = await importConfig();
      assert.deepStrictEqual(config.KLAID_AUTO_DL_URLS, ["tiktok.com", "youtube.com/shorts/", "instagram.com/reel/"]);
    });

    it("should handle empty array", async () => {
      process.env.KLAID_AUTO_DL_URLS = "[]";
      const config = await importConfig();
      assert.deepStrictEqual(config.KLAID_AUTO_DL_URLS, []);
    });
  });

  describe("KLAID_AUTO_DL_DELETE_MESSAGE parsing", () => {
    it("should parse 'true' string as true", async () => {
      process.env.KLAID_AUTO_DL_DELETE_MESSAGE = "true";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_AUTO_DL_DELETE_MESSAGE, true);
    });

    it("should parse 'TRUE' (uppercase) as true", async () => {
      process.env.KLAID_AUTO_DL_DELETE_MESSAGE = "TRUE";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_AUTO_DL_DELETE_MESSAGE, true);
    });

    it("should parse 'false' string as false", async () => {
      process.env.KLAID_AUTO_DL_DELETE_MESSAGE = "false";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_AUTO_DL_DELETE_MESSAGE, false);
    });

    it("should parse any non-true value as false", async () => {
      process.env.KLAID_AUTO_DL_DELETE_MESSAGE = "yes";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_AUTO_DL_DELETE_MESSAGE, false);
    });

    it("should use default (true) when undefined", async () => {
      process.env.KLAID_AUTO_DL_DELETE_MESSAGE = undefined;
      const config = await importConfig();
      assert.strictEqual(config.KLAID_AUTO_DL_DELETE_MESSAGE, true);
    });
  });

  describe("default values", () => {
    it("should use default KLAID_LOG_LEVEL of 'info'", async () => {
      process.env.KLAID_LOG_LEVEL = undefined;
      const config = await importConfig();
      assert.strictEqual(config.KLAID_LOG_LEVEL, "info");
    });

    it("should use custom KLAID_LOG_LEVEL when provided", async () => {
      process.env.KLAID_LOG_LEVEL = "debug";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_LOG_LEVEL, "debug");
    });

    it("should use default KLAID_DOWNLOAD_DIR of '/tmp'", async () => {
      process.env.KLAID_DOWNLOAD_DIR = undefined;
      const config = await importConfig();
      assert.strictEqual(config.KLAID_DOWNLOAD_DIR, "/tmp");
    });

    it("should use custom KLAID_DOWNLOAD_DIR when provided", async () => {
      process.env.KLAID_DOWNLOAD_DIR = "/custom/dir";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_DOWNLOAD_DIR, "/custom/dir");
    });

    it("should use empty string for KLAID_TELEGRAM_API_ROOT by default", async () => {
      process.env.KLAID_TELEGRAM_API_ROOT = undefined;
      const config = await importConfig();
      assert.strictEqual(config.KLAID_TELEGRAM_API_ROOT, "");
    });

    it("should use custom KLAID_TELEGRAM_API_ROOT when provided", async () => {
      process.env.KLAID_TELEGRAM_API_ROOT = "https://custom.api.com";
      const config = await importConfig();
      assert.strictEqual(config.KLAID_TELEGRAM_API_ROOT, "https://custom.api.com");
    });
  });
});
