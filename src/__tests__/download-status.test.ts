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
  const videos: unknown[][] = [];
  const deletions: unknown[][] = [];
  const { ctx, mocks } = createMockContext({ messageText });
  const message = ctx.message;
  assert.ok(message);
  const reply = t.mock.method(ctx, "reply", async (...args: Parameters<typeof ctx.reply>) => {
    const ephemeral = args[1]?.ephemeral_message_parameters !== undefined;
    events.push(ephemeral ? "status" : "public");
    return { ...message, message_id: ephemeral ? 0 : 1000, ephemeral_message_id: ephemeral ? 999 : undefined };
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
    replyWithVideo: async (...args: unknown[]) => {
      events.push("media");
      videos.push(args);
      return message;
    },
    replyWithPhoto: async () => {
      events.push("media");
      return message;
    },
    api: {
      deleteMessage: async () => {
        events.push("delete-public");
        return true;
      },
      deleteEphemeralMessage: async (...args: unknown[]) => {
        events.push("delete-status");
        deletions.push(args);
        return true;
      },
      editEphemeralMessageText: async (...args: unknown[]) => {
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
  return { ctx, mocks, message, events, edits, videos, deletions, reply, run };
}

type VideoOptions = { caption?: string; cover?: unknown; start_timestamp?: number; reply_parameters?: unknown };

it("shows the status only to the author and removes it once the video is delivered", async (t) => {
  const { run, events, videos, deletions, reply } = await setup(t);
  await run();
  assert.deepEqual(events.slice(0, 2), ["status", "download"]);
  assert.deepEqual(events.slice(-3), ["delete", "media", "delete-status"]);
  assert.equal(events.includes("public"), false);
  assert.equal(reply.mock.calls[0].arguments[0], "Downloading… Your media will appear shortly.");
  assert.deepEqual(reply.mock.calls[0].arguments[1]?.ephemeral_message_parameters, { receiver_user_id: 789 });
  assert.equal(reply.mock.calls[0].arguments[1]?.disable_notification, true);
  const options = videos[0][1] as VideoOptions;
  assert.match(String(options.caption), /@testuser: https:\/\/example.com\/video/);
  assert.equal(options.reply_parameters, undefined);
  assert.deepEqual(deletions, [[456, 789, 999]]);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("removes the status after gallery delivery", async (t) => {
  const { run, events, edits, deletions } = await setup(t, "gallery");
  await run();
  assert.deepEqual(events.slice(-3), ["delete", "media", "delete-status"]);
  assert.deepEqual(deletions, [[456, 789, 999]]);
  assert.deepEqual(edits, []);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("tells only the author about a failed download and keeps their message", async (t) => {
  const { run, events, edits, reply } = await setup(t, "failure");
  await run();
  assert.equal(events.includes("media"), false);
  assert.equal(events.includes("delete"), false);
  assert.equal(events.includes("public"), false);
  assert.equal(reply.mock.callCount(), 1);
  assert.deepEqual(edits[0].slice(0, 3), [456, 789, 999]);
  assert.match(String(edits[0][3]), /^Couldn't download media/);
  assert.doesNotMatch(String(edits[0][3]), /@testuser/);
});

it("reports an upload failure with the deleted link and still removes downloaded files", async (t) => {
  const { run, ctx, events, edits, deletions } = await setup(t, "gallery");
  t.mock.method(ctx, "replyWithMediaGroup", async () => {
    throw new Error("Upload failed");
  });
  await run();
  assert.match(String(edits[0][3]), /Couldn't send all media/);
  assert.match(String(edits[0][3]), /@testuser: https:\/\/example.com\/video/);
  assert.equal(events.includes("public"), false);
  assert.deepEqual(deletions, []);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("sends a failure privately without a status when keeping the original message", async (t) => {
  const { run, events, reply } = await setup(t, "failure");
  await run(false);
  assert.deepEqual(
    events.filter((event) => event !== "download"),
    ["status"],
  );
  assert.match(String(reply.mock.calls[0].arguments[0]), /Couldn't download media/);
});

it("does not add a status when keeping the original message", async (t) => {
  const { run, events, videos } = await setup(t);
  await run(false);
  assert.equal(events.includes("delete"), false);
  assert.equal(events.includes("status"), false);
  assert.notEqual((videos[0][1] as VideoOptions).reply_parameters, undefined);
});

it("replies to the original message when it cannot be deleted", async (t) => {
  const { run, ctx, events, videos } = await setup(t);
  t.mock.method(ctx, "deleteMessage", async () => {
    throw new Error("Missing permission");
  });
  await run();
  assert.ok(events.includes("media"));
  const options = videos[0][1] as VideoOptions;
  assert.notEqual(options.reply_parameters, undefined);
  assert.doesNotMatch(String(options.caption), /@testuser/);
});

it("falls back to a public failure reply when ephemeral messages are refused", async (t) => {
  const { run, ctx, message, events } = await setup(t, "failure");
  const reply = t.mock.method(ctx, "reply", async (...args: Parameters<typeof ctx.reply>) => {
    if (args[1]?.ephemeral_message_parameters) throw new Error("Not enough rights");
    events.push("public");
    return message;
  });
  await run();
  // The refused status is not retried for the failure notice.
  assert.equal(reply.mock.callCount(), 2);
  assert.match(String(reply.mock.calls[1].arguments[0]), /Couldn't download media/);
  assert.equal(reply.mock.calls[1].arguments[1]?.reply_parameters?.message_id, message.message_id);
  assert.equal(events.includes("delete"), false);
});

it("still delivers media when ephemeral messages are refused", async (t) => {
  const { run, ctx, events } = await setup(t);
  t.mock.method(ctx, "reply", async () => {
    throw new Error("Not enough rights");
  });
  await run();
  assert.deepEqual(events.slice(-2), ["delete", "media"]);
});

it("takes back a status that an old Bot API server posted publicly", async (t) => {
  const { run, ctx, message, events } = await setup(t);
  t.mock.method(ctx, "reply", async () => ({ ...message, message_id: 1000 }));
  await run();
  assert.deepEqual(events, ["delete-public", "download", "download", "delete", "media"]);
});

it("sends a new private notice if the status can no longer be edited", async (t) => {
  const { run, ctx, events, reply } = await setup(t, "failure");
  t.mock.method(ctx.api, "editEphemeralMessageText", async () => {
    throw new Error("Message expired");
  });
  await run();
  assert.equal(reply.mock.callCount(), 2);
  assert.match(String(reply.mock.calls[1].arguments[0]), /Couldn't download media/);
  assert.equal(events.includes("public"), false);
});

it("uses ordinary replies in private chats and for anonymous admins", async (t) => {
  const { run, message, events, reply } = await setup(t, "failure");
  assert.ok(message.from);
  message.from.is_bot = true;
  await run();
  assert.deepEqual(
    events.filter((event) => event !== "download"),
    ["public"],
  );
  assert.equal(reply.mock.calls[0].arguments[1]?.ephemeral_message_parameters, undefined);
});

it("keeps the status in the original topic", async (t) => {
  const { run, message, reply } = await setup(t);
  message.message_thread_id = 42;
  await run();
  assert.equal(reply.mock.calls[0].arguments[1]?.message_thread_id, 42);
});

it("keeps a failure notice that carries the deleted link within Telegram's text limit", async (t) => {
  const { run, ctx, message, edits } = await setup(t);
  message.text = `https://example.com/video ${"x".repeat(4050)}`;
  Object.assign(ctx, {
    replyWithVideo: async () => {
      throw new Error("Upload failed");
    },
  });
  await run();
  assert.ok(String(edits[0][3]).length <= 4096);
  assert.match(String(edits[0][3]), /@testuser: https/);
});

it("sends a single photo as its own message", async (t) => {
  const { run, events } = await setup(t, "photo");
  await run();
  assert.deepEqual(events.slice(-3), ["delete", "media", "delete-status"]);
});

it("delivers media even if the status cannot be removed", async (t) => {
  const { run, ctx, events, edits } = await setup(t, "gallery");
  t.mock.method(ctx.api, "deleteEphemeralMessage", async () => {
    throw new Error("Cannot delete message");
  });
  await run();
  assert.equal(events.at(-1), "media");
  assert.deepEqual(edits, []);
});

it("sends the yt-dlp thumbnail as the cover and starts at the linked time", async (t) => {
  const { run, videos } = await setup(t, "video", "https://example.com/video?t=1m30s");
  await run();
  const media = videos[0][1] as VideoOptions;
  assert.ok(media.cover instanceof InputFile);
  assert.equal(media.start_timestamp, 90);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("ignores a linked time beyond the end of the video", async (t) => {
  const { run, videos } = await setup(t, "video", "https://example.com/video?t=601");
  await run();
  assert.equal((videos[0][1] as VideoOptions).start_timestamp, undefined);
});
