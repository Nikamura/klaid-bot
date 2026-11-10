import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { InputFile, InputMediaBuilder } from "grammy";
import type { Message } from "grammy/types";
import { discoverUrls } from "./discover-urls.js";
import { downloadGallery, GalleryDownloadError } from "./download-gallery.js";
import type { BotContext } from "./types/bot-context.js";
import { config } from "./utils/config.js";
import type { logger as globalLogger } from "./utils/logger.js";

const DEFAULT_DOWNLOAD_ERROR_MESSAGE =
  "The source site rejected the download request, or the media is private or unavailable. Please try again later.";
const TELEGRAM_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const YT_DLP_MAX_FILESIZE = "50M";
const YT_DLP_VIDEO_FORMAT = "bv*[height<=1080][filesize<50M]+ba/bv*[height<=720]+ba/bv*[height<=480]+ba/b";

export class VideoDownloadError extends Error {
  constructor(
    public videoUrl: string,
    message: string | null,
    public userMessage = DEFAULT_DOWNLOAD_ERROR_MESSAGE,
  ) {
    super(message ?? "Failed to download video");
    this.name = "VideoDownloadError";
  }
}

interface YtDlpRequestAttempt {
  executable: string;
  args: string[];
}

export function isTikTokUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ["tiktok.com", "tiktokv.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function buildYtDlpRequestAttempts(
  videoUrl: string,
  args: string[],
  tiktokExecutable = config.KLAID_TIKTOK_YT_DLP,
): YtDlpRequestAttempt[] {
  if (isTikTokUrl(videoUrl)) {
    return [{ executable: tiktokExecutable, args: [...args] }];
  }
  return [
    { executable: "yt-dlp", args: ["--impersonate", "chrome", ...args] },
    { executable: "yt-dlp", args: [...args] },
  ];
}

export function buildYtDlpDownloadArgs(downloadDir: string, fileName: string, videoUrl: string): string[] {
  return [
    "-f",
    YT_DLP_VIDEO_FORMAT,
    "--format-sort",
    "vcodec:h264",
    "--merge-output-format",
    "mp4",
    "--write-subs",
    "--write-auto-subs",
    "--sub-lang",
    "en",
    "--convert-subs",
    "srt",
    "--embed-thumbnail",
    // Keep the thumbnail next to the video as well, so it can be uploaded as the Telegram cover.
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "--embed-metadata",
    "-o",
    `${downloadDir}/${fileName}.%(ext)s`,
    "--max-filesize",
    YT_DLP_MAX_FILESIZE,
    videoUrl,
  ];
}

async function runYtDlp(
  videoUrl: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number } = {},
): Promise<string> {
  const errors: string[] = [];

  for (const attempt of buildYtDlpRequestAttempts(videoUrl, args)) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const child = execFile(attempt.executable, attempt.args, options, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.trim() || error.message));
            return;
          }
          resolve(stdout);
        });
        child.stdin?.end();
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new VideoDownloadError(videoUrl, errors.join("\n\nFallback attempt failed:\n"));
}

function cleanupDownloadFiles(downloadDir: string, fileName: string): void {
  try {
    const files = readdirSync(downloadDir);
    for (const file of files) {
      if (file.startsWith(`${fileName}.`)) {
        try {
          unlinkSync(`${downloadDir}/${file}`);
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // best-effort
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

  try {
    await runYtDlp(videoUrl, buildYtDlpDownloadArgs(downloadDir, fileName, videoUrl));
  } catch (error) {
    cleanupDownloadFiles(downloadDir, fileName);
    throw error;
  }

  const videoPath = `${downloadDir}/${fileName}.mp4`;

  if (!existsSync(videoPath) || statSync(videoPath).size >= TELEGRAM_MAX_VIDEO_BYTES) {
    // yt-dlp can exit successfully without a file when --max-filesize rejects it. Also verify the final merged file,
    // since individually acceptable video and audio streams can exceed Telegram's limit after merging.
    cleanupDownloadFiles(downloadDir, fileName);
    throw new VideoDownloadError(
      videoUrl,
      "Video file too large or unavailable",
      "The video is unavailable or exceeds the 50 MB download limit.",
    );
  }

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

interface VideoProbe {
  width?: number;
  height?: number;
  duration?: number;
}

/** Reads the real dimensions and length of the downloaded file, so Telegram can lay the video out before it loads. */
async function probeVideo(videoPath: string): Promise<VideoProbe> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height:stream_side_data=rotation:format=duration",
          "-of",
          "json",
          videoPath,
        ],
        { timeout: 10_000 },
        (error, out) => (error ? reject(error) : resolve(out)),
      );
    });
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];
    const rotation = Math.abs(Number(stream?.side_data_list?.[0]?.rotation ?? 0));
    const sideways = rotation === 90 || rotation === 270;
    const duration = Number(data.format?.duration);
    return {
      width: (sideways ? stream?.height : stream?.width) || undefined,
      height: (sideways ? stream?.width : stream?.height) || undefined,
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    };
  } catch {
    return {};
  }
}

function findCoverFile(fileName: string): string | null {
  const coverPath = `${config.KLAID_DOWNLOAD_DIR}/${fileName}.jpg`;
  return existsSync(coverPath) ? coverPath : null;
}

/**
 * Reads the start time a video link points at (`?t=90`, `?t=1m30s`, `?start=90`, `#t=90`), in seconds.
 */
export function parseStartTimestamp(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const query = parsed.searchParams;
  const raw =
    query.get("t") ??
    query.get("start") ??
    query.get("time_continue") ??
    new URLSearchParams(parsed.hash.slice(1)).get("t");
  const match = raw ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw) : null;
  if (!match) return undefined;
  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
}

export interface VideoMeta {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
}

export async function fetchVideoMeta(videoUrl: string, timeoutMs = 10_000): Promise<VideoMeta> {
  const stdout = await runYtDlp(videoUrl, ["--dump-json", "--no-download", videoUrl], {
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
  });

  try {
    const data = JSON.parse(stdout);
    return {
      title: data.title || data.fulltitle || "Video",
      thumbnail: data.thumbnail || null,
      duration: data.duration ? Math.round(data.duration) : null,
      uploader: data.uploader || data.channel || null,
    };
  } catch {
    return { title: "Video", thumbnail: null, duration: null, uploader: null };
  }
}

export interface VideoDownload extends VideoProbe {
  type: "video";
  url: string;
  videoPath: string;
  /** JPEG thumbnail saved by yt-dlp, sent as the video cover. */
  coverPath: string | null;
  /** Where playback starts, taken from the source URL. */
  startTimestamp?: number;
  meta: VideoMeta | null;
}

export function cleanupDownload(download: MediaDownload): void {
  if (download.type === "video") {
    for (const filePath of [download.videoPath, download.coverPath]) {
      if (filePath) rmSync(filePath, { force: true });
    }
  } else {
    rmSync(download.galleryDir, { recursive: true, force: true });
  }
}

export interface GalleryDownload {
  type: "gallery";
  filePaths: string[];
  galleryDir: string;
}

export type MediaDownload = VideoDownload | GalleryDownload;

export async function downloadMedia(
  logger: typeof globalLogger,
  url: string,
  index: number,
  metaPromise: Promise<VideoMeta | null> = fetchVideoMeta(url).catch(() => null),
): Promise<MediaDownload> {
  const fileName = `${Date.now()}-${index}`;

  try {
    logger.debug("Trying video download", { url });
    const [videoPath, meta] = await Promise.all([dowloadVideo(fileName, url), metaPromise]);
    const probe = await probeVideo(videoPath);
    // `t` is not a start time on every site, so only trust it when it falls inside the known duration.
    const start = parseStartTimestamp(url);
    const duration = probe.duration ?? meta?.duration;
    const startTimestamp = start && duration && start < duration ? start : undefined;
    return { type: "video", url, videoPath, coverPath: findCoverFile(fileName), startTimestamp, meta, ...probe };
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
        logger.warn("Video and gallery download failed", {
          url,
          videoError: videoErr.message,
          galleryError: galleryErr.message,
        });
        throw new VideoDownloadError(
          url,
          `Video download failed: ${videoErr.message}\nGallery download failed: ${galleryErr.message}`,
          videoErr.userMessage,
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
      const fileName = `${Date.now()}-${index}`;
      const videoPath = await dowloadVideo(fileName, url);
      rmSync(`${config.KLAID_DOWNLOAD_DIR}/${fileName}.jpg`, { force: true });
      return { videoPath };
    }),
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Builds an HTML caption: an optional plain-text prefix, then the title linked to the source and the uploader and
 * length. Everything is cut before escaping, so the result stays within Telegram's limit without breaking a tag.
 */
export function formatVideoCaption(prefix: string | null, meta: VideoMeta | null, url: string): string {
  const title = meta ? meta.title.slice(0, 200) : "Source";
  const details = meta
    ? [meta.uploader, meta.duration ? formatDuration(meta.duration) : null]
        .filter(Boolean)
        .join(" \u2022 ")
        .slice(0, 100)
    : "";
  const label = meta ? `<b>${escapeHtml(title)}</b>` : title;
  const metaLines = [`<a href="${escapeHtml(url)}">${label}</a>`, escapeHtml(details)].filter(Boolean).join("\n");
  const prefixBudget = TELEGRAM_CAPTION_LIMIT - title.length - details.length - 3;
  return [prefix ? escapeHtml(prefix.slice(0, prefixBudget)) : null, metaLines].filter(Boolean).join("\n\n");
}

/** Shows "sending a video…" under the chat title until stopped; Telegram clears the action after five seconds. */
function startChatAction(ctx: BotContext, messageThreadId: number | undefined): () => void {
  const send = () => {
    Promise.resolve()
      .then(() => ctx.replyWithChatAction("upload_video", { message_thread_id: messageThreadId }))
      .catch(() => {});
  };
  send();
  const timer = setInterval(send, 4500);
  timer.unref();
  return () => clearInterval(timer);
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

  const chatId = message.chat.id;
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  // Ephemeral messages are shown only to this user and the bot. Sending one unprompted requires the bot to be a
  // chat administrator, so this is cleared again as soon as Telegram refuses one.
  let ephemeralReceiverId = isGroup && message.from && !message.from.is_bot ? message.from.id : undefined;
  let statusMessageId: number | undefined;
  // Set once the author's message is deleted, so that the media and any later notice still carry the link.
  let caption: string | null = null;
  const statusText = (status: string) =>
    [status, caption?.slice(0, 4096 - status.length - 2)].filter(Boolean).join("\n\n");
  const noticeOptions = {
    link_preview_options: { is_disabled: true },
    disable_notification: true,
    message_thread_id: message.message_thread_id,
  };

  const sendEphemeral = async (status: string): Promise<number | undefined> => {
    if (ephemeralReceiverId === undefined) return undefined;
    try {
      const sent = await ctx.reply(statusText(status), {
        ...noticeOptions,
        ephemeral_message_parameters: { receiver_user_id: ephemeralReceiverId },
      });
      if (sent.ephemeral_message_id === undefined) {
        // A Bot API server older than 10.3 ignores the parameter and posts publicly; take that back.
        ephemeralReceiverId = undefined;
        await ctx.api.deleteMessage(chatId, sent.message_id).catch(() => {});
        return undefined;
      }
      return sent.ephemeral_message_id;
    } catch (err) {
      logger.warn("Could not send an ephemeral message; the bot may not be a chat administrator", err);
      ephemeralReceiverId = undefined;
      return undefined;
    }
  };

  // The author's message stays in place until the media is ready, so a failed download never loses the link.
  if (autoDeleteMessage) {
    statusMessageId = await sendEphemeral("Downloading… Your media will appear shortly.");
  }

  const reportFailure = async (status: string) => {
    if (ephemeralReceiverId !== undefined && statusMessageId !== undefined) {
      try {
        await ctx.api.editEphemeralMessageText(chatId, ephemeralReceiverId, statusMessageId, statusText(status), {
          link_preview_options: { is_disabled: true },
        });
        return;
      } catch (err) {
        logger.error("Error updating download status", err);
      }
    }
    if ((await sendEphemeral(status)) !== undefined) return;
    // Private chats, and groups where the bot cannot send ephemeral messages, get an ordinary reply.
    try {
      await ctx.reply(statusText(status), {
        ...noticeOptions,
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      });
    } catch (err) {
      logger.error("Error sending download failure notice", err);
    }
  };

  const stopChatAction = startChatAction(ctx, message.message_thread_id);
  try {
    const downloads: MediaDownload[] = await downloadAllMedia(logger, urls).catch(async (err) => {
      logger.error("Error downloading media", err);
      if (err instanceof VideoDownloadError) {
        await reportFailure(`Couldn't download media:\n\n${err.userMessage}`);
        return [];
      }
      await reportFailure("Couldn't download media. Please try again later.");
      throw err;
    });

    if (downloads.length) {
      let authorsMessageDeleted = false;
      if (autoDeleteMessage) {
        await ctx
          .deleteMessage()
          .then(() => {
            authorsMessageDeleted = true;
            caption = `${user}: ${text}`;
          })
          .catch((err) => {
            logger.error("Error deleting message", err);
          });
      }

      const videos = downloads.filter((d): d is VideoDownload => d.type === "video");
      const galleries = downloads.filter((d): d is GalleryDownload => d.type === "gallery");

      const videoMedia = videos.map((download, i) =>
        InputMediaBuilder.video(new InputFile(download.videoPath), {
          cover: download.coverPath ? new InputFile(download.coverPath) : undefined,
          start_timestamp: download.startTimestamp,
          caption: formatVideoCaption(i === 0 ? caption : null, download.meta, download.url),
          parse_mode: "HTML",
          width: download.width,
          height: download.height,
          duration: download.duration,
          supports_streaming: true,
        }),
      );
      const galleryMedia = galleries.map((gallery, galleryIndex) =>
        gallery.filePaths.map((filePath, i) =>
          InputMediaBuilder.photo(new InputFile(filePath), {
            caption: !videos.length && galleryIndex === 0 && i === 0 ? caption?.slice(0, 1024) : undefined,
          }),
        ),
      );
      const batches = [videoMedia, ...galleryMedia].filter((batch) => batch.length);
      const mediaOptions = {
        message_thread_id: message.message_thread_id,
        reply_parameters: authorsMessageDeleted
          ? undefined
          : { message_id: message.message_id, allow_sending_without_reply: true },
      };

      try {
        for (const batch of batches) {
          if (batch.length === 1) {
            const media = batch[0];
            if (media.type === "video") {
              await ctx.replyWithVideo(media.media, {
                ...mediaOptions,
                caption: media.caption,
                parse_mode: media.parse_mode,
                cover: media.cover,
                start_timestamp: media.start_timestamp,
                width: media.width,
                height: media.height,
                duration: media.duration,
                supports_streaming: media.supports_streaming,
              });
            } else {
              await ctx.replyWithPhoto(media.media, { ...mediaOptions, caption: media.caption });
            }
          } else {
            await ctx.replyWithMediaGroup(batch, mediaOptions);
          }
        }
        if (ephemeralReceiverId !== undefined && statusMessageId !== undefined) {
          try {
            await ctx.api.deleteEphemeralMessage(chatId, ephemeralReceiverId, statusMessageId);
          } catch (err) {
            logger.error("Error deleting download status", err);
          }
        }
      } catch (err) {
        logger.error("Error sending media group", err);
        await reportFailure("Couldn't send all media. Please try again later.");
      } finally {
        // Clean up downloaded files even if reporting a delivery error fails.
        for (const download of downloads) cleanupDownload(download);
      }
    }
  } finally {
    stopChatAction();
  }

  logger.debug("Finished downloading media", {
    urls,
    user,
    chat: message.chat,
  });
}
