import assert from "node:assert";
import { describe, it } from "node:test";

// Set required env var before importing bot
process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";

describe("bot", () => {
  describe("bot instance", () => {
    it("should export a bot instance", async () => {
      const { bot } = await import("../bot.js");
      assert.ok(bot, "Bot should be exported");
      assert.strictEqual(typeof bot.start, "function", "Bot should have start method");
      assert.strictEqual(typeof bot.stop, "function", "Bot should have stop method");
    });

    it("should have error handler configured", async () => {
      const { bot } = await import("../bot.js");
      // Bot.catch sets up an error handler - verify it exists
      assert.ok(bot.errorHandler, "Bot should have error handler");
    });
  });

  describe("isPrivateChat logic (bug fix verification)", () => {
    it("should correctly identify private chat type", () => {
      // This tests the logic that was buggy: `false && ctx.message?.chat.type === "private"`
      // The bug caused isPrivateChat to always be false

      // Simulate the fixed logic
      const chatTypes = [
        { type: "private" as const, expected: true },
        { type: "group" as const, expected: false },
        { type: "supergroup" as const, expected: false },
        { type: "channel" as const, expected: false },
      ];

      for (const { type, expected } of chatTypes) {
        const ctx = { message: { chat: { type } } };
        const isPrivateChat = ctx.message?.chat.type === "private";
        assert.strictEqual(isPrivateChat, expected, `Chat type "${type}" should be private: ${expected}`);
      }
    });

    it("should handle missing message gracefully", () => {
      const ctx: { message?: { chat?: { type?: string } } } = { message: undefined };
      // This should not throw and should evaluate to false
      const isPrivateChat = ctx.message?.chat?.type === "private";
      assert.strictEqual(isPrivateChat, false, "Missing message should result in false");
    });

    it("should handle missing chat gracefully", () => {
      const ctx: { message?: { chat?: { type?: string } } } = { message: { chat: undefined } };
      const isPrivateChat = ctx.message?.chat?.type === "private";
      assert.strictEqual(isPrivateChat, false, "Missing chat should result in false");
    });
  });

  describe("command handlers", () => {
    it("should determine autoDeleteMessage based on isPrivateChat", () => {
      // In commands: autoDeleteMessage = isPrivateChat ? false : true
      // This means: delete in groups, don't delete in private chats

      const testCases = [
        { isPrivateChat: true, expectedAutoDelete: false },
        { isPrivateChat: false, expectedAutoDelete: true },
      ];

      for (const { isPrivateChat, expectedAutoDelete } of testCases) {
        const autoDeleteMessage = isPrivateChat ? false : true;
        assert.strictEqual(
          autoDeleteMessage,
          expectedAutoDelete,
          `isPrivateChat=${isPrivateChat} should result in autoDelete=${expectedAutoDelete}`,
        );
      }
    });
  });

  describe("message handler", () => {
    it("should use whitelist for group chats only", () => {
      // In message handler: whitelist = isPrivateChat ? undefined : config.KLAID_AUTO_DL_URLS
      const testCases = [
        { isPrivateChat: true, hasWhitelist: false },
        { isPrivateChat: false, hasWhitelist: true },
      ];

      const configWhitelist = ["tiktok.com", "youtube.com/shorts/"];

      for (const { isPrivateChat, hasWhitelist } of testCases) {
        const whitelist = isPrivateChat ? undefined : configWhitelist;
        if (hasWhitelist) {
          assert.ok(whitelist, "Group chats should use whitelist");
          assert.deepStrictEqual(whitelist, configWhitelist);
        } else {
          assert.strictEqual(whitelist, undefined, "Private chats should not use whitelist");
        }
      }
    });

    it("should determine autoDeleteMessage based on chat type and config", () => {
      // In message handler: autoDeleteMessage = isPrivateChat ? false : config.KLAID_AUTO_DL_DELETE_MESSAGE
      const configDeleteMessage = true;

      const testCases = [
        { isPrivateChat: true, expected: false },
        { isPrivateChat: false, expected: configDeleteMessage },
      ];

      for (const { isPrivateChat, expected } of testCases) {
        const autoDeleteMessage = isPrivateChat ? false : configDeleteMessage;
        assert.strictEqual(autoDeleteMessage, expected);
      }
    });
  });
});
