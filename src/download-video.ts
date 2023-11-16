import { unlinkSync } from "fs";
import { ChildProcess, exec } from "node:child_process";
import { InputFile, InputMediaBuilder } from "grammy";
import { Message } from "grammy/types";
import { discoverUrls } from "./discover-urls";
import { BotContext } from "./types/bot-context";
import { config } from "./utils/config";
import { logger as globalLogger } from "./utils/logger";

export class VideoDownloadError extends Error {
  constructor(public videoUrl: string, message: string | null) {
    super(message ?? "Failed to download video");
    this.name = "VideoDownloadError";
  }
}

export async function dowloadVideo(fileName: string, videoUrl: string): Promise<string> {
  const downloadDir = config.get("KLAID_DOWNLOAD_DIR");
  const command = `yt-dlp --recode-video mp4 -o "${downloadDir}/${fileName}.%(ext)s" ${videoUrl}`;

  const process = await new Promise<ChildProcess>((resolve, reject) => {
    const childProcess = exec(command, (error) => {
      if (error) {
        reject(new VideoDownloadError(videoUrl, error.message));
        return;
      }
      resolve(childProcess);
    });
  });

  if (process.exitCode === 0) {
    return `${downloadDir}/${fileName}.mp4`;
  }

  throw new VideoDownloadError(videoUrl, null);
}

export async function downloadVideos(logger: typeof globalLogger, urls: string[]): Promise<string[]> {
  return await Promise.all(
    urls.map(async (url, index) => {
      logger.debug("Downloading video", { url });
      const videoPath = await dowloadVideo(`${Date.now()}-${index}`, url);
      return videoPath;
    })
  );
}
export async function downloadVideosFromMessage(
  message: Message,
  text: string,
  logger: typeof globalLogger,
  ctx: BotContext,
  whitelist: undefined | string[],
  autoDeleteMessage: boolean
) {
  const username = message.from?.username;
  const firstLastName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
  const user = username ? `@${username}` : firstLastName;

  const urls = discoverUrls(logger, text, whitelist);
  if (!urls.length) return;

  let authorsMessageDeleted = false;
  if (autoDeleteMessage) {
    await ctx
      .deleteMessage()
      .then(() => {
        authorsMessageDeleted = true;
      })
      .catch((err) => {
        logger.error("Error deleting message", err);
      });
  }

  const caption = authorsMessageDeleted ? `${user}: ${text}` : null;

  const downloads = await downloadVideos(logger, urls).catch(async (err) => {
    if (err instanceof VideoDownloadError) {
      await ctx.reply([caption, `Error downloading video:\n\n${err.message}`].filter(Boolean).join("\n\n---\n\n"), {
        disable_web_page_preview: true,
        disable_notification: true,
        reply_to_message_id: message.message_id,
        allow_sending_without_reply: true,
      });
      return [];
    } else {
      throw err;
    }
  });

  if (downloads.length) {
    await ctx.replyWithMediaGroup(
      downloads.map((download) => InputMediaBuilder.video(new InputFile(download), caption ? { caption } : {})),
      {
        reply_to_message_id: message.message_id,
        allow_sending_without_reply: true,
      }
    );

    // Delete downloaded videos
    for (const download of downloads) {
      unlinkSync(download);
    }
  }
}
