import { randomUUID } from "node:crypto";
import { GrammyError, InlineKeyboard, InputFile, InputMediaBuilder } from "grammy";
import { discoverUrls } from "./discover-urls.js";
import {
  cleanupDownload,
  downloadMedia,
  escapeHtml,
  fetchVideoMeta,
  formatVideoCaption,
  type MediaDownload,
  VideoDownloadError,
} from "./download-video.js";
import type { BotContext } from "./types/bot-context.js";
import { config } from "./utils/config.js";

function sourceLink(url: string, label = url): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
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
          message_text: `\u23F3 Downloading media...\n${sourceLink(url)}`,
          parse_mode: "HTML" as const,
        },
        reply_markup: new InlineKeyboard().text("\u23F3 Downloading...", "noop"),
      },
    ],
    { cache_time: 0 },
  );
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
  const userId = chosenResult.from.id;
  // Inline messages cannot take uploads, so the file goes to another chat first to obtain a file_id. Without a
  // storage chat that is the user's private chat, which only works once they have started the bot.
  const uploadChatId = config.KLAID_STORAGE_CHAT_ID ?? userId;
  const showFailure = async (html: string, keyboard?: InlineKeyboard) => {
    try {
      await ctx.api.editMessageTextInline(inlineMessageId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard ?? { inline_keyboard: [] },
      });
    } catch {
      // Edit may fail if message was deleted
    }
  };
  let download: MediaDownload | null = null;

  try {
    const metaPromise = fetchVideoMeta(url).catch((err) => {
      ctx.logger.debug("Failed to fetch metadata", err);
      return null;
    });
    const downloadPromise = downloadMedia(ctx.logger, url, 0, metaPromise);

    // Update message with metadata as soon as it arrives
    metaPromise.then(async (meta) => {
      if (!meta) return;
      try {
        await ctx.api.editMessageTextInline(
          inlineMessageId,
          `\u23F3 Downloading media...\n${formatVideoCaption(null, meta, url)}`,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: new InlineKeyboard().text("\u23F3 Downloading...", "noop"),
          },
        );
      } catch {
        // Edit may fail if media already replaced the message
      }
    });

    download = await downloadPromise;

    if (download.type === "video") {
      const tempMessage = await ctx.api.sendVideo(uploadChatId, new InputFile(download.videoPath), {
        cover: download.coverPath ? new InputFile(download.coverPath) : undefined,
        width: download.width,
        height: download.height,
        duration: download.duration,
        supports_streaming: true,
        disable_notification: true,
      });
      const fileId = tempMessage.video?.file_id;

      if (!fileId) {
        await showFailure(`\u274C Failed to process video\n${sourceLink(url)}`);
        return;
      }

      // Reuse the cover Telegram stored with the temporary message.
      const media = InputMediaBuilder.video(fileId, {
        caption: formatVideoCaption(null, download.meta, url),
        parse_mode: "HTML",
        cover: tempMessage.video?.cover?.at(-1)?.file_id,
        start_timestamp: download.startTimestamp,
      });
      await ctx.api.editMessageMediaInline(inlineMessageId, media, {
        reply_markup: { inline_keyboard: [] },
      });

      await ctx.api.deleteMessage(uploadChatId, tempMessage.message_id).catch(() => {});
    } else {
      // An inline message holds a single item, so only the first photo can be shown.
      const firstPhoto = download.filePaths[0];
      const tempMessage = await ctx.api.sendPhoto(uploadChatId, new InputFile(firstPhoto), {
        disable_notification: true,
      });
      const fileId = tempMessage.photo?.[tempMessage.photo.length - 1]?.file_id;

      if (!fileId) {
        await showFailure(`\u274C Failed to process gallery\n${sourceLink(url)}`);
        return;
      }

      const count = download.filePaths.length;
      const caption =
        count > 1
          ? `Photo 1 of ${count} \u2022 ${sourceLink(url, "see the rest at the source")}`
          : sourceLink(url, "Source");
      const media = InputMediaBuilder.photo(fileId, { caption, parse_mode: "HTML" });
      await ctx.api.editMessageMediaInline(inlineMessageId, media, {
        reply_markup: { inline_keyboard: [] },
      });

      await ctx.api.deleteMessage(uploadChatId, tempMessage.message_id).catch(() => {});
    }
  } catch (err) {
    ctx.logger.error("Inline download failed", err);
    if (download && uploadChatId === userId && err instanceof GrammyError && err.error_code === 403) {
      await showFailure(
        `\u274C I can't send you files yet\n${sourceLink(url)}\n\n<i>Open the bot, press Start, then try again.</i>`,
        new InlineKeyboard().url("Open the bot", `https://t.me/${ctx.me.username}`),
      );
      return;
    }
    // Downloader output is logged, not shown: it is noisy and can contain arbitrary markup.
    const reason =
      err instanceof VideoDownloadError ? err.userMessage : "Something went wrong. Please try again later.";
    await showFailure(`\u274C Download failed\n${sourceLink(url)}\n\n<i>${escapeHtml(reason)}</i>`);
  } finally {
    if (download) {
      cleanupDownload(download);
    }
  }
}
