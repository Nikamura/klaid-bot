import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it, type TestContext } from "node:test";
import { InputFile } from "grammy";
import { createMockContext } from "./utils/mock-context.js";
import { createMockLogger } from "./utils/mock-logger.js";

const downloadDir = mkdtempSync(join(tmpdir(), "klaid-status-"));
process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";
process.env.KLAID_DOWNLOAD_DIR = downloadDir;
after(() => rmSync(downloadDir, { recursive: true, force: true }));

async function setup(
  t: TestContext,
  mode: "video" | "gallery" | "photo" | "failure" = "video",
  messageText = "https://example.com/video",
) {
  const events: string[] = [];
  const edits: unknown[][] = [];
  const mediaEdits: unknown[][] = [];
  const deletions: unknown[][] = [];
  const { ctx, mocks } = createMockContext({ messageText });
  const message = ctx.message;
  assert.ok(message);
  const reply = t.mock.method(ctx, "reply", async () => {
    events.push("status");
    return { ...message, message_id: 999 };
  });
  t.mock.method(ctx, "deleteMessage", async () => {
    events.push("delete");
    return true;
  });
  t.mock.method(ctx, "replyWithMediaGroup", async (...args: Parameters<typeof ctx.replyWithMediaGroup>) => {
    events.push("media");
    assert.equal(args[1]?.reply_parameters?.message_id, events.includes("delete") ? undefined : message.message_id);
    return [];
  });
  Object.assign(ctx, {
    replyWithVideo: async () => {
      events.push("media");
      return message;
    },
    replyWithPhoto: async () => {
      events.push("media");
      return message;
    },
    api: {
      editMessageMedia: async (...args: unknown[]) => {
        events.push("replace");
        mediaEdits.push(args);
        return message;
      },
      deleteMessage: async (...args: unknown[]) => {
        events.push("delete-status");
        deletions.push(args);
        return true;
      },
      editMessageText: async (...args: unknown[]) => {
        events.push("edit");
        edits.push(args);
        return true;
      },
    },
  });
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    events.push("download");
    const executable = args[0];
    const flags = args[1] as string[];
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    if (mode === "failure" || ((mode === "gallery" || mode === "photo") && executable !== "gallery-dl")) {
      callback(new Error("Source rejected download"), "", "Source rejected download");
    } else if (executable === "gallery-dl") {
      const directory = flags[flags.indexOf("-d") + 1];
      writeFileSync(join(directory, "1.jpg"), "photo");
      if (mode === "gallery") writeFileSync(join(directory, "2.jpg"), "photo");
      callback(null, "", "");
    } else if (flags.includes("--dump-json")) {
      callback(null, JSON.stringify({ title: "Test video", duration: 600 }), "");
    } else {
      const output = flags[flags.indexOf("-o") + 1];
      writeFileSync(output.replace("%(ext)s", "mp4"), "video");
      if (flags.includes("--write-thumbnail")) writeFileSync(output.replace("%(ext)s", "jpg"), "cover");
      callback(null, "", "");
    }
    return { stdin: { end() {} } };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const { downloadMediaFromMessage } = await import("../download-video.js");
  const run = (autoDelete = true) =>
    downloadMediaFromMessage(message, message.text ?? "", createMockLogger(), ctx, undefined, autoDelete);
  return { ctx, mocks, message, events, edits, mediaEdits, deletions, reply, run };
}

it("posts a silent status before downloading and replaces it with the video", async (t) => {
  const { run, events, mediaEdits, deletions, reply } = await setup(t);
  await run();
  assert.deepEqual(events.slice(0, 3), ["delete", "status", "download"]);
  assert.equal(events.at(-1), "replace");
  assert.equal(events.includes("media"), false);
  assert.match(String(reply.mock.calls[0].arguments[0]), /Downloading… Your media will appear shortly/);
  assert.match(String(reply.mock.calls[0].arguments[0]), /@testuser: https:\/\/example.com\/video/);
  assert.equal(reply.mock.calls[0].arguments[1]?.disable_notification, true);
  assert.deepEqual(mediaEdits[0].slice(0, 2), [456, 999]);
  assert.equal((mediaEdits[0][2] as { type: string }).type, "video");
  assert.match((mediaEdits[0][2] as { caption: string }).caption, /@testuser: https:\/\/example.com\/video/);
  assert.deepEqual(deletions, []);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("deletes the status only after gallery delivery", async (t) => {
  const { run, events, edits, deletions } = await setup(t, "gallery");
  await run();
  assert.deepEqual(events.slice(-2), ["media", "delete-status"]);
  assert.deepEqual(deletions, [[456, 999]]);
  assert.deepEqual(edits, []);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("edits the status to a download error instead of leaving it pending", async (t) => {
  const { run, events, edits, reply } = await setup(t, "failure");
  await run();
  assert.equal(events.includes("media"), false);
  assert.equal(reply.mock.callCount(), 1);
  assert.match(String(edits[0][2]), /Couldn't download media/);
});

it("edits the status on upload failure and still removes downloaded files", async (t) => {
  const { run, ctx, edits, deletions } = await setup(t, "gallery");
  t.mock.method(ctx, "replyWithMediaGroup", async () => {
    throw new Error("Upload failed");
  });
  await run();
  assert.match(String(edits[0][2]), /Couldn't send all media/);
  assert.deepEqual(deletions, []);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("does not add a status when keeping the original message", async (t) => {
  const { run, events, edits } = await setup(t);
  await run(false);
  assert.equal(events.includes("delete"), false);
  assert.equal(events.includes("status"), false);
  assert.deepEqual(edits, []);
});

it("does not add a status when deletion fails", async (t) => {
  const { run, ctx, events } = await setup(t);
  t.mock.method(ctx, "deleteMessage", async () => {
    throw new Error("Missing permission");
  });
  await run();
  assert.equal(events.includes("status"), false);
  assert.ok(events.includes("media"));
});

it("continues downloading if posting the status fails", async (t) => {
  const { run, ctx, events } = await setup(t);
  t.mock.method(ctx, "reply", async () => {
    throw new Error("Status unavailable");
  });
  await run();
  assert.ok(events.includes("media"));
});

it("sends a fallback notice if the status can no longer be edited", async (t) => {
  const { run, ctx, reply } = await setup(t, "failure");
  t.mock.method(ctx.api, "editMessageText", async () => {
    throw new Error("Message deleted");
  });
  await run();
  assert.equal(reply.mock.callCount(), 2);
  assert.match(String(reply.mock.calls[1].arguments[0]), /Couldn't download media/);
});

it("keeps the status in the original topic and within Telegram's text limit", async (t) => {
  const { run, message, reply } = await setup(t);
  message.message_thread_id = 42;
  message.text = `https://example.com/video ${"x".repeat(4050)}`;
  await run();
  assert.equal(reply.mock.calls[0].arguments[1]?.message_thread_id, 42);
  assert.ok(String(reply.mock.calls[0].arguments[0]).length <= 4096);
});

it("replaces the status with a single photo", async (t) => {
  const { run, mediaEdits, events } = await setup(t, "photo");
  await run();
  assert.equal((mediaEdits[0][2] as { type: string }).type, "photo");
  assert.equal(events.includes("media"), false);
  assert.equal(events.includes("delete-status"), false);
});

it("sends separately then deletes the status when attaching media fails", async (t) => {
  const { run, ctx, events, deletions } = await setup(t);
  t.mock.method(ctx.api, "editMessageMedia", async () => {
    throw new Error("Cannot edit message");
  });
  await run();
  assert.deepEqual(events.slice(-2), ["media", "delete-status"]);
  assert.deepEqual(deletions, [[456, 999]]);
});

it("clears the pending text if status deletion fails after successful delivery", async (t) => {
  const { run, ctx, events, edits } = await setup(t, "gallery");
  t.mock.method(ctx.api, "deleteMessage", async () => {
    throw new Error("Cannot delete message");
  });
  await run();
  assert.deepEqual(events.slice(-2), ["media", "edit"]);
  assert.match(String(edits[0][2]), /Ready!/);
});

it("sends the yt-dlp thumbnail as the cover and starts at the linked time", async (t) => {
  const { run, mediaEdits } = await setup(t, "video", "https://example.com/video?t=1m30s");
  await run();
  const media = mediaEdits[0][2] as { cover?: unknown; start_timestamp?: number };
  assert.ok(media.cover instanceof InputFile);
  assert.equal(media.start_timestamp, 90);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("ignores a linked time beyond the end of the video", async (t) => {
  const { run, mediaEdits } = await setup(t, "video", "https://example.com/video?t=601");
  await run();
  assert.equal((mediaEdits[0][2] as { start_timestamp?: number }).start_timestamp, undefined);
});
