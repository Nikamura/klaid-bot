import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { InputFile, InputMediaBuilder } from "grammy";
import type { Message } from "grammy/types";
import { discoverUrls } from "./discover-urls.js";
import { GalleryDownloadError, downloadGallery } from "./download-gallery.js";
import type { BotContext } from "./types/bot-context.js";
import { config } from "./utils/config.js";
import type { logger as globalLogger } from "./utils/logger.js";

export class VideoDownloadError extends Error {
  constructor(
    public videoUrl: string,
    message: string | null,
  ) {
    super(message ?? "Failed to download video");
    this.name = "VideoDownloadError";
  }
}

function findSubtitleFile(downloadDir: string, fileName: string): string | null {
  let files: string[];
  try {
    files = readdirSync(downloadDir);
  } catch {
    return null;
  }
  const srtMatches = files.filter((f) => f.startsWith(`${fileName}.`) && /\.en[^.]*\.srt$/.test(f));
  if (srtMatches.length > 0) {
    const exact = srtMatches.find((f) => f === `${fileName}.en.srt`);
    return `${downloadDir}/${exact ?? srtMatches.sort()[0]}`;
  }
  // Fallback to .vtt in case --convert-subs failed
  const vttMatches = files.filter((f) => f.startsWith(`${fileName}.`) && /\.en[^.]*\.vtt$/.test(f));
  if (vttMatches.length > 0) {
    return `${downloadDir}/${vttMatches.sort()[0]}`;
  }
  return null;
}

function cleanupSubtitleFiles(downloadDir: string, fileName: string): void {
  try {
    const files = readdirSync(downloadDir);
    for (const f of files) {
      if (f.startsWith(`${fileName}.`) && /\.(srt|vtt|ass)$/.test(f)) {
        try {
          unlinkSync(`${downloadDir}/${f}`);
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // best-effort
  }
}

function escapeSubtitlePath(filePath: string): string {
  return filePath.replace(/([:\\[\]'])/g, "\\$1");
}

async function burnSubtitles(videoPath: string, subtitlePath: string): Promise<string> {
  const outputPath = videoPath.replace(/\.mp4$/, ".subs.mp4");
  const escapedSubPath = escapeSubtitlePath(subtitlePath);

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-i",
        videoPath,
        "-vf",
        `subtitles=${escapedSubPath}:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1'`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ],
      { timeout: 120_000 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  return outputPath;
}

async function dowloadVideo(fileName: string, videoUrl: string): Promise<string> {
  const downloadDir = config.KLAID_DOWNLOAD_DIR;

  await new Promise<void>((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "--impersonate",
        "chrome",
        "--merge-output-format",
        "mp4",
        "--write-subs",
        "--write-auto-subs",
        "--sub-lang",
        "en",
        "--convert-subs",
        "srt",
        "--embed-thumbnail",
        "--embed-metadata",
        "-o",
        `${downloadDir}/${fileName}.%(ext)s`,
        "--max-filesize",
        "50M",
        videoUrl,
      ],
      (error) => {
        if (error) {
          reject(new VideoDownloadError(videoUrl, error.message));
          return;
        }
        resolve();
      },
    );
  });

  const videoPath = `${downloadDir}/${fileName}.mp4`;
  const subtitlePath = findSubtitleFile(downloadDir, fileName);

  if (!subtitlePath) {
    cleanupSubtitleFiles(downloadDir, fileName);
    return videoPath;
  }

  try {
    const burnedVideoPath = await burnSubtitles(videoPath, subtitlePath);
    unlinkSync(videoPath);
    cleanupSubtitleFiles(downloadDir, fileName);
    return burnedVideoPath;
  } catch {
    // ffmpeg failed — fall back to video without subs
    try {
      unlinkSync(videoPath.replace(/\.mp4$/, ".subs.mp4"));
    } catch {
      // may not exist
    }
    cleanupSubtitleFiles(downloadDir, fileName);
    return videoPath;
  }
}

export interface VideoMeta {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
}

export async function fetchVideoMeta(videoUrl: string, timeoutMs = 10_000): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "yt-dlp",
      ["--impersonate", "chrome", "--dump-json", "--no-download", videoUrl],
      { maxBuffer: 1024 * 1024, timeout: timeoutMs },
      (error, stdout) => {
        if (error) {
          reject(new VideoDownloadError(videoUrl, error.message));
          return;
        }
        try {
          const data = JSON.parse(stdout);
          resolve({
            title: data.title || data.fulltitle || "Video",
            thumbnail: data.thumbnail || null,
            duration: data.duration ? Math.round(data.duration) : null,
            uploader: data.uploader || data.channel || null,
          });
        } catch {
          resolve({ title: "Video", thumbnail: null, duration: null, uploader: null });
        }
      },
    );
    child.stdin?.end();
  });
}

export interface VideoDownload {
  type: "video";
  videoPath: string;
  meta: VideoMeta | null;
}

export interface GalleryDownload {
  type: "gallery";
  filePaths: string[];
  galleryDir: string;
}

export type MediaDownload = VideoDownload | GalleryDownload;

export async function downloadMedia(logger: typeof globalLogger, url: string, index: number): Promise<MediaDownload> {
  const fileName = `${Date.now()}-${index}`;

  try {
    logger.debug("Trying video download", { url });
    const [videoPath, meta] = await Promise.all([dowloadVideo(fileName, url), fetchVideoMeta(url).catch(() => null)]);
    return { type: "video", videoPath, meta };
  } catch (videoErr) {
    if (!(videoErr instanceof VideoDownloadError)) throw videoErr;

    logger.debug("Video download failed, trying gallery download", { url, videoError: videoErr.message });
    const galleryDir = `${config.KLAID_DOWNLOAD_DIR}/gallery-${fileName}`;
    mkdirSync(galleryDir, { recursive: true });

    try {
      const filePaths = await downloadGallery(galleryDir, url);
      return { type: "gallery", filePaths, galleryDir };
    } catch (galleryErr) {
      // Clean up empty gallery dir on failure
      rmSync(galleryDir, { recursive: true, force: true });
      if (galleryErr instanceof GalleryDownloadError) {
        throw new VideoDownloadError(
          url,
          `Video download failed: ${videoErr.message}\nGallery download failed: ${galleryErr.message}`,
        );
      }
      throw galleryErr;
    }
  }
}

export async function downloadVideos(logger: typeof globalLogger, urls: string[]): Promise<{ videoPath: string }[]> {
  return await Promise.all(
    urls.map(async (url, index) => {
      logger.debug("Downloading video", { url });
      const videoPath = await dowloadVideo(`${Date.now()}-${index}`, url);
      return { videoPath };
    }),
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMeta(meta: VideoMeta): string {
  const parts = [
    meta.title,
    [meta.uploader, meta.duration ? formatDuration(meta.duration) : null].filter(Boolean).join(" \u2022 "),
  ];
  return parts.filter(Boolean).join("\n");
}

async function downloadAllMedia(logger: typeof globalLogger, urls: string[]): Promise<MediaDownload[]> {
  return await Promise.all(urls.map((url, index) => downloadMedia(logger, url, index)));
}

export async function downloadMediaFromMessage(
  message: Message,
  text: string,
  logger: typeof globalLogger,
  ctx: BotContext,
  whitelist: undefined | string[],
  autoDeleteMessage: boolean,
) {
  const username = message.from?.username;
  const firstLastName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
  const user = username ? `@${username}` : firstLastName;

  const urls = discoverUrls(logger, text, whitelist);
  if (!urls.length) return;

  logger.debug("Received message", { urls, user, chat: message.chat });

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

  const downloads: MediaDownload[] = await downloadAllMedia(logger, urls).catch(async (err) => {
    if (err instanceof VideoDownloadError) {
      await ctx.reply([caption, `Error downloading media:\n\n${err.message}`].filter(Boolean).join("\n\n---\n\n"), {
        disable_web_page_preview: true,
        disable_notification: true,
        reply_to_message_id: message.message_id,
        allow_sending_without_reply: true,
      });
      return [];
    }
    throw err;
  });

  if (downloads.length) {
    const videos = downloads.filter((d): d is VideoDownload => d.type === "video");
    const galleries = downloads.filter((d): d is GalleryDownload => d.type === "gallery");

    try {
      if (videos.length) {
        await ctx.replyWithMediaGroup(
          videos.map((download, i) => {
            const parts = [i === 0 ? caption : null, download.meta ? formatMeta(download.meta) : null];
            const videoCaption = parts.filter(Boolean).join("\n\n") || undefined;
            return InputMediaBuilder.video(new InputFile(download.videoPath), {
              caption: videoCaption,
            });
          }),
          {
            reply_to_message_id: message.message_id,
            allow_sending_without_reply: true,
          },
        );
      }

      for (const gallery of galleries) {
        const galleryCaption = !videos.length && gallery === galleries[0] ? caption : null;
        if (gallery.filePaths.length === 1) {
          await ctx.replyWithPhoto(new InputFile(gallery.filePaths[0]), {
            caption: galleryCaption ?? undefined,
            reply_to_message_id: message.message_id,
            allow_sending_without_reply: true,
          });
        } else {
          await ctx.replyWithMediaGroup(
            gallery.filePaths.map((filePath, i) =>
              InputMediaBuilder.photo(new InputFile(filePath), {
                caption: i === 0 ? galleryCaption ?? undefined : undefined,
              }),
            ),
            {
              reply_to_message_id: message.message_id,
              allow_sending_without_reply: true,
            },
          );
        }
      }
    } catch (err) {
      logger.error("Error sending media group", err);
      if (err instanceof Error) {
        await ctx.reply([caption, `Error sending media:\n\n${err.message}`].filter(Boolean).join("\n\n---\n\n"), {
          disable_web_page_preview: true,
          disable_notification: true,
          reply_to_message_id: message.message_id,
          allow_sending_without_reply: true,
        });
      }
    }

    // Clean up downloaded files
    for (const download of downloads) {
      if (download.type === "video") {
        unlinkSync(download.videoPath);
      } else {
        rmSync(download.galleryDir, { recursive: true, force: true });
      }
    }
  }

  logger.debug("Finished downloading media", {
    urls,
    user,
    chat: message.chat,
  });
}
