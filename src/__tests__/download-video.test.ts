import assert from "node:assert";
import { describe, it } from "node:test";
import { createMockContext } from "./utils/mock-context.js";
import { createMockLogger } from "./utils/mock-logger.js";

// Set required env var before tests run
process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";

describe("download-video", () => {
  describe("yt-dlp arguments", () => {
    it("should retry without browser impersonation", async () => {
      const { buildYtDlpRequestAttempts } = await import("../download-video.js");
      const args = ["--dump-json", "https://example.com/video"];

      assert.deepStrictEqual(buildYtDlpRequestAttempts(args), [["--impersonate", "chrome", ...args], args]);
    });

    it("should prefer Telegram-compatible H.264 video within the size limit", async () => {
      const { buildYtDlpDownloadArgs } = await import("../download-video.js");
      const args = buildYtDlpDownloadArgs("/tmp/downloads", "video", "https://example.com/video");

      const formatSortIndex = args.indexOf("--format-sort");
      const maxFilesizeIndex = args.indexOf("--max-filesize");
      assert.strictEqual(args[formatSortIndex + 1], "vcodec:h264");
      assert.strictEqual(args[maxFilesizeIndex + 1], "50M");
      assert.ok(args.includes("--merge-output-format"));
      assert.ok(args.includes("mp4"));
    });

    it("should recognize TikTok domains for the video fallback", async () => {
      const { isTikTokUrl } = await import("../download-video.js");

      assert.strictEqual(isTikTokUrl("https://vm.tiktok.com/abc"), true);
      assert.strictEqual(isTikTokUrl("https://www.tiktok.com/@user/video/123"), true);
      assert.strictEqual(isTikTokUrl("https://example.com/tiktok.com/video"), false);
      assert.strictEqual(isTikTokUrl("not a URL"), false);
    });
  });

  describe("VideoDownloadError", () => {
    it("should create error with videoUrl and message", async () => {
      const { VideoDownloadError } = await import("../download-video.js");
      const error = new VideoDownloadError("https://example.com", "Download failed");

      assert.strictEqual(error.videoUrl, "https://example.com");
      assert.strictEqual(error.message, "Download failed");
      assert.strictEqual(
        error.userMessage,
        "The source site rejected the download request, or the media is private or unavailable. Please try again later.",
      );
      assert.strictEqual(error.name, "VideoDownloadError");
    });

    it("should use default message when null provided", async () => {
      const { VideoDownloadError } = await import("../download-video.js");
      const error = new VideoDownloadError("https://example.com", null);

      assert.strictEqual(error.message, "Failed to download video");
    });

    it("should keep technical downloader details out of the user-facing message", async () => {
      const { VideoDownloadError } = await import("../download-video.js");
      const error = new VideoDownloadError(
        "https://example.com",
        "Video download failed: Command failed: yt-dlp ...\nGallery download failed: No images found in gallery",
      );

      assert.doesNotMatch(error.userMessage, /yt-dlp|gallery/i);
    });
  });

  describe("downloadMediaFromMessage", () => {
    it("should return early when no URLs found in message", async () => {
      const { downloadMediaFromMessage } = await import("../download-video.js");
      const { ctx, mocks } = createMockContext({ messageText: "Hello world no urls here" });
      const logger = createMockLogger();
      const message = ctx.message;
      assert.ok(message, "Message should exist");

      await downloadMediaFromMessage(message, "Hello world no urls here", logger, ctx, undefined, false);

      // No media should be sent since no URLs found
      assert.strictEqual(mocks.replyWithMediaGroup.calls.length, 0);
      assert.strictEqual(mocks.reply.calls.length, 0);
    });

    it("should return early when URLs dont match whitelist", async () => {
      const { downloadMediaFromMessage } = await import("../download-video.js");
      const { ctx, mocks } = createMockContext({ messageText: "Check https://example.com" });
      const logger = createMockLogger();
      const message = ctx.message;
      assert.ok(message, "Message should exist");

      await downloadMediaFromMessage(
        message,
        "Check https://example.com",
        logger,
        ctx,
        ["tiktok.com"], // whitelist that won't match
        false,
      );

      // No media should be sent since URL doesn't match whitelist
      assert.strictEqual(mocks.replyWithMediaGroup.calls.length, 0);
    });

    it("should not delete original message when autoDeleteMessage is false", async () => {
      const { downloadMediaFromMessage } = await import("../download-video.js");
      const { ctx, mocks } = createMockContext({ messageText: "Hello no urls" });
      const logger = createMockLogger();
      const message = ctx.message;
      assert.ok(message, "Message should exist");

      await downloadMediaFromMessage(message, "Hello no urls", logger, ctx, undefined, false);

      // deleteMessage should NOT be called when autoDeleteMessage is false
      assert.strictEqual(mocks.deleteMessage.calls.length, 0);
    });

    it("should format caption with @username", async () => {
      const { ctx } = createMockContext({
        messageText: "test",
        username: "testuser",
      });

      // Verify username extraction logic
      const username = ctx.message?.from?.username;
      const user = username ? `@${username}` : "";
      assert.strictEqual(user, "@testuser");
    });

    it("should format caption with first/last name when no username", async () => {
      const { ctx } = createMockContext({
        messageText: "test",
        firstName: "John",
        lastName: "Doe",
        username: undefined,
      });

      // Verify name extraction logic
      const username = ctx.message?.from?.username;
      const firstLastName = [ctx.message?.from?.first_name, ctx.message?.from?.last_name].filter(Boolean).join(" ");
      const user = username ? `@${username}` : firstLastName;
      assert.strictEqual(user, "John Doe");
    });

    it("should use whitelist filter when provided", async () => {
      const { downloadMediaFromMessage } = await import("../download-video.js");
      const { ctx, mocks } = createMockContext();
      const logger = createMockLogger();
      const message = ctx.message;
      assert.ok(message, "Message should exist");

      // Pass a whitelist that won't match any URL
      await downloadMediaFromMessage(message, "Check https://example.com", logger, ctx, ["nomatch.com"], false);

      // Nothing should happen since no URLs match
      assert.strictEqual(mocks.replyWithMediaGroup.calls.length, 0);
    });

    it("should not call deleteMessage when no URLs found", async () => {
      const { downloadMediaFromMessage } = await import("../download-video.js");
      const { ctx, mocks } = createMockContext();
      const logger = createMockLogger();
      const message = ctx.message;
      assert.ok(message, "Message should exist");

      await downloadMediaFromMessage(message, "no urls here", logger, ctx, undefined, true);

      // deleteMessage should not be called when there are no URLs
      assert.strictEqual(mocks.deleteMessage.calls.length, 0);
    });
  });
});
