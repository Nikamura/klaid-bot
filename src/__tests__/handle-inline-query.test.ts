import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it, type TestContext } from "node:test";
import { GrammyError } from "grammy";
import type { BotContext } from "../types/bot-context.js";
import { createMockLogger } from "./utils/mock-logger.js";

const downloadDir = mkdtempSync(join(tmpdir(), "klaid-inline-"));
process.env.KLAID_TELEGRAM_BOT_TOKEN = "test-token";
process.env.KLAID_DOWNLOAD_DIR = downloadDir;
after(() => rmSync(downloadDir, { recursive: true, force: true }));

const url = "https://example.com/video?a=1&b=2";

async function setup(t: TestContext, mode: "video" | "gallery" | "failure" | "blocked" = "video") {
  const textEdits: unknown[][] = [];
  const mediaEdits: unknown[][] = [];
  const uploads: unknown[][] = [];
  let metaCalls = 0;
  const ctx = {
    logger: createMockLogger(),
    me: { username: "klaidbot" },
    chosenInlineResult: { inline_message_id: "inline-1", query: url, from: { id: 789 } },
    api: {
      editMessageTextInline: async (...args: unknown[]) => {
        textEdits.push(args);
        return true;
      },
      editMessageMediaInline: async (...args: unknown[]) => {
        mediaEdits.push(args);
        return true;
      },
      sendVideo: async (...args: unknown[]) => {
        if (mode === "blocked") {
          throw new GrammyError("blocked", { ok: false, error_code: 403, description: "Forbidden" }, "sendVideo", {});
        }
        uploads.push(args);
        return {
          message_id: 5,
          video: { file_id: "video-id", cover: [{ file_id: "small" }, { file_id: "cover-id" }] },
        };
      },
      sendPhoto: async (...args: unknown[]) => {
        uploads.push(args);
        return { message_id: 6, photo: [{ file_id: "photo-id" }] };
      },
      deleteMessage: async () => true,
    },
  } as unknown as BotContext;
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    const executable = args[0];
    const flags = args[1] as string[];
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    if (mode === "failure" || (mode === "gallery" && executable !== "gallery-dl")) {
      callback(new Error("ERROR: <html> yt-dlp internals"), "", "ERROR: <html> yt-dlp internals");
    } else if (executable === "ffprobe") {
      callback(null, JSON.stringify({ streams: [{ width: 720, height: 1280 }], format: { duration: "600" } }), "");
    } else if (executable === "gallery-dl") {
      const directory = flags[flags.indexOf("-d") + 1];
      for (const name of ["1.jpg", "2.jpg", "3.jpg"]) writeFileSync(join(directory, name), "photo");
      callback(null, "", "");
    } else if (flags.includes("--dump-json")) {
      metaCalls++;
      callback(null, JSON.stringify({ title: "Cats <3 & dogs", uploader: "A&B", duration: 600 }), "");
    } else {
      const output = flags[flags.indexOf("-o") + 1];
      writeFileSync(output.replace("%(ext)s", "mp4"), "video");
      writeFileSync(output.replace("%(ext)s", "jpg"), "cover");
      callback(null, "", "");
    }
    return { stdin: { end() {} } };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const { handleChosenInlineResult } = await import("../handle-inline-query.js");
  return { run: () => handleChosenInlineResult(ctx), textEdits, mediaEdits, uploads, metaCalls: () => metaCalls };
}

it("replaces the placeholder with the video, an escaped caption and the stored cover", async (t) => {
  const { run, mediaEdits, uploads, metaCalls } = await setup(t);
  await run();
  const media = mediaEdits[0][1] as { caption: string; cover: string; media: string };
  assert.equal(media.media, "video-id");
  assert.equal(media.cover, "cover-id");
  assert.equal(
    media.caption,
    '<a href="https://example.com/video?a=1&amp;b=2"><b>Cats &lt;3 &amp; dogs</b></a>\nA&amp;B \u2022 10:00',
  );
  assert.equal(uploads[0][0], 789);
  assert.deepEqual(
    (({ width, height, duration, supports_streaming }) => [width, height, duration, supports_streaming])(
      uploads[0][2] as Record<string, unknown>,
    ),
    [720, 1280, 600, true],
  );
  // The non-TikTok downloader tries once with impersonation; metadata is not fetched a second time by the download.
  assert.equal(metaCalls(), 1);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("says which photo of a gallery is shown", async (t) => {
  const { run, mediaEdits } = await setup(t, "gallery");
  await run();
  assert.match((mediaEdits[0][1] as { caption: string }).caption, /^Photo 1 of 3 /);
  assert.deepEqual(readdirSync(downloadDir), []);
});

it("shows a plain failure message without downloader output", async (t) => {
  const { run, textEdits } = await setup(t, "failure");
  await run();
  const text = String(textEdits.at(-1)?.[1]);
  assert.match(text, /Download failed/);
  assert.match(text, /The source site rejected the download request/);
  assert.doesNotMatch(text, /yt-dlp|<html>/);
});

it("asks the user to start the bot when it cannot message them", async (t) => {
  const { run, textEdits } = await setup(t, "blocked");
  await run();
  const [, text, options] = textEdits.at(-1) as [
    string,
    string,
    { reply_markup: { inline_keyboard: { url: string }[][] } },
  ];
  assert.match(text, /press Start/);
  assert.equal(options.reply_markup.inline_keyboard[0][0].url, "https://t.me/klaidbot");
  assert.deepEqual(readdirSync(downloadDir), []);
});
