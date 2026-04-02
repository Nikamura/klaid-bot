import { randomUUID } from "node:crypto";
import { rmSync, unlinkSync } from "node:fs";
import { InlineKeyboard, InputFile, InputMediaBuilder } from "grammy";
import { discoverUrls } from "./discover-urls.js";
import { type MediaDownload, type VideoMeta, downloadMedia, fetchVideoMeta } from "./download-video.js";
import type { BotContext } from "./types/bot-context.js";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMeta(meta: VideoMeta, url: string): string {
  const parts = [
    `<b>${meta.title}</b>`,
    [meta.uploader, meta.duration ? formatDuration(meta.duration) : null].filter(Boolean).join(" \u2022 "),
    `<a href="${url}">Source</a>`,
  ];
  return parts.filter(Boolean).join("\n");
}

export async function handleInlineQuery(ctx: BotContext) {
  const query = ctx.inlineQuery?.query?.trim();
  if (!query) {
    await ctx.answerInlineQuery([]);
    return;
  }

  const urls = discoverUrls(ctx.logger, query, undefined);
  if (!urls.length) {
    await ctx.answerInlineQuery([]);
    return;
  }

  const url = urls[0];

  await ctx.answerInlineQuery(
    [
      {
        type: "article" as const,
        id: randomUUID(),
        title: "\u{1F3AC} Tap to download & share",
        description: url,
        thumbnail_url: "https://img.icons8.com/color/480/video.png",
        input_message_content: {
          message_text: `\u23F3 Downloading media...\n<a href="${url}">${url}</a>`,
          parse_mode: "HTML" as const,
        },
        reply_markup: new InlineKeyboard().text("\u23F3 Downloading...", "noop"),
      },
    ],
    { cache_time: 0 },
  );
}

function cleanupDownload(download: MediaDownload) {
  if (download.type === "video") {
    try {
      unlinkSync(download.videoPath);
    } catch {
      // File may not exist if download failed
    }
  } else {
    rmSync(download.galleryDir, { recursive: true, force: true });
  }
}

export async function handleChosenInlineResult(ctx: BotContext) {
  const chosenResult = ctx.chosenInlineResult;
  if (!chosenResult) return;

  const inlineMessageId = chosenResult.inline_message_id;
  if (!inlineMessageId) {
    ctx.logger.warn("No inline_message_id in chosen_inline_result");
    return;
  }

  const query = chosenResult.query?.trim();
  if (!query) return;

  const urls = discoverUrls(ctx.logger, query, undefined);
  if (!urls.length) return;

  const url = urls[0];
  let download: MediaDownload | null = null;

  try {
    // Fetch metadata and download media in parallel
    const metaPromise = fetchVideoMeta(url).catch((err) => {
      ctx.logger.debug("Failed to fetch metadata", err);
      return null;
    });
    const downloadPromise = downloadMedia(ctx.logger, url, 0);

    // Update message with metadata as soon as it arrives
    metaPromise.then(async (meta) => {
      if (!meta) return;
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, `\u23F3 Downloading media...\n${formatMeta(meta, url)}`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("\u23F3 Downloading...", "noop"),
        });
      } catch {
        // Edit may fail if media already replaced the message
      }
    });

    download = await downloadPromise;

    const userId = chosenResult.from.id;
    const meta = await metaPromise;

    if (download.type === "video") {
      const tempMessage = await ctx.api.sendVideo(userId, new InputFile(download.videoPath));
      const fileId = tempMessage.video?.file_id;

      if (!fileId) {
        await ctx.api.editMessageTextInline(
          inlineMessageId,
          `\u274C Failed to process video\n<a href="${url}">${url}</a>`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } },
        );
        return;
      }

      const caption = meta ? formatMeta(meta, url) : `<a href="${url}">Source</a>`;
      const media = InputMediaBuilder.video(fileId, { caption, parse_mode: "HTML" });
      await ctx.api.editMessageMediaInline(inlineMessageId, media, {
        reply_markup: { inline_keyboard: [] },
      });

      await ctx.api.deleteMessage(userId, tempMessage.message_id).catch(() => {});
    } else {
      // Gallery: send first photo to get file_id, then edit inline message
      const firstPhoto = download.filePaths[0];
      const tempMessage = await ctx.api.sendPhoto(userId, new InputFile(firstPhoto));
      const fileId = tempMessage.photo?.[tempMessage.photo.length - 1]?.file_id;

      if (!fileId) {
        await ctx.api.editMessageTextInline(
          inlineMessageId,
          `\u274C Failed to process gallery\n<a href="${url}">${url}</a>`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } },
        );
        return;
      }

      const caption = `<a href="${url}">Source</a> (${download.filePaths.length} image${
        download.filePaths.length > 1 ? "s" : ""
      })`;
      const media = InputMediaBuilder.photo(fileId, { caption, parse_mode: "HTML" });
      await ctx.api.editMessageMediaInline(inlineMessageId, media, {
        reply_markup: { inline_keyboard: [] },
      });

      await ctx.api.deleteMessage(userId, tempMessage.message_id).catch(() => {});
    }
  } catch (err) {
    ctx.logger.error("Inline download failed", err);
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    try {
      await ctx.api.editMessageTextInline(
        inlineMessageId,
        `\u274C Download failed\n<a href="${url}">${url}</a>\n\n<i>${errorMsg}</i>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } },
      );
    } catch {
      // Edit may fail if message was deleted
    }
  } finally {
    if (download) {
      cleanupDownload(download);
    }
  }
}
