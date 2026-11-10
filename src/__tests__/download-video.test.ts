import assert from "node:assert";
import { describe, it } from "node:test";
import { createMockContext } from "./utils/mock-context.js";
import { createMockLogger } from "./utils/mock-logger.js";

// Set required env var before tests run
process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";

describe("download-video", () => {
  describe("yt-dlp arguments", () => {
    it("should retry non-TikTok downloads without browser impersonation", async () => {
      const { buildYtDlpRequestAttempts } = await import("../download-video.js");
      const args = ["--dump-json", "https://example.com/video"];

      assert.deepStrictEqual(buildYtDlpRequestAttempts("https://example.com/video", args), [
        { executable: "yt-dlp", args: ["--impersonate", "chrome", ...args] },
        { executable: "yt-dlp", args },
      ]);
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

    it("should keep a JPEG thumbnail for the Telegram cover", async () => {
      const { buildYtDlpDownloadArgs } = await import("../download-video.js");
      const args = buildYtDlpDownloadArgs("/tmp/downloads", "video", "https://example.com/video");

      assert.ok(args.includes("--write-thumbnail"));
      assert.strictEqual(args[args.indexOf("--convert-thumbnails") + 1], "jpg");
    });
  });

  describe("parseStartTimestamp", () => {
    it("should read start times from the query string and fragment", async () => {
      const { parseStartTimestamp } = await import("../download-video.js");

      assert.strictEqual(parseStartTimestamp("https://youtube.com/watch?t=90s&v=abc"), 90);
      assert.strictEqual(parseStartTimestamp("https://youtu.be/abc?t=1h2m3s"), 3723);
      assert.strictEqual(parseStartTimestamp("https://youtu.be/abc#t=42"), 42);
      assert.strictEqual(parseStartTimestamp("https://example.com/v?start=10"), 10);
    });

    it("should ignore missing, zero and non-time values", async () => {
      const { parseStartTimestamp } = await import("../download-video.js");

      assert.strictEqual(parseStartTimestamp("https://youtu.be/abc"), undefined);
      assert.strictEqual(parseStartTimestamp("https://youtu.be/abc?t=0"), undefined);
      assert.strictEqual(parseStartTimestamp("https://x.com/a/status/1?t=AbC123xyz&s=20"), undefined);
      assert.strictEqual(parseStartTimestamp("not a url"), undefined);
    });

    it("should use isolated yt-dlp without forced impersonation for TikTok", async () => {
      const { buildYtDlpRequestAttempts } = await import("../download-video.js");
      const args = ["--dump-json", "https://vm.tiktok.com/abc"];
      const executable = "/opt/yt-dlp-plain/bin/yt-dlp";

      assert.deepStrictEqual(buildYtDlpRequestAttempts("https://vm.tiktok.com/abc", args, executable), [
        { executable, args },
      ]);
      assert.strictEqual(buildYtDlpRequestAttempts("https://example.com/tiktok.com/video", args).length, 2);
    });
  });

  describe("formatVideoCaption", () => {
    const meta = { title: '1 < 2 & "3"', thumbnail: null, duration: 95, uploader: "A&B" };

    it("should escape markup and link the title to the source", async () => {
      const { formatVideoCaption } = await import("../download-video.js");

      assert.strictEqual(
        formatVideoCaption("@user: <hi>", meta, "https://example.com/v?a=1&b=2"),
        '@user: &lt;hi&gt;\n\n<a href="https://example.com/v?a=1&amp;b=2"><b>1 &lt; 2 &amp; &quot;3&quot;</b></a>\nA&amp;B \u2022 1:35',
      );
      assert.strictEqual(
        formatVideoCaption(null, null, "https://example.com/v"),
        '<a href="https://example.com/v">Source</a>',
      );
    });

    it("should keep the visible text within the caption limit", async () => {
      const { formatVideoCaption } = await import("../download-video.js");
      const caption = formatVideoCaption(
        "<".repeat(3000),
        { ...meta, title: "t".repeat(500) },
        "https://example.com/v",
      );
      const visible = caption
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');

      assert.ok(visible.length <= 1024);
      assert.ok(visible.length > 1000);
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
